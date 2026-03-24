from __future__ import annotations

import asyncio
import hashlib
import inspect
import json
import logging
import mimetypes
import os
import re
import shutil
import subprocess
import threading
import time
from collections import Counter, OrderedDict
from collections.abc import Awaitable, Callable, Mapping, Sequence
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Protocol
from urllib.parse import urlparse

import httpx

from backend.app.config import get_settings

DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1"
DEFAULT_TRANSCRIPTION_MODEL = "whisper-1"
DEFAULT_OPENAI_UPLOAD_LIMIT_BYTES = 25 * 1024 * 1024
DEFAULT_WHISPER_TARGET_CHUNK_SECONDS = 600.0
DEFAULT_WHISPER_MIN_CHUNK_SECONDS = 240.0
DEFAULT_WHISPER_MAX_CHUNK_SECONDS = 780.0
DEFAULT_WHISPER_MAX_CONCURRENCY = 3
DEFAULT_FRAME_SCENE_THRESHOLD = 0.25
DEFAULT_FRAME_SCALE = "640:360"
DEFAULT_FRAME_HASH_DISTANCE = 8
DEFAULT_MAX_INFORMATIVE_FRAMES = 2
DEFAULT_MAX_ANNOTATED_FRAMES_PER_SCENE = 1
DEFAULT_MAX_ANNOTATED_FRAMES_PER_VIDEO = 20
DEFAULT_SHORT_VIDEO_ANNOTATE_BIAS_SECONDS = 180.0
DEFAULT_TEXT_REGION_MIN_COUNT = 8
DEFAULT_TEXT_REGION_MIN_AREA_RATIO = 0.02
DEFAULT_FRAME_ANNOTATION_TIMEOUT_SECONDS = 45.0
DEFAULT_FRAME_ANNOTATION_CONCURRENCY = 5
DEFAULT_FRAME_ANNOTATION_CACHE_SIZE = 2048
DEFAULT_FRAME_PREPARE_CONCURRENCY = 4
DEFAULT_FRAME_EXTRACTION_CACHE_SIZE = 512
DEFAULT_GEMINI_FLASH_MODEL = "gemini-3.1-flash-image-preview"

FRAME_ANNOTATION_PROMPT = """
You are analyzing a screenshot from a technical talk, interview, demo, or keynote.
Return JSON only with this exact schema:
{
  "description": "1-2 sentences describing the frame",
  "text_content": "All visible text from slides, charts, UI, numbers, bullets, or code",
  "visual_type": "slide|chart|diagram|code|product_demo|whiteboard|other",
  "key_entities": ["model", "product", "company", "metric"]
}
""".strip()

logger = logging.getLogger(__name__)

_FRAME_ANNOTATION_CACHE: "OrderedDict[str, dict[str, Any]]" = OrderedDict()
_FRAME_ANNOTATION_CACHE_LOCK = threading.Lock()
_FRAME_EXTRACTION_CACHE: "OrderedDict[str, list[tuple[str, bytes]]]" = OrderedDict()
_FRAME_EXTRACTION_CACHE_LOCK = threading.Lock()


def _resolve_ytdlp_proxy(proxy_url: str | None = None) -> str | None:
    candidate = (proxy_url or os.getenv("YTDLP_PROXY") or "").strip()
    return candidate or None


def _first_env(*names: str) -> str:
    for name in names:
        value = os.getenv(name, "").strip()
        if value:
            return value
    return ""


class KnowledgeMetadataClient(Protocol):
    async def get_video_metadata(self, video_id: str) -> Mapping[str, Any]:
        ...


class KnowledgeCaptionProvider(Protocol):
    async def resolve_transcript_segments(
        self,
        video_metadata: Mapping[str, Any],
        output_dir: Path,
    ) -> Sequence[Mapping[str, Any]] | None:
        ...


class KnowledgeVideoDownloader(Protocol):
    async def download_video(
        self,
        video_metadata: Mapping[str, Any],
        output_dir: Path,
    ) -> str | Path:
        ...


class KnowledgeTranscriber(Protocol):
    async def transcribe(
        self,
        video_path: str | Path,
        *,
        video_metadata: Mapping[str, Any],
    ) -> Sequence[Mapping[str, Any]]:
        ...


class KnowledgeSceneDetector(Protocol):
    async def detect_scenes(
        self,
        video_path: str | Path,
        *,
        transcript_segments: Sequence[Mapping[str, Any]],
        video_metadata: Mapping[str, Any],
        threshold: float,
    ) -> Sequence[Mapping[str, Any]]:
        ...


class KnowledgeFrameAnalyzer(Protocol):
    async def analyze_scene(
        self,
        video_path: str | Path,
        *,
        scene: Mapping[str, Any],
        transcript_segments: Sequence[Mapping[str, Any]],
        video_metadata: Mapping[str, Any],
        log_event: Callable[[str, Mapping[str, Any] | None], Awaitable[None] | None] | None = None,
    ) -> Mapping[str, Any]:
        ...


class StaticKnowledgeMetadataClient:
    def __init__(self, payload: Mapping[str, Any]) -> None:
        self._payload = dict(payload)

    async def get_video_metadata(self, video_id: str) -> Mapping[str, Any]:
        return dict(self._payload)


class StaticKnowledgeTranscriber:
    def __init__(self, segments: Sequence[Mapping[str, Any]]) -> None:
        self._segments = [dict(segment) for segment in segments]

    async def transcribe(
        self,
        video_path: str | Path,
        *,
        video_metadata: Mapping[str, Any],
    ) -> Sequence[Mapping[str, Any]]:
        return [dict(segment) for segment in self._segments]


