from __future__ import annotations

import asyncio
import inspect
import json
import logging
import mimetypes
import os
import re
import shutil
import subprocess
import tempfile
import time
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from backend.app.embedding import EmbeddingBackend, create_embedding_backend
from workers.broll.steps.fetch_asset_metadata import FetchAssetMetadataStep
from workers.common.pipeline import PipelineContext
from workers.common.storage import R2FrameUploader
from workers.common.sources import PexelsClient, PixabayClient, YouTubeClient
from workers.knowledge import InMemoryKnowledgeRepository, KnowledgeIndexingPipeline
from workers.knowledge.runtime import (
    HeuristicFrameAnalyzer,
    HeuristicSceneDetector,
    HttpVideoDownloader,
    extract_keywords,
    summarize_text,
)

from .repository import UnifiedRepository, resolve_default_unified_repository
from .summary import GeminiFlashSummaryGenerator

DEFAULT_UNIFIED_EMBEDDING_DIMENSION = 3072
MAX_INDEX_DURATION_SECONDS = 4 * 60 * 60
DEFAULT_UNIFIED_STEP_TIMEOUTS: dict[str, float] = {
    "FetchUnifiedMetadataStep": 45.0,
    "DownloadKnowledgeVideoStep": 480.0,
    "DetectKnowledgeScenesStep": 90.0,
    "AnalyzeKnowledgeFramesStep": 600.0,
    "BuildUnifiedRetrievalUnitsStep": 180.0,
    "EmbedUnifiedUnitsStep": 300.0,
    "PersistUnifiedUnitsStep": 120.0,
    "MarkUnifiedJobCompletedStep": 60.0,
}
DEFAULT_KEYFRAME_CAPTURE_CONCURRENCY = 6
DEFAULT_KEYFRAME_CAPTURE_TIMEOUT_SECONDS = 30.0
logger = logging.getLogger(__name__)

DEFAULT_UNIFIED_TIMEOUT_GUIDANCE: dict[str, str] = {
    "FetchUnifiedMetadataStep": "Metadata fetch timed out; inspect the upstream source and proxy path.",
    "DownloadKnowledgeVideoStep": "Video download timed out; inspect source reachability, cookies, and proxy settings.",
    "DetectKnowledgeScenesStep": "Scene detection timed out; inspect ffmpeg health and local file readability.",
    "AnalyzeKnowledgeFramesStep": "Frame analysis timed out; a vision-model request may be hung. Check Gemini reachability or proxy behavior.",
    "BuildUnifiedRetrievalUnitsStep": "Unit construction timed out; inspect summary generation and segment volume.",
    "EmbedUnifiedUnitsStep": "Unit embedding timed out; inspect Gemini embedding latency and outbound connectivity.",
    "PersistUnifiedUnitsStep": "Unit persistence timed out; inspect Postgres health and lock contention.",
    "MarkUnifiedJobCompletedStep": "Final job commit timed out; inspect worker/database health before requeueing.",
}


