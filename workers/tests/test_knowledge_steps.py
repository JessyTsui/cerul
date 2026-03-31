import asyncio
import subprocess
import threading
import time
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from workers.common.config import reset_settings_cache
from workers.common.embedding import GeminiEmbeddingBackend
from workers.common.pipeline import PipelineContext
from workers.knowledge import InMemoryKnowledgeRepository, KnowledgeIndexingPipeline
from workers.knowledge.pipeline import DEFAULT_KNOWLEDGE_EMBEDDING_DIMENSION
from workers.knowledge.runtime import (
    HeuristicFrameAnalyzer,
    HeuristicSceneDetector,
    HttpVideoDownloader,
    OpenAICompatibleTranscriber,
    StaticKnowledgeMetadataClient,
    StaticKnowledgeTranscriber,
    YtDlpCaptionProvider,
    YtDlpVideoDownloader,
    _plan_transcription_chunks,
)
from workers.knowledge.steps import (
    AnalyzeKnowledgeFramesStep,
    DenseVisualEmbedStep,
    DetectKnowledgeScenesStep,
    DownloadKnowledgeVideoStep,
    EmbedKnowledgeSegmentsStep,
    FetchKnowledgeCaptionsStep,
    FetchKnowledgeMetadataStep,
    MarkKnowledgeJobCompletedStep,
    SegmentKnowledgeTranscriptStep,
    StoreKnowledgeSegmentsStep,
    TranscribeKnowledgeVideoStep,
)
from workers.knowledge.steps.dense_visual_embed import compute_dense_visual_timestamps
from workers.knowledge.steps.embed import compute_embedding_frame_timestamps


class FakeEmbeddingBackend:
    name = "fake-gemini"

    def dimension(self) -> int:
        return 768

    def embed_text(self, text: str) -> list[float]:
        seed = float(len(text.split()))
        return [seed + float(index) for index in range(self.dimension())]

    def embed_image(self, image_path: str) -> list[float]:
        raise NotImplementedError

    def embed_video(self, video_path: str) -> list[float]:
        raise NotImplementedError


class FakeMultimodalEmbeddingBackend(FakeEmbeddingBackend):
    def __init__(self) -> None:
        self.multimodal_calls: list[tuple[str, list[str]]] = []

    def dimension(self) -> int:
        return DEFAULT_KNOWLEDGE_EMBEDDING_DIMENSION

    def embed_multimodal(
        self,
        text: str,
        *,
        image_paths: list[str] | tuple[str, ...],
    ) -> list[float]:
        normalized_paths = [str(path) for path in image_paths]
        self.multimodal_calls.append((text, normalized_paths))
        seed = float(len(text.split()) + len(normalized_paths))
        return [seed + float(index) for index in range(self.dimension())]


class SlowFrameAnnotator:
    def available(self) -> bool:
        return True

    async def annotate(self, image_path: str | Path) -> dict[str, object]:
        await asyncio.sleep(0.05)
        return {
            "description": "Delayed frame annotation",
            "text_content": "demo",
            "visual_type": "slide",
            "visual_entities": ["demo"],
        }


class RecordingFrameAnnotator:
    def __init__(self) -> None:
        self.calls: list[str] = []

    def available(self) -> bool:
        return True

    async def annotate(self, image_path: str | Path) -> dict[str, object]:
        self.calls.append(Path(image_path).name)
        return {
            "description": "Annotated frame",
            "text_content": "visible text",
            "visual_type": "slide",
            "visual_entities": ["demo"],
        }


class ConcurrentRecordingFrameAnnotator:
    def __init__(self, delay_seconds: float = 0.02) -> None:
        self.calls: list[str] = []
        self.current = 0
        self.peak = 0
        self.delay_seconds = delay_seconds
        self._lock = asyncio.Lock()

    def available(self) -> bool:
        return True

    async def annotate(self, image_path: str | Path) -> dict[str, object]:
        async with self._lock:
            self.current += 1
            self.peak = max(self.peak, self.current)
        self.calls.append(Path(image_path).name)
        await asyncio.sleep(self.delay_seconds)
        async with self._lock:
            self.current -= 1
        return {
            "description": f"Annotated {Path(image_path).name}",
            "text_content": "visible text",
            "visual_type": "slide",
            "visual_entities": ["demo"],
        }


class SlowConcurrentEmbeddingBackend(FakeEmbeddingBackend):
    def __init__(self) -> None:
        self.current = 0
        self.peak = 0
        self._lock = threading.Lock()

    def embed_text(self, text: str) -> list[float]:
        with self._lock:
            self.current += 1
            self.peak = max(self.peak, self.current)
        time.sleep(0.02)
        with self._lock:
            self.current -= 1
        return [1.0 + float(index) for index in range(self.dimension())]


class FakeCaptionProvider:
    def __init__(self, segments: list[dict[str, object]]) -> None:
        self._segments = [dict(segment) for segment in segments]
        self.calls: list[tuple[dict[str, object], Path]] = []

    async def resolve_transcript_segments(
        self,
        video_metadata: dict[str, object],
        output_dir: Path,
    ) -> list[dict[str, object]]:
        self.calls.append((dict(video_metadata), output_dir))
        return [dict(segment) for segment in self._segments]


class FakeHtmlResponse:
    def __init__(self) -> None:
        self.headers = {"content-type": "text/html; charset=utf-8"}

    def raise_for_status(self) -> None:
        return None

    async def aiter_bytes(self):
        yield b"<html>watch page</html>"


class FakeStreamResponse:
    def __init__(self, chunks: list[bytes]) -> None:
        self._chunks = chunks
        self.headers = {"content-type": "video/mp4"}

    def raise_for_status(self) -> None:
        return None

    async def aiter_bytes(self):
        for chunk in self._chunks:
            yield chunk


class FakeStreamContext:
    def __init__(self, response: FakeStreamResponse) -> None:
        self._response = response

    async def __aenter__(self) -> FakeStreamResponse:
        return self._response

    async def __aexit__(self, exc_type, exc, tb) -> bool:
        return False


class FakeStreamingClient:
    def __init__(self, *args, **kwargs) -> None:
        self.response = FakeStreamResponse([b"fake-", b"video-", b"bytes"])

    async def __aenter__(self) -> "FakeStreamingClient":
        return self

    async def __aexit__(self, exc_type, exc, tb) -> bool:
        return False

    def stream(self, method: str, url: str) -> FakeStreamContext:
        return FakeStreamContext(self.response)


class FakeHtmlStreamContext:
    async def __aenter__(self) -> FakeHtmlResponse:
        return FakeHtmlResponse()

    async def __aexit__(self, exc_type, exc, tb) -> bool:
        return False


class FakeHtmlStreamingClient:
    def __init__(self, *args, **kwargs) -> None:
        return None

    async def __aenter__(self) -> "FakeHtmlStreamingClient":
        return self

    async def __aexit__(self, exc_type, exc, tb) -> bool:
        return False

    def stream(self, method: str, url: str) -> FakeHtmlStreamContext:
        return FakeHtmlStreamContext()


class FakeTranscriptionResponse:
    def __init__(self, payload: dict[str, object]) -> None:
        self._payload = payload
        self.is_success = True
        self.status_code = 200
        self.text = ""

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict[str, object]:
        return self._payload


class FakeTranscriptionClient:
    def __init__(
        self,
        *args,
        payload: dict[str, object] | None = None,
        **kwargs,
    ) -> None:
        self.calls: list[dict[str, object]] = []
        self.payload = payload or {
            "text": "agents coordinate tasks",
            "segments": [
                {
                    "start": 0.0,
                    "end": 4.5,
                    "text": "agents coordinate tasks",
                }
            ],
        }

    def __enter__(self) -> "FakeTranscriptionClient":
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        return False

    def post(
        self,
        url: str,
        *,
        headers: dict[str, str],
        data: dict[str, str],
        files: dict[str, tuple[str, object, str]],
    ) -> FakeTranscriptionResponse:
        self.calls.append(
            {
                "url": url,
                "headers": headers,
                "data": dict(data),
                "filename": files["file"][0],
            }
        )
        return FakeTranscriptionResponse(self.payload)


def _write_video(path: Path) -> Path:
    path.write_bytes(b"\x00\x00\x00\x18ftypmp42")
    return path


def test_fetch_knowledge_metadata_step_normalizes_youtube_payload() -> None:
    step = FetchKnowledgeMetadataStep(
        metadata_client=StaticKnowledgeMetadataClient(
            {
                "id": "openai-devday",
                "title": "OpenAI Dev Day Keynote",
                "description": "Reasoning models, agents, and platform updates.",
                "channel_title": "OpenAI",
                "published_at": "2025-11-06T00:00:00Z",
                "duration": "PT1H2M3S",
                "thumbnails": {
                    "high": {
                        "url": "https://img.youtube.com/vi/openai-devday/hqdefault.jpg"
                    }
                },
                "watch_url": "https://www.youtube.com/watch?v=openai-devday",
            }
        )
    )
    context = PipelineContext(data={"video_id": "openai-devday"})

    asyncio.run(step.run(context))

    video_metadata = context.data["video_metadata"]
    assert video_metadata["source"] == "youtube"
    assert video_metadata["source_video_id"] == "openai-devday"
    assert video_metadata["speaker"] == "OpenAI"
    assert video_metadata["duration_seconds"] == 3723
    assert video_metadata["download_url"] is None
    assert video_metadata["thumbnail_url"].endswith("/hqdefault.jpg")