class OpenAICompatibleTranscriber:
    def __init__(
        self,
        *,
        api_key: str | None = None,
        base_url: str | None = None,
        model_name: str | None = None,
        timeout_seconds: float | None = None,
        response_format: str | None = None,
        timestamp_granularity: str | None = None,
        max_upload_bytes: int = DEFAULT_OPENAI_UPLOAD_LIMIT_BYTES,
        chunk_target_seconds: float = DEFAULT_WHISPER_TARGET_CHUNK_SECONDS,
        chunk_min_seconds: float = DEFAULT_WHISPER_MIN_CHUNK_SECONDS,
        chunk_max_seconds: float = DEFAULT_WHISPER_MAX_CHUNK_SECONDS,
        max_concurrent_requests: int = DEFAULT_WHISPER_MAX_CONCURRENCY,
        silence_noise_level: str = "-30dB",
        silence_duration_seconds: float = 0.5,
    ) -> None:
        transcription_settings = get_settings().knowledge.transcription
        self._provider = str(transcription_settings.provider).strip().lower()
        self._api_key = (
            api_key
            or _first_env("ASR_API_KEY", "OPENAI_TRANSCRIBE_API_KEY", "OPENAI_API_KEY")
        ).strip()
        resolved_base_url = (
            base_url
            or _first_env("ASR_BASE_URL", "OPENAI_TRANSCRIBE_BASE_URL")
            or str(transcription_settings.base_url)
            or DEFAULT_OPENAI_BASE_URL
        )
        self._base_url = resolved_base_url.rstrip("/")
        self._model_name = (
            (
                model_name
                or _first_env("ASR_MODEL", "OPENAI_TRANSCRIBE_MODEL")
                or str(transcription_settings.model)
            ).strip()
            or DEFAULT_TRANSCRIPTION_MODEL
        )
        self._response_format = (
            (
                response_format
                or _first_env("ASR_RESPONSE_FORMAT", "OPENAI_TRANSCRIBE_RESPONSE_FORMAT")
                or str(transcription_settings.response_format)
            ).strip()
            or "auto"
        ).lower()
        self._timestamp_granularity = (
            (
                timestamp_granularity
                or _first_env("ASR_TIMESTAMP_GRANULARITY", "OPENAI_TRANSCRIBE_TIMESTAMP_GRANULARITY")
                or str(transcription_settings.timestamp_granularity)
            ).strip()
            or "segment"
        ).lower()
        resolved_timeout_seconds = (
            timeout_seconds
            if timeout_seconds is not None
            else float(
                _first_env("ASR_TIMEOUT_SECONDS", "OPENAI_TRANSCRIBE_TIMEOUT_SECONDS")
                or transcription_settings.timeout_seconds
                or 600.0
            )
        )
        self._timeout_seconds = resolved_timeout_seconds
        self._max_upload_bytes = max_upload_bytes
        self._chunk_target_seconds = max(float(chunk_target_seconds), 60.0)
        self._chunk_min_seconds = max(
            30.0,
            min(float(chunk_min_seconds), self._chunk_target_seconds),
        )
        self._chunk_max_seconds = max(
            self._chunk_target_seconds,
            float(chunk_max_seconds),
        )
        self._max_concurrent_requests = max(int(max_concurrent_requests), 1)
        self._silence_noise_level = silence_noise_level
        self._silence_duration_seconds = max(float(silence_duration_seconds), 0.1)
        self._logger = logging.getLogger(__name__)

    async def transcribe(
        self,
        video_path: str | Path,
        *,
        video_metadata: Mapping[str, Any],
    ) -> Sequence[Mapping[str, Any]]:
        if not self._api_key:
            raise RuntimeError(
                "ASR_API_KEY, OPENAI_TRANSCRIBE_API_KEY, or OPENAI_API_KEY is required for ASR fallback."
            )

        resolved_video_path = Path(video_path)
        if not resolved_video_path.exists():
            raise FileNotFoundError(f"Transcription input does not exist: {resolved_video_path}")

        source_duration = await self._get_audio_duration(resolved_video_path)

        # Extract a low-bitrate mp3 before chunking so long uploads stay stable and
        # the worker can cut at silence boundaries without m4a/moov corruption.
        upload_path = resolved_video_path
        tmp_audio_path: Path | None = None
        should_extract_audio = (
            resolved_video_path.suffix.lower() != ".mp3"
            or resolved_video_path.stat().st_size > self._max_upload_bytes
            or source_duration > self._chunk_target_seconds
        )
        if should_extract_audio:
            tmp_audio_path = resolved_video_path.with_name(
                resolved_video_path.stem + ".whisper.mp3"
            )
            if await self._extract_audio_track(resolved_video_path, tmp_audio_path):
                upload_path = tmp_audio_path
            else:
                tmp_audio_path = None

        default_end = float(video_metadata.get("duration_seconds") or source_duration or 0.0)
        try:
            all_segments = await self._transcribe_with_chunking(upload_path, default_end)
        finally:
            if tmp_audio_path and tmp_audio_path.exists():
                tmp_audio_path.unlink(missing_ok=True)

        return normalize_transcript_segments(all_segments, default_end=default_end)

    async def _get_audio_duration(self, audio_path: Path) -> float:
        """Return duration in seconds via ffprobe, or 0 on failure."""
        try:
            proc = await asyncio.create_subprocess_exec(
                "ffprobe", "-v", "quiet",
                "-show_entries", "format=duration",
                "-of", "csv=p=0",
                str(audio_path),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL,
            )
            stdout, _ = await proc.communicate()
            return float(stdout.decode().strip() or 0)
        except Exception:
            return 0.0

    async def _extract_audio_track(
        self,
        source_path: Path,
        target_path: Path,
    ) -> bool:
        try:
            proc = await asyncio.create_subprocess_exec(
                "ffmpeg",
                "-y",
                "-i",
                str(source_path),
                "-vn",
                "-ac",
                "1",
                "-ar",
                "16000",
                "-b:a",
                "16k",
                str(target_path),
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )
            await proc.communicate()
        except FileNotFoundError:
            return False

        if proc.returncode != 0 or not target_path.exists():
            target_path.unlink(missing_ok=True)
            return False
        return True

    async def _detect_silence_boundaries(self, audio_path: Path) -> list[float]:
        try:
            completed = await asyncio.to_thread(
                subprocess.run,
                [
                    "ffmpeg",
                    "-i",
                    str(audio_path),
                    "-af",
                    (
                        "silencedetect="
                        f"noise={self._silence_noise_level}:d={self._silence_duration_seconds}"
                    ),
                    "-f",
                    "null",
                    "-",
                ],
                capture_output=True,
                text=True,
                check=False,
            )
        except FileNotFoundError:
            return []

        matches = re.findall(r"silence_end:\s*([0-9]+(?:\.[0-9]+)?)", completed.stderr)
        return [float(value) for value in matches]

    async def _extract_audio_chunk(
        self,
        audio_path: Path,
        *,
        chunk_index: int,
        chunk_start: float,
        chunk_end: float,
    ) -> Path:
        chunk_path = audio_path.with_name(f"{audio_path.stem}.chunk{chunk_index:03d}.mp3")
        chunk_duration = max(chunk_end - chunk_start, 0.1)
        proc = await asyncio.create_subprocess_exec(
            "ffmpeg",
            "-y",
            "-ss",
            str(chunk_start),
            "-i",
            str(audio_path),
            "-t",
            str(chunk_duration),
            "-ac",
            "1",
            "-ar",
            "16000",
            "-b:a",
            "16k",
            str(chunk_path),
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        await proc.communicate()
        if proc.returncode != 0 or not chunk_path.exists():
            chunk_path.unlink(missing_ok=True)
            raise RuntimeError(
                "ffmpeg chunk extraction failed "
                f"for chunk {chunk_index} ({chunk_start:.2f}-{chunk_end:.2f}s)."
            )
        return chunk_path

    async def _transcribe_with_chunking(
        self,
        audio_path: Path,
        default_end: float,
    ) -> list[dict[str, Any]]:
        """Transcribe audio by splitting near silence boundaries around 10 minutes."""
        duration = await self._get_audio_duration(audio_path)
        if duration <= 0.0:
            if audio_path.stat().st_size > self._max_upload_bytes:
                raise RuntimeError(
                    "Unable to determine audio duration for oversized upload. "
                    "Prefer subtitles or ensure ffprobe is installed."
                )
            response = await self._call_whisper_api(audio_path)
            return _extract_transcript_segments(response.json(), default_end=default_end)

        requires_chunking = (
            duration > self._chunk_target_seconds
            or audio_path.stat().st_size > self._max_upload_bytes
        )
        if not requires_chunking:
            response = await self._call_whisper_api(audio_path)
            return _extract_transcript_segments(response.json(), default_end=default_end)

        silence_boundaries = await self._detect_silence_boundaries(audio_path)
        chunk_ranges = _plan_transcription_chunks(
            duration,
            silence_boundaries,
            target_chunk_seconds=self._chunk_target_seconds,
            min_chunk_seconds=self._chunk_min_seconds,
            max_chunk_seconds=self._chunk_max_seconds,
        )
        if not chunk_ranges:
            response = await self._call_whisper_api(audio_path)
            return _extract_transcript_segments(response.json(), default_end=default_end)

        self._logger.info(
            "Transcribing %s in %d chunks using silence-aware boundaries.",
            audio_path.name,
            len(chunk_ranges),
        )
        semaphore = asyncio.Semaphore(self._max_concurrent_requests)

        async def _transcribe_chunk(
            chunk_index: int,
            chunk_range: tuple[float, float],
        ) -> list[dict[str, Any]]:
            chunk_start, chunk_end = chunk_range
            async with semaphore:
                chunk_path = await self._extract_audio_chunk(
                    audio_path,
                    chunk_index=chunk_index,
                    chunk_start=chunk_start,
                    chunk_end=chunk_end,
                )
                try:
                    response = await self._call_whisper_api(chunk_path)
                    chunk_segments = _extract_transcript_segments(
                        response.json(),
                        default_end=chunk_end - chunk_start,
                    )
                    return [
                        {
                            **segment,
                            "start": float(segment["start"]) + chunk_start,
                            "end": float(segment["end"]) + chunk_start,
                        }
                        for segment in chunk_segments
                    ]
                finally:
                    chunk_path.unlink(missing_ok=True)

        chunk_results = await asyncio.gather(
            *[
                _transcribe_chunk(chunk_index, chunk_range)
                for chunk_index, chunk_range in enumerate(chunk_ranges)
            ]
        )
        return [
            segment
            for chunk_segments in chunk_results
            for segment in chunk_segments
        ]

    async def _call_whisper_api(self, audio_path: Path) -> httpx.Response:
        """Upload one audio file to the Whisper endpoint and return the response."""
        suffix = audio_path.suffix.lower()
        content_type = "audio/mpeg" if suffix == ".mp3" else (
            mimetypes.guess_type(audio_path.name)[0] or "application/octet-stream"
        )
        file_bytes = audio_path.read_bytes()
        base_url = self._base_url
        api_key = self._api_key
        model_name = self._model_name
        response_format = self._resolve_transcription_response_format()
        timeout = self._timeout_seconds
        proxy_url = (
            _first_env("ASR_PROXY", "HTTPS_PROXY", "HTTP_PROXY")
            or None
        )
        request_data = {
            "model": model_name,
            "response_format": response_format,
        }
        if response_format == "verbose_json" and self._timestamp_granularity:
            request_data["timestamp_granularities[]"] = self._timestamp_granularity

        def _do_request() -> httpx.Response:
            with httpx.Client(timeout=timeout, proxy=proxy_url) as client:
                return client.post(
                    f"{base_url}/audio/transcriptions",
                    headers={"Authorization": f"Bearer {api_key}"},
                    data=request_data,
                    files={"file": (audio_path.name, file_bytes, content_type)},
                )

        response = await asyncio.to_thread(_do_request)
        if not response.is_success:
            raise RuntimeError(
                f"Whisper API error {response.status_code}: {response.text[:500]}"
            )
        return response

    def _resolve_transcription_response_format(self) -> str:
        if self._response_format != "auto":
            return self._response_format
        return "verbose_json"


class YtDlpCaptionProvider:
    def __init__(
        self,
        *,
        command: str | None = None,
        proxy_url: str | None = None,
        logger: logging.Logger | None = None,
    ) -> None:
        self._command = (command or os.getenv("YTDLP_BIN") or "yt-dlp").strip() or "yt-dlp"
        self._proxy_url = _resolve_ytdlp_proxy(proxy_url)
        self._logger = logger or logging.getLogger(__name__)

    async def resolve_transcript_segments(
        self,
        video_metadata: Mapping[str, Any],
        output_dir: Path,
    ) -> Sequence[Mapping[str, Any]] | None:
        source = _first_non_empty(
            video_metadata.get("source_url"),
            video_metadata.get("video_url"),
        )
        source_video_id = _first_non_empty(
            video_metadata.get("source_video_id"),
            video_metadata.get("video_id"),
            "captions",
        )
        if source is None or source_video_id is None:
            return None

        output_dir.mkdir(parents=True, exist_ok=True)
        output_template = output_dir / f"{source_video_id}.%(ext)s"
        command = [
            self._command,
            "--extractor-args", "youtube:player_client=android",
            "--skip-download",
            "--write-subs",
            "--write-auto-subs",
            "--sub-langs",
            "all",
            "--sub-format",
            "srt/vtt/best",
            "--output",
            str(output_template),
            source,
        ]
        if self._proxy_url is not None:
            command[1:1] = ["--proxy", self._proxy_url]

        try:
            completed = await self._run_command(command)
        except FileNotFoundError:
            self._logger.warning("yt-dlp is not installed; skipping subtitle resolution.")
            return None

        if completed.returncode != 0:
            self._logger.warning(
                "yt-dlp subtitle resolution failed for %s: %s",
                source,
                (completed.stderr or completed.stdout).strip(),
            )
            return None

        subtitle_files = _find_caption_files(output_dir, source_video_id)
        if not subtitle_files:
            return None

        selected_file = _select_preferred_caption_file(
            subtitle_files,
            preferred_languages=_resolve_preferred_caption_languages(video_metadata),
            source_video_id=str(source_video_id),
        )
        return parse_transcript_file(
            selected_file,
            default_end=float(video_metadata.get("duration_seconds") or 0.0),
        )

    async def _run_command(self, command: Sequence[str]) -> subprocess.CompletedProcess[str]:
        return await asyncio.to_thread(
            subprocess.run,
            list(command),
            capture_output=True,
            text=True,
            check=False,
        )


class HttpVideoDownloader:
    def __init__(self, timeout: float = 120.0) -> None:
        self._timeout = timeout

    async def download_video(
        self,
        video_metadata: Mapping[str, Any],
        output_dir: Path,
    ) -> str:
        source = str(video_metadata.get("download_url") or "").strip()
        if not source:
            raise ValueError("Video metadata is missing an explicit download_url.")

        output_dir.mkdir(parents=True, exist_ok=True)
        local_path = _resolve_local_path(source)
        target_name = f"{video_metadata['source']}_{video_metadata['source_video_id']}"

        if local_path is not None:
            extension = local_path.suffix or ".mp4"
            destination = output_dir / f"{target_name}{extension}"
            shutil.copyfile(local_path, destination)
            return str(destination)

        async with httpx.AsyncClient(
            timeout=self._timeout,
            follow_redirects=True,
        ) as client:
            async with client.stream("GET", source) as response:
                response.raise_for_status()
                content_type = response.headers.get("content-type")
                if not _is_supported_download_content_type(content_type):
                    raise ValueError(
                        "download_url returned unsupported content-type: "
                        f"{content_type or 'unknown'}."
                    )
                extension = _guess_extension(
                    source_url=source,
                    content_type=content_type,
                )
                destination = output_dir / f"{target_name}{extension}"
                with destination.open("wb") as handle:
                    async for chunk in response.aiter_bytes():
                        if chunk:
                            handle.write(chunk)

            return str(destination)


class YtDlpVideoDownloader:
    def __init__(
        self,
        *,
        command: str | None = None,
        proxy_url: str | None = None,
        max_height: int | None = None,
        fallback_downloader: KnowledgeVideoDownloader | None = None,
        logger: logging.Logger | None = None,
    ) -> None:
        download_settings = get_settings().knowledge.download
        self._command = (command or os.getenv("YTDLP_BIN") or "yt-dlp").strip() or "yt-dlp"
        self._proxy_url = _resolve_ytdlp_proxy(proxy_url)
        resolved_max_height = max_height if max_height is not None else download_settings.max_height
        self._max_height = max(int(resolved_max_height), 1)
        self._fallback_downloader = fallback_downloader or HttpVideoDownloader()
        self._logger = logger or logging.getLogger(__name__)

    async def download_video(
        self,
        video_metadata: Mapping[str, Any],
        output_dir: Path,
    ) -> str | Path:
        source = _first_non_empty(
            video_metadata.get("download_url"),
            video_metadata.get("source_url"),
            video_metadata.get("video_url"),
        )
        if source is None:
            raise ValueError("Video metadata is missing a downloadable source URL.")

        output_dir.mkdir(parents=True, exist_ok=True)
        if _can_use_direct_download(source):
            download_metadata = dict(video_metadata)
            download_metadata["download_url"] = source
            return await self._fallback_downloader.download_video(download_metadata, output_dir)

        target_name_parts = [
            str(video_metadata.get("source") or "").strip(),
            str(video_metadata.get("source_video_id") or "").strip(),
        ]
        target_name = "_".join(part for part in target_name_parts if part) or "knowledge_video"
        output_template = output_dir / f"{target_name}.%(ext)s"
        format_selector = self._build_format_selector()
        command = [
            self._command,
            "--no-playlist",
            "--extractor-args", "youtube:player_client=android",
            "--format",
            format_selector,
            "--output",
            str(output_template),
            source,
        ]
        if self._proxy_url is not None:
            command[1:1] = ["--proxy", self._proxy_url]

        try:
            completed = await self._run_command(command)
        except FileNotFoundError as exc:
            raise RuntimeError(
                "yt-dlp is required to download YouTube videos for knowledge indexing."
            ) from exc

        if completed.returncode != 0:
            raise RuntimeError(
                (completed.stderr or completed.stdout).strip() or "yt-dlp video download failed."
            )

        downloaded_files = _find_downloaded_video_files(output_dir, str(target_name))
        if not downloaded_files:
            raise FileNotFoundError(
                f"yt-dlp completed without producing a video file for {source}."
            )

        selected_file = max(downloaded_files, key=lambda path: path.stat().st_mtime)
        self._logger.info("Downloaded knowledge video via yt-dlp to %s", selected_file)
        return str(selected_file)

    def _build_format_selector(self) -> str:
        max_height = self._max_height
        return (
            f"18/bestvideo[height<={max_height}][ext=mp4]+bestaudio[ext=m4a]"
            f"/bestvideo[height<={max_height}]+bestaudio"
            f"/best[height<={max_height}]"
            "/best"
        )

    async def _run_command(self, command: Sequence[str]) -> subprocess.CompletedProcess[str]:
        return await asyncio.to_thread(
            subprocess.run,
            list(command),
            capture_output=True,
            text=True,
            check=False,
        )


class HeuristicSceneDetector:
    async def detect_scenes(
        self,
        video_path: str | Path,
        *,
        transcript_segments: Sequence[Mapping[str, Any]],
        video_metadata: Mapping[str, Any],
        threshold: float,
    ) -> Sequence[Mapping[str, Any]]:
        normalized_segments = normalize_transcript_segments(
            transcript_segments,
            default_end=float(video_metadata.get("duration_seconds") or 0),
        )
        if not normalized_segments:
            duration_seconds = float(video_metadata.get("duration_seconds") or 0.0)
            return [
                {
                    "scene_index": 0,
                    "timestamp_start": 0.0,
                    "timestamp_end": duration_seconds,
                    "keyframe_timestamp": duration_seconds / 2 if duration_seconds else 0.0,
                    "transcript_excerpt": "",
                    "metadata": {"detector": "heuristic"},
                }
            ]

        pause_threshold = max(1.5, 5.0 - (threshold * 4.0))
        max_scene_seconds = max(15.0, 75.0 - (threshold * 45.0))

        scenes: list[dict[str, Any]] = []
        current_group: list[dict[str, Any]] = [normalized_segments[0]]
        current_start = normalized_segments[0]["start"]
        previous_end = normalized_segments[0]["end"]

        for segment in normalized_segments[1:]:
            gap = float(segment["start"]) - float(previous_end)
            next_duration = float(segment["end"]) - float(current_start)
            if gap >= pause_threshold or next_duration >= max_scene_seconds:
                scenes.append(
                    _build_scene_payload(len(scenes), current_group, detector="heuristic")
                )
                current_group = [segment]
                current_start = segment["start"]
            else:
                current_group.append(segment)
            previous_end = segment["end"]

        scenes.append(_build_scene_payload(len(scenes), current_group, detector="heuristic"))
        return scenes


class GeminiFlashFrameAnnotator:
    def __init__(
        self,
        *,
        api_key: str | None = None,
        model_name: str = DEFAULT_GEMINI_FLASH_MODEL,
        client: Any | None = None,
    ) -> None:
        self._api_key = (api_key or os.getenv("GEMINI_API_KEY", "")).strip()
        self._model_name = model_name
        self._client = client
        self._sdk_types: Any | None = None

    def available(self) -> bool:
        return self._client is not None or bool(self._api_key)

    async def annotate(self, image_path: str | Path) -> dict[str, Any]:
        return await asyncio.to_thread(self._annotate_sync, Path(image_path))

    def _annotate_sync(self, image_path: Path) -> dict[str, Any]:
        client = self._get_client()
        sdk_types = self._get_sdk_types()
        mime_type = mimetypes.guess_type(image_path.name)[0] or "image/jpeg"
        if sdk_types is None:
            image_part: Any = {
                "data": image_path.read_bytes(),
                "mime_type": mime_type,
            }
            config: Any = {
                "response_mime_type": "application/json",
                "temperature": 0,
            }
        else:
            image_part = sdk_types.Part.from_bytes(
                data=image_path.read_bytes(),
                mime_type=mime_type,
            )
            config = sdk_types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0,
            )

        response = client.models.generate_content(
            model=self._model_name,
            contents=[FRAME_ANNOTATION_PROMPT, image_part],
            config=config,
        )
        return _normalize_frame_annotation_payload(_extract_generated_text(response))

    def _get_client(self) -> Any:
        if self._client is not None:
            return self._client
        if not self._api_key:
            raise RuntimeError("GEMINI_API_KEY is required for frame annotation.")
        genai_module = self._load_sdk()[0]
        self._client = genai_module.Client(api_key=self._api_key)
        return self._client

    def _get_sdk_types(self) -> Any | None:
        try:
            return self._load_sdk()[1]
        except RuntimeError:
            if self._client is not None:
                return None
            raise

    def _load_sdk(self) -> tuple[Any, Any]:
        if self._sdk_types is not None:
            from google import genai

            return genai, self._sdk_types

        try:
            from google import genai
            from google.genai import types
        except ImportError as exc:
            raise RuntimeError(
                "GeminiFlashFrameAnnotator requires google-genai. "
                "Install workers/requirements.txt."
            ) from exc

        self._sdk_types = types
        return genai, types


