from __future__ import annotations

import mimetypes
import re
import shutil
from collections import Counter
from collections.abc import Mapping, Sequence
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Protocol
from urllib.parse import urlparse

import httpx


class KnowledgeMetadataClient(Protocol):
    async def get_video_metadata(self, video_id: str) -> Mapping[str, Any]:
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
    return normalized.startswith("video/") or normalized in {
        "application/octet-stream",
        "binary/octet-stream",
    }


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