def test_download_knowledge_video_step_copies_local_file(tmp_path: Path) -> None:
    source_video = _write_video(tmp_path / "source.mp4")
    step = DownloadKnowledgeVideoStep(video_downloader=HttpVideoDownloader())
    context = PipelineContext(
        data={
            "video_metadata": {
                "source": "youtube",
                "source_video_id": "openai-devday",
                "download_url": str(source_video),
            }
        }
    )

    asyncio.run(step.run(context))

    downloaded_path = Path(context.data["video_path"])
    assert downloaded_path.exists()
    assert downloaded_path.read_bytes() == source_video.read_bytes()
    assert Path(context.data["temp_dir"]).exists()


def test_download_knowledge_video_step_requires_explicit_download_url() -> None:
    step = DownloadKnowledgeVideoStep(video_downloader=HttpVideoDownloader())
    context = PipelineContext(
        data={
            "video_metadata": {
                "source": "youtube",
                "source_video_id": "openai-devday",
                "source_url": "https://www.youtube.com/watch?v=openai-devday",
                "video_url": "https://www.youtube.com/watch?v=openai-devday",
            }
        }
    )

    with pytest.raises(ValueError, match="explicit download_url"):
        asyncio.run(step.run(context))


def test_download_knowledge_video_step_streams_bytes_to_disk(tmp_path: Path) -> None:
    step = DownloadKnowledgeVideoStep(video_downloader=HttpVideoDownloader())
    context = PipelineContext(
        data={
            "video_metadata": {
                "source": "youtube",
                "source_video_id": "openai-devday",
                "download_url": "https://cdn.example.com/openai-devday.mp4",
            }
        }
    )

    with patch("workers.knowledge.runtime.httpx.AsyncClient", FakeStreamingClient):
        asyncio.run(step.run(context))

    downloaded_path = Path(context.data["video_path"])
    assert downloaded_path.exists()
    assert downloaded_path.read_bytes() == b"fake-video-bytes"


def test_fetch_knowledge_captions_step_loads_srt_from_metadata_source(
    tmp_path: Path,
) -> None:
    subtitle_path = tmp_path / "captions.srt"
    subtitle_path.write_text(
        "1\n00:00:00,000 --> 00:00:02,000\nfirst line\n\n"
        "2\n00:00:02,500 --> 00:00:05,000\nsecond line\n",
        encoding="utf-8",
    )
    step = FetchKnowledgeCaptionsStep()
    context = PipelineContext(
        data={
            "video_metadata": {
                "duration_seconds": 5,
                "metadata": {"subtitle_path": str(subtitle_path)},
            }
        }
    )

    asyncio.run(step.run(context))

    assert context.data["transcript_source"] == str(subtitle_path)
    assert context.data["transcript_segments"] == [
        {"start": 0.0, "end": 2.0, "text": "first line", "speaker": None},
        {"start": 2.5, "end": 5.0, "text": "second line", "speaker": None},
    ]


def test_fetch_knowledge_captions_step_uses_provider_when_no_explicit_source(
    tmp_path: Path,
) -> None:
    caption_provider = FakeCaptionProvider(
        [
            {"start": 0.0, "end": 3.0, "text": "caption block one"},
            {"start": 3.0, "end": 6.0, "text": "caption block two"},
        ]
    )
    step = FetchKnowledgeCaptionsStep(caption_provider=caption_provider)
    context = PipelineContext(
        data={
            "video_metadata": {
                "source_video_id": "openai-devday",
                "source_url": "https://www.youtube.com/watch?v=openai-devday",
                "duration_seconds": 6,
            },
            "temp_dir": str(tmp_path),
        }
    )

    asyncio.run(step.run(context))

    assert context.data["transcript_source"] == "captions:provider"
    assert context.data["transcript_segments"][0]["text"] == "caption block one"
    assert caption_provider.calls[0][1] == tmp_path


def test_fetch_knowledge_captions_step_ignores_broken_explicit_source_and_falls_back(
    tmp_path: Path,
) -> None:
    missing_subtitle_path = tmp_path / "missing.srt"
    caption_provider = FakeCaptionProvider(
        [{"start": 0.0, "end": 4.0, "text": "provider fallback transcript"}]
    )
    step = FetchKnowledgeCaptionsStep(caption_provider=caption_provider)
    context = PipelineContext(
        data={
            "video_metadata": {
                "source_video_id": "openai-devday",
                "source_url": "https://www.youtube.com/watch?v=openai-devday",
                "duration_seconds": 4,
                "subtitle_path": str(missing_subtitle_path),
            },
            "temp_dir": str(tmp_path),
        }
    )

    asyncio.run(step.run(context))

    assert context.data["transcript_source"] == "captions:provider"
    assert context.data["transcript_segments"][0]["text"] == "provider fallback transcript"
    assert "Failed to load transcript source" in context.data["caption_resolution_warning"]


def test_download_knowledge_video_step_rejects_non_video_content_type() -> None:
    step = DownloadKnowledgeVideoStep(video_downloader=HttpVideoDownloader())
    context = PipelineContext(
        data={
            "video_metadata": {
                "source": "youtube",
                "source_video_id": "openai-devday",
                "download_url": "https://www.youtube.com/watch?v=openai-devday",
            }
        }
    )

    with patch("workers.knowledge.runtime.httpx.AsyncClient", FakeHtmlStreamingClient):
        with pytest.raises(ValueError, match="unsupported content-type"):
            asyncio.run(step.run(context))


def test_ytdlp_caption_provider_prefers_configured_language_order(
    tmp_path: Path,
) -> None:
    provider = YtDlpCaptionProvider(command="yt-dlp-test")

    async def fake_run_command(command: list[str]) -> subprocess.CompletedProcess[str]:
        (tmp_path / "openai-devday.es.vtt").write_text(
            "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nhola equipo\n",
            encoding="utf-8",
        )
        (tmp_path / "openai-devday.en.vtt").write_text(
            "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nhello team\n",
            encoding="utf-8",
        )
        return subprocess.CompletedProcess(command, 0, "", "")

    provider._run_command = fake_run_command  # type: ignore[method-assign]

    segments = asyncio.run(
        provider.resolve_transcript_segments(
            {
                "source_video_id": "openai-devday",
                "source_url": "https://www.youtube.com/watch?v=openai-devday",
                "duration_seconds": 2,
                "preferred_caption_languages": ["en", "es"],
            },
            tmp_path,
        )
    )

    assert segments is not None
    assert segments[0]["text"] == "hello team"


def test_ytdlp_caption_provider_prefers_exact_locale_over_base_language(
    tmp_path: Path,
) -> None:
    provider = YtDlpCaptionProvider(command="yt-dlp-test")

    async def fake_run_command(command: list[str]) -> subprocess.CompletedProcess[str]:
        (tmp_path / "openai-devday.en.vtt").write_text(
            "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\ngeneric english\n",
            encoding="utf-8",
        )
        (tmp_path / "openai-devday.en-us.vtt").write_text(
            "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\namerican english\n",
            encoding="utf-8",
        )
        return subprocess.CompletedProcess(command, 0, "", "")

    provider._run_command = fake_run_command  # type: ignore[method-assign]

    segments = asyncio.run(
        provider.resolve_transcript_segments(
            {
                "source_video_id": "openai-devday",
                "source_url": "https://www.youtube.com/watch?v=openai-devday",
                "duration_seconds": 2,
                "preferred_caption_languages": ["en-us"],
            },
            tmp_path,
        )
    )

    assert segments is not None
    assert segments[0]["text"] == "american english"


def test_ytdlp_caption_provider_prioritizes_language_before_subtitle_format(
    tmp_path: Path,
) -> None:
    provider = YtDlpCaptionProvider(command="yt-dlp-test")

    async def fake_run_command(command: list[str]) -> subprocess.CompletedProcess[str]:
        (tmp_path / "openai-devday.fr.srt").write_text(
            "1\n00:00:00,000 --> 00:00:02,000\nbonjour equipe\n",
            encoding="utf-8",
        )
        (tmp_path / "openai-devday.en.vtt").write_text(
            "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nhello team\n",
            encoding="utf-8",
        )
        return subprocess.CompletedProcess(command, 0, "", "")

    provider._run_command = fake_run_command  # type: ignore[method-assign]

    segments = asyncio.run(
        provider.resolve_transcript_segments(
            {
                "source_video_id": "openai-devday",
                "source_url": "https://www.youtube.com/watch?v=openai-devday",
                "duration_seconds": 2,
                "preferred_caption_languages": ["en"],
            },
            tmp_path,
        )
    )

    assert segments is not None
    assert segments[0]["text"] == "hello team"