class HeuristicFrameAnalyzer:
    def __init__(
        self,
        *,
        ffmpeg_command: str = "ffmpeg",
        scene_threshold: float = DEFAULT_FRAME_SCENE_THRESHOLD,
        frame_scale: str = DEFAULT_FRAME_SCALE,
        hash_distance_threshold: int = DEFAULT_FRAME_HASH_DISTANCE,
        max_informative_frames: int = DEFAULT_MAX_INFORMATIVE_FRAMES,
        max_annotated_frames_per_scene: int = DEFAULT_MAX_ANNOTATED_FRAMES_PER_SCENE,
        max_annotated_frames_per_video: int = DEFAULT_MAX_ANNOTATED_FRAMES_PER_VIDEO,
        short_video_annotate_bias_seconds: float = DEFAULT_SHORT_VIDEO_ANNOTATE_BIAS_SECONDS,
        text_region_min_count: int = DEFAULT_TEXT_REGION_MIN_COUNT,
        text_region_min_area_ratio: float = DEFAULT_TEXT_REGION_MIN_AREA_RATIO,
        annotation_timeout_seconds: float = DEFAULT_FRAME_ANNOTATION_TIMEOUT_SECONDS,
        annotation_concurrency: int = DEFAULT_FRAME_ANNOTATION_CONCURRENCY,
        annotation_cache_size: int = DEFAULT_FRAME_ANNOTATION_CACHE_SIZE,
        prepare_concurrency: int = DEFAULT_FRAME_PREPARE_CONCURRENCY,
        extraction_cache_size: int = DEFAULT_FRAME_EXTRACTION_CACHE_SIZE,
        annotation_backend: GeminiFlashFrameAnnotator | None = None,
        logger: logging.Logger | None = None,
    ) -> None:
        self._ffmpeg_command = ffmpeg_command
        self._scene_threshold = scene_threshold
        self._frame_scale = frame_scale
        self._hash_distance_threshold = hash_distance_threshold
        self._max_informative_frames = max(1, int(max_informative_frames))
        self._max_annotated_frames_per_scene = max(1, int(max_annotated_frames_per_scene))
        self._max_annotated_frames_per_video = max(1, int(max_annotated_frames_per_video))
        self._short_video_annotate_bias_seconds = max(
            float(short_video_annotate_bias_seconds),
            0.0,
        )
        self._text_region_min_count = max(int(text_region_min_count), 1)
        self._text_region_min_area_ratio = max(float(text_region_min_area_ratio), 0.0)
        self._annotation_timeout_seconds = max(float(annotation_timeout_seconds), 0.001)
        self._annotation_concurrency = max(int(annotation_concurrency), 1)
        self._annotation_cache_size = max(int(annotation_cache_size), 0)
        self._prepare_concurrency = max(int(prepare_concurrency), 1)
        self._extraction_cache_size = max(int(extraction_cache_size), 0)
        self._annotation_backend = annotation_backend or GeminiFlashFrameAnnotator()
        self._logger = logger or logging.getLogger(__name__)
        self._annotated_frames_used = 0

    @property
    def annotation_concurrency(self) -> int:
        return self._annotation_concurrency

    @property
    def prepare_concurrency(self) -> int:
        return self._prepare_concurrency

    async def analyze_scene(
        self,
        video_path: str | Path,
        *,
        scene: Mapping[str, Any],
        transcript_segments: Sequence[Mapping[str, Any]],
        video_metadata: Mapping[str, Any],
        log_event: Callable[[str, Mapping[str, Any] | None], Awaitable[None] | None] | None = None,
    ) -> Mapping[str, Any]:
        prepared_scene = await self.prepare_scene_analysis(
            video_path,
            scene=scene,
            transcript_segments=transcript_segments,
            video_metadata=video_metadata,
            log_event=log_event,
        )
        annotation_outcome = await self.annotate_prepared_scene(
            prepared_scene,
            log_event=log_event,
        )
        return self.finalize_prepared_scene_analysis(
            prepared_scene,
            annotation_outcome=annotation_outcome,
        )

    async def prepare_scene_analysis(
        self,
        video_path: str | Path,
        *,
        scene: Mapping[str, Any],
        transcript_segments: Sequence[Mapping[str, Any]],
        video_metadata: Mapping[str, Any],
        log_event: Callable[[str, Mapping[str, Any] | None], Awaitable[None] | None] | None = None,
    ) -> dict[str, Any]:
        overlapping_segments = [
            segment
            for segment in normalize_transcript_segments(transcript_segments)
            if _segments_overlap(
                float(segment["start"]),
                float(segment["end"]),
                float(scene["timestamp_start"]),
                float(scene["timestamp_end"]),
            )
        ]
        transcript_excerpt = " ".join(
            str(segment["text"]).strip() for segment in overlapping_segments
        ).strip() or str(scene.get("transcript_excerpt", "")).strip()
        keywords = extract_keywords(transcript_excerpt, limit=4)
        scene_index = int(scene["scene_index"])
        prepare_started_at = time.monotonic()
        resolved_video_path = Path(video_path)
        if not resolved_video_path.exists():
            return self._build_prepared_scene(
                scene_index=scene_index,
                keywords=keywords,
                route="text_only",
                selected_frames=[],
                annotation_frames=[],
                candidate_frame_count=0,
                unique_frame_count=0,
                informative_frame_count=0,
                ocr_detected=False,
                remaining_annotation_budget=self._remaining_annotation_budget(),
                fallback_visual_summary=self._build_fallback_summary(
                    keywords=keywords,
                    video_metadata=video_metadata,
                ),
                extraction_cache_hit_count=0,
                extraction_time_ms=0,
                dedup_time_ms=0,
                filter_time_ms=0,
                ocr_time_ms=0,
                prepare_time_ms=_elapsed_time_ms(prepare_started_at),
            )

        output_dir = (
            resolved_video_path.parent
            / f"{resolved_video_path.stem}_frames"
            / f"scene_{scene_index:04d}"
        )
        extraction_started_at = time.monotonic()
        candidate_frames, extraction_cache_hit = await self._resolve_candidate_frames(
            resolved_video_path,
            scene=scene,
            output_dir=output_dir,
            video_metadata=video_metadata,
        )
        extraction_time_ms = _elapsed_time_ms(extraction_started_at)
        await _emit_runtime_event(
            log_event,
            f"Extracted {len(candidate_frames)} candidate frames for scene {scene_index}.",
            {
                "candidate_frame_count": len(candidate_frames),
                "extraction_cache_hit_count": 1 if extraction_cache_hit else 0,
                "extraction_time_ms": extraction_time_ms,
            },
        )
        if not candidate_frames:
            return self._build_prepared_scene(
                scene_index=scene_index,
                keywords=keywords,
                route="text_only",
                selected_frames=[],
                annotation_frames=[],
                candidate_frame_count=0,
                unique_frame_count=0,
                informative_frame_count=0,
                ocr_detected=False,
                remaining_annotation_budget=self._remaining_annotation_budget(),
                extraction_cache_hit_count=1 if extraction_cache_hit else 0,
                extraction_time_ms=extraction_time_ms,
                dedup_time_ms=0,
                filter_time_ms=0,
                ocr_time_ms=0,
                prepare_time_ms=_elapsed_time_ms(prepare_started_at),
            )

        dedup_started_at = time.monotonic()
        unique_frames = _deduplicate_frame_paths(
            candidate_frames,
            threshold=self._hash_distance_threshold,
        )
        dedup_time_ms = _elapsed_time_ms(dedup_started_at)
        filter_started_at = time.monotonic()
        informative_frames = [
            frame_path
            for frame_path in unique_frames
            if self._is_informative_frame(frame_path)
        ]
        selected_frames = informative_frames[: self._max_informative_frames]
        filter_time_ms = _elapsed_time_ms(filter_started_at)
        await _emit_runtime_event(
            log_event,
            f"Selected {len(selected_frames)} informative frames for scene {scene_index}.",
            {
                "unique_frame_count": len(unique_frames),
                "selected_frame_count": len(selected_frames),
                "dedup_time_ms": dedup_time_ms,
                "filter_time_ms": filter_time_ms,
            },
        )
        ocr_started_at = time.monotonic()
        ocr_detected = any(self._frame_has_text_regions(frame_path) for frame_path in selected_frames)
        ocr_time_ms = _elapsed_time_ms(ocr_started_at)
        route = self._resolve_scene_route(
            video_duration_seconds=float(video_metadata.get("duration_seconds") or 0.0),
            unique_frame_count=len(unique_frames),
            selected_frame_count=len(selected_frames),
            ocr_detected=ocr_detected,
        )
        annotation_frames = self._select_annotation_frames(selected_frames, route=route)
        if route == "annotate" and not annotation_frames:
            route = "embed_only" if selected_frames else "text_only"
        await _emit_runtime_event(
            log_event,
            f"Scene {scene_index} routed to {route}.",
            {
                "route": route,
                "ocr_detected": ocr_detected,
                "unique_frame_count": len(unique_frames),
                "selected_frame_count": len(selected_frames),
                "annotation_frame_count": len(annotation_frames),
                "remaining_annotation_budget": self._remaining_annotation_budget(),
                "ocr_time_ms": ocr_time_ms,
            },
        )
        return self._build_prepared_scene(
            scene_index=scene_index,
            keywords=keywords,
            route=route,
            selected_frames=selected_frames,
            annotation_frames=annotation_frames,
            candidate_frame_count=len(candidate_frames),
            unique_frame_count=len(unique_frames),
            informative_frame_count=len(selected_frames),
            ocr_detected=ocr_detected,
            remaining_annotation_budget=self._remaining_annotation_budget(),
            extraction_cache_hit_count=1 if extraction_cache_hit else 0,
            extraction_time_ms=extraction_time_ms,
            dedup_time_ms=dedup_time_ms,
            filter_time_ms=filter_time_ms,
            ocr_time_ms=ocr_time_ms,
            prepare_time_ms=_elapsed_time_ms(prepare_started_at),
        )

    async def annotate_prepared_scene(
        self,
        prepared_scene: Mapping[str, Any],
        *,
        log_event: Callable[[str, Mapping[str, Any] | None], Awaitable[None] | None] | None = None,
        semaphore: asyncio.Semaphore | None = None,
    ) -> dict[str, Any]:
        annotation_frames = [
            Path(frame_path)
            for frame_path in (prepared_scene.get("annotation_frames") or [])
            if str(frame_path).strip()
        ]
        if not annotation_frames:
            return {
                "annotations": [],
                "annotation_timeout_count": 0,
                "annotation_error_count": 0,
                "annotation_cache_hit_count": 0,
                "annotation_time_ms": 0,
            }

        annotation_started_at = time.monotonic()
        (
            annotations,
            annotation_timeout_count,
            annotation_error_count,
            annotation_cache_hit_count,
        ) = await self._annotate_frames(
            annotation_frames,
            log_event=log_event,
            semaphore=semaphore,
        )
        return {
            "annotations": annotations,
            "annotation_timeout_count": annotation_timeout_count,
            "annotation_error_count": annotation_error_count,
            "annotation_cache_hit_count": annotation_cache_hit_count,
            "annotation_time_ms": _elapsed_time_ms(annotation_started_at),
        }

    def finalize_prepared_scene_analysis(
        self,
        prepared_scene: Mapping[str, Any],
        *,
        annotation_outcome: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        annotations = list((annotation_outcome or {}).get("annotations") or [])
        annotation_timeout_count = int(
            (annotation_outcome or {}).get("annotation_timeout_count", 0) or 0
        )
        annotation_error_count = int(
            (annotation_outcome or {}).get("annotation_error_count", 0) or 0
        )
        annotation_cache_hit_count = int(
            (annotation_outcome or {}).get("annotation_cache_hit_count", 0) or 0
        )
        annotation_time_ms = int((annotation_outcome or {}).get("annotation_time_ms", 0) or 0)
        aggregated_annotation = _aggregate_frame_annotations(annotations)
        fallback_visual_summary = str(prepared_scene.get("fallback_visual_summary") or "").strip() or None
        route = str(prepared_scene.get("route") or "text_only")
        selected_frames = [
            str(frame_path)
            for frame_path in (prepared_scene.get("selected_frames") or [])
            if str(frame_path).strip()
        ]
        return self._build_scene_result(
            scene_index=int(prepared_scene["scene_index"]),
            keywords=_merge_keywords(
                prepared_scene.get("keywords") or [],
                aggregated_annotation["visual_entities"],
            ),
            route=route,
            frame_paths=selected_frames if route != "text_only" else [],
            has_visual_embedding=bool(selected_frames) and route != "text_only",
            candidate_frame_count=int(prepared_scene.get("candidate_frame_count", 0) or 0),
            unique_frame_count=int(prepared_scene.get("unique_frame_count", 0) or 0),
            informative_frame_count=int(prepared_scene.get("informative_frame_count", 0) or 0),
            annotation_frame_count=len(prepared_scene.get("annotation_frames") or []),
            extraction_cache_hit_count=int(
                prepared_scene.get("extraction_cache_hit_count", 0) or 0
            ),
            annotation_timeout_count=annotation_timeout_count,
            annotation_error_count=annotation_error_count,
            annotation_cache_hit_count=annotation_cache_hit_count,
            extraction_time_ms=int(prepared_scene.get("extraction_time_ms", 0) or 0),
            dedup_time_ms=int(prepared_scene.get("dedup_time_ms", 0) or 0),
            filter_time_ms=int(prepared_scene.get("filter_time_ms", 0) or 0),
            ocr_time_ms=int(prepared_scene.get("ocr_time_ms", 0) or 0),
            prepare_time_ms=int(prepared_scene.get("prepare_time_ms", 0) or 0),
            annotation_time_ms=annotation_time_ms,
            ocr_detected=bool(prepared_scene.get("ocr_detected", False)),
            remaining_annotation_budget=int(
                prepared_scene.get(
                    "remaining_annotation_budget",
                    self._remaining_annotation_budget(),
                )
                or 0
            ),
            visual_type=aggregated_annotation["visual_type"],
            visual_summary=aggregated_annotation["visual_description"] or fallback_visual_summary,
            visual_description=aggregated_annotation["visual_description"],
            visual_text_content=aggregated_annotation["visual_text_content"],
            visual_entities=aggregated_annotation["visual_entities"],
        )

    def _build_fallback_analysis(
        self,
        *,
        scene_index: int,
        keywords: Sequence[str],
        video_metadata: Mapping[str, Any],
    ) -> dict[str, Any]:
        summary = self._build_fallback_summary(
            keywords=keywords,
            video_metadata=video_metadata,
        )
        return self._build_scene_result(
            scene_index=scene_index,
            keywords=keywords,
            route="text_only",
            frame_paths=[],
            has_visual_embedding=False,
            candidate_frame_count=0,
            unique_frame_count=0,
            informative_frame_count=0,
            annotation_frame_count=0,
            extraction_cache_hit_count=0,
            annotation_timeout_count=0,
            annotation_error_count=0,
            annotation_cache_hit_count=0,
            extraction_time_ms=0,
            dedup_time_ms=0,
            filter_time_ms=0,
            ocr_time_ms=0,
            prepare_time_ms=0,
            annotation_time_ms=0,
            ocr_detected=False,
            remaining_annotation_budget=self._remaining_annotation_budget(),
            visual_summary=summary,
        )

    def _build_fallback_summary(
        self,
        *,
        keywords: Sequence[str],
        video_metadata: Mapping[str, Any],
    ) -> str:
        speaker = str(video_metadata.get("speaker") or "Speaker").strip()
        topic = ", ".join(keywords) if keywords else "the current discussion"
        return f"{speaker} is on screen discussing {topic}."

    def _build_prepared_scene(
        self,
        *,
        scene_index: int,
        keywords: Sequence[str],
        route: str,
        selected_frames: Sequence[Path],
        annotation_frames: Sequence[Path],
        candidate_frame_count: int,
        unique_frame_count: int,
        informative_frame_count: int,
        ocr_detected: bool,
        remaining_annotation_budget: int,
        extraction_cache_hit_count: int,
        extraction_time_ms: int,
        dedup_time_ms: int,
        filter_time_ms: int,
        ocr_time_ms: int,
        prepare_time_ms: int,
        fallback_visual_summary: str | None = None,
    ) -> dict[str, Any]:
        return {
            "scene_index": scene_index,
            "keywords": list(keywords),
            "route": route,
            "selected_frames": [str(frame_path) for frame_path in selected_frames],
            "annotation_frames": [str(frame_path) for frame_path in annotation_frames],
            "candidate_frame_count": candidate_frame_count,
            "unique_frame_count": unique_frame_count,
            "informative_frame_count": informative_frame_count,
            "ocr_detected": ocr_detected,
            "remaining_annotation_budget": remaining_annotation_budget,
            "extraction_cache_hit_count": extraction_cache_hit_count,
            "extraction_time_ms": extraction_time_ms,
            "dedup_time_ms": dedup_time_ms,
            "filter_time_ms": filter_time_ms,
            "ocr_time_ms": ocr_time_ms,
            "prepare_time_ms": prepare_time_ms,
            "fallback_visual_summary": fallback_visual_summary,
        }

    def _build_scene_result(
        self,
        *,
        scene_index: int,
        keywords: Sequence[str],
        route: str,
        frame_paths: Sequence[str],
        has_visual_embedding: bool,
        candidate_frame_count: int,
        unique_frame_count: int,
        informative_frame_count: int,
        annotation_frame_count: int,
        extraction_cache_hit_count: int,
        annotation_timeout_count: int,
        annotation_error_count: int,
        annotation_cache_hit_count: int,
        extraction_time_ms: int,
        dedup_time_ms: int,
        filter_time_ms: int,
        ocr_time_ms: int,
        prepare_time_ms: int,
        annotation_time_ms: int,
        ocr_detected: bool,
        remaining_annotation_budget: int,
        visual_type: str | None = None,
        visual_summary: str | None = None,
        visual_description: str | None = None,
        visual_text_content: str | None = None,
        visual_entities: Sequence[str] | None = None,
    ) -> dict[str, Any]:
        return {
            "scene_index": scene_index,
            "visual_summary": visual_summary,
            "keywords": list(keywords),
            "frame_paths": list(frame_paths),
            "has_visual_embedding": has_visual_embedding,
            "visual_type": visual_type,
            "visual_description": visual_description,
            "visual_text_content": visual_text_content,
            "visual_entities": list(visual_entities or []),
            "candidate_frame_count": candidate_frame_count,
            "unique_frame_count": unique_frame_count,
            "informative_frame_count": informative_frame_count,
            "annotation_frame_count": annotation_frame_count,
            "extraction_cache_hit_count": extraction_cache_hit_count,
            "annotation_timeout_count": annotation_timeout_count,
            "annotation_error_count": annotation_error_count,
            "annotation_cache_hit_count": annotation_cache_hit_count,
            "extraction_time_ms": extraction_time_ms,
            "dedup_time_ms": dedup_time_ms,
            "filter_time_ms": filter_time_ms,
            "ocr_time_ms": ocr_time_ms,
            "prepare_time_ms": prepare_time_ms,
            "annotation_time_ms": annotation_time_ms,
            "analysis_route": route,
            "ocr_detected": ocr_detected,
            "remaining_annotation_budget": remaining_annotation_budget,
        }

    def _resolve_scene_route(
        self,
        *,
        video_duration_seconds: float,
        unique_frame_count: int,
        selected_frame_count: int,
        ocr_detected: bool,
    ) -> str:
        if unique_frame_count <= 1 or selected_frame_count <= 0:
            return "text_only"
        if video_duration_seconds and video_duration_seconds <= self._short_video_annotate_bias_seconds:
            return "annotate"
        if ocr_detected:
            return "annotate"
        return "embed_only"

    def _select_annotation_frames(
        self,
        frame_paths: Sequence[Path],
        *,
        route: str,
    ) -> list[Path]:
        if route != "annotate" or not frame_paths:
            return []

        remaining_budget = self._remaining_annotation_budget()
        if remaining_budget <= 0:
            return []

        annotation_frame_count = min(
            len(frame_paths),
            self._max_annotated_frames_per_scene,
            remaining_budget,
        )
        selected = list(frame_paths[:annotation_frame_count])
        self._annotated_frames_used += len(selected)
        return selected

    def _remaining_annotation_budget(self) -> int:
        return max(self._max_annotated_frames_per_video - self._annotated_frames_used, 0)

    async def _extract_candidate_frames(
        self,
        video_path: Path,
        *,
        scene: Mapping[str, Any],
        output_dir: Path,
    ) -> list[Path]:
        output_dir.mkdir(parents=True, exist_ok=True)
        for existing_file in output_dir.glob("*.jpg"):
            existing_file.unlink(missing_ok=True)

        start = float(scene["timestamp_start"])
        end = float(scene["timestamp_end"])
        duration = max(end - start, 0.1)
        midpoint = start + (duration / 2.0)
        scale_filter = f"scale={self._frame_scale}"
        frame_pattern = output_dir / "frame_%03d.jpg"
        scene_filter = f"select=gt(scene\\,{self._scene_threshold}),{scale_filter}"

        await self._run_ffmpeg_command(
            [
                self._ffmpeg_command,
                "-y",
                "-ss",
                str(start),
                "-i",
                str(video_path),
                "-t",
                str(duration),
                "-vf",
                scene_filter,
                "-vsync",
                "vfr",
                "-q:v",
                "2",
                str(frame_pattern),
            ],
            description=f"scene frame extraction for scene {scene['scene_index']}",
        )
        midpoint_path = output_dir / "midpoint.jpg"
        await self._run_ffmpeg_command(
            [
                self._ffmpeg_command,
                "-y",
                "-ss",
                str(midpoint),
                "-i",
                str(video_path),
                "-frames:v",
                "1",
                "-vf",
                scale_filter,
                "-q:v",
                "2",
                str(midpoint_path),
            ],
            description=f"midpoint frame extraction for scene {scene['scene_index']}",
        )

        return sorted(path for path in output_dir.glob("*.jpg") if path.is_file())

    async def _resolve_candidate_frames(
        self,
        video_path: Path,
        *,
        scene: Mapping[str, Any],
        output_dir: Path,
        video_metadata: Mapping[str, Any],
    ) -> tuple[list[Path], bool]:
        cache_key = _compute_frame_extraction_cache_key(
            video_path,
            scene=scene,
            video_metadata=video_metadata,
            frame_scale=self._frame_scale,
            scene_threshold=self._scene_threshold,
        )
        cached_frames = _get_cached_frame_extraction(cache_key)
        if cached_frames is not None:
            restored_frames = await asyncio.to_thread(
                _restore_frame_extraction_cache,
                output_dir,
                cached_frames,
            )
            return restored_frames, True

        candidate_frames = await self._extract_candidate_frames(
            video_path,
            scene=scene,
            output_dir=output_dir,
        )
        _set_cached_frame_extraction(
            cache_key,
            candidate_frames,
            max_size=self._extraction_cache_size,
        )
        return candidate_frames, False

    async def _run_ffmpeg_command(
        self,
        command: Sequence[str],
        *,
        description: str,
    ) -> bool:
        try:
            completed = await asyncio.to_thread(
                subprocess.run,
                list(command),
                capture_output=True,
                text=True,
                check=False,
            )
        except FileNotFoundError:
            self._logger.warning("ffmpeg is not installed; skipping %s.", description)
            return False

        if completed.returncode != 0:
            self._logger.debug(
                "ffmpeg command failed for %s: %s",
                description,
                (completed.stderr or completed.stdout).strip(),
            )
            return False
        return True

    def _is_informative_frame(self, frame_path: Path) -> bool:
        try:
            import cv2
            import numpy as np
        except ImportError:
            return True

        image = cv2.imread(str(frame_path))
        if image is None:
            # Keep unreadable frames rather than dropping the whole visual path.
            try:
                return frame_path.stat().st_size > 0
            except OSError:
                return True

        hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
        lower_skin_primary = np.array([0, 40, 60], dtype=np.uint8)
        upper_skin_primary = np.array([25, 255, 255], dtype=np.uint8)
        lower_skin_secondary = np.array([160, 40, 60], dtype=np.uint8)
        upper_skin_secondary = np.array([180, 255, 255], dtype=np.uint8)
        skin_mask = cv2.inRange(hsv, lower_skin_primary, upper_skin_primary)
        skin_mask |= cv2.inRange(hsv, lower_skin_secondary, upper_skin_secondary)
        skin_ratio = float(np.count_nonzero(skin_mask)) / float(skin_mask.size)

        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        edges = cv2.Canny(gray, 100, 200)
        edge_ratio = float(np.count_nonzero(edges)) / float(edges.size)

        return not (skin_ratio > 0.45 and edge_ratio < 0.04)

    def _frame_has_text_regions(self, frame_path: Path) -> bool:
        try:
            import cv2
            import numpy as np
        except ImportError:
            return False

        image = cv2.imread(str(frame_path))
        if image is None:
            return False

        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        mser = cv2.MSER_create()
        regions, _ = mser.detectRegions(gray)
        if len(regions) < self._text_region_min_count:
            return False

        mask = np.zeros(gray.shape, dtype=np.uint8)
        for region in regions:
            if len(region) < 4:
                continue
            hull = cv2.convexHull(region.reshape(-1, 1, 2))
            cv2.fillConvexPoly(mask, hull, 255)

        text_area_ratio = float(np.count_nonzero(mask)) / float(mask.size)
        return text_area_ratio >= self._text_region_min_area_ratio

    async def _annotate_frames(
        self,
        frame_paths: Sequence[Path],
        *,
        log_event: Callable[[str, Mapping[str, Any] | None], Awaitable[None] | None] | None = None,
        semaphore: asyncio.Semaphore | None = None,
    ) -> tuple[list[dict[str, Any]], int, int, int]:
        frame_results = await self._annotate_frame_results(
            [{"frame_path": frame_path} for frame_path in frame_paths],
            log_event=log_event,
            semaphore=semaphore,
        )
        annotations = [
            dict(result["annotation"])
            for result in frame_results
            if result.get("annotation") is not None
        ]
        timeout_count = sum(int(result.get("timed_out", 0) or 0) for result in frame_results)
        error_count = sum(int(result.get("failed", 0) or 0) for result in frame_results)
        cache_hit_count = sum(int(result.get("cache_hit", 0) or 0) for result in frame_results)
        return annotations, timeout_count, error_count, cache_hit_count

    async def _annotate_frame_results(
        self,
        frame_entries: Sequence[Mapping[str, Any]],
        *,
        log_event: Callable[[str, Mapping[str, Any] | None], Awaitable[None] | None] | None = None,
        semaphore: asyncio.Semaphore | None = None,
    ) -> list[dict[str, Any]]:
        if not frame_entries or not self._annotation_backend.available():
            return []

        shared_semaphore = semaphore or asyncio.Semaphore(self._annotation_concurrency)

        async def annotate_single_frame(
            index: int,
            frame_entry: Mapping[str, Any],
        ) -> dict[str, Any]:
            frame_path = Path(str(frame_entry["frame_path"]))
            scene_index = frame_entry.get("scene_index")
            frame_hash = _compute_frame_annotation_cache_key(frame_path)
            cached_annotation = _get_cached_frame_annotation(frame_hash)
            if cached_annotation is not None:
                await _emit_runtime_event(
                    log_event,
                    f"Using cached frame annotation for {frame_path.name}.",
                    {
                        "frame_path": str(frame_path),
                        "frame_hash": frame_hash,
                        "scene_index": scene_index,
                        "cache_hit": True,
                    },
                )
                return {
                    "index": index,
                    "scene_index": scene_index,
                    "frame_path": str(frame_path),
                    "annotation": cached_annotation,
                    "timed_out": 0,
                    "failed": 0,
                    "cache_hit": 1,
                }

            try:
                async with shared_semaphore:
                    await _emit_runtime_event(
                        log_event,
                        f"Annotating frame {frame_path.name}.",
                        {
                            "frame_path": str(frame_path),
                            "frame_hash": frame_hash,
                            "scene_index": scene_index,
                            "timeout_seconds": self._annotation_timeout_seconds,
                        },
                    )
                    annotation = await asyncio.wait_for(
                        self._annotation_backend.annotate(frame_path),
                        timeout=self._annotation_timeout_seconds,
                    )
            except asyncio.TimeoutError:
                self._logger.warning(
                    "Frame annotation timed out for %s after %.1fs.",
                    frame_path,
                    self._annotation_timeout_seconds,
                )
                await _emit_runtime_event(
                    log_event,
                    f"Frame annotation timed out for {frame_path.name}.",
                        {
                            "frame_path": str(frame_path),
                            "scene_index": scene_index,
                            "timeout_seconds": self._annotation_timeout_seconds,
                        },
                    )
                return {
                    "index": index,
                    "scene_index": scene_index,
                    "frame_path": str(frame_path),
                    "annotation": None,
                    "timed_out": 1,
                    "failed": 0,
                    "cache_hit": 0,
                }
            except Exception as exc:
                self._logger.warning(
                    "Frame annotation failed for %s: %s",
                    frame_path,
                    exc,
                )
                await _emit_runtime_event(
                    log_event,
                    f"Frame annotation failed for {frame_path.name}.",
                        {
                            "frame_path": str(frame_path),
                            "scene_index": scene_index,
                            "error": str(exc),
                        },
                    )
                return {
                    "index": index,
                    "scene_index": scene_index,
                    "frame_path": str(frame_path),
                    "annotation": None,
                    "timed_out": 0,
                    "failed": 1,
                    "cache_hit": 0,
                }

            _set_cached_frame_annotation(
                frame_hash,
                annotation,
                max_size=self._annotation_cache_size,
            )
            return {
                "index": index,
                "scene_index": scene_index,
                "frame_path": str(frame_path),
                "annotation": dict(annotation),
                "timed_out": 0,
                "failed": 0,
                "cache_hit": 0,
            }

        results = await asyncio.gather(
            *(annotate_single_frame(index, frame_entry) for index, frame_entry in enumerate(frame_entries))
        )
        return sorted(results, key=lambda item: int(item["index"]))


def normalize_video_metadata(
    payload: Mapping[str, Any],
    *,
    requested_video_id: str | None = None,
) -> dict[str, Any]:
    source_video_id = _first_non_empty(
        payload.get("source_video_id"),
        payload.get("video_id"),
        payload.get("id"),
        requested_video_id,
    )
    if source_video_id is None:
        raise ValueError("Knowledge video metadata is missing source_video_id.")

    title = _first_non_empty(payload.get("title"), f"YouTube video {source_video_id}")
    source_url = _first_non_empty(
        payload.get("source_url"),
        payload.get("watch_url"),
        payload.get("url"),
        payload.get("webpage_url"),
        f"https://www.youtube.com/watch?v={source_video_id}",
    )
    video_url = _first_non_empty(
        payload.get("video_url"),
        payload.get("download_url"),
        source_url,
    )
    thumbnail_url = _pick_thumbnail_url(payload)

    return {
        "id": f"youtube_{source_video_id}",
        "source": "youtube",
        "source_video_id": str(source_video_id),
        "source_url": source_url,
        "video_url": video_url,
        "download_url": _first_non_empty(payload.get("download_url")),
        "thumbnail_url": thumbnail_url,
        "title": str(title),
        "description": str(payload.get("description") or ""),
        "speaker": _first_non_empty(
            payload.get("speaker"),
            payload.get("channel_title"),
            payload.get("author"),
        ),
        "published_at": parse_datetime(
            _first_non_empty(
                payload.get("published_at"),
                payload.get("publish_date"),
                payload.get("published"),
            )
        ),
        "duration_seconds": parse_duration_seconds(
            _first_non_empty(
                payload.get("duration_seconds"),
                payload.get("duration"),
            )
        ),
        "license": _first_non_empty(
            payload.get("license"),
            "standard-youtube-license",
        ),
        "metadata": dict(payload),
    }


def normalize_transcript_segments(
    segments: Sequence[Mapping[str, Any]],
    *,
    default_end: float | None = None,
) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for index, raw_segment in enumerate(segments):
        text = str(raw_segment.get("text") or raw_segment.get("transcript") or "").strip()
        if not text:
            continue

        start = float(raw_segment.get("start") or raw_segment.get("timestamp_start") or 0.0)
        raw_end = raw_segment.get("end") or raw_segment.get("timestamp_end")
        if raw_end is None:
            end = default_end if default_end is not None else start
        else:
            end = float(raw_end)

        if end < start:
            raise ValueError(f"Transcript segment {index} ends before it starts.")

        normalized.append(
            {
                "start": start,
                "end": end,
                "text": text,
                "speaker": raw_segment.get("speaker"),
            }
        )

    normalized.sort(key=lambda segment: (float(segment["start"]), float(segment["end"])))
    return normalized


def parse_datetime(value: Any) -> datetime | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)
    cleaned = str(value).strip()
    if not cleaned:
        return None
    if cleaned.endswith("Z"):
        cleaned = f"{cleaned[:-1]}+00:00"
    parsed = datetime.fromisoformat(cleaned)
    return parsed if parsed.tzinfo is not None else parsed.replace(tzinfo=timezone.utc)


