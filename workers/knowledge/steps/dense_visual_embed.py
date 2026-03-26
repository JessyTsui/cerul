from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

from backend.app.config import get_settings
from backend.app.embedding import EmbeddingBackend
from workers.common.pipeline import PipelineContext, PipelineStep, emit_step_log

DEFAULT_DENSE_VISUAL_FRAMES_PER_SEGMENT = 3
DEFAULT_DENSE_VISUAL_EMBEDDING_CONCURRENCY = 6
DEFAULT_DENSE_VISUAL_FRAME_SCALE = "640:360"
DEFAULT_DENSE_VISUAL_FRAME_TIMEOUT_SECONDS = 15.0
MAX_DENSE_VISUAL_TRANSCRIPT_CHARS = 200


def compute_dense_visual_timestamps(
    timestamp_start: float,
    timestamp_end: float,
    *,
    count: int,
) -> list[float]:
    normalized_count = max(int(count), 0)
    if normalized_count <= 0:
        return []

    start = float(timestamp_start or 0.0)
    end = float(timestamp_end or start)
    if end <= start:
        return [round(max(start, 0.0), 3)]

    duration = end - start
    if normalized_count == 1:
        return [round(start + duration * 0.5, 3)]

    return [
        round(start + duration * ((index + 1) / (normalized_count + 1)), 3)
        for index in range(normalized_count)
    ]