class UnifiedIndexingPipeline:
    def __init__(
        self,
        repository: UnifiedRepository | None = None,
        embedding_backend: EmbeddingBackend | None = None,
        youtube_client: YouTubeClient | None = None,
        pexels_client: PexelsClient | None = None,
        pixabay_client: PixabayClient | None = None,
        frame_analyzer: HeuristicFrameAnalyzer | None = None,
        scene_detector: HeuristicSceneDetector | None = None,
        video_downloader: HttpVideoDownloader | None = None,
        summary_generator: GeminiFlashSummaryGenerator | None = None,
        frame_uploader: R2FrameUploader | None = None,
        temp_dir_root: str | None = None,
        db_url: str | None = None,
    ) -> None:
        self._repository = repository or resolve_default_unified_repository(db_url)
        self._embedding_backend = embedding_backend or create_embedding_backend(
            output_dimension=DEFAULT_UNIFIED_EMBEDDING_DIMENSION
        )
        self._youtube_client = youtube_client or YouTubeClient()
        self._pexels_client = pexels_client or PexelsClient()
        self._pixabay_client = pixabay_client or PixabayClient()
        self._frame_analyzer = frame_analyzer or HeuristicFrameAnalyzer()
        self._scene_detector = scene_detector or HeuristicSceneDetector()
        self._video_downloader = video_downloader or HttpVideoDownloader()
        self._summary_generator = summary_generator or GeminiFlashSummaryGenerator()
        self._frame_uploader = frame_uploader or R2FrameUploader()
        self._temp_dir_root = temp_dir_root

    async def run(
        self,
        *,
        url: str,
        source: str,
        source_video_id: str,
        owner_id: str | None,
        video_id: str | None = None,
        job_id: str | None = None,
        conf: Mapping[str, Any] | None = None,
    ) -> PipelineContext:
        runtime_conf = dict(conf or {})
        runtime_conf["step_timeouts"] = {
            **DEFAULT_UNIFIED_STEP_TIMEOUTS,
            **dict(runtime_conf.get("step_timeouts") or {}),
        }
        runtime_conf["step_timeout_guidance"] = {
            **DEFAULT_UNIFIED_TIMEOUT_GUIDANCE,
            **dict(runtime_conf.get("step_timeout_guidance") or {}),
        }
        if source == "youtube":
            return await self._run_youtube_pipeline(
                url=url,
                source_video_id=source_video_id,
                owner_id=owner_id,
                video_id=video_id,
                job_id=job_id,
                conf=runtime_conf,
            )
        return await self._run_visual_pipeline(
            url=url,
            source=source,
            source_video_id=source_video_id,
            owner_id=owner_id,
            video_id=video_id,
            job_id=job_id,
            conf=runtime_conf,
        )

    async def _run_youtube_pipeline(
        self,
        *,
        url: str,
        source_video_id: str,
        owner_id: str | None,
        video_id: str | None,
        job_id: str | None,
        conf: Mapping[str, Any] | None,
    ) -> PipelineContext:
        in_memory_repository = InMemoryKnowledgeRepository()
        pipeline = KnowledgeIndexingPipeline(
            repository=in_memory_repository,
            embedding_backend=self._embedding_backend,
            metadata_client=self._youtube_client,
            temp_dir_root=self._temp_dir_root,
        )
        context = await pipeline.run(
            video_id=source_video_id,
            job_id=job_id,
            conf=conf,
        )
        if context.failed_step is not None:
            error_message = context.error or (
                f"Knowledge indexing failed at {context.failed_step}."
            )
            raise RuntimeError(error_message)
        stored_video = dict(context.data.get("stored_video") or {})
        stored_segments = [
            dict(segment) for segment in context.data.get("stored_segments", [])
        ]
        if not stored_video or not stored_segments:
            raise RuntimeError("Unified indexing requires stored knowledge video and segments.")
        self._validate_max_duration(stored_video.get("duration_seconds"))

        unified_video = self._build_unified_video_payload(
            source="youtube",
            requested_video_id=video_id,
            owner_id=owner_id,
            video=stored_video,
            transcript_available=True,
        )
        units = await self._run_context_step(
            context,
            step_name="BuildUnifiedRetrievalUnitsStep",
            operation=lambda: self._build_units_from_knowledge_segments(
                stored_video=stored_video,
                stored_segments=stored_segments,
                video_path=context.data.get("video_path"),
            ),
        )
        context.data["units"] = list(units)
        stored_unified_video, stored_units = await self._run_context_step(
            context,
            step_name="PersistUnifiedUnitsStep",
            operation=lambda: self._persist_units(
                video=unified_video,
                owner_id=owner_id,
                units=units,
                job_id=job_id,
            ),
        )

        context.data["stored_unified_video"] = stored_unified_video
        context.data["stored_unified_units"] = stored_units
        context.data["indexed_unit_count"] = len(stored_units)
        context.data["job_status"] = "completed"
        context.data["job_artifacts"] = {
            "video_id": stored_unified_video["id"],
            "units_created": len(stored_units),
            "source": stored_unified_video["source"],
        }
        await self._run_context_step(
            context,
            step_name="MarkUnifiedJobCompletedStep",
            operation=self._noop_operation,
        )
        return context

    async def _run_visual_pipeline(
        self,
        *,
        url: str,
        source: str,
        source_video_id: str,
        owner_id: str | None,
        video_id: str | None,
        job_id: str | None,
        conf: Mapping[str, Any] | None,
    ) -> PipelineContext:
        context = PipelineContext(
            conf=dict(conf or {}),
            data={
                "job_id": job_id,
                "track": "unified",
                "source": source,
                "source_video_id": source_video_id,
            }
        )
        temp_dir: Path | None = None
        try:
            video_metadata = await self._run_context_step(
                context,
                step_name="FetchUnifiedMetadataStep",
                operation=lambda: self._fetch_visual_video_metadata(
                    url=url,
                    source=source,
                    source_video_id=source_video_id,
                    requested_video_id=video_id,
                ),
            )
            context.data["video_metadata"] = video_metadata

            temp_dir = Path(
                tempfile.mkdtemp(prefix="cerul-unified-", dir=self._temp_dir_root or None)
            )
            download_metadata = dict(video_metadata)
            download_metadata["download_url"] = video_metadata["video_url"]
            video_path = await self._run_context_step(
                context,
                step_name="DownloadKnowledgeVideoStep",
                operation=lambda: self._video_downloader.download_video(
                    download_metadata, temp_dir
                ),
            )
            context.data["video_path"] = str(video_path)
            context.data["temp_dir"] = str(temp_dir)

            duration_seconds = await self._probe_duration_seconds(Path(video_path))
            if duration_seconds and not video_metadata.get("duration_seconds"):
                video_metadata["duration_seconds"] = duration_seconds
            self._validate_max_duration(video_metadata.get("duration_seconds"))

            scenes = await self._run_context_step(
                context,
                step_name="DetectKnowledgeScenesStep",
                operation=lambda: self._scene_detector.detect_scenes(
                    video_path,
                    transcript_segments=[],
                    video_metadata=video_metadata,
                    threshold=0.25,
                ),
            )
            context.data["scenes"] = list(scenes)
            context.data["scene_count"] = len(scenes)

            analyses = await self._run_context_step(
                context,
                step_name="AnalyzeKnowledgeFramesStep",
                operation=lambda: self._analyze_visual_scenes(
                    context=context,
                    video_path=video_path,
                    scenes=scenes,
                    video_metadata=video_metadata,
                ),
            )
            context.data["scene_analyses"] = analyses

            units = await self._run_context_step(
                context,
                step_name="BuildUnifiedRetrievalUnitsStep",
                operation=lambda: self._build_units_from_visual_scene(
                    video_metadata=video_metadata,
                    scenes=scenes,
                    scene_analyses=analyses,
                    video_path=video_path,
                ),
            )
            context.data["units"] = units

            embedded_units = await self._run_context_step(
                context,
                step_name="EmbedUnifiedUnitsStep",
                operation=lambda: self._embed_units(units),
            )
            context.data["embedded_units"] = embedded_units

            stored_unified_video, stored_units = await self._run_context_step(
                context,
                step_name="PersistUnifiedUnitsStep",
                operation=lambda: self._persist_units(
                    video=video_metadata,
                    owner_id=owner_id,
                    units=embedded_units,
                    job_id=job_id,
                ),
            )
            context.data["stored_unified_video"] = stored_unified_video
            context.data["stored_unified_units"] = stored_units
            context.data["indexed_unit_count"] = len(stored_units)
            context.data["job_status"] = "completed"
            context.data["job_artifacts"] = {
                "video_id": stored_unified_video["id"],
                "units_created": len(stored_units),
                "source": stored_unified_video["source"],
            }
            await self._run_context_step(
                context,
                step_name="MarkUnifiedJobCompletedStep",
                operation=self._noop_operation,
            )
            return context
        finally:
            if temp_dir is not None:
                shutil.rmtree(temp_dir, ignore_errors=True)

    async def _run_context_step(
        self,
        context: PipelineContext,
        *,
        step_name: str,
        operation,
    ):
        context.current_step = step_name
        timeout_seconds = self._resolve_step_timeout(context, step_name)
        await self._emit_progress(context, step_name, "running")
        await self._emit_step_log(
            context,
            step_name,
            "info",
            (
                f"Started step {step_name}."
                + (f" Timeout set to {int(timeout_seconds)}s." if timeout_seconds else "")
            ),
        )

        started_at = time.monotonic()
        try:
            if timeout_seconds:
                result = await asyncio.wait_for(operation(), timeout=timeout_seconds)
            else:
                result = await operation()
        except asyncio.TimeoutError as exc:
            duration_ms = self._remember_step_duration(context, step_name, started_at)
            guidance = self._build_timeout_message(context, step_name, timeout_seconds)
            await self._remember_step_guidance(
                context,
                step_name,
                timeout_seconds=timeout_seconds,
                guidance=guidance,
            )
            context.failed_step = step_name
            context.error = guidance
            await self._emit_step_log(
                context,
                step_name,
                "error",
                guidance,
                {"duration_ms": duration_ms, "timeout_seconds": timeout_seconds},
            )
            await self._emit_progress(context, step_name, "failed")
            raise RuntimeError(guidance) from exc
        except Exception as exc:
            duration_ms = self._remember_step_duration(context, step_name, started_at)
            context.failed_step = step_name
            context.error = str(exc)
            await self._emit_step_log(
                context,
                step_name,
                "error",
                f"Step failed: {exc}",
                {"duration_ms": duration_ms},
            )
            await self._emit_progress(context, step_name, "failed")
            raise

        duration_ms = self._remember_step_duration(context, step_name, started_at)
        context.completed_steps.append(step_name)
        if timeout_seconds:
            await self._remember_step_guidance(
                context,
                step_name,
                timeout_seconds=timeout_seconds,
                guidance=None,
            )
        await self._emit_step_log(
            context,
            step_name,
            "info",
            f"Completed step {step_name} in {self._format_duration_ms(duration_ms)}.",
            {"duration_ms": duration_ms},
        )
        await self._emit_progress(context, step_name, "completed")
        return result

    async def _emit_progress(
        self,
        context: PipelineContext,
        step_name: str,
        status: str,
    ) -> None:
        callback = context.conf.get("progress_callback")
        if not callable(callback):
            return
        try:
            result = callback(step_name, status, context)
            if inspect.isawaitable(result):
                await result
        except Exception as exc:  # pragma: no cover - best effort callback guard
            logger.warning(
                "Unified progress callback failed for %s (%s): %s",
                step_name,
                status,
                exc,
            )

    async def _emit_step_log(
        self,
        context: PipelineContext,
        step_name: str,
        level: str,
        message: str,
        details: Mapping[str, Any] | None = None,
    ) -> None:
        callback = context.conf.get("step_log_callback")
        if not callable(callback):
            return
        try:
            result = callback(step_name, level, message, dict(details or {}), context)
            if inspect.isawaitable(result):
                await result
        except Exception as exc:  # pragma: no cover - best effort callback guard
            logger.warning(
                "Unified step log callback failed for %s (%s): %s",
                step_name,
                level,
                exc,
            )

    def _resolve_step_timeout(self, context: PipelineContext, step_name: str) -> float | None:
        raw_timeouts = context.conf.get("step_timeouts")
        if not isinstance(raw_timeouts, Mapping):
            return None
        raw_value = raw_timeouts.get(step_name)
        if raw_value in (None, "", 0, 0.0):
            return None
        try:
            timeout_seconds = float(raw_value)
        except (TypeError, ValueError):
            return None
        return timeout_seconds if timeout_seconds > 0 else None

    def _build_timeout_message(
        self,
        context: PipelineContext,
        step_name: str,
        timeout_seconds: float | None,
    ) -> str:
        raw_guidance = None
        guidance_map = context.conf.get("step_timeout_guidance")
        if isinstance(guidance_map, Mapping):
            raw_guidance = guidance_map.get(step_name)
        guidance = str(raw_guidance).strip() if raw_guidance is not None else ""
        timeout_fragment = f" after {int(timeout_seconds)}s" if timeout_seconds else ""
        message = f"Step {step_name} timed out{timeout_fragment}."
        if guidance:
            message = f"{message} {guidance}"
        return message

    def _remember_step_duration(
        self,
        context: PipelineContext,
        step_name: str,
        started_at: float,
    ) -> int:
        duration_ms = max(int(round((time.monotonic() - started_at) * 1000)), 0)
        context.data.setdefault("step_duration_ms", {})[step_name] = duration_ms
        return duration_ms

    async def _remember_step_guidance(
        self,
        context: PipelineContext,
        step_name: str,
        *,
        timeout_seconds: float | None,
        guidance: str | None,
    ) -> None:
        if timeout_seconds:
            context.data.setdefault("step_timeout_seconds", {})[step_name] = timeout_seconds
        if guidance:
            context.data.setdefault("step_guidance", {})[step_name] = guidance

    def _format_duration_ms(self, value: int) -> str:
        total_seconds = max(int(round(value / 1000.0)), 0)
        minutes, seconds = divmod(total_seconds, 60)
        hours, minutes = divmod(minutes, 60)
        if hours > 0:
            return f"{hours}h {minutes}m {seconds}s"
        if minutes > 0:
            return f"{minutes}m {seconds}s"
        return f"{seconds}s"

    async def _analyze_visual_scenes(
        self,
        *,
        context: PipelineContext,
        video_path: str | Path,
        scenes: Sequence[Mapping[str, Any]],
        video_metadata: Mapping[str, Any],
    ) -> list[dict[str, Any]]:
        context.data["frame_analysis_scene_total"] = len(scenes)
        analyses: list[dict[str, Any]] = []
        for position, scene in enumerate(scenes, start=1):
            context.data["frame_analysis_current_scene_index"] = int(scene["scene_index"])
            context.data["frame_analysis_current_scene_position"] = position
            await self._emit_step_log(
                context,
                "AnalyzeKnowledgeFramesStep",
                "info",
                f"Analyzing scene {position}/{len(scenes)}.",
                {
                    "scene_index": int(scene["scene_index"]),
                    "timestamp_start": float(scene["timestamp_start"]),
                    "timestamp_end": float(scene["timestamp_end"]),
                },
            )
            analysis = await self._frame_analyzer.analyze_scene(
                video_path,
                scene=scene,
                transcript_segments=[],
                video_metadata=video_metadata,
            )
            analyses.append(dict(analysis))
            context.data["scene_analyses"] = analyses
        return analyses

    async def _noop_operation(self) -> None:
        return None

    async def _fetch_visual_video_metadata(
        self,
        *,
        url: str,
        source: str,
        source_video_id: str,
        requested_video_id: str | None,
    ) -> dict[str, Any]:
        if source == "pexels":
            payload = await self._pexels_client.get_video(source_video_id)
            normalized = FetchAssetMetadataStep()._normalize_pexels_asset(payload)
            title = normalized["title"]
            description = title
            thumbnail_url = normalized.get("thumbnail_url")
            video_url = normalized.get("video_url") or url
            duration_seconds = normalized.get("duration")
            license_value = normalized.get("license")
            creator = normalized.get("creator")
        elif source == "pixabay":
            payload = await self._pixabay_client.get_video(source_video_id)
            normalized = FetchAssetMetadataStep()._normalize_pixabay_asset(payload)
            title = normalized["title"]
            description = title
            thumbnail_url = normalized.get("thumbnail_url")
            video_url = normalized.get("video_url") or url
            duration_seconds = normalized.get("duration")
            license_value = normalized.get("license")
            creator = normalized.get("creator")
        else:
            parsed = urlparse(url)
            file_name = Path(parsed.path).name or source_video_id
            title = Path(file_name).stem.replace("-", " ").replace("_", " ").strip() or source_video_id
            description = title
            thumbnail_url = None
            video_url = url
            duration_seconds = None
            license_value = None
            creator = None

        return {
            "id": requested_video_id,
            "source": source,
            "source_video_id": source_video_id,
            "source_url": url,
            "video_url": video_url,
            "thumbnail_url": thumbnail_url,
            "title": title,
            "description": description,
            "speaker": None,
            "published_at": None,
            "duration_seconds": duration_seconds,
            "license": license_value,
            "creator": creator,
            "has_captions": False,
            "metadata": {"source_url": url},
        }

    def _build_unified_video_payload(
        self,
        *,
        source: str,
        requested_video_id: str | None,
        owner_id: str | None,
        video: Mapping[str, Any],
        transcript_available: bool,
    ) -> dict[str, Any]:
        metadata = dict(video.get("metadata") or {})
        return {
            "id": requested_video_id,
            "source": source,
            "source_video_id": video["source_video_id"],
            "source_url": video.get("source_url"),
            "video_url": video["video_url"],
            "thumbnail_url": video.get("thumbnail_url"),
            "title": video["title"],
            "description": video.get("description", ""),
            "speaker": video.get("speaker"),
            "published_at": video.get("published_at"),
            "duration_seconds": video.get("duration_seconds"),
            "license": video.get("license"),
            "creator": metadata.get("creator") or video.get("speaker"),
            "has_captions": transcript_available,
            "metadata": metadata,
            "owner_id": owner_id,
        }

    async def _build_units_from_knowledge_segments(
        self,
        *,
        stored_video: Mapping[str, Any],
        stored_segments: Sequence[Mapping[str, Any]],
        video_path: str | Path | None = None,
    ) -> list[dict[str, Any]]:
        units: list[dict[str, Any]] = []
        uploaded_urls = await self._ensure_segment_keyframes(
            video=stored_video,
            segments=stored_segments,
            video_path=video_path,
        )
        summary_text, summary_source = await self._build_summary_text(
            stored_video,
            stored_segments,
        )
        summary_embedding = await asyncio.to_thread(
            self._embedding_backend.embed_text,
            summary_text,
        )
        units.append(
            {
                "unit_type": "summary",
                "unit_index": 0,
                "timestamp_start": None,
                "timestamp_end": None,
                "content_text": summary_text,
                "transcript": None,
                "visual_desc": None,
                "visual_type": None,
                "keyframe_url": stored_video.get("thumbnail_url"),
                "metadata": {"summary_source": summary_source},
                "embedding": list(summary_embedding),
            }
        )

        visual_unit_index = 0
        for segment in stored_segments:
            transcript_text = str(segment.get("transcript_text") or "").strip()
            visual_desc = str(
                segment.get("visual_description")
                or segment.get("visual_summary")
                or ""
            ).strip()
            visible_text = str(segment.get("visual_text_content") or "").strip()
            speech_embedding = segment.get("embedding")
            segment_index = int(segment["segment_index"])
            keyframe_url = uploaded_urls.get(segment_index) or stored_video.get("thumbnail_url")
            if transcript_text and speech_embedding is not None:
                units.append(
                    {
                        "unit_type": "speech",
                        "unit_index": segment_index,
                        "timestamp_start": segment.get("timestamp_start"),
                        "timestamp_end": segment.get("timestamp_end"),
                        "content_text": str(segment.get("title") or stored_video["title"]) + "\n" + transcript_text,
                        "transcript": transcript_text,
                        "visual_desc": visual_desc or None,
                        "visual_type": segment.get("visual_type"),
                        "keyframe_url": keyframe_url,
                        "metadata": {
                            "segment_title": segment.get("title"),
                            "visual_text_content": visible_text or None,
                            "keywords": (segment.get("metadata") or {}).get("keywords", []),
                        },
                        "embedding": list(speech_embedding),
                    }
                )

            if visual_desc:
                content_text = "\n".join(
                    part
                    for part in [
                        str(stored_video["title"]),
                        visual_desc,
                        f"Visible text: {visible_text}" if visible_text else None,
                    ]
                    if part
                )
                frame_paths = [
                    str(frame_path)
                    for frame_path in (segment.get("frame_paths") or [])
                    if str(frame_path).strip()
                ]
                embedding = await self._resolve_visual_unit_embedding(
                    segment=segment,
                    content_text=content_text,
                    frame_paths=frame_paths,
                )
                units.append(
                    {
                        "unit_type": "visual",
                        "unit_index": visual_unit_index,
                        "timestamp_start": segment.get("timestamp_start"),
                        "timestamp_end": segment.get("timestamp_end"),
                        "content_text": content_text,
                        "transcript": None,
                        "visual_desc": visual_desc,
                        "visual_type": segment.get("visual_type"),
                        "keyframe_url": keyframe_url,
                        "metadata": {
                            "visual_text_content": visible_text or None,
                            "segment_title": segment.get("title"),
                            "embedding_source": (
                                "segment"
                                if segment.get("embedding") is not None
                                else "visual_unit"
                            ),
                        },
                        "embedding": embedding,
                    }
                )
                visual_unit_index += 1
        return units

    async def _build_units_from_visual_scene(
        self,
        *,
        video_metadata: Mapping[str, Any],
        scenes: Sequence[Mapping[str, Any]],
        scene_analyses: Sequence[Mapping[str, Any]],
        video_path: str | Path | None = None,
    ) -> list[dict[str, Any]]:
        units: list[dict[str, Any]] = []
        uploaded_urls = await self._ensure_scene_keyframes(
            video_metadata=video_metadata,
            scenes=scenes,
            scene_analyses=scene_analyses,
            video_path=video_path,
        )
        descriptions = [
            str(analysis.get("visual_description") or "").strip()
            for analysis in scene_analyses
            if str(analysis.get("visual_description") or "").strip()
        ]
        summary_text, summary_source = await self._generate_summary_text(
            title=str(video_metadata["title"]),
            description=str(video_metadata.get("description") or "").strip(),
            source=str(video_metadata.get("source") or "unknown"),
            duration_seconds=video_metadata.get("duration_seconds"),
            transcript_excerpt="",
            visual_excerpt=" ".join(descriptions),
            fallback_text=self._build_visual_summary_fallback(
                video_metadata=video_metadata,
                descriptions=descriptions,
            ),
        )
        summary_embedding = await asyncio.to_thread(
            self._embedding_backend.embed_text,
            summary_text,
        )
        units.append(
            {
                "unit_type": "summary",
                "unit_index": 0,
                "timestamp_start": None,
                "timestamp_end": None,
                "content_text": summary_text,
                "transcript": None,
                "visual_desc": None,
                "visual_type": None,
                "keyframe_url": video_metadata.get("thumbnail_url"),
                "metadata": {"summary_source": summary_source},
                "embedding": list(summary_embedding),
            }
        )

        analyses_by_scene = {
            int(analysis["scene_index"]): dict(analysis) for analysis in scene_analyses
        }
        visual_unit_index = 0
        for scene in scenes:
            analysis = analyses_by_scene.get(int(scene["scene_index"]), {})
            scene_index = int(scene["scene_index"])
            visual_desc = str(analysis.get("visual_description") or "").strip()
            if not visual_desc:
                continue
            keyframe_url = uploaded_urls.get(scene_index) or video_metadata.get("thumbnail_url")
            visible_text = str(analysis.get("visual_text_content") or "").strip()
            content_text = "\n".join(
                part
                for part in [
                    str(video_metadata["title"]),
                    visual_desc,
                    f"Visible text: {visible_text}" if visible_text else None,
                ]
                if part
            )
            frame_paths = [
                str(frame_path)
                for frame_path in (analysis.get("frame_paths") or [])
                if str(frame_path).strip()
            ]
            embedding = await self._embed_visual_unit(
                content_text=content_text,
                frame_paths=frame_paths,
            )
            units.append(
                {
                    "unit_type": "visual",
                    "unit_index": visual_unit_index,
                    "timestamp_start": scene.get("timestamp_start"),
                    "timestamp_end": scene.get("timestamp_end"),
                    "content_text": content_text,
                    "transcript": None,
                    "visual_desc": visual_desc,
                    "visual_type": analysis.get("visual_type"),
                    "keyframe_url": keyframe_url,
                    "metadata": {
                        "visual_text_content": visible_text or None,
                        "keywords": analysis.get("keywords", []),
                    },
                    "embedding": embedding,
                }
            )
            visual_unit_index += 1
        return units

    async def _upload_segment_keyframes(
        self,
        *,
        video: Mapping[str, Any],
        segments: Sequence[Mapping[str, Any]],
    ) -> dict[int, str]:
        frame_entries: list[tuple[int, Path]] = []
        for segment in segments:
            frame_path = self._first_existing_frame_path(segment.get("frame_paths") or [])
            if frame_path is None:
                continue
            frame_entries.append((int(segment["segment_index"]), frame_path))
        return await self._upload_frame_entries(
            video_key=self._frame_storage_key(video),
            frame_entries=frame_entries,
        )

    async def _ensure_segment_keyframes(
        self,
        *,
        video: Mapping[str, Any],
        segments: Sequence[Mapping[str, Any]],
        video_path: str | Path | None,
    ) -> dict[int, str]:
        uploaded_urls = await self._upload_segment_keyframes(
            video=video,
            segments=segments,
        )
        missing_targets: dict[int, float] = {}
        for segment in segments:
            segment_index = int(segment["segment_index"])
            if segment_index in uploaded_urls:
                continue
            transcript_text = str(segment.get("transcript_text") or "").strip()
            visual_desc = str(
                segment.get("visual_description")
                or segment.get("visual_summary")
                or ""
            ).strip()
            if not transcript_text and not visual_desc:
                continue
            timestamp = self._coerce_timestamp_seconds(segment.get("timestamp_start"))
            if timestamp is None:
                continue
            missing_targets[segment_index] = timestamp
        if not missing_targets:
            return uploaded_urls
        extracted_urls = await self._extract_and_upload_missing_keyframes(
            video_key=self._frame_storage_key(video),
            video_path=video_path,
            frame_targets=missing_targets,
        )
        return {**uploaded_urls, **extracted_urls}

    async def _upload_scene_keyframes(
        self,
        *,
        video_metadata: Mapping[str, Any],
        scene_analyses: Sequence[Mapping[str, Any]],
    ) -> dict[int, str]:
        frame_entries: list[tuple[int, Path]] = []
        for analysis in scene_analyses:
            frame_path = self._first_existing_frame_path(analysis.get("frame_paths") or [])
            if frame_path is None:
                continue
            frame_entries.append((int(analysis["scene_index"]), frame_path))
        return await self._upload_frame_entries(
            video_key=self._frame_storage_key(video_metadata),
            frame_entries=frame_entries,
        )

    async def _ensure_scene_keyframes(
        self,
        *,
        video_metadata: Mapping[str, Any],
        scenes: Sequence[Mapping[str, Any]],
        scene_analyses: Sequence[Mapping[str, Any]],
        video_path: str | Path | None,
    ) -> dict[int, str]:
        uploaded_urls = await self._upload_scene_keyframes(
            video_metadata=video_metadata,
            scene_analyses=scene_analyses,
        )
        analyses_by_scene = {
            int(analysis["scene_index"]): dict(analysis) for analysis in scene_analyses
        }
        missing_targets: dict[int, float] = {}
        for scene in scenes:
            scene_index = int(scene["scene_index"])
            if scene_index in uploaded_urls:
                continue
            analysis = analyses_by_scene.get(scene_index, {})
            visual_desc = str(analysis.get("visual_description") or "").strip()
            if not visual_desc:
                continue
            timestamp = self._coerce_timestamp_seconds(scene.get("timestamp_start"))
            if timestamp is None:
                continue
            missing_targets[scene_index] = timestamp
        if not missing_targets:
            return uploaded_urls
        extracted_urls = await self._extract_and_upload_missing_keyframes(
            video_key=self._frame_storage_key(video_metadata),
            video_path=video_path,
            frame_targets=missing_targets,
        )
        return {**uploaded_urls, **extracted_urls}

    async def _upload_frame_entries(
        self,
        *,
        video_key: str,
        frame_entries: Sequence[tuple[int, Path]],
    ) -> dict[int, str]:
        if not self._frame_uploader.available() or not frame_entries:
            return {}
        deduped_entries: list[tuple[int, Path]] = []
        seen_indexes: set[int] = set()
        for frame_index, frame_path in frame_entries:
            if frame_index in seen_indexes:
                continue
            seen_indexes.add(frame_index)
            deduped_entries.append((frame_index, frame_path))
        return await self._frame_uploader.upload_frames_batch(
            video_key,
            deduped_entries,
        )

    async def _extract_and_upload_missing_keyframes(
        self,
        *,
        video_key: str,
        video_path: str | Path | None,
        frame_targets: Mapping[int, float],
    ) -> dict[int, str]:
        if not self._frame_uploader.available() or not frame_targets:
            return {}
        resolved_video_path = self._resolve_existing_video_path(video_path)
        if resolved_video_path is None:
            return {}

        output_dir = resolved_video_path.parent / "unified-keyframes"
        output_dir.mkdir(parents=True, exist_ok=True)
        semaphore = asyncio.Semaphore(DEFAULT_KEYFRAME_CAPTURE_CONCURRENCY)
        grouped_targets: dict[str, dict[str, Any]] = {}
        for frame_index, timestamp_seconds in sorted(frame_targets.items()):
            timestamp_key = f"{float(timestamp_seconds):.3f}"
            group = grouped_targets.get(timestamp_key)
            if group is None:
                grouped_targets[timestamp_key] = {
                    "timestamp_seconds": float(timestamp_seconds),
                    "frame_indexes": [int(frame_index)],
                    "output_path": output_dir / f"{int(frame_index):03d}.jpg",
                }
            else:
                group["frame_indexes"].append(int(frame_index))

        async def extract_one(
            _timestamp_key: str,
            target: Mapping[str, Any],
        ) -> tuple[list[int], Path] | None:
            async with semaphore:
                extracted = await self._capture_video_frame(
                    video_path=resolved_video_path,
                    timestamp_seconds=float(target["timestamp_seconds"]),
                    output_path=Path(target["output_path"]),
                )
            if extracted is None:
                return None
            return list(target["frame_indexes"]), extracted

        results = await asyncio.gather(
            *(
                extract_one(timestamp_key, target)
                for timestamp_key, target in grouped_targets.items()
            ),
            return_exceptions=True,
        )
        extracted_entries: list[tuple[int, Path]] = []
        for result in results:
            if not isinstance(result, tuple):
                continue
            frame_indexes, extracted_path = result
            extracted_entries.extend(
                (int(frame_index), extracted_path) for frame_index in frame_indexes
            )
        if not extracted_entries:
            return {}
        return await self._upload_frame_entries(
            video_key=video_key,
            frame_entries=extracted_entries,
        )

    def _frame_storage_key(self, payload: Mapping[str, Any]) -> str:
        for candidate in (
            payload.get("id"),
            payload.get("source_video_id"),
        ):
            value = str(candidate or "").strip()
            if value:
                return value
        return "unknown-video"

    def _first_existing_frame_path(self, frame_paths: Sequence[object]) -> Path | None:
        for raw_path in frame_paths:
            candidate = Path(str(raw_path).strip())
            if candidate.exists():
                return candidate
        return None

    def _resolve_existing_video_path(self, video_path: str | Path | None) -> Path | None:
        if video_path is None:
            return None
        candidate = Path(str(video_path).strip())
        if candidate.exists():
            return candidate
        return None

    def _coerce_timestamp_seconds(self, value: Any) -> float | None:
        if value is None:
            return None
        try:
            return max(0.0, float(value))
        except (TypeError, ValueError):
            return None

    async def _capture_video_frame(
        self,
        *,
        video_path: Path,
        timestamp_seconds: float,
        output_path: Path,
    ) -> Path | None:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            proc = await asyncio.create_subprocess_exec(
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
        except FileNotFoundError:
            return None

        try:
            await asyncio.wait_for(
                proc.communicate(),
                timeout=DEFAULT_KEYFRAME_CAPTURE_TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError:
            proc.kill()
            await proc.communicate()
            return None

        if proc.returncode != 0 or not output_path.exists():
            return None
        return output_path

    async def _embed_units(
        self,
        units: Sequence[Mapping[str, Any]],
    ) -> list[dict[str, Any]]:
        embedded_units: list[dict[str, Any]] = []
        for unit in units:
            payload = dict(unit)
            if payload.get("embedding") is None:
                payload["embedding"] = list(
                    await asyncio.to_thread(
                        self._embedding_backend.embed_text,
                        str(payload["content_text"]),
                    )
                )
            embedded_units.append(payload)
        return embedded_units

    async def _embed_visual_unit(
        self,
        *,
        content_text: str,
        frame_paths: Sequence[str],
    ) -> list[float]:
        embed_multimodal = getattr(self._embedding_backend, "embed_multimodal", None)
        if frame_paths and callable(embed_multimodal):
            return list(
                await asyncio.to_thread(
                    embed_multimodal,
                    content_text,
                    image_paths=list(frame_paths)[:2],
                )
            )
        return list(await asyncio.to_thread(self._embedding_backend.embed_text, content_text))

    async def _resolve_visual_unit_embedding(
        self,
        *,
        segment: Mapping[str, Any],
        content_text: str,
        frame_paths: Sequence[str],
    ) -> list[float]:
        existing_embedding = segment.get("embedding")
        if existing_embedding is not None:
            return list(existing_embedding)
        return await self._embed_visual_unit(
            content_text=content_text,
            frame_paths=frame_paths,
        )

    async def _persist_units(
        self,
        *,
        video: Mapping[str, Any],
        owner_id: str | None,
        units: Sequence[Mapping[str, Any]],
        job_id: str | None,
    ) -> tuple[dict[str, Any], list[dict[str, Any]]]:
        if job_id is not None and not await self._repository.job_exists(job_id):
            return dict(video), []
        stored_video = await self._repository.upsert_video(video)
        if job_id is not None and not await self._repository.job_exists(job_id):
            return stored_video, []
        await self._repository.ensure_video_access(str(stored_video["id"]), owner_id)
        if job_id is not None and not await self._repository.job_exists(job_id):
            return stored_video, []
        stored_units = await self._repository.replace_units(
            video_id=str(stored_video["id"]),
            units=units,
        )
        await self._repository.mark_job_completed(
            job_id,
            {
                "video_id": stored_video["id"],
                "units_created": len(stored_units),
            },
        )
        return stored_video, stored_units

    async def _build_summary_text(
        self,
        stored_video: Mapping[str, Any],
        stored_segments: Sequence[Mapping[str, Any]],
    ) -> tuple[str, str]:
        transcript = " ".join(
            str(segment.get("transcript_text") or "").strip()
            for segment in stored_segments[:4]
            if str(segment.get("transcript_text") or "").strip()
        ).strip()
        visual_descriptions = " ".join(
            str(segment.get("visual_description") or segment.get("visual_summary") or "").strip()
            for segment in stored_segments[:4]
            if str(segment.get("visual_description") or segment.get("visual_summary") or "").strip()
        ).strip()
        fallback_text = "\n".join(
            part
            for part in [
                str(stored_video["title"]),
                str(stored_video.get("description") or "").strip() or None,
                summarize_text(transcript, max_words=32) if transcript else None,
                summarize_text(visual_descriptions, max_words=24)
                if visual_descriptions
                else None,
            ]
            if part
        )
        return await self._generate_summary_text(
            title=str(stored_video["title"]),
            description=str(stored_video.get("description") or "").strip(),
            source=str(stored_video.get("source") or "youtube"),
            duration_seconds=stored_video.get("duration_seconds"),
            transcript_excerpt=transcript,
            visual_excerpt=visual_descriptions,
            fallback_text=fallback_text,
        )

    def _build_visual_summary_fallback(
        self,
        *,
        video_metadata: Mapping[str, Any],
        descriptions: Sequence[str],
    ) -> str:
        parts = [
            str(video_metadata["title"]),
            str(video_metadata.get("description") or "").strip() or None,
            summarize_text(" ".join(descriptions), max_words=28) if descriptions else None,
        ]
        return "\n".join(part for part in parts if part)

    async def _generate_summary_text(
        self,
        *,
        title: str,
        description: str,
        source: str,
        duration_seconds: int | None,
        transcript_excerpt: str,
        visual_excerpt: str,
        fallback_text: str,
    ) -> tuple[str, str]:
        try:
            summary_text = await self._summary_generator.summarize(
                title=title,
                description=description,
                source=source,
                duration_seconds=(
                    int(duration_seconds) if duration_seconds is not None else None
                ),
                transcript_excerpt=transcript_excerpt,
                visual_excerpt=visual_excerpt,
            )
        except Exception:
            summary_text = None

        if summary_text:
            return summary_text, "gemini_flash"

        return fallback_text, "heuristic"

    def _validate_max_duration(self, duration_seconds: Any) -> None:
        if duration_seconds is None:
            return
        try:
            normalized_duration = int(duration_seconds)
        except (TypeError, ValueError):
            return
        if normalized_duration > MAX_INDEX_DURATION_SECONDS:
            raise ValueError("Videos longer than 4 hours are not supported.")

    async def _probe_duration_seconds(self, video_path: Path) -> int | None:
        try:
            proc = await asyncio.create_subprocess_exec(
                "ffprobe",
                "-v",
                "quiet",
                "-show_entries",
                "format=duration",
                "-of",
                "csv=p=0",
                str(video_path),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL,
            )
            stdout, _ = await proc.communicate()
        except FileNotFoundError:
            return None

        try:
            return int(round(float((stdout or b"0").decode().strip() or 0.0)))
        except ValueError:
            return None