def parse_duration_seconds(value: Any) -> int | None:
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        return int(round(float(value)))

    cleaned = str(value).strip()
    if cleaned.isdigit():
        return int(cleaned)

    pattern = re.compile(
        r"^PT(?:(?P<hours>\d+)H)?(?:(?P<minutes>\d+)M)?(?:(?P<seconds>\d+(?:\.\d+)?)S)?$"
    )
    match = pattern.fullmatch(cleaned)
    if match is None:
        return int(round(float(cleaned)))

    hours = float(match.group("hours") or 0)
    minutes = float(match.group("minutes") or 0)
    seconds = float(match.group("seconds") or 0)
    return int(round((hours * 3600) + (minutes * 60) + seconds))


def extract_keywords(text: str, *, limit: int = 4) -> list[str]:
    if not text.strip():
        return []

    stopwords = {
        "about",
        "after",
        "and",
        "been",
        "from",
        "have",
        "into",
        "more",
        "over",
        "that",
        "their",
        "them",
        "they",
        "this",
        "with",
        "would",
    }
    counts = Counter(
        token
        for token in re.findall(r"[A-Za-z0-9']+", text.lower())
        if len(token) > 2 and token not in stopwords
    )
    return [token for token, _count in counts.most_common(limit)]


def summarize_text(text: str, *, max_words: int = 18) -> str:
    words = text.split()
    if len(words) <= max_words:
        return " ".join(words)
    return " ".join(words[:max_words]).strip() + "..."