async def extract_dense_visual_frame(
    video_path: str | Path,
    timestamp_seconds: float,
    output_path: Path,
    *,
    scale: str = DEFAULT_DENSE_VISUAL_FRAME_SCALE,
) -> Path | None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    process = None
    try:
        process = await asyncio.create_subprocess_exec(
            "ffmpeg",
            "-loglevel",
            "error",
            "-ss",
            f"{timestamp_seconds:.3f}",
            "-i",
            str(video_path),
            "-frames:v",
            "1",
            "-vf",
            f"scale={scale}",
            "-q:v",
            "2",
            "-y",
            str(output_path),
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        await asyncio.wait_for(
            process.communicate(),
            timeout=DEFAULT_DENSE_VISUAL_FRAME_TIMEOUT_SECONDS,
        )
    except FileNotFoundError:
        output_path.unlink(missing_ok=True)
        return None
    except asyncio.TimeoutError:
        if process is not None:
            process.kill()
            await process.communicate()
        output_path.unlink(missing_ok=True)
        return None

    if process is None or process.returncode != 0 or not output_path.exists():
        output_path.unlink(missing_ok=True)
        return None
    return output_path


class DenseVisualEmbedStep(PipelineStep):
    step_name = "DenseVisualEmbedStep"

    def __init__(
        self,
        embedding_backend: EmbeddingBackend | None = None,
        *,
        frames_per_segment: int | None = None,
        max_concurrency: int = DEFAULT_DENSE_VISUAL_EMBEDDING_CONCURRENCY,
    ) -> None:
        self._embedding_backend = embedding_backend
        self._frames_per_segment = frames_per_segment
        self._max_concurrency = max(1, int(max_concurrency))

    async def _process(self, context: PipelineContext) -> None:
        segments = context.data.get("segments")
        video_metadata = context.data.get("video_metadata")
        if segments is None or video_metadata is None:
            raise RuntimeError(
                "Dense visual embedding requires segmented transcript data and video metadata."
            )

        frames_per_segment = self._resolve_frames_per_segment(context)
        if frames_per_segment <= 0:
            context.data["dense_visual_units"] = []
            context.data["dense_visual_unit_count"] = 0
            return

        video_path = self._resolve_video_path(context.data.get("video_path"))
        if video_path is None:
            await emit_step_log(
                context,
                self.step_name,
                "Skipping dense visual embedding because the video file is unavailable.",
                details={"video_path": context.data.get("video_path")},
            )
            context.data["dense_visual_units"] = []
            context.data["dense_visual_unit_count"] = 0
            return

        embedding_backend = self._embedding_backend or context.conf.get("embedding_backend")
        if embedding_backend is None:
            raise RuntimeError("An embedding backend is required for dense visual embedding.")

        embed_multimodal = getattr(embedding_backend, "embed_multimodal", None)
        if not callable(embed_multimodal):
            await emit_step_log(
                context,
                self.step_name,
                "Skipping dense visual embedding because the backend has no multimodal support.",
                details={"embedding_backend": type(embedding_backend).__name__},
            )
            context.data["dense_visual_units"] = []
            context.data["dense_visual_unit_count"] = 0
            return

        dense_visual_root = video_path.parent / f"{video_path.stem}_dense_visual"
        video_title = str(video_metadata.get("title") or "").strip()
        semaphore = asyncio.Semaphore(self._max_concurrency)
        dense_visual_units: list[dict[str, Any]] = []
        dense_visual_errors: dict[str, str] = {}

        await emit_step_log(
            context,
            self.step_name,
            "Starting dense visual embedding.",
            details={
                "frames_per_segment": frames_per_segment,
                "segment_count": len(segments),
            },
        )

        async def build_unit(
            segment: dict[str, Any],
            *,
            frame_index: int,
            timestamp_seconds: float,
        ) -> dict[str, Any] | None:
            segment_index = int(segment["segment_index"])
            output_path = (
                dense_visual_root
                / f"segment_{segment_index:04d}"
                / f"frame_{frame_index:02d}.jpg"
            )
            output_path.parent.mkdir(parents=True, exist_ok=True)
            async with semaphore:
                extracted_path = await extract_dense_visual_frame(
                    video_path=video_path,
                    timestamp_seconds=timestamp_seconds,
                    output_path=output_path,
                )
                if extracted_path is None:
                    dense_visual_errors[f"{segment_index}:{frame_index}"] = (
                        "frame_extraction_failed"
                    )
                    return None

                content_text = self._build_dense_visual_content_text(
                    video_title=video_title,
                    segment=segment,
                )
                try:
                    vector = list(
                        await asyncio.to_thread(
                            embed_multimodal,
                            content_text,
                            image_paths=[str(extracted_path)],
                        )
                    )
                except Exception as exc:  # pragma: no cover - defensive
                    dense_visual_errors[f"{segment_index}:{frame_index}"] = str(exc)
                    return None

            if len(vector) != embedding_backend.dimension():
                dense_visual_errors[f"{segment_index}:{frame_index}"] = (
                    "embedding_dimension_mismatch"
                )
                return None

            return {
                "segment_index": segment_index,
                "frame_index": frame_index,
                "timestamp_seconds": timestamp_seconds,
                "timestamp_start": segment.get("timestamp_start"),
                "timestamp_end": segment.get("timestamp_end"),
                "content_text": content_text,
                "embedding": vector,
                "frame_path": str(extracted_path),
                "metadata": {
                    "dense_visual": True,
                    "frame_timestamp_seconds": timestamp_seconds,
                    "segment_title": segment.get("title"),
                },
            }

        tasks: list[asyncio.Task[dict[str, Any] | None]] = []
        for segment in segments:
            timestamps = compute_dense_visual_timestamps(
                self._coerce_timestamp(segment.get("timestamp_start")),
                self._coerce_timestamp(segment.get("timestamp_end")),
                count=frames_per_segment,
            )
            segment_units = 0
            for frame_index, timestamp_seconds in enumerate(timestamps):
                tasks.append(
                    asyncio.create_task(
                        build_unit(
                            dict(segment),
                            frame_index=frame_index,
                            timestamp_seconds=timestamp_seconds,
                        )
                    )
                )
                segment_units += 1
            segment_metadata = dict(segment.get("metadata") or {})
            segment_metadata["dense_visual_frame_count"] = segment_units
            segment["metadata"] = segment_metadata

        if tasks:
            results = await asyncio.gather(*tasks)
            dense_visual_units = [result for result in results if result is not None]

        context.data["dense_visual_units"] = dense_visual_units
        context.data["dense_visual_unit_count"] = len(dense_visual_units)
        context.data["dense_visual_error_count"] = len(dense_visual_errors)
        if dense_visual_errors:
            context.data["dense_visual_errors"] = dense_visual_errors

        await emit_step_log(
            context,
            self.step_name,
            "Finished dense visual embedding.",
            details={
                "dense_visual_unit_count": len(dense_visual_units),
                "dense_visual_error_count": len(dense_visual_errors),
            },
        )

    def _resolve_frames_per_segment(self, context: PipelineContext) -> int:
        if self._frames_per_segment is not None:
            return max(int(self._frames_per_segment), 0)
        configured_value = context.conf.get("dense_visual_frames_per_segment")
        if configured_value is None:
            configured_value = get_settings().knowledge.dense_visual_frames_per_segment
        return max(int(configured_value), 0)

    def _resolve_video_path(self, value: object) -> Path | None:
        if value is None:
            return None
        raw_value = str(value).strip()
        if not raw_value:
            return None
        candidate = Path(raw_value)
        if not candidate.exists():
            return None
        return candidate

    def _build_dense_visual_content_text(
        self,
        *,
        video_title: str,
        segment: dict[str, Any],
    ) -> str:
        transcript_excerpt = str(segment.get("transcript_text") or "").strip()
        transcript_excerpt = transcript_excerpt[:MAX_DENSE_VISUAL_TRANSCRIPT_CHARS]
        if not transcript_excerpt:
            transcript_excerpt = str(segment.get("title") or "").strip()
        return "\n".join(part for part in [video_title, transcript_excerpt] if part).strip()

    def _coerce_timestamp(self, value: object) -> float:
        try:
            return float(value or 0.0)
        except (TypeError, ValueError):
            return 0.0
