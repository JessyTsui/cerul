from __future__ import annotations

import asyncio
import tempfile
from pathlib import Path

from backend.app.embedding import EmbeddingBackend
from workers.common.pipeline import PipelineContext, PipelineStep

DEFAULT_SEGMENT_EMBEDDING_CONCURRENCY = 10
MAX_EMBEDDING_IMAGE_FRAMES = 2
EMBEDDING_FRAME_CAPTURE_TIMEOUT_SECONDS = 15.0


async def extract_frame_at_timestamp(
    video_path: str | Path,
    timestamp_seconds: float,
    output_path: Path,
) -> Path | None:
    """Extract a single JPEG frame at the given timestamp using ffmpeg."""
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
            "-q:v",
            "2",
            "-y",
            str(output_path),
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        await asyncio.wait_for(
            process.communicate(),
            timeout=EMBEDDING_FRAME_CAPTURE_TIMEOUT_SECONDS,
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


def compute_embedding_frame_timestamps(
    timestamp_start: float,
    timestamp_end: float,
) -> list[float]:
    """Return one or two timestamps suitable for visual embedding snapshots."""
    duration = timestamp_end - timestamp_start
    if duration <= 0:
        return []
    if duration < 10:
        return [timestamp_start + duration * 0.5]
    return [
        timestamp_start + duration * 0.33,
        timestamp_start + duration * 0.67,
    ]


class EmbedKnowledgeSegmentsStep(PipelineStep):
    step_name = "EmbedKnowledgeSegmentsStep"

    def __init__(
        self,
        embedding_backend: EmbeddingBackend | None = None,
        max_concurrency: int = DEFAULT_SEGMENT_EMBEDDING_CONCURRENCY,
    ) -> None:
        self._embedding_backend = embedding_backend
        self._max_concurrency = max(1, int(max_concurrency))

    async def _process(self, context: PipelineContext) -> None:
        segments = context.data.get("segments")
        if segments is None:
            raise RuntimeError("Knowledge embeddings require segmented transcript data.")
        video_path = self._resolve_video_path(context.data.get("video_path"))

        embedding_backend = self._embedding_backend or context.conf.get(
            "embedding_backend"
        )
        if embedding_backend is None:
            raise RuntimeError("An embedding backend is required.")

        embeddings: dict[int, list[float]] = {}
        embedding_errors: dict[int, str] = {}
        semaphore = asyncio.Semaphore(self._max_concurrency)
        temp_frame_dir = tempfile.TemporaryDirectory(prefix="cerul-embed-frames-")
        temp_frame_root = Path(temp_frame_dir.name)

        async def embed_segment(
            segment: dict[str, object],
        ) -> tuple[int, list[float] | None, str | None, bool | None]:
            segment_index = int(segment["segment_index"])
            payload = self._build_embedding_payload(segment)
            frame_paths = [
                str(frame_path).strip()
                for frame_path in (segment.get("frame_paths") or [])
                if str(frame_path).strip()
            ]
            temp_frame_paths: list[str] = []
            if not frame_paths and video_path is not None:
                timestamps = compute_embedding_frame_timestamps(
                    self._coerce_timestamp(segment.get("timestamp_start")),
                    self._coerce_timestamp(segment.get("timestamp_end")),
                )
                for frame_offset, timestamp in enumerate(timestamps):
                    output_path = temp_frame_root / f"embed_frame_{segment_index}_{frame_offset}.jpg"
                    extracted_path = await extract_frame_at_timestamp(
                        video_path=video_path,
                        timestamp_seconds=timestamp,
                        output_path=output_path,
                    )
                    if extracted_path is not None:
                        temp_frame_paths.append(str(extracted_path))
                if temp_frame_paths:
                    frame_paths = temp_frame_paths
            try:
                async with semaphore:
                    embed_multimodal = getattr(embedding_backend, "embed_multimodal", None)
                    if frame_paths and callable(embed_multimodal):
                        vector = list(
                            await asyncio.to_thread(
                                embed_multimodal,
                                payload,
                                image_paths=frame_paths[:MAX_EMBEDDING_IMAGE_FRAMES],
                            )
                        )
                        has_visual_embedding = True
                    else:
                        vector = list(
                            await asyncio.to_thread(embedding_backend.embed_text, payload)
                        )
                        has_visual_embedding = False
            except Exception as exc:
                return segment_index, None, str(exc), None
            finally:
                for temp_frame_path in temp_frame_paths:
                    Path(temp_frame_path).unlink(missing_ok=True)

            if len(vector) != embedding_backend.dimension():
                raise ValueError(
                    f"Embedding dimension mismatch for segment {segment_index}: "
                    f"expected {embedding_backend.dimension()}, got {len(vector)}."
                )
            return segment_index, vector, None, has_visual_embedding

        try:
            results = await asyncio.gather(
                *(embed_segment(segment) for segment in segments)
            )
        finally:
            temp_frame_dir.cleanup()
        for segment, (segment_index, vector, error, has_visual_embedding) in zip(segments, results):
            if error is not None:
                embedding_errors[segment_index] = error
                continue
            if vector is None:
                continue
            embeddings[segment_index] = vector
            segment["has_visual_embedding"] = bool(has_visual_embedding)

        if not embeddings:
            raise ValueError("Knowledge embedding produced no vectors.")

        context.data["segment_embeddings"] = embeddings
        context.data["embedding_dimension"] = embedding_backend.dimension()
        if embedding_errors:
            context.data["embedding_errors"] = embedding_errors

    def _build_embedding_payload(self, segment: dict[str, object]) -> str:
        parts = [
            str(segment.get("title") or "").strip(),
            str(segment.get("transcript_text") or "").strip(),
        ]
        visual_description = str(segment.get("visual_description") or "").strip()
        visual_text_content = str(segment.get("visual_text_content") or "").strip()
        visual_entities = [
            str(entity).strip()
            for entity in (segment.get("visual_entities") or [])
            if str(entity).strip()
        ]
        if visual_description:
            parts.append(f"[Visual content: {visual_description}]")
        if visual_text_content:
            parts.append(f"[Visible text: {visual_text_content}]")
        if visual_entities:
            parts.append(f"[Visual entities: {', '.join(visual_entities)}]")
        return "\n".join(part for part in parts if part)

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

    def _coerce_timestamp(self, value: object) -> float:
        try:
            return float(value or 0.0)
        except (TypeError, ValueError):
            return 0.0