async def load_transcript_segments_from_source(
    source: str | Path,
    *,
    default_end: float | None = None,
    timeout: float = 30.0,
) -> list[dict[str, Any]]:
    if isinstance(source, Path):
        return parse_transcript_file(source, default_end=default_end)

    local_path = _resolve_local_path(source)
    if local_path is not None:
        return parse_transcript_file(local_path, default_end=default_end)

    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        response = await client.get(str(source))

    response.raise_for_status()
    source_path = Path(urlparse(str(source)).path)
    return parse_transcript_payload(
        response.text,
        suffix=source_path.suffix,
        default_end=default_end,
    )


def parse_transcript_file(
    path: str | Path,
    *,
    default_end: float | None = None,
) -> list[dict[str, Any]]:
    resolved_path = Path(path)
    raw_text = resolved_path.read_text(encoding="utf-8-sig")
    return parse_transcript_payload(
        raw_text,
        suffix=resolved_path.suffix,
        default_end=default_end,
    )


def parse_transcript_payload(
    payload: str,
    *,
    suffix: str | None,
    default_end: float | None = None,
) -> list[dict[str, Any]]:
    normalized_suffix = (suffix or "").strip().lower()
    if normalized_suffix == ".json":
        loaded = json.loads(payload)
        if isinstance(loaded, list):
            return normalize_transcript_segments(loaded, default_end=default_end)
        if isinstance(loaded, Mapping) and isinstance(loaded.get("segments"), list):
            return normalize_transcript_segments(
                loaded["segments"],
                default_end=default_end,
            )
        raise ValueError("JSON transcript payload must be a list or include a segments array.")

    if normalized_suffix == ".srt":
        return _parse_caption_cues(payload, default_end=default_end)

    if normalized_suffix == ".vtt":
        cleaned_payload = "\n".join(
            line
            for line in payload.splitlines()
            if not line.strip().startswith(("WEBVTT", "NOTE"))
        )
        return _parse_caption_cues(cleaned_payload, default_end=default_end)

    return normalize_transcript_segments(
        [{"start": 0.0, "end": default_end or 0.0, "text": payload.strip()}],
        default_end=default_end,
    )


