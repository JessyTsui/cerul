import asyncio
from pathlib import Path
from unittest.mock import patch

import pytest

from backend.app.embedding import GeminiEmbeddingBackend
from workers.common.pipeline import PipelineContext
from workers.knowledge import InMemoryKnowledgeRepository, KnowledgeIndexingPipeline
from workers.knowledge.runtime import (
    HeuristicFrameAnalyzer,
    HeuristicSceneDetector,
    HttpVideoDownloader,
    StaticKnowledgeMetadataClient,
    StaticKnowledgeTranscriber,
)
from workers.knowledge.steps import (
    AnalyzeKnowledgeFramesStep,
    DetectKnowledgeScenesStep,
    DownloadKnowledgeVideoStep,
    EmbedKnowledgeSegmentsStep,
    FetchKnowledgeMetadataStep,
    MarkKnowledgeJobCompletedStep,
    SegmentKnowledgeTranscriptStep,
    StoreKnowledgeSegmentsStep,
    TranscribeKnowledgeVideoStep,
)


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
                    "keywords": ["agents", "reasoning", "models"],
                }
            ],
        }
    )

    asyncio.run(step.run(context))

    segment = context.data["segments"][0]
    assert segment["title"].startswith("OpenAI Dev Day:")
    assert "agents plan tasks" in segment["transcript_text"]
    assert segment["metadata"]["transcript_segment_count"] == 2


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
                    "timestamp_start": 0.0,
                    "timestamp_end": 12.0,
                    "metadata": {"scene_index": 0},
                }
            ],
            "segment_embeddings": {0: [0.0] * 768},
        }
    )

    asyncio.run(step.run(context))

    stored_video = context.data["stored_video"]
    stored_segments = context.data["stored_segments"]
    assert stored_video["source_video_id"] == "openai-devday"
    assert len(stored_segments) == 1
    assert repository.segments_by_video_id[stored_video["id"]][0]["embedding"] == [0.0] * 768


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
                    "embedding": [1.0] * 768,
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
            "segment_embeddings": {0: [0.0] * 768},
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
    assert context.data["segment_count"] == 2
    assert context.data["indexed_segment_count"] == 2
    assert context.data["job_status"] == "completed"
    assert repository.completed_jobs["job-knowledge-1"]["scene_count"] == 2
    assert stored_video["source_video_id"] == "openai-devday"
    assert len(stored_segments) == 2
    assert all(len(segment["embedding"]) == 768 for segment in stored_segments)
    assert stored_segments[0]["timestamp_start"] == 0.0
    assert stored_segments[1]["timestamp_start"] == 28.0