def test_ytdlp_video_downloader_uses_source_url_when_download_url_is_missing(
    tmp_path: Path,
) -> None:
    downloader = YtDlpVideoDownloader(command="yt-dlp-test")

    async def fake_run_command(command: list[str]) -> object:
        (tmp_path / "youtube_openai-devday.mp4").write_bytes(b"video")

        class CompletedProcess:
            returncode = 0
            stdout = ""
            stderr = ""

        return CompletedProcess()

    downloader._run_command = fake_run_command  # type: ignore[method-assign]

    downloaded_path = asyncio.run(
        downloader.download_video(
            {
                "source": "youtube",
                "source_video_id": "openai-devday",
                "source_url": "https://www.youtube.com/watch?v=openai-devday",
            },
            tmp_path,
        )
    )

    assert Path(str(downloaded_path)).exists()
    assert Path(str(downloaded_path)).name == "youtube_openai-devday.mp4"


def test_ytdlp_caption_provider_reads_proxy_from_env(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("YTDLP_PROXY", "http://proxy.example:10001")
    provider = YtDlpCaptionProvider(command="yt-dlp-test")
    captured: dict[str, list[str]] = {}

    async def fake_run_command(command: list[str]) -> subprocess.CompletedProcess[str]:
        captured["command"] = command
        (tmp_path / "openai-devday.en.vtt").write_text(
            "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nhello team\n",
            encoding="utf-8",
        )
        return subprocess.CompletedProcess(command, 0, "", "")

    provider._run_command = fake_run_command  # type: ignore[method-assign]

    segments = asyncio.run(
        provider.resolve_transcript_segments(
            {
                "source_video_id": "openai-devday",
                "source_url": "https://www.youtube.com/watch?v=openai-devday",
                "duration_seconds": 2,
            },
            tmp_path,
        )
    )

    assert segments is not None
    assert "--no-check-certificates" in captured["command"]
    assert "--proxy" in captured["command"]
    proxy_idx = captured["command"].index("--proxy")
    assert captured["command"][proxy_idx + 1] == "http://proxy.example:10001"


def test_ytdlp_video_downloader_reads_proxy_from_env(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("YTDLP_PROXY", "http://proxy.example:10001")
    downloader = YtDlpVideoDownloader(command="yt-dlp-test")
    captured: dict[str, list[str]] = {}

    async def fake_run_command(command: list[str]) -> object:
        captured["command"] = command
        (tmp_path / "youtube_openai-devday.mp4").write_bytes(b"video")

        class CompletedProcess:
            returncode = 0
            stdout = ""
            stderr = ""

        return CompletedProcess()

    downloader._run_command = fake_run_command  # type: ignore[method-assign]

    downloaded_path = asyncio.run(
        downloader.download_video(
            {
                "source": "youtube",
                "source_video_id": "openai-devday",
                "source_url": "https://www.youtube.com/watch?v=openai-devday",
            },
            tmp_path,
        )
    )

    assert Path(str(downloaded_path)).exists()
    assert "--no-check-certificates" in captured["command"]
    assert "--proxy" in captured["command"]
    proxy_idx = captured["command"].index("--proxy")
    assert captured["command"][proxy_idx + 1] == "http://proxy.example:10001"


def test_ytdlp_caption_provider_reads_cookies_file_from_env(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    cookies_path = tmp_path / "cookies.txt"
    cookies_path.write_text("# Netscape HTTP Cookie File\n", encoding="utf-8")
    monkeypatch.setenv("YTDLP_COOKIES_FILE", str(cookies_path))
    provider = YtDlpCaptionProvider(command="yt-dlp-test")
    captured: dict[str, list[str]] = {}

    async def fake_run_command(command: list[str]) -> subprocess.CompletedProcess[str]:
        captured["command"] = command
        (tmp_path / "openai-devday.en.vtt").write_text(
            "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nhello team\n",
            encoding="utf-8",
        )
        return subprocess.CompletedProcess(command, 0, "", "")

    provider._run_command = fake_run_command  # type: ignore[method-assign]

    segments = asyncio.run(
        provider.resolve_transcript_segments(
            {
                "source_video_id": "openai-devday",
                "source_url": "https://www.youtube.com/watch?v=openai-devday",
                "duration_seconds": 2,
            },
            tmp_path,
        )
    )

    assert segments is not None
    cookies_index = captured["command"].index("--cookies")
    assert captured["command"][cookies_index + 1] == str(cookies_path)


def test_ytdlp_video_downloader_reads_cookies_file_from_env(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    cookies_path = tmp_path / "cookies.txt"
    cookies_path.write_text("# Netscape HTTP Cookie File\n", encoding="utf-8")
    monkeypatch.setenv("YTDLP_COOKIES_FILE", str(cookies_path))
    downloader = YtDlpVideoDownloader(command="yt-dlp-test")
    captured: dict[str, list[str]] = {}

    async def fake_run_command(command: list[str]) -> object:
        captured["command"] = command
        (tmp_path / "youtube_openai-devday.mp4").write_bytes(b"video")

        class CompletedProcess:
            returncode = 0
            stdout = ""
            stderr = ""

        return CompletedProcess()

    downloader._run_command = fake_run_command  # type: ignore[method-assign]

    downloaded_path = asyncio.run(
        downloader.download_video(
            {
                "source": "youtube",
                "source_video_id": "openai-devday",
                "source_url": "https://www.youtube.com/watch?v=openai-devday",
            },
            tmp_path,
        )
    )

    assert Path(str(downloaded_path)).exists()
    cookies_index = captured["command"].index("--cookies")
    assert captured["command"][cookies_index + 1] == str(cookies_path)


def test_ytdlp_video_downloader_applies_configured_height_ceiling(
    tmp_path: Path,
) -> None:
    downloader = YtDlpVideoDownloader(command="yt-dlp-test", max_height=360)
    captured: dict[str, list[str]] = {}

    async def fake_run_command(command: list[str]) -> object:
        captured["command"] = command
        (tmp_path / "youtube_openai-devday.mp4").write_bytes(b"video")

        class CompletedProcess:
            returncode = 0
            stdout = ""
            stderr = ""

        return CompletedProcess()

    downloader._run_command = fake_run_command  # type: ignore[method-assign]

    downloaded_path = asyncio.run(
        downloader.download_video(
            {
                "source": "youtube",
                "source_video_id": "openai-devday",
                "source_url": "https://www.youtube.com/watch?v=openai-devday",
            },
            tmp_path,
        )
    )

    assert Path(str(downloaded_path)).exists()
    format_index = captured["command"].index("--format")
    assert captured["command"][format_index + 1] == (
        "18/bestvideo[height<=360][ext=mp4]+bestaudio[ext=m4a]"
        "/bestvideo[height<=360]+bestaudio"
        "/best[height<=360]"
        "/best"
    )


def test_ytdlp_video_downloader_applies_proxy_before_cookies(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    cookies_path = tmp_path / "cookies.txt"
    cookies_path.write_text("# Netscape HTTP Cookie File\n", encoding="utf-8")
    monkeypatch.setenv("YTDLP_PROXY", "http://proxy.example:10001")
    monkeypatch.setenv("YTDLP_COOKIES_FILE", str(cookies_path))
    downloader = YtDlpVideoDownloader(command="yt-dlp-test")
    captured: dict[str, list[str]] = {}

    async def fake_run_command(command: list[str]) -> object:
        captured["command"] = command
        (tmp_path / "youtube_openai-devday.mp4").write_bytes(b"video")

        class CompletedProcess:
            returncode = 0
            stdout = ""
            stderr = ""

        return CompletedProcess()

    downloader._run_command = fake_run_command  # type: ignore[method-assign]

    asyncio.run(
        downloader.download_video(
            {
                "source": "youtube",
                "source_video_id": "openai-devday",
                "source_url": "https://www.youtube.com/watch?v=openai-devday",
            },
            tmp_path,
        )
    )

    assert "--no-check-certificates" in captured["command"]
    proxy_idx = captured["command"].index("--proxy")
    assert captured["command"][proxy_idx + 1] == "http://proxy.example:10001"
    cookies_idx = captured["command"].index("--cookies")
    assert captured["command"][cookies_idx + 1] == str(cookies_path)
    assert proxy_idx < cookies_idx


def test_transcribe_knowledge_video_step_normalizes_segments() -> None:
    step = TranscribeKnowledgeVideoStep(
        transcriber=StaticKnowledgeTranscriber(
            [
                {"start": 4, "end": 8, "text": "second block"},
                {"timestamp_start": 0, "timestamp_end": 3, "transcript": "first block"},
            ]
        )
    )
    context = PipelineContext(
        data={
            "video_path": "/tmp/demo.mp4",
            "video_metadata": {"duration_seconds": 10},
        }
    )

    asyncio.run(step.run(context))

    transcript_segments = context.data["transcript_segments"]
    assert transcript_segments[0]["text"] == "first block"
    assert transcript_segments[1]["text"] == "second block"
    assert context.data["transcript_segment_count"] == 2


def test_transcribe_knowledge_video_step_skips_asr_when_captions_exist() -> None:
    transcriber = AsyncMock()
    step = TranscribeKnowledgeVideoStep(transcriber=transcriber)
    context = PipelineContext(
        data={
            "video_path": "/tmp/demo.mp4",
            "video_metadata": {"duration_seconds": 10},
            "transcript_segments": [
                {"start": 0.0, "end": 5.0, "text": "captions already exist"}
            ],
        }
    )

    asyncio.run(step.run(context))

    transcriber.transcribe.assert_not_called()
    assert context.data["transcript_segment_count"] == 1
    assert context.data["transcript_segments"][0]["text"] == "captions already exist"


def test_openai_compatible_transcriber_defaults_to_verbose_json_for_segmented_asr(
    tmp_path: Path,
) -> None:
    video_path = _write_video(tmp_path / "devday.mp4")
    fake_client = FakeTranscriptionClient(
        payload={
            "segments": [
                {
                    "start": 0.0,
                    "end": 4.5,
                    "text": "agents coordinate tasks",
                }
            ]
        }
    )
    transcriber = OpenAICompatibleTranscriber(api_key="test-key")

    with (
        patch.object(transcriber, "_extract_audio_track", AsyncMock(return_value=False)),
        patch("workers.knowledge.runtime.httpx.Client", return_value=fake_client),
    ):
        segments = asyncio.run(
            transcriber.transcribe(
                video_path,
                video_metadata={"duration_seconds": 5},
            )
        )

    assert segments == [
        {
            "start": 0.0,
            "end": 4.5,
            "text": "agents coordinate tasks",
            "speaker": None,
        }
    ]
    assert fake_client.calls == [
        {
            "url": f"{transcriber._base_url}/audio/transcriptions",
            "headers": {"Authorization": "Bearer test-key"},
            "data": {
                "model": transcriber._model_name,
                "response_format": "verbose_json",
                "timestamp_granularities[]": "segment",
            },
            "filename": "devday.mp4",
        }
    ]


def test_openai_compatible_transcriber_respects_explicit_json_response_format(
    tmp_path: Path,
) -> None:
    video_path = _write_video(tmp_path / "devday.mp4")
    fake_client = FakeTranscriptionClient(payload={"text": "agents coordinate tasks"})
    transcriber = OpenAICompatibleTranscriber(
        api_key="test-key",
        model_name="custom-asr",
        response_format="json",
    )

    with (
        patch.object(transcriber, "_extract_audio_track", AsyncMock(return_value=False)),
        patch("workers.knowledge.runtime.httpx.Client", return_value=fake_client),
    ):
        segments = asyncio.run(
            transcriber.transcribe(
                video_path,
                video_metadata={"duration_seconds": 5},
            )
        )

    assert segments == [
        {
            "start": 0.0,
            "end": 5.0,
            "text": "agents coordinate tasks",
            "speaker": None,
        }
    ]
    assert fake_client.calls == [
        {
            "url": f"{transcriber._base_url}/audio/transcriptions",
            "headers": {"Authorization": "Bearer test-key"},
            "data": {
                "model": "custom-asr",
                "response_format": "json",
            },
            "filename": "devday.mp4",
        }
    ]


def test_openai_compatible_transcriber_reads_env_overrides_for_openai_compatible_endpoints(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    video_path = _write_video(tmp_path / "devday.mp4")
    fake_client = FakeTranscriptionClient(payload={"text": "agents coordinate tasks"})
    monkeypatch.setenv("ASR_BASE_URL", "https://transcribe.example.com/v1")
    monkeypatch.setenv("ASR_MODEL", "custom-asr")
    monkeypatch.setenv("ASR_RESPONSE_FORMAT", "json")
    monkeypatch.setenv("ASR_API_KEY", "transcribe-key")
    reset_settings_cache()
    try:
        transcriber = OpenAICompatibleTranscriber()

        with (
            patch.object(transcriber, "_extract_audio_track", AsyncMock(return_value=False)),
            patch("workers.knowledge.runtime.httpx.Client", return_value=fake_client),
        ):
            segments = asyncio.run(
                transcriber.transcribe(
                    video_path,
                    video_metadata={"duration_seconds": 5},
                )
            )
        assert segments[0]["text"] == "agents coordinate tasks"
        assert fake_client.calls == [
            {
                "url": "https://transcribe.example.com/v1/audio/transcriptions",
                "headers": {"Authorization": "Bearer transcribe-key"},
                "data": {
                    "model": "custom-asr",
                    "response_format": "json",
                },
                "filename": "devday.mp4",
            },
        ]
    finally:
        reset_settings_cache()


def test_openai_compatible_transcriber_does_not_reuse_ytdlp_proxy_for_asr(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    video_path = _write_video(tmp_path / "devday.mp4")
    fake_client = FakeTranscriptionClient(payload={"text": "agents coordinate tasks"})
    monkeypatch.setenv("YTDLP_PROXY", "http://yt-proxy.example:10001")
    monkeypatch.setenv("HTTPS_PROXY", "http://asr-proxy.example:10002")
    transcriber = OpenAICompatibleTranscriber(api_key="test-key")
    client_ctor = MagicMock(return_value=fake_client)

    with (
        patch.object(transcriber, "_extract_audio_track", AsyncMock(return_value=False)),
        patch("workers.knowledge.runtime.httpx.Client", client_ctor),
    ):
        segments = asyncio.run(
            transcriber.transcribe(
                video_path,
                video_metadata={"duration_seconds": 5},
            )
        )

    assert segments[0]["text"] == "agents coordinate tasks"
    assert client_ctor.call_args.kwargs["proxy"] == "http://asr-proxy.example:10002"


def test_plan_transcription_chunks_prefers_nearby_silence_boundaries() -> None:
    chunk_ranges = _plan_transcription_chunks(
        1450.0,
        [598.4, 610.0, 1202.0],
        target_chunk_seconds=600.0,
        min_chunk_seconds=240.0,
        max_chunk_seconds=780.0,
    )

    assert chunk_ranges == [
        (0.0, 598.4),
        (598.4, 1202.0),
        (1202.0, 1450.0),
    ]


def test_detect_knowledge_scenes_step_splits_on_transcript_gaps() -> None:
    step = DetectKnowledgeScenesStep(scene_detector=HeuristicSceneDetector())
    context = PipelineContext(
        conf={"scene_threshold": 0.35},
        data={
            "video_path": "/tmp/demo.mp4",
            "video_metadata": {"duration_seconds": 60},
            "transcript_segments": [
                {"start": 0.0, "end": 8.0, "text": "opening remarks"},
                {"start": 9.0, "end": 16.0, "text": "agent workflow overview"},
                {"start": 24.0, "end": 31.0, "text": "search pipeline details"},
            ],
        },
    )

    asyncio.run(step.run(context))

    assert context.data["scene_count"] == 2
    assert context.data["scenes"][0]["timestamp_start"] == 0.0
    assert context.data["scenes"][1]["timestamp_start"] == 24.0


def test_analyze_knowledge_frames_step_generates_visual_summaries() -> None:
    step = AnalyzeKnowledgeFramesStep(frame_analyzer=HeuristicFrameAnalyzer())
    context = PipelineContext(
        data={
            "video_path": "/tmp/demo.mp4",
            "video_metadata": {"speaker": "Sam Altman"},
            "transcript_segments": [
                {"start": 0.0, "end": 12.0, "text": "agents coordinate tasks with tools"},
            ],
            "scenes": [
                {
                    "scene_index": 0,
                    "timestamp_start": 0.0,
                    "timestamp_end": 12.0,
                    "transcript_excerpt": "agents coordinate tasks with tools",
                }
            ],
        }
    )

    asyncio.run(step.run(context))

    analysis = context.data["scene_analyses"][0]
    assert analysis["scene_index"] == 0
    assert "Sam Altman" in analysis["visual_summary"]
    assert "agents" in analysis["keywords"]


def test_heuristic_frame_analyzer_skips_timed_out_annotations(tmp_path: Path) -> None:
    frame_path = tmp_path / "frame.jpg"
    frame_path.write_bytes(b"frame")
    analyzer = HeuristicFrameAnalyzer(
        annotation_backend=SlowFrameAnnotator(),
        annotation_timeout_seconds=0.01,
    )

    annotations, timeout_count, error_count, cache_hit_count = asyncio.run(
        analyzer._annotate_frames([frame_path])
    )

    assert annotations == []
    assert timeout_count == 1
    assert error_count == 0
    assert cache_hit_count == 0


def test_heuristic_frame_analyzer_annotates_frames_with_configured_concurrency(
    tmp_path: Path,
) -> None:
    frame_paths = []
    for index in range(4):
        frame_path = tmp_path / f"frame_{index:03d}.jpg"
        frame_path.write_bytes(f"frame-{index}".encode("utf-8"))
        frame_paths.append(frame_path)
    annotator = ConcurrentRecordingFrameAnnotator()
    analyzer = HeuristicFrameAnalyzer(
        annotation_backend=annotator,
        annotation_concurrency=2,
    )

    annotations, timeout_count, error_count, cache_hit_count = asyncio.run(
        analyzer._annotate_frames(frame_paths)
    )

    assert len(annotations) == 4
    assert timeout_count == 0
    assert error_count == 0
    assert cache_hit_count == 0
    assert annotator.peak > 1


def test_heuristic_frame_analyzer_reuses_cached_frame_annotations(
    tmp_path: Path,
) -> None:
    frame_path = tmp_path / "frame.jpg"
    frame_path.write_bytes(b"frame")
    annotator = RecordingFrameAnnotator()
    analyzer = HeuristicFrameAnalyzer(annotation_backend=annotator)

    with patch(
        "workers.knowledge.runtime._compute_frame_annotation_cache_key",
        return_value=f"cache:{tmp_path.name}",
    ):
        first_annotations, _, _, first_cache_hits = asyncio.run(
            analyzer._annotate_frames([frame_path])
        )
        second_annotations, _, _, second_cache_hits = asyncio.run(
            analyzer._annotate_frames([frame_path])
        )

    assert len(first_annotations) == 1
    assert len(second_annotations) == 1
    assert first_cache_hits == 0
    assert second_cache_hits == 1
    assert annotator.calls == ["frame.jpg"]


def test_heuristic_frame_analyzer_reuses_cached_frame_extractions(
    tmp_path: Path,
) -> None:
    video_path = _write_video(tmp_path / "demo.mp4")
    analyzer = HeuristicFrameAnalyzer(
        annotation_backend=RecordingFrameAnnotator(),
        extraction_cache_size=8,
    )
    scene = {
        "scene_index": 0,
        "timestamp_start": 0.0,
        "timestamp_end": 15.0,
    }
    extracted_calls = 0

    async def fake_extract(
        _video_path: Path,
        *,
        scene: dict[str, object],
        output_dir: Path,
    ) -> list[Path]:
        nonlocal extracted_calls
        extracted_calls += 1
        frame_path = output_dir / f"scene_{int(scene['scene_index'])}_frame_001.jpg"
        output_dir.mkdir(parents=True, exist_ok=True)
        frame_path.write_bytes(b"frame")
        return [frame_path]

    analyzer._extract_candidate_frames = fake_extract  # type: ignore[method-assign]

    first_prepared = asyncio.run(
        analyzer.prepare_scene_analysis(
            video_path,
            scene=scene,
            transcript_segments=[],
            video_metadata={
                "source": "youtube",
                "source_video_id": "openai-devday",
                "duration_seconds": 600,
            },
        )
    )

    cached_output_dir = video_path.parent / f"{video_path.stem}_frames" / "scene_0000"
    for existing_file in cached_output_dir.glob("*.jpg"):
        existing_file.unlink()

    second_prepared = asyncio.run(
        analyzer.prepare_scene_analysis(
            video_path,
            scene=scene,
            transcript_segments=[],
            video_metadata={
                "source": "youtube",
                "source_video_id": "openai-devday",
                "duration_seconds": 600,
            },
        )
    )

    assert extracted_calls == 1
    assert first_prepared["extraction_cache_hit_count"] == 0
    assert second_prepared["extraction_cache_hit_count"] == 1
    assert Path(second_prepared["selected_frames"][0]).exists()


def test_analyze_knowledge_frames_step_batches_annotations_across_scenes(
    tmp_path: Path,
) -> None:
    step = AnalyzeKnowledgeFramesStep(
        frame_analyzer=HeuristicFrameAnalyzer(
            annotation_backend=ConcurrentRecordingFrameAnnotator(delay_seconds=0.03),
            annotation_concurrency=2,
            max_annotated_frames_per_video=20,
        )
    )
    analyzer = step._frame_analyzer
    assert analyzer is not None
    video_path = _write_video(tmp_path / "demo.mp4")
    scene_frames: list[list[Path]] = []
    for scene_index in range(3):
        frame_one = tmp_path / f"scene_{scene_index}_frame_1.jpg"
        frame_two = tmp_path / f"scene_{scene_index}_frame_2.jpg"
        frame_one.write_bytes(f"scene-{scene_index}-frame-1".encode("utf-8"))
        frame_two.write_bytes(f"scene-{scene_index}-frame-2".encode("utf-8"))
        scene_frames.append([frame_one, frame_two])

    context = PipelineContext(
        data={
            "video_path": str(video_path),
            "video_metadata": {"duration_seconds": 120, "speaker": "Demo Speaker"},
            "transcript_segments": [],
            "scenes": [
                {
                    "scene_index": scene_index,
                    "timestamp_start": float(scene_index * 10),
                    "timestamp_end": float((scene_index + 1) * 10),
                }
                for scene_index in range(3)
            ],
        }
    )

    with (
        patch.object(
            analyzer,
            "_extract_candidate_frames",
            AsyncMock(side_effect=scene_frames),
        ),
        patch.object(analyzer, "_is_informative_frame", return_value=True),
        patch.object(analyzer, "_frame_has_text_regions", return_value=False),
    ):
        asyncio.run(step.run(context))

    assert context.data["frame_analysis_total_annotation_frame_count"] == 3
    assert context.data["frame_analysis_route_counts"]["annotate"] == 3
    assert context.data["frame_analysis_total_extraction_time_ms"] >= 0
    assert context.data["frame_analysis_total_prepare_time_ms"] >= 0
    assert context.data["frame_analysis_total_annotation_time_ms"] >= 0
    assert context.data["scene_analyses"][0]["annotation_frame_count"] == 1
    assert "extraction_time_ms" in context.data["scene_analyses"][0]
    assert "annotation_time_ms" in context.data["scene_analyses"][0]
    assert analyzer._annotation_backend.peak > 1


def test_analyze_knowledge_frames_step_prepares_scenes_concurrently(
    tmp_path: Path,
) -> None:
    step = AnalyzeKnowledgeFramesStep(
        frame_analyzer=HeuristicFrameAnalyzer(
            annotation_backend=RecordingFrameAnnotator(),
            prepare_concurrency=2,
        )
    )
    analyzer = step._frame_analyzer
    assert analyzer is not None
    video_path = _write_video(tmp_path / "demo.mp4")
    scene_frames: list[list[Path]] = []
    for scene_index in range(3):
        frame_one = tmp_path / f"prepare_scene_{scene_index}_frame_1.jpg"
        frame_two = tmp_path / f"prepare_scene_{scene_index}_frame_2.jpg"
        frame_one.write_bytes(f"scene-{scene_index}-frame-1".encode("utf-8"))
        frame_two.write_bytes(f"scene-{scene_index}-frame-2".encode("utf-8"))
        scene_frames.append([frame_one, frame_two])

    class ExtractionTracker:
        def __init__(self) -> None:
            self.current = 0
            self.peak = 0
            self._lock = asyncio.Lock()

        async def extract(self, *_args, **_kwargs):
            scene = _kwargs["scene"]
            async with self._lock:
                self.current += 1
                self.peak = max(self.peak, self.current)
            await asyncio.sleep(0.03)
            async with self._lock:
                self.current -= 1
            return scene_frames[int(scene["scene_index"])]

    tracker = ExtractionTracker()
    context = PipelineContext(
        data={
            "video_path": str(video_path),
            "video_metadata": {"duration_seconds": 600, "speaker": "Demo Speaker"},
            "transcript_segments": [],
            "scenes": [
                {
                    "scene_index": scene_index,
                    "timestamp_start": float(scene_index * 10),
                    "timestamp_end": float((scene_index + 1) * 10),
                }
                for scene_index in range(3)
            ],
        }
    )

    with (
        patch.object(analyzer, "_extract_candidate_frames", AsyncMock(side_effect=tracker.extract)),
        patch.object(analyzer, "_is_informative_frame", return_value=True),
        patch.object(analyzer, "_frame_has_text_regions", return_value=False),
    ):
        asyncio.run(step.run(context))

    assert tracker.peak > 1
    assert context.data["frame_analysis_route_counts"]["embed_only"] == 3


def test_heuristic_frame_analyzer_routes_single_unique_frame_to_text_only(
    tmp_path: Path,
) -> None:
    video_path = _write_video(tmp_path / "demo.mp4")
    frame_path = tmp_path / "frame_001.jpg"
    frame_path.write_bytes(b"frame")
    annotator = RecordingFrameAnnotator()
    analyzer = HeuristicFrameAnalyzer(annotation_backend=annotator)

    with (
        patch.object(analyzer, "_extract_candidate_frames", AsyncMock(return_value=[frame_path])),
        patch.object(analyzer, "_is_informative_frame", return_value=True),
        patch.object(analyzer, "_frame_has_text_regions", return_value=False),
    ):
        analysis = asyncio.run(
            analyzer.analyze_scene(
                video_path,
                scene={"scene_index": 0, "timestamp_start": 0.0, "timestamp_end": 30.0},
                transcript_segments=[],
                video_metadata={"duration_seconds": 600, "speaker": "Demo Speaker"},
            )
        )

    assert analysis["analysis_route"] == "text_only"
    assert analysis["annotation_frame_count"] == 0
    assert analysis["frame_paths"] == []
    assert annotator.calls == []


def test_heuristic_frame_analyzer_routes_visual_scene_without_text_to_embed_only(
    tmp_path: Path,
) -> None:
    video_path = _write_video(tmp_path / "demo.mp4")
    frame_one = tmp_path / "frame_001.jpg"
    frame_two = tmp_path / "frame_002.jpg"
    frame_one.write_bytes(b"frame-one")
    frame_two.write_bytes(b"frame-two")
    annotator = RecordingFrameAnnotator()
    analyzer = HeuristicFrameAnalyzer(annotation_backend=annotator)

    with (
        patch.object(
            analyzer,
            "_extract_candidate_frames",
            AsyncMock(return_value=[frame_one, frame_two]),
        ),
        patch.object(analyzer, "_is_informative_frame", return_value=True),
        patch.object(analyzer, "_frame_has_text_regions", return_value=False),
    ):
        analysis = asyncio.run(
            analyzer.analyze_scene(
                video_path,
                scene={"scene_index": 1, "timestamp_start": 30.0, "timestamp_end": 60.0},
                transcript_segments=[],
                video_metadata={"duration_seconds": 900, "speaker": "Demo Speaker"},
            )
        )

    assert analysis["analysis_route"] == "embed_only"
    assert analysis["annotation_frame_count"] == 0
    assert len(analysis["frame_paths"]) == 2
    assert analysis["has_visual_embedding"] is True
    assert annotator.calls == []


def test_heuristic_frame_analyzer_annotates_short_visual_scenes_even_without_text(
    tmp_path: Path,
) -> None:
    video_path = _write_video(tmp_path / "demo.mp4")
    frame_one = tmp_path / "frame_001.jpg"
    frame_two = tmp_path / "frame_002.jpg"
    frame_one.write_bytes(b"frame-one")
    frame_two.write_bytes(b"frame-two")
    annotator = RecordingFrameAnnotator()
    analyzer = HeuristicFrameAnalyzer(
        annotation_backend=annotator,
        max_annotated_frames_per_video=20,
    )

    with (
        patch.object(
            analyzer,
            "_extract_candidate_frames",
            AsyncMock(return_value=[frame_one, frame_two]),
        ),
        patch.object(analyzer, "_is_informative_frame", return_value=True),
        patch.object(analyzer, "_frame_has_text_regions", return_value=False),
    ):
        analysis = asyncio.run(
            analyzer.analyze_scene(
                video_path,
                scene={"scene_index": 2, "timestamp_start": 0.0, "timestamp_end": 12.0},
                transcript_segments=[],
                video_metadata={"duration_seconds": 120, "speaker": "Demo Speaker"},
            )
        )

    assert analysis["analysis_route"] == "annotate"
    assert analysis["annotation_frame_count"] == 1
    assert analysis["remaining_annotation_budget"] == 19
    assert annotator.calls == ["frame_001.jpg"]


def test_segment_knowledge_transcript_step_merges_transcript_and_scene_analysis() -> None:
    step = SegmentKnowledgeTranscriptStep()
    context = PipelineContext(
        data={
            "video_metadata": {"title": "OpenAI Dev Day", "speaker": "Sam Altman"},
            "transcript_segments": [
                {"start": 0.0, "end": 10.0, "text": "agents plan tasks"},
                {"start": 10.0, "end": 18.0, "text": "reasoning models execute steps"},
            ],
            "scenes": [
                {
                    "scene_index": 0,
                    "timestamp_start": 0.0,
                    "timestamp_end": 18.0,
                    "transcript_excerpt": "agents plan tasks reasoning models execute steps",
                }
            ],
            "scene_analyses": [
                {
                    "scene_index": 0,
                    "visual_summary": "Speaker presenting on stage.",
                    "visual_type": "slide",
                    "visual_description": "Slide shows agent workflow steps.",
                    "visual_text_content": "Plan -> Act -> Verify",
                    "visual_entities": ["OpenAI", "agent workflow"],
                    "frame_paths": ["/tmp/frame.jpg"],
                    "has_visual_embedding": True,
                    "keywords": ["agents", "reasoning", "models"],
                }
            ],
        }
    )

    asyncio.run(step.run(context))

    segment = context.data["segments"][0]
    assert segment["title"].startswith("OpenAI Dev Day:")
    assert "agents plan tasks" in segment["transcript_text"]
    assert segment["visual_type"] == "slide"
    assert segment["visual_text_content"] == "Plan -> Act -> Verify"
    assert segment["frame_paths"] == ["/tmp/frame.jpg"]
    assert segment["metadata"]["transcript_segment_count"] == 2


def test_segment_knowledge_transcript_step_splits_long_scenes_into_transcript_windows() -> None:
    step = SegmentKnowledgeTranscriptStep()
    context = PipelineContext(
        data={
            "video_metadata": {"title": "OpenAI Dev Day", "speaker": "Sam Altman"},
            "transcript_segments": [
                {"start": 0.0, "end": 20.0, "text": "agents plan tasks and use memory"},
                {"start": 20.0, "end": 40.0, "text": "reasoning models coordinate execution"},
                {"start": 40.0, "end": 60.0, "text": "tools help complete the workflow"},
                {"start": 60.0, "end": 80.0, "text": "evaluation improves reliability"},
                {"start": 80.0, "end": 100.0, "text": "memory helps the assistant recover context"},
            ],
            "scenes": [
                {
                    "scene_index": 0,
                    "timestamp_start": 0.0,
                    "timestamp_end": 100.0,
                    "transcript_excerpt": "long interview segment",
                }
            ],
            "scene_analyses": [
                {
                    "scene_index": 0,
                    "visual_summary": "Speaker presenting on stage.",
                    "visual_type": "slide",
                    "visual_description": "Slide shows agent workflow steps.",
                    "visual_text_content": "Plan -> Act -> Verify",
                    "visual_entities": ["OpenAI", "agent workflow"],
                    "frame_paths": ["/tmp/frame.jpg"],
                    "has_visual_embedding": True,
                    "keywords": ["agents", "reasoning", "models"],
                }
            ],
        }
    )

    asyncio.run(step.run(context))

    segments = context.data["segments"]
    assert len(segments) == 2
    assert segments[0]["timestamp_start"] == 0.0
    assert segments[0]["timestamp_end"] == 60.0
    assert segments[1]["timestamp_start"] == 60.0
    assert segments[1]["timestamp_end"] == 100.0
    assert segments[0]["metadata"]["scene_index"] == 0
    assert segments[1]["metadata"]["transcript_segment_count"] == 2


def test_embed_knowledge_segments_step_produces_expected_dimension() -> None:
    step = EmbedKnowledgeSegmentsStep(embedding_backend=FakeEmbeddingBackend())
    context = PipelineContext(
        data={
            "segments": [
                {
                    "segment_index": 0,
                    "title": "OpenAI Dev Day: agents",
                    "description": "Speaker presenting on stage.",
                    "transcript_text": "agents coordinate tasks",
                    "visual_summary": "Slides about workflow orchestration.",
                }
            ]
        }
    )

    asyncio.run(step.run(context))

    vector = context.data["segment_embeddings"][0]
    assert len(vector) == 768
    assert context.data["embedding_dimension"] == 768


def test_embed_knowledge_segments_step_uses_multimodal_embeddings_when_frames_exist(
    tmp_path: Path,
) -> None:
    backend = FakeMultimodalEmbeddingBackend()
    frame_path = tmp_path / "frame.jpg"
    frame_path.write_bytes(b"frame")
    step = EmbedKnowledgeSegmentsStep(embedding_backend=backend)
    context = PipelineContext(
        data={
            "segments": [
                {
                    "segment_index": 0,
                    "title": "OpenAI Dev Day: multimodal",
                    "transcript_text": "agents coordinate tasks",
                    "visual_description": "Slide with workflow diagram.",
                    "visual_text_content": "Reasoning loop",
                    "visual_entities": ["OpenAI", "Reasoning"],
                    "frame_paths": [str(frame_path)],
                    "has_visual_embedding": False,
                }
            ]
        }
    )

    asyncio.run(step.run(context))

    assert len(context.data["segment_embeddings"][0]) == DEFAULT_KNOWLEDGE_EMBEDDING_DIMENSION
    assert context.data["segments"][0]["has_visual_embedding"] is True
    assert backend.multimodal_calls[0][1] == [str(frame_path)]


def test_compute_embedding_frame_timestamps_prefers_midpoint_for_short_segments() -> None:
    assert compute_embedding_frame_timestamps(10.0, 18.0) == [14.0]
    assert compute_embedding_frame_timestamps(20.0, 20.0) == []


def test_embed_knowledge_segments_step_limits_multimodal_frames_to_two(
    tmp_path: Path,
) -> None:
    backend = FakeMultimodalEmbeddingBackend()
    frame_paths: list[str] = []
    for index in range(3):
        frame_path = tmp_path / f"frame-{index}.jpg"
        frame_path.write_bytes(b"frame")
        frame_paths.append(str(frame_path))

    step = EmbedKnowledgeSegmentsStep(embedding_backend=backend)
    context = PipelineContext(
        data={
            "segments": [
                {
                    "segment_index": 0,
                    "title": "OpenAI Dev Day: multimodal",
                    "transcript_text": "agents coordinate tasks",
                    "frame_paths": frame_paths,
                }
            ]
        }
    )

    asyncio.run(step.run(context))

    assert context.data["segments"][0]["has_visual_embedding"] is True
    assert backend.multimodal_calls[0][1] == frame_paths[:2]


def test_embed_knowledge_segments_step_extracts_frames_for_text_only_segments(
    tmp_path: Path,
) -> None:
    backend = FakeMultimodalEmbeddingBackend()
    video_path = tmp_path / "demo.mp4"
    video_path.write_bytes(b"video")
    created_outputs: list[Path] = []

    async def fake_extract(
        video_path: str | Path,
        timestamp_seconds: float,
        output_path: Path,
    ) -> Path:
        assert Path(video_path).name == "demo.mp4"
        assert any(abs(timestamp_seconds - expected) < 0.05 for expected in (13.3, 16.7))
        output_path.write_bytes(b"frame")
        created_outputs.append(output_path)
        return output_path

    step = EmbedKnowledgeSegmentsStep(embedding_backend=backend)
    context = PipelineContext(
        data={
            "video_path": str(video_path),
            "segments": [
                {
                    "segment_index": 0,
                    "title": "Image coverage demo",
                    "transcript_text": "speaker explains image search quality",
                    "timestamp_start": 10.0,
                    "timestamp_end": 20.0,
                    "frame_paths": [],
                }
            ]
        }
    )

    with patch(
        "workers.knowledge.steps.embed.extract_frame_at_timestamp",
        AsyncMock(side_effect=fake_extract),
    ):
        asyncio.run(step.run(context))

    assert context.data["segments"][0]["has_visual_embedding"] is True
    assert len(backend.multimodal_calls) == 1
    assert len(backend.multimodal_calls[0][1]) == 2
    assert all(not path.exists() for path in created_outputs)


def test_embed_knowledge_segments_step_falls_back_to_text_when_frame_extraction_fails(
    tmp_path: Path,
) -> None:
    backend = FakeMultimodalEmbeddingBackend()
    video_path = tmp_path / "demo.mp4"
    video_path.write_bytes(b"video")
    step = EmbedKnowledgeSegmentsStep(embedding_backend=backend)
    context = PipelineContext(
        data={
            "video_path": str(video_path),
            "segments": [
                {
                    "segment_index": 0,
                    "title": "Fallback demo",
                    "transcript_text": "speaker explains image search quality",
                    "timestamp_start": 10.0,
                    "timestamp_end": 20.0,
                    "frame_paths": [],
                }
            ]
        }
    )

    with patch(
        "workers.knowledge.steps.embed.extract_frame_at_timestamp",
        AsyncMock(return_value=None),
    ):
        asyncio.run(step.run(context))

    assert context.data["segments"][0]["has_visual_embedding"] is False
    assert backend.multimodal_calls == []


def test_embed_knowledge_segments_step_runs_embeddings_concurrently() -> None:
    backend = SlowConcurrentEmbeddingBackend()
    step = EmbedKnowledgeSegmentsStep(
        embedding_backend=backend,
        max_concurrency=3,
    )
    context = PipelineContext(
        data={
            "segments": [
                {
                    "segment_index": index,
                    "title": f"Segment {index}",
                    "transcript_text": f"payload {index}",
                }
                for index in range(6)
            ]
        }
    )

    asyncio.run(step.run(context))

    assert len(context.data["segment_embeddings"]) == 6
    assert backend.peak > 1


def test_compute_dense_visual_timestamps_spreads_frames_evenly() -> None:
    assert compute_dense_visual_timestamps(10.0, 20.0, count=1) == [15.0]
    assert compute_dense_visual_timestamps(10.0, 20.0, count=3) == [12.5, 15.0, 17.5]
    assert compute_dense_visual_timestamps(20.0, 20.0, count=3) == [20.0]


def test_dense_visual_embed_step_builds_multimodal_units(
    tmp_path: Path,
) -> None:
    backend = FakeMultimodalEmbeddingBackend()
    video_path = tmp_path / "demo.mp4"
    video_path.write_bytes(b"video")
    extracted_frames: list[Path] = []

    async def fake_extract(
        video_path: str | Path,
        timestamp_seconds: float,
        output_path: Path,
        *,
        scale: str = "640:360",
    ) -> Path:
        del scale
        assert Path(video_path).name == "demo.mp4"
        assert any(abs(timestamp_seconds - expected) < 0.01 for expected in (13.333, 16.667))
        output_path.write_bytes(b"frame")
        extracted_frames.append(output_path)
        return output_path

    step = DenseVisualEmbedStep(
        embedding_backend=backend,
        frames_per_segment=2,
    )
    context = PipelineContext(
        data={
            "video_path": str(video_path),
            "video_metadata": {"title": "Dense Visual Demo"},
            "segments": [
                {
                    "segment_index": 0,
                    "title": "Agents",
                    "transcript_text": "agents coordinate retrieval with tool calls",
                    "timestamp_start": 10.0,
                    "timestamp_end": 20.0,
                    "metadata": {},
                }
            ],
        }
    )

    with patch(
        "workers.knowledge.steps.dense_visual_embed.extract_dense_visual_frame",
        AsyncMock(side_effect=fake_extract),
    ):
        asyncio.run(step.run(context))

    dense_visual_units = context.data["dense_visual_units"]
    assert len(dense_visual_units) == 2
    assert context.data["dense_visual_unit_count"] == 2
    assert context.data["segments"][0]["metadata"]["dense_visual_frame_count"] == 2
    assert [unit["frame_index"] for unit in dense_visual_units] == [0, 1]
    assert all(unit["metadata"]["dense_visual"] is True for unit in dense_visual_units)
    assert all(Path(unit["frame_path"]).exists() for unit in dense_visual_units)
    assert backend.multimodal_calls == [
        ("Dense Visual Demo\nagents coordinate retrieval with tool calls", [str(path)])
        for path in extracted_frames
    ]


def test_dense_visual_embed_step_skips_when_backend_has_no_multimodal_support(
    tmp_path: Path,
) -> None:
    video_path = tmp_path / "demo.mp4"
    video_path.write_bytes(b"video")
    step = DenseVisualEmbedStep(
        embedding_backend=FakeEmbeddingBackend(),
        frames_per_segment=2,
    )
    context = PipelineContext(
        data={
            "video_path": str(video_path),
            "video_metadata": {"title": "Dense Visual Demo"},
            "segments": [
                {
                    "segment_index": 0,
                    "title": "Agents",
                    "transcript_text": "agents coordinate retrieval with tool calls",
                    "timestamp_start": 10.0,
                    "timestamp_end": 20.0,
                    "metadata": {},
                }
            ],
        }
    )

    asyncio.run(step.run(context))

    assert context.data["dense_visual_units"] == []
    assert context.data["dense_visual_unit_count"] == 0


def test_store_knowledge_segments_step_persists_video_and_segments() -> None:
    repository = InMemoryKnowledgeRepository()
    step = StoreKnowledgeSegmentsStep(repository=repository)
    context = PipelineContext(
        data={
            "video_metadata": {
                "source": "youtube",
                "source_video_id": "openai-devday",
                "source_url": "https://www.youtube.com/watch?v=openai-devday",
                "video_url": "https://example.com/devday.mp4",
                "thumbnail_url": "https://img.youtube.com/vi/openai-devday/hqdefault.jpg",
                "title": "OpenAI Dev Day",
                "description": "Reasoning models and agents.",
                "speaker": "Sam Altman",
                "published_at": None,
                "duration_seconds": 120,
                "license": "standard-youtube-license",
                "metadata": {},
            },
            "segments": [
                {
                    "segment_index": 0,
                    "title": "OpenAI Dev Day: agents",
                    "description": "Agent workflows.",
                    "transcript_text": "agents coordinate tasks",
                    "visual_summary": "Speaker on stage.",
                    "has_visual_embedding": True,
                    "visual_type": "slide",
                    "visual_description": "Slide with orchestration diagram.",
                    "visual_text_content": "Retriever -> Planner -> Tool",
                    "visual_entities": ["OpenAI", "Planner"],
                    "timestamp_start": 0.0,
                    "timestamp_end": 12.0,
                    "metadata": {"scene_index": 0},
                }
            ],
            "segment_embeddings": {0: [0.0] * DEFAULT_KNOWLEDGE_EMBEDDING_DIMENSION},
        }
    )

    asyncio.run(step.run(context))

    stored_video = context.data["stored_video"]
    stored_segments = context.data["stored_segments"]
    assert stored_video["source_video_id"] == "openai-devday"
    assert len(stored_segments) == 1
    assert stored_segments[0]["visual_type"] == "slide"
    assert stored_segments[0]["visual_entities"] == ["OpenAI", "Planner"]
    assert repository.segments_by_video_id[stored_video["id"]][0]["embedding"] == [
        0.0
    ] * DEFAULT_KNOWLEDGE_EMBEDDING_DIMENSION


def test_store_knowledge_segments_step_rejects_partial_embeddings_without_deleting() -> None:
    repository = InMemoryKnowledgeRepository()
    stored_video = asyncio.run(
        repository.upsert_knowledge_video(
            {
                "source": "youtube",
                "source_video_id": "openai-devday",
                "source_url": "https://www.youtube.com/watch?v=openai-devday",
                "video_url": "https://example.com/devday.mp4",
                "thumbnail_url": "https://img.youtube.com/vi/openai-devday/hqdefault.jpg",
                "title": "OpenAI Dev Day",
                "description": "Reasoning models and agents.",
                "speaker": "Sam Altman",
                "published_at": None,
                "duration_seconds": 120,
                "license": "standard-youtube-license",
                "metadata": {},
            }
        )
    )
    asyncio.run(
        repository.replace_knowledge_segments(
            video_id=stored_video["id"],
            segments=[
                {
                    "segment_index": 0,
                    "title": "Existing segment",
                    "description": "Existing description",
                    "transcript_text": "existing transcript",
                    "visual_summary": "Existing summary",
                    "timestamp_start": 0.0,
                    "timestamp_end": 10.0,
                    "metadata": {"scene_index": 0},
                    "embedding": [1.0] * DEFAULT_KNOWLEDGE_EMBEDDING_DIMENSION,
                }
            ],
        )
    )

    step = StoreKnowledgeSegmentsStep(repository=repository)
    context = PipelineContext(
        data={
            "video_metadata": {
                "source": "youtube",
                "source_video_id": "openai-devday",
                "source_url": "https://www.youtube.com/watch?v=openai-devday",
                "video_url": "https://example.com/devday.mp4",
                "thumbnail_url": "https://img.youtube.com/vi/openai-devday/hqdefault.jpg",
                "title": "OpenAI Dev Day",
                "description": "Reasoning models and agents.",
                "speaker": "Sam Altman",
                "published_at": None,
                "duration_seconds": 120,
                "license": "standard-youtube-license",
                "metadata": {},
            },
            "segments": [
                {
                    "segment_index": 0,
                    "title": "Updated segment 0",
                    "description": "Updated description",
                    "transcript_text": "updated transcript 0",
                    "visual_summary": "Updated summary 0",
                    "timestamp_start": 0.0,
                    "timestamp_end": 10.0,
                    "metadata": {"scene_index": 0},
                },
                {
                    "segment_index": 1,
                    "title": "New segment 1",
                    "description": "New description",
                    "transcript_text": "new transcript 1",
                    "visual_summary": "New summary 1",
                    "timestamp_start": 11.0,
                    "timestamp_end": 20.0,
                    "metadata": {"scene_index": 1},
                },
            ],
            "segment_embeddings": {
                0: [0.0] * DEFAULT_KNOWLEDGE_EMBEDDING_DIMENSION
            },
        }
    )

    with pytest.raises(ValueError, match="Missing segment indexes: 1"):
        asyncio.run(step.run(context))

    preserved_segments = repository.segments_by_video_id[stored_video["id"]]
    assert len(preserved_segments) == 1
    assert preserved_segments[0]["title"] == "Existing segment"


def test_mark_knowledge_job_completed_step_records_artifacts() -> None:
    repository = InMemoryKnowledgeRepository()
    step = MarkKnowledgeJobCompletedStep(repository=repository)
    context = PipelineContext(
        data={
            "job_id": "job-123",
            "source_video_id": "openai-devday",
            "scene_count": 2,
            "segment_count": 2,
            "indexed_segment_count": 2,
            "transcript_segment_count": 3,
            "video_path": "/tmp/demo.mp4",
            "temp_dir": "/tmp",
        }
    )

    asyncio.run(step.run(context))

    assert context.data["job_status"] == "completed"
    assert repository.completed_jobs["job-123"]["indexed_segment_count"] == 2


def test_knowledge_indexing_pipeline_uses_gemini_backend_by_default() -> None:
    pipeline = KnowledgeIndexingPipeline()

    assert isinstance(pipeline._embedding_backend, GeminiEmbeddingBackend)
    assert pipeline._embedding_backend.dimension() == DEFAULT_KNOWLEDGE_EMBEDDING_DIMENSION
    assert isinstance(pipeline._video_downloader, YtDlpVideoDownloader)
    assert isinstance(pipeline._transcriber, OpenAICompatibleTranscriber)


def test_knowledge_indexing_pipeline_prefers_subtitles_before_asr(
    tmp_path: Path,
) -> None:
    source_video = _write_video(tmp_path / "devday.mp4")
    subtitle_path = tmp_path / "devday.srt"
    subtitle_path.write_text(
        "1\n00:00:00,000 --> 00:00:06,000\nagents coordinate tasks with tools\n\n"
        "2\n00:00:07,000 --> 00:00:12,000\nknowledge search should cite timestamps\n",
        encoding="utf-8",
    )
    repository = InMemoryKnowledgeRepository()
    pipeline = KnowledgeIndexingPipeline(
        repository=repository,
        embedding_backend=FakeEmbeddingBackend(),
        metadata_client=StaticKnowledgeMetadataClient(
            {
                "id": "openai-devday",
                "title": "OpenAI Dev Day",
                "description": "Agents, reasoning models, and search workflows.",
                "speaker": "Sam Altman",
                "published_at": "2025-11-06T00:00:00Z",
                "duration_seconds": 18,
                "thumbnail_url": "https://img.youtube.com/vi/openai-devday/hqdefault.jpg",
                "source_url": "https://www.youtube.com/watch?v=openai-devday",
                "video_url": str(source_video),
                "download_url": str(source_video),
                "subtitle_path": str(subtitle_path),
            }
        ),
    )

    context = asyncio.run(
        pipeline.run(
            "openai-devday",
            job_id="job-knowledge-captions",
            conf={"scene_threshold": 0.35},
        )
    )

    stored_video = next(iter(repository.videos_by_key.values()))
    stored_segments = repository.segments_by_video_id[stored_video["id"]]

    assert context.failed_step is None
    assert context.data["transcript_source"] == str(subtitle_path)
    assert context.data["indexed_segment_count"] == 1
    assert stored_segments[0]["transcript_text"].startswith("agents coordinate tasks")


def test_knowledge_indexing_pipeline_falls_back_to_asr_when_subtitle_source_is_stale(
    tmp_path: Path,
) -> None:
    source_video = _write_video(tmp_path / "devday.mp4")
    stale_subtitle_path = tmp_path / "missing.srt"
    repository = InMemoryKnowledgeRepository()
    pipeline = KnowledgeIndexingPipeline(
        repository=repository,
        embedding_backend=FakeEmbeddingBackend(),
        metadata_client=StaticKnowledgeMetadataClient(
            {
                "id": "openai-devday",
                "title": "OpenAI Dev Day",
                "description": "Agents, reasoning models, and search workflows.",
                "speaker": "Sam Altman",
                "published_at": "2025-11-06T00:00:00Z",
                "duration_seconds": 12,
                "thumbnail_url": "https://img.youtube.com/vi/openai-devday/hqdefault.jpg",
                "source_url": "https://www.youtube.com/watch?v=openai-devday",
                "video_url": str(source_video),
                "download_url": str(source_video),
                "subtitle_path": str(stale_subtitle_path),
            }
        ),
        caption_provider=FakeCaptionProvider([]),
        transcriber=StaticKnowledgeTranscriber(
            [
                {
                    "start": 0.0,
                    "end": 6.0,
                    "text": "agents coordinate tasks with retrieval and tools",
                },
                {
                    "start": 7.0,
                    "end": 11.0,
                    "text": "knowledge search should cite timestamps",
                },
            ]
        ),
    )

    context = asyncio.run(
        pipeline.run(
            "openai-devday",
            job_id="job-knowledge-stale-subtitle",
            conf={"scene_threshold": 0.35},
        )
    )

    assert context.failed_step is None
    assert context.data["transcript_source"] == "asr"
    assert "Failed to load transcript source" in context.data["caption_resolution_warning"]
    assert context.data["indexed_segment_count"] == 1


def test_knowledge_indexing_pipeline_runs_end_to_end_with_stubs(
    tmp_path: Path,
) -> None:
    source_video = _write_video(tmp_path / "devday.mp4")
    repository = InMemoryKnowledgeRepository()
    pipeline = KnowledgeIndexingPipeline(
        repository=repository,
        embedding_backend=FakeEmbeddingBackend(),
        metadata_client=StaticKnowledgeMetadataClient(
            {
                "id": "openai-devday",
                "title": "OpenAI Dev Day",
                "description": "Agents, reasoning models, and search workflows.",
                "speaker": "Sam Altman",
                "published_at": "2025-11-06T00:00:00Z",
                "duration_seconds": 42,
                "thumbnail_url": "https://img.youtube.com/vi/openai-devday/hqdefault.jpg",
                "source_url": "https://www.youtube.com/watch?v=openai-devday",
                "video_url": str(source_video),
                "download_url": str(source_video),
            }
        ),
        transcriber=StaticKnowledgeTranscriber(
            [
                {
                    "start": 0.0,
                    "end": 10.0,
                    "text": "agents coordinate tasks with retrieval and tools",
                },
                {
                    "start": 11.0,
                    "end": 18.0,
                    "text": "reasoning models improve multi step execution",
                },
                {
                    "start": 28.0,
                    "end": 36.0,
                    "text": "knowledge search answers should cite timestamps",
                },
            ]
        ),
    )

    context = asyncio.run(
        pipeline.run(
            "openai-devday",
            job_id="job-knowledge-1",
            conf={"scene_threshold": 0.35},
        )
    )

    stored_video = next(iter(repository.videos_by_key.values()))
    stored_segments = repository.segments_by_video_id[stored_video["id"]]

    assert context.failed_step is None
    assert context.data["scene_count"] == 2
    assert context.data["segment_count"] == 1
    assert context.data["indexed_segment_count"] == 1
    assert context.data["job_status"] == "completed"
    assert repository.completed_jobs["job-knowledge-1"]["scene_count"] == 2
    assert stored_video["source_video_id"] == "openai-devday"
    assert len(stored_segments) == 1
    assert all(len(segment["embedding"]) == 768 for segment in stored_segments)
    assert stored_segments[0]["timestamp_start"] == 0.0
    assert stored_segments[0]["timestamp_end"] == 36.0