def resolve_inline_transcript_segments(
    video_metadata: Mapping[str, Any],
    *,
    default_end: float | None = None,
) -> list[dict[str, Any]] | None:
    raw_segments = video_metadata.get("transcript_segments")
    if raw_segments is None:
        raw_metadata = video_metadata.get("metadata")
        if isinstance(raw_metadata, Mapping):
            raw_segments = raw_metadata.get("transcript_segments")

    if not isinstance(raw_segments, Sequence) or isinstance(raw_segments, (str, bytes)):
        return None

    return normalize_transcript_segments(raw_segments, default_end=default_end)


def resolve_transcript_source(
    video_metadata: Mapping[str, Any],
) -> str | Path | None:
    candidate = _first_non_empty(
        video_metadata.get("subtitle_path"),
        video_metadata.get("subtitle_file"),
        video_metadata.get("subtitle_url"),
        video_metadata.get("captions_path"),
        video_metadata.get("captions_file"),
        video_metadata.get("captions_url"),
        video_metadata.get("transcript_path"),
        video_metadata.get("transcript_file"),
        video_metadata.get("transcript_url"),
    )
    if candidate is not None:
        return candidate

    raw_metadata = video_metadata.get("metadata")
    if isinstance(raw_metadata, Mapping):
        nested_candidate = _first_non_empty(
            raw_metadata.get("subtitle_path"),
            raw_metadata.get("subtitle_file"),
            raw_metadata.get("subtitle_url"),
            raw_metadata.get("captions_path"),
            raw_metadata.get("captions_file"),
            raw_metadata.get("captions_url"),
            raw_metadata.get("transcript_path"),
            raw_metadata.get("transcript_file"),
            raw_metadata.get("transcript_url"),
        )
        if nested_candidate is not None:
            return nested_candidate

    return None


