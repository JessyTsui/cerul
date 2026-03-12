from __future__ import annotations

import asyncio
import json
import logging
import mimetypes
import os
import re
import shutil
import subprocess
from collections import Counter
from collections.abc import Mapping, Sequence
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Protocol
from urllib.parse import urlparse

import httpx

DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1"
DEFAULT_OPENAI_TRANSCRIBE_MODEL = "gpt-4o-transcribe"
DEFAULT_OPENAI_UPLOAD_LIMIT_BYTES = 25 * 1024 * 1024

logger = logging.getLogger(__name__)


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
        base_url: str = DEFAULT_OPENAI_BASE_URL,
        model_name: str = DEFAULT_OPENAI_TRANSCRIBE_MODEL,
        timeout_seconds: float = 120.0,
        max_upload_bytes: int = DEFAULT_OPENAI_UPLOAD_LIMIT_BYTES,
    ) -> None:
        self._api_key = (api_key or os.getenv("OPENAI_API_KEY", "")).strip()
        self._base_url = base_url.rstrip("/")
        self._model_name = model_name
        self._timeout_seconds = timeout_seconds
        self._max_upload_bytes = max_upload_bytes

    async def transcribe(
        self,
        video_path: str | Path,
        *,
        video_metadata: Mapping[str, Any],
    ) -> Sequence[Mapping[str, Any]]:
        if not self._api_key:
            raise RuntimeError("OPENAI_API_KEY is required for ASR fallback.")

        resolved_video_path = Path(video_path)
        if not resolved_video_path.exists():
            raise FileNotFoundError(f"Transcription input does not exist: {resolved_video_path}")

        file_size = resolved_video_path.stat().st_size
        if file_size > self._max_upload_bytes:
            raise RuntimeError(
                "Transcription input exceeds the OpenAI upload limit. "
                "Prefer subtitles or add audio chunking for long videos."
            )

        content_type = (
            mimetypes.guess_type(resolved_video_path.name)[0] or "application/octet-stream"
        )
        payload = [
            ("model", self._model_name),
            ("response_format", "verbose_json"),
            ("timestamp_granularities[]", "segment"),
        ]

        async with httpx.AsyncClient(timeout=self._timeout_seconds) as client:
            with resolved_video_path.open("rb") as handle:
                response = await client.post(
                    f"{self._base_url}/audio/transcriptions",
                    headers={"Authorization": f"Bearer {self._api_key}"},
                    data=payload,
                    files={"file": (resolved_video_path.name, handle, content_type)},
                )

        response.raise_for_status()
        return normalize_transcript_segments(
            _extract_transcript_segments(
                response.json(),
                default_end=float(video_metadata.get("duration_seconds") or 0.0),
            ),
            default_end=float(video_metadata.get("duration_seconds") or 0.0),
        )


class YtDlpCaptionProvider:
    def __init__(
        self,
        *,
        command: str | None = None,
        logger: logging.Logger | None = None,
    ) -> None:
        self._command = (command or os.getenv("YTDLP_BIN") or "yt-dlp").strip() or "yt-dlp"
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
        fallback_downloader: KnowledgeVideoDownloader | None = None,
        logger: logging.Logger | None = None,
    ) -> None:
        self._command = (command or os.getenv("YTDLP_BIN") or "yt-dlp").strip() or "yt-dlp"
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
        command = [
            self._command,
            "--no-playlist",
            "--format",
            "best[ext=mp4]/best",
            "--output",
            str(output_template),
            source,
        ]

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


class HeuristicFrameAnalyzer:
    async def analyze_scene(
        self,
        video_path: str | Path,
        *,
        scene: Mapping[str, Any],
        transcript_segments: Sequence[Mapping[str, Any]],
        video_metadata: Mapping[str, Any],
    ) -> Mapping[str, Any]:
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
        speaker = str(video_metadata.get("speaker") or "Speaker").strip()
        topic = ", ".join(keywords) if keywords else "the current discussion"
        summary = f"{speaker} is on screen discussing {topic}."
        return {
            "scene_index": int(scene["scene_index"]),
            "visual_summary": summary,
            "keywords": keywords,
        }


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