def _resolve_preferred_caption_languages(video_metadata: Mapping[str, Any]) -> tuple[str, ...]:
    raw_candidates: list[Any] = [
        video_metadata.get("preferred_caption_languages"),
        video_metadata.get("preferred_subtitle_languages"),
        video_metadata.get("caption_language"),
        video_metadata.get("subtitle_language"),
        video_metadata.get("transcript_language"),
        video_metadata.get("audio_language"),
        video_metadata.get("default_audio_language"),
        video_metadata.get("language"),
    ]

    raw_metadata = video_metadata.get("metadata")
    if isinstance(raw_metadata, Mapping):
        raw_candidates.extend(
            [
                raw_metadata.get("preferred_caption_languages"),
                raw_metadata.get("preferred_subtitle_languages"),
                raw_metadata.get("caption_language"),
                raw_metadata.get("subtitle_language"),
                raw_metadata.get("transcript_language"),
                raw_metadata.get("audio_language"),
                raw_metadata.get("default_audio_language"),
                raw_metadata.get("defaultLanguage"),
                raw_metadata.get("defaultAudioLanguage"),
                raw_metadata.get("language"),
            ]
        )

    normalized: list[str] = []
    for candidate in raw_candidates:
        if isinstance(candidate, str):
            normalized.extend(
                item.strip() for item in candidate.split(",") if item.strip()
            )
            continue
        if isinstance(candidate, Sequence) and not isinstance(candidate, (str, bytes)):
            normalized.extend(str(item).strip() for item in candidate if str(item).strip())

    return _normalize_caption_language_preferences(normalized)


def _resolve_local_path(value: str) -> Path | None:
    parsed = urlparse(value)
    if parsed.scheme == "file":
        path = Path(parsed.path)
        return path if path.exists() else None

    path = Path(value)
    if "://" not in value and path.exists():
        return path
    return None


def _guess_extension(source_url: str, content_type: str | None) -> str:
    suffix = Path(urlparse(source_url).path).suffix
    if suffix:
        return suffix

    if content_type:
        guessed = mimetypes.guess_extension(content_type.split(";", maxsplit=1)[0].strip())
        if guessed:
            return guessed

    return ".mp4"


def _is_supported_download_content_type(content_type: str | None) -> bool:
    if content_type is None:
        return True

    normalized = content_type.split(";", maxsplit=1)[0].strip().lower()
    return normalized.startswith(("video/", "audio/")) or normalized in {
        "application/octet-stream",
        "binary/octet-stream",
    }


def _can_use_direct_download(source: str) -> bool:
    if _resolve_local_path(source) is not None:
        return True
    return _looks_like_direct_media_url(source)


def _first_non_empty(*values: Any) -> str | None:
    for value in values:
        if value is None:
            continue
        cleaned = str(value).strip()
        if cleaned:
            return cleaned
    return None


def _pick_thumbnail_url(payload: Mapping[str, Any]) -> str | None:
    direct = _first_non_empty(
        payload.get("thumbnail_url"),
        payload.get("thumbnail"),
        payload.get("thumbnailUrl"),
    )
    if direct is not None:
        return direct

    thumbnails = payload.get("thumbnails")
    if not isinstance(thumbnails, Mapping):
        return None

    for key in ("maxres", "standard", "high", "medium", "default"):
        entry = thumbnails.get(key)
        if isinstance(entry, Mapping):
            url = _first_non_empty(entry.get("url"))
            if url is not None:
                return url
    return None


def _looks_like_direct_media_url(source: str) -> bool:
    parsed = urlparse(source)
    if parsed.netloc.endswith(("youtube.com", "youtu.be")):
        return False

    suffix = Path(parsed.path).suffix.lower()
    return suffix in {
        ".mp4",
        ".m4a",
        ".mp3",
        ".wav",
        ".aac",
        ".ogg",
        ".webm",
        ".mov",
    }


def _find_caption_files(output_dir: Path, source_video_id: str) -> list[Path]:
    candidates: list[Path] = []
    for suffix in (".srt", ".vtt"):
        candidates.extend(output_dir.glob(f"{source_video_id}*{suffix}"))
    return [path for path in candidates if path.is_file()]


def _select_preferred_caption_file(
    candidates: Sequence[Path],
    *,
    preferred_languages: Sequence[str] | None = None,
    source_video_id: str | None = None,
) -> Path:
    normalized_preferences = _normalize_caption_language_preferences(preferred_languages)
    ranked_candidates = sorted(
        candidates,
        key=lambda path: (
            _caption_language_rank(
                _extract_caption_language_code(path, source_video_id=source_video_id),
                normalized_preferences,
            ),
            ".live_chat." in path.name,
            ".orig." in path.name,
            path.suffix.lower() != ".srt",
            path.name,
        ),
    )
    return ranked_candidates[0]


def _normalize_caption_language_preferences(
    preferred_languages: Sequence[str] | None,
) -> tuple[str, ...]:
    default_preferences = ("en", "en-us", "en-gb")
    if not preferred_languages:
        return default_preferences

    normalized: list[str] = []
    seen: set[str] = set()
    for language in preferred_languages:
        cleaned = str(language).strip().replace("_", "-").lower()
        if not cleaned or cleaned in seen:
            continue
        seen.add(cleaned)
        normalized.append(cleaned)

    return tuple(normalized) or default_preferences


def _caption_language_rank(
    language_code: str | None,
    preferred_languages: Sequence[str],
) -> tuple[int, int, str]:
    if language_code is None:
        return (2, len(preferred_languages), "")

    exact_map = {language: index for index, language in enumerate(preferred_languages)}
    base_map = {
        language.split("-", 1)[0]: index for index, language in enumerate(preferred_languages)
    }
    if language_code in exact_map:
        return (0, exact_map[language_code], language_code)

    base_language = language_code.split("-", 1)[0]
    if base_language in exact_map:
        return (1, exact_map[base_language], language_code)
    if base_language in base_map:
        return (1, base_map[base_language], language_code)

    return (3, len(preferred_languages), language_code)


def _extract_caption_language_code(
    path: Path,
    *,
    source_video_id: str | None = None,
) -> str | None:
    stem = path.stem
    if source_video_id:
        prefix = f"{source_video_id}."
        if stem.startswith(prefix):
            stem = stem[len(prefix) :]
        elif stem == source_video_id:
            stem = ""

    for token in stem.split("."):
        normalized = token.strip().replace("_", "-").lower()
        if not normalized or normalized in {"orig", "live-chat", "live_chat"}:
            continue
        if re.fullmatch(r"[a-z]{2,3}(?:-[a-z0-9]{2,8})*", normalized):
            return normalized
    return None


def _find_downloaded_video_files(output_dir: Path, target_name: str) -> list[Path]:
    ignored_suffixes = {
        ".description",
        ".info.json",
        ".part",
        ".srt",
        ".txt",
        ".vtt",
        ".webp",
    }
    candidates = []
    for path in output_dir.glob(f"{target_name}*"):
        if not path.is_file():
            continue
        if any(path.name.endswith(suffix) for suffix in ignored_suffixes):
            continue
        candidates.append(path)
    return candidates


def _extract_transcript_segments(
    payload: Any,
    *,
    default_end: float,
) -> list[dict[str, Any]]:
    if isinstance(payload, Mapping):
        raw_segments = payload.get("segments")
        if isinstance(raw_segments, Sequence) and not isinstance(raw_segments, (str, bytes)):
            extracted_segments = []
            for raw_segment in raw_segments:
                if not isinstance(raw_segment, Mapping):
                    continue
                text = _first_non_empty(
                    raw_segment.get("text"),
                    raw_segment.get("transcript"),
                )
                if text is None:
                    continue
                extracted_segments.append(
                    {
                        "start": float(raw_segment.get("start") or 0.0),
                        "end": float(raw_segment.get("end") or default_end),
                        "text": text,
                        "speaker": raw_segment.get("speaker"),
                    }
                )
            if extracted_segments:
                return extracted_segments

        full_text = _first_non_empty(payload.get("text"), payload.get("transcript"))
        if full_text is not None:
            return [{"start": 0.0, "end": default_end, "text": full_text}]

    if isinstance(payload, str) and payload.strip():
        return [{"start": 0.0, "end": default_end, "text": payload.strip()}]

    raise ValueError("Transcription payload did not include any usable transcript text.")


def _parse_caption_cues(
    payload: str,
    *,
    default_end: float | None = None,
) -> list[dict[str, Any]]:
    blocks = re.split(r"\n\s*\n", payload.strip())
    segments: list[dict[str, Any]] = []

    for block in blocks:
        lines = [line.strip() for line in block.splitlines() if line.strip()]
        if not lines:
            continue

        if "-->" in lines[0]:
            timestamp_line_index = 0
        elif len(lines) >= 2 and "-->" in lines[1]:
            timestamp_line_index = 1
        else:
            continue

        start, end = _parse_caption_timestamp_line(lines[timestamp_line_index])
        text = " ".join(lines[timestamp_line_index + 1 :]).strip()
        if not text:
            continue

        segments.append(
            {
                "start": start,
                "end": end,
                "text": text,
            }
        )

    return normalize_transcript_segments(segments, default_end=default_end)


def _parse_caption_timestamp_line(value: str) -> tuple[float, float]:
    match = re.match(
        r"^(?P<start>\S+)\s+-->\s+(?P<end>\S+)",
        value.strip(),
    )
    if match is None:
        raise ValueError(f"Unsupported caption timestamp line: {value}")

    return (
        _parse_caption_timestamp_value(match.group("start")),
        _parse_caption_timestamp_value(match.group("end")),
    )


def _parse_caption_timestamp_value(value: str) -> float:
    cleaned = value.strip().replace(",", ".")
    parts = cleaned.split(":")
    if len(parts) == 3:
        hours = int(parts[0])
        minutes = int(parts[1])
        seconds = float(parts[2])
        return (hours * 3600) + (minutes * 60) + seconds
    if len(parts) == 2:
        minutes = int(parts[0])
        seconds = float(parts[1])
        return (minutes * 60) + seconds
    raise ValueError(f"Unsupported caption timestamp value: {value}")


def _build_scene_payload(
    scene_index: int,
    transcript_group: Sequence[Mapping[str, Any]],
    *,
    detector: str,
) -> dict[str, Any]:
    start = float(transcript_group[0]["start"])
    end = float(transcript_group[-1]["end"])
    excerpt = " ".join(str(segment["text"]).strip() for segment in transcript_group).strip()
    return {
        "scene_index": scene_index,
        "timestamp_start": start,
        "timestamp_end": end,
        "keyframe_timestamp": start + ((end - start) / 2 if end > start else 0.0),
        "transcript_excerpt": summarize_text(excerpt, max_words=24),
        "metadata": {"detector": detector},
    }


def _segments_overlap(
    start_a: float,
    end_a: float,
    start_b: float,
    end_b: float,
) -> bool:
    return not (end_a <= start_b or end_b <= start_a)


def _plan_transcription_chunks(
    duration: float,
    silence_points: Sequence[float],
    *,
    target_chunk_seconds: float,
    min_chunk_seconds: float,
    max_chunk_seconds: float,
) -> list[tuple[float, float]]:
    if duration <= 0.0:
        return []

    normalized_silence_points = sorted(
        {
            round(float(point), 3)
            for point in silence_points
            if 0.0 < float(point) < duration
        }
    )
    chunk_ranges: list[tuple[float, float]] = []
    chunk_start = 0.0

    while chunk_start < duration:
        remaining = duration - chunk_start
        if remaining <= max_chunk_seconds:
            chunk_end = duration
        else:
            candidate_points = [
                point
                for point in normalized_silence_points
                if (chunk_start + min_chunk_seconds)
                <= point
                <= min(duration, chunk_start + max_chunk_seconds)
            ]
            if candidate_points:
                target_boundary = chunk_start + target_chunk_seconds
                chunk_end = min(
                    candidate_points,
                    key=lambda point: (abs(point - target_boundary), point),
                )
            else:
                chunk_end = min(duration, chunk_start + target_chunk_seconds)

        if chunk_end <= chunk_start:
            chunk_end = min(duration, chunk_start + max(min_chunk_seconds, 1.0))

        chunk_ranges.append((round(chunk_start, 3), round(chunk_end, 3)))
        chunk_start = chunk_end

    if (
        len(chunk_ranges) >= 2
        and (chunk_ranges[-1][1] - chunk_ranges[-1][0]) < (min_chunk_seconds / 2.0)
    ):
        previous_start, _previous_end = chunk_ranges[-2]
        chunk_ranges[-2] = (previous_start, chunk_ranges[-1][1])
        chunk_ranges.pop()

    return chunk_ranges


def _deduplicate_frame_paths(
    frame_paths: Sequence[Path],
    *,
    threshold: int,
) -> list[Path]:
    try:
        import imagehash
        from PIL import Image
    except ImportError:
        return list(frame_paths)

    unique_frames: list[Path] = []
    image_hashes: list[Any] = []
    byte_hashes: set[str] = set()
    for frame_path in frame_paths:
        try:
            with Image.open(frame_path) as image:
                frame_hash = imagehash.phash(image)
        except Exception:
            try:
                frame_hash = f"sha256:{hashlib.sha256(frame_path.read_bytes()).hexdigest()}"
            except Exception:
                unique_frames.append(frame_path)
                continue
            if frame_hash in byte_hashes:
                continue
            unique_frames.append(frame_path)
            byte_hashes.add(frame_hash)
            continue

        if any(abs(frame_hash - existing_hash) < threshold for existing_hash in image_hashes):
            continue
        unique_frames.append(frame_path)
        image_hashes.append(frame_hash)

    return unique_frames


def _compute_frame_annotation_cache_key(frame_path: Path) -> str | None:
    try:
        import imagehash
        from PIL import Image

        with Image.open(frame_path) as image:
            return f"phash:{str(imagehash.phash(image))}"
    except Exception:
        try:
            return f"sha256:{hashlib.sha256(frame_path.read_bytes()).hexdigest()}"
        except Exception:
            return None


def _compute_frame_extraction_cache_key(
    video_path: Path,
    *,
    scene: Mapping[str, Any],
    video_metadata: Mapping[str, Any],
    frame_scale: str,
    scene_threshold: float,
) -> str:
    source = str(video_metadata.get("source") or "").strip()
    source_video_id = (
        str(video_metadata.get("source_video_id") or video_metadata.get("video_id") or "").strip()
    )
    if source and source_video_id:
        video_identity = f"{source}:{source_video_id}"
    else:
        try:
            stat = video_path.stat()
            video_identity = (
                f"path:{video_path.resolve()}:{stat.st_size}:{stat.st_mtime_ns}"
            )
        except OSError:
            video_identity = f"path:{video_path}"

    payload = "|".join(
        [
            video_identity,
            f"scene_index:{int(scene.get('scene_index', 0) or 0)}",
            f"start:{float(scene.get('timestamp_start', 0.0) or 0.0):.3f}",
            f"end:{float(scene.get('timestamp_end', 0.0) or 0.0):.3f}",
            f"scale:{frame_scale}",
            f"threshold:{float(scene_threshold):.4f}",
        ]
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _elapsed_time_ms(started_at: float) -> int:
    return max(int(round((time.monotonic() - started_at) * 1000.0)), 0)


def _get_cached_frame_annotation(frame_hash: str | None) -> dict[str, Any] | None:
    if not frame_hash:
        return None
    with _FRAME_ANNOTATION_CACHE_LOCK:
        cached = _FRAME_ANNOTATION_CACHE.get(frame_hash)
        if cached is None:
            return None
        _FRAME_ANNOTATION_CACHE.move_to_end(frame_hash)
        return dict(cached)


def _set_cached_frame_annotation(
    frame_hash: str | None,
    annotation: Mapping[str, Any],
    *,
    max_size: int,
) -> None:
    if not frame_hash or max_size <= 0:
        return
    with _FRAME_ANNOTATION_CACHE_LOCK:
        _FRAME_ANNOTATION_CACHE[frame_hash] = dict(annotation)
        _FRAME_ANNOTATION_CACHE.move_to_end(frame_hash)
        while len(_FRAME_ANNOTATION_CACHE) > max_size:
            _FRAME_ANNOTATION_CACHE.popitem(last=False)


def _get_cached_frame_extraction(
    cache_key: str | None,
) -> list[tuple[str, bytes]] | None:
    if not cache_key:
        return None
    with _FRAME_EXTRACTION_CACHE_LOCK:
        cached = _FRAME_EXTRACTION_CACHE.get(cache_key)
        if cached is None:
            return None
        _FRAME_EXTRACTION_CACHE.move_to_end(cache_key)
        return [(name, bytes(payload)) for name, payload in cached]


def _set_cached_frame_extraction(
    cache_key: str | None,
    frame_paths: Sequence[Path],
    *,
    max_size: int,
) -> None:
    if not cache_key or max_size <= 0 or not frame_paths:
        return

    cached_frames: list[tuple[str, bytes]] = []
    for frame_path in frame_paths:
        try:
            cached_frames.append((frame_path.name, frame_path.read_bytes()))
        except Exception:
            continue
    if not cached_frames:
        return

    with _FRAME_EXTRACTION_CACHE_LOCK:
        _FRAME_EXTRACTION_CACHE[cache_key] = cached_frames
        _FRAME_EXTRACTION_CACHE.move_to_end(cache_key)
        while len(_FRAME_EXTRACTION_CACHE) > max_size:
            _FRAME_EXTRACTION_CACHE.popitem(last=False)


def _restore_frame_extraction_cache(
    output_dir: Path,
    cached_frames: Sequence[tuple[str, bytes]],
) -> list[Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    for existing_file in output_dir.glob("*.jpg"):
        existing_file.unlink(missing_ok=True)

    restored_paths: list[Path] = []
    for file_name, payload in cached_frames:
        destination = output_dir / file_name
        destination.write_bytes(payload)
        restored_paths.append(destination)
    return sorted(restored_paths)


def _aggregate_frame_annotations(
    annotations: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    if not annotations:
        return {
            "visual_type": None,
            "visual_description": None,
            "visual_text_content": None,
            "visual_entities": [],
        }

    descriptions = _ordered_unique_strings(
        annotation.get("description") for annotation in annotations
    )
    text_fragments = _ordered_unique_strings(
        annotation.get("text_content") for annotation in annotations
    )
    visual_types = [
        str(annotation.get("visual_type")).strip()
        for annotation in annotations
        if str(annotation.get("visual_type") or "").strip()
        and str(annotation.get("visual_type")).strip() != "other"
    ]
    visual_entities = _ordered_unique_strings(
        entity
        for annotation in annotations
        for entity in (annotation.get("visual_entities") or [])
    )

    return {
        "visual_type": Counter(visual_types).most_common(1)[0][0] if visual_types else None,
        "visual_description": " ".join(descriptions[:2]).strip() or None,
        "visual_text_content": "\n".join(text_fragments[:3]).strip() or None,
        "visual_entities": visual_entities,
    }


def _ordered_unique_strings(values: Sequence[Any] | Any) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for value in values:
        cleaned = str(value or "").strip()
        normalized_key = cleaned.lower()
        if not cleaned or normalized_key in seen:
            continue
        seen.add(normalized_key)
        normalized.append(cleaned)
    return normalized


def _merge_keywords(
    base_keywords: Sequence[str],
    visual_entities: Sequence[str],
    *,
    limit: int = 8,
) -> list[str]:
    merged: list[str] = []
    seen: set[str] = set()
    for value in list(base_keywords) + list(visual_entities):
        cleaned = str(value or "").strip()
        normalized = cleaned.lower()
        if not cleaned or normalized in seen:
            continue
        seen.add(normalized)
        merged.append(cleaned)
        if len(merged) >= limit:
            break
    return merged


def _normalize_frame_annotation_payload(payload: Any) -> dict[str, Any]:
    if isinstance(payload, str):
        cleaned_payload = payload.strip()
        if cleaned_payload.startswith("```"):
            cleaned_payload = cleaned_payload.strip("`")
            cleaned_payload = re.sub(r"^json\s*", "", cleaned_payload, flags=re.IGNORECASE)
        parsed_payload = json.loads(cleaned_payload or "{}")
    elif isinstance(payload, Mapping):
        parsed_payload = dict(payload)
    else:
        raise ValueError("Frame annotation payload must be a JSON object or string.")

    if not isinstance(parsed_payload, Mapping):
        raise ValueError("Frame annotation payload must decode to a JSON object.")

    raw_entities = parsed_payload.get("key_entities") or parsed_payload.get("visual_entities") or []
    if not isinstance(raw_entities, Sequence) or isinstance(raw_entities, (str, bytes)):
        raw_entities = []

    visual_type = str(parsed_payload.get("visual_type") or "").strip().lower() or None
    if visual_type not in {"slide", "chart", "diagram", "code", "product_demo", "whiteboard", "other", None}:
        visual_type = "other"

    return {
        "description": str(parsed_payload.get("description") or "").strip() or None,
        "text_content": str(parsed_payload.get("text_content") or "").strip() or None,
        "visual_type": visual_type,
        "visual_entities": _ordered_unique_strings(raw_entities),
    }


async def _emit_runtime_event(
    callback: Callable[[str, Mapping[str, Any] | None], Awaitable[None] | None] | None,
    message: str,
    details: Mapping[str, Any] | None = None,
) -> None:
    if callback is None:
        return

    result = callback(message, details)
    if inspect.isawaitable(result):
        await result


def _extract_generated_text(response: Any) -> str:
    direct_text = getattr(response, "text", None)
    if isinstance(direct_text, str) and direct_text.strip():
        return direct_text.strip()
    if isinstance(response, Mapping) and isinstance(response.get("text"), str):
        return response["text"].strip()

    candidates = getattr(response, "candidates", None)
    if candidates is None and isinstance(response, Mapping):
        candidates = response.get("candidates")
    if not isinstance(candidates, Sequence) or isinstance(candidates, (str, bytes)):
        raise ValueError("Gemini frame annotation response did not include text.")

    text_fragments: list[str] = []
    for candidate in candidates:
        content = getattr(candidate, "content", None)
        if content is None and isinstance(candidate, Mapping):
            content = candidate.get("content")
        parts = getattr(content, "parts", None)
        if parts is None and isinstance(content, Mapping):
            parts = content.get("parts")
        if not isinstance(parts, Sequence) or isinstance(parts, (str, bytes)):
            continue
        for part in parts:
            part_text = getattr(part, "text", None)
            if part_text is None and isinstance(part, Mapping):
                part_text = part.get("text")
            if isinstance(part_text, str) and part_text.strip():
                text_fragments.append(part_text.strip())

    joined_text = "".join(text_fragments).strip()
    if not joined_text:
        raise ValueError("Gemini frame annotation response did not include text.")
    return joined_text
