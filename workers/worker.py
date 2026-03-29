from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import platform
import signal
import socket
from collections.abc import Mapping
from datetime import datetime, timezone
from typing import Any

import asyncpg

from workers.broll import BrollIndexingPipeline
from workers.common.pipeline import PipelineContext
from workers.knowledge import AsyncpgKnowledgeRepository, KnowledgeIndexingPipeline
from workers.unified import UnifiedIndexingPipeline

LOGGER = logging.getLogger(__name__)
MAX_STEP_LOG_ENTRIES = 25
DEFAULT_WORKER_CONCURRENCY = 6
WORKER_HEARTBEAT_INTERVAL_SECONDS = 30


CLAIM_JOB_SQL = """
UPDATE processing_jobs
SET
    status = 'running',
    locked_by = $1,
    locked_at = NOW(),
    attempts = attempts + 1,
    started_at = COALESCE(started_at, NOW()),
    updated_at = NOW()
WHERE id = (
    SELECT id
    FROM processing_jobs
    WHERE status IN ('pending', 'retrying')
      AND (next_retry_at IS NULL OR next_retry_at <= NOW())
    ORDER BY
        CASE WHEN status = 'retrying' THEN 0 ELSE 1 END,
        created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1
)
RETURNING *;
"""

COMPLETE_JOB_SQL = """
UPDATE processing_jobs
SET
    status = 'completed',
    error_message = NULL,
    completed_at = NOW(),
    next_retry_at = NULL,
    locked_at = NULL,
    updated_at = NOW()
WHERE id = $1::uuid
  AND COALESCE((input_payload->>'cancelled_by_user')::boolean, FALSE) = FALSE
"""

RETRY_JOB_SQL = """
UPDATE processing_jobs
SET
    status = 'retrying',
    error_message = $2,
    completed_at = NULL,
    next_retry_at = NOW() + ($3 * INTERVAL '1 second'),
    locked_at = NULL,
    updated_at = NOW()
WHERE id = $1::uuid
  AND COALESCE((input_payload->>'cancelled_by_user')::boolean, FALSE) = FALSE
"""

FAIL_JOB_SQL = """
UPDATE processing_jobs
SET
    status = 'failed',
    error_message = $2,
    completed_at = NULL,
    next_retry_at = NULL,
    locked_at = NULL,
    updated_at = NOW()
WHERE id = $1::uuid
  AND COALESCE((input_payload->>'cancelled_by_user')::boolean, FALSE) = FALSE
"""

RELEASE_LOCKED_JOBS_SQL = """
UPDATE processing_jobs
SET
    status = 'pending',
    locked_by = NULL,
    locked_at = NULL,
    updated_at = NOW()
WHERE locked_by = $1
  AND status = 'running'
"""

UPSERT_JOB_STEP_SQL = """
INSERT INTO processing_job_steps (
    job_id,
    step_name,
    status,
    artifacts,
    error_message,
    started_at,
    completed_at,
    updated_at
)
VALUES (
    $1::uuid,
    $2,
    $3,
    $4::jsonb,
    $5,
    CASE
        WHEN $3 = 'running' THEN NOW()
        ELSE NULL
    END,
    CASE
        WHEN $3 IN ('completed', 'failed', 'skipped') THEN NOW()
        ELSE NULL
    END,
    NOW()
)
ON CONFLICT (job_id, step_name) DO UPDATE
SET
    status = EXCLUDED.status,
    artifacts = EXCLUDED.artifacts,
    error_message = EXCLUDED.error_message,
    started_at = CASE
        WHEN EXCLUDED.status = 'running'
            THEN COALESCE(processing_job_steps.started_at, NOW())
        ELSE COALESCE(processing_job_steps.started_at, EXCLUDED.started_at)
    END,
    completed_at = CASE
        WHEN EXCLUDED.status IN ('completed', 'failed', 'skipped') THEN NOW()
        WHEN EXCLUDED.status = 'running' THEN NULL
        ELSE processing_job_steps.completed_at
    END,
    updated_at = NOW()
"""

TOUCH_JOB_SQL = """
UPDATE processing_jobs
SET updated_at = NOW()
WHERE id = $1::uuid
  AND COALESCE((input_payload->>'cancelled_by_user')::boolean, FALSE) = FALSE
"""

JOB_WRITABLE_SQL = """
SELECT TRUE
FROM processing_jobs
WHERE id = $1::uuid
  AND COALESCE((input_payload->>'cancelled_by_user')::boolean, FALSE) = FALSE
LIMIT 1
"""

REGISTER_WORKER_HEARTBEAT_SQL = """
INSERT INTO worker_heartbeats (
    worker_id,
    hostname,
    pid,
    slots,
    started_at,
    last_heartbeat,
    metadata
)
VALUES ($1, $2, $3, $4, NOW(), NOW(), $5::jsonb)
ON CONFLICT (worker_id) DO UPDATE
SET
    hostname = EXCLUDED.hostname,
    pid = EXCLUDED.pid,
    slots = EXCLUDED.slots,
    started_at = NOW(),
    last_heartbeat = NOW(),
    metadata = EXCLUDED.metadata
"""

UPDATE_WORKER_HEARTBEAT_SQL = """
UPDATE worker_heartbeats
SET last_heartbeat = NOW()
WHERE worker_id = $1
"""

MARK_WORKER_STOPPED_SQL = """
UPDATE worker_heartbeats
SET last_heartbeat = NOW() - INTERVAL '5 minutes 1 second'
WHERE worker_id = $1
"""


async def register_worker(
    pool: asyncpg.Pool,
    worker_id: str,
    hostname: str,
    pid: int,
    slots: int,
    metadata: Mapping[str, Any] | None = None,
) -> None:
    payload = json.dumps(dict(metadata or {}), default=str)
    async with pool.acquire() as conn:
        await conn.execute(
            REGISTER_WORKER_HEARTBEAT_SQL,
            worker_id,
            hostname,
            pid,
            max(int(slots), 1),
            payload,
        )


async def update_worker_heartbeat(pool: asyncpg.Pool, worker_id: str) -> None:
    async with pool.acquire() as conn:
        await conn.execute(UPDATE_WORKER_HEARTBEAT_SQL, worker_id)


async def mark_worker_stopped(pool: asyncpg.Pool, worker_id: str) -> None:
    async with pool.acquire() as conn:
        await conn.execute(MARK_WORKER_STOPPED_SQL, worker_id)


async def heartbeat_loop(
    pool: asyncpg.Pool,
    worker_id: str,
    shutdown_event: asyncio.Event,
    interval: float = WORKER_HEARTBEAT_INTERVAL_SECONDS,
) -> None:
    while not shutdown_event.is_set():
        try:
            await asyncio.wait_for(shutdown_event.wait(), timeout=interval)
            break
        except asyncio.TimeoutError:
            pass

        try:
            await update_worker_heartbeat(pool, worker_id)
        except Exception:
            LOGGER.warning(
                "Failed to update heartbeat for worker %s.",
                worker_id,
                exc_info=True,
            )


class JobWorker:
    base_backoff_seconds = 30
    max_backoff_seconds = 3600

    def __init__(
        self,
        worker_id: str,
        db_url: str,
        poll_interval: float = 5,
        shutdown_event: asyncio.Event | None = None,
        manage_signals: bool = True,
    ) -> None:
        self.worker_id = worker_id
        self.db_url = db_url
        self.poll_interval = poll_interval
        self._shutdown_event = shutdown_event or asyncio.Event()
        self._job_contexts: dict[str, PipelineContext] = {}
        self._live_event_pool: asyncpg.Pool | None = None
        self._signals_installed = False
        self._manage_signals = manage_signals

    async def claim_job(self, conn: asyncpg.Connection) -> dict[str, Any] | None:
        row = await conn.fetchrow(CLAIM_JOB_SQL, self.worker_id)
        if row is None:
            return None
        return dict(row)

    async def execute_job(
        self,
        conn: asyncpg.Connection,
        job: Mapping[str, Any],
    ) -> None:
        job_id = str(job["id"])

        try:
            context = await self._run_pipeline_for_job(job)
            context.data.setdefault("job_id", job_id)
            context.data.setdefault("track", str(job["track"]))
            self._job_contexts[job_id] = context

            if context.failed_step is not None:
                error_message = context.error or f"Step {context.failed_step} failed."
                await self.handle_failure(conn, job, RuntimeError(error_message))
                return

            await conn.execute(COMPLETE_JOB_SQL, job_id)
        except Exception as exc:
            LOGGER.exception("Job %s failed during execution.", job_id)
            await self.handle_failure(conn, job, exc)

    async def handle_failure(
        self,
        conn: asyncpg.Connection,
        job: Mapping[str, Any],
        error: Exception,
    ) -> None:
        job_id = str(job["id"])
        attempts = int(job.get("attempts", 0))
        max_attempts = int(job.get("max_attempts", 3))
        error_message = str(error)
        context = self._job_contexts.get(job_id)

        if not await self._job_is_writable(conn, job_id):
            return

        if attempts < max_attempts:
            delay_seconds = self.compute_retry_delay(attempts)
            await conn.execute(RETRY_JOB_SQL, job_id, error_message, delay_seconds)
        else:
            await conn.execute(FAIL_JOB_SQL, job_id, error_message)

        if context is not None and context.failed_step is not None:
            artifacts = self._build_step_artifacts(context.failed_step, context)
            artifacts["error"] = context.error or error_message
            await self._upsert_job_step(
                conn=conn,
                job_id=job_id,
                step_name=context.failed_step,
                status="failed",
                artifacts=artifacts,
                error_message=context.error or error_message,
            )

    async def record_step_progress(
        self,
        conn: asyncpg.Connection,
        job_id: str,
        context: PipelineContext,
    ) -> None:
        if not await self._job_is_writable(conn, job_id):
            return

        seen_steps: set[str] = set()

        for step_name in context.completed_steps:
            if step_name in seen_steps:
                continue
            seen_steps.add(step_name)
            await self._upsert_job_step(
                conn=conn,
                job_id=job_id,
                step_name=step_name,
                status="completed",
                artifacts=self._build_step_artifacts(step_name, context),
                error_message=None,
            )

        for step_name in context.skipped_steps:
            if step_name in seen_steps:
                continue
            seen_steps.add(step_name)
            await self._upsert_job_step(
                conn=conn,
                job_id=job_id,
                step_name=step_name,
                status="skipped",
                artifacts={},
                error_message=None,
            )

        if context.failed_step is not None and context.failed_step not in seen_steps:
            artifacts = self._build_step_artifacts(context.failed_step, context)
            artifacts["error"] = context.error
            await self._upsert_job_step(
                conn=conn,
                job_id=job_id,
                step_name=context.failed_step,
                status="failed",
                artifacts=artifacts,
                error_message=context.error,
            )

    async def run_loop(self) -> None:
        self._install_signal_handlers()
        conn = await asyncpg.connect(self.db_url)

        try:
            await self.release_locked_jobs(conn)
            while not self._shutdown_event.is_set():
                conn = await self._ensure_connection(conn)
                job = await self.claim_job(conn)
                if job is None:
                    try:
                        await asyncio.wait_for(
                            self._shutdown_event.wait(),
                            timeout=self.poll_interval,
                        )
                    except asyncio.TimeoutError:
                        continue
                    continue

                job_id = str(job["id"])
                await self.execute_job(conn, job)

                conn = await self._ensure_connection(conn)
                context = self._job_contexts.pop(job_id, None)
                if context is not None:
                    await self.record_step_progress(conn, job_id, context)
        finally:
            await self.release_locked_jobs(conn)
            await conn.close()
            await self._close_live_event_pool()

    async def _ensure_connection(self, conn: asyncpg.Connection) -> asyncpg.Connection:
        """Reconnect if the existing connection has gone stale."""
        try:
            await conn.execute("SELECT 1")
            return conn
        except Exception:
            LOGGER.warning("Database connection lost, reconnecting.")
            try:
                await conn.close()
            except Exception:
                pass
            return await asyncpg.connect(self.db_url)

    async def release_locked_jobs(self, conn: asyncpg.Connection) -> None:
        await conn.execute(RELEASE_LOCKED_JOBS_SQL, self.worker_id)

    def compute_retry_delay(self, attempts: int) -> int:
        normalized_attempts = max(int(attempts), 1)
        delay_seconds = self.base_backoff_seconds * (2 ** (normalized_attempts - 1))
        return min(delay_seconds, self.max_backoff_seconds)

    async def _run_pipeline_for_job(
        self,
        job: Mapping[str, Any],
    ) -> PipelineContext:
        job_id = str(job["id"])
        track = str(job["track"])
        payload = self._require_mapping(job.get("input_payload"), "input_payload")
        conf = self._with_progress_callback(
            job_id=job_id,
            conf=self._optional_mapping(payload.get("conf")),
        )

        if track == "broll":
            pipeline = BrollIndexingPipeline()
            raw_query = payload.get("query") or payload.get("category")
            query = str(raw_query or "").strip()
            category = payload.get("category")
            return await pipeline.run(
                query=query,
                category=str(category) if category is not None else None,
                job_id=job_id,
                conf=conf,
            )

        if track == "knowledge":
            pipeline = KnowledgeIndexingPipeline(
                repository=AsyncpgKnowledgeRepository(self.db_url)
            )
            raw_video_id = payload.get("video_id") or payload.get("source_video_id")
            video_id = str(raw_video_id or "").strip()
            source_metadata = self._optional_mapping(payload.get("source_metadata"))
            return await pipeline.run(
                video_id=video_id,
                job_id=job_id,
                source_metadata=source_metadata,
                conf=conf,
            )

        if track == "unified":
            pipeline = UnifiedIndexingPipeline(db_url=self.db_url)
            raw_url = payload.get("url")
            url = str(raw_url or "").strip()
            if not url:
                raise ValueError("Unified jobs require input_payload.url.")

            raw_source = payload.get("source")
            source = str(raw_source or "").strip().lower()
            if not source:
                raise ValueError("Unified jobs require input_payload.source.")

            raw_source_video_id = (
                payload.get("source_video_id") or payload.get("source_item_id")
            )
            source_video_id = str(raw_source_video_id or "").strip()
            if not source_video_id:
                raise ValueError(
                    "Unified jobs require input_payload.source_video_id."
                )

            raw_owner_id = payload.get("owner_id")
            owner_id = str(raw_owner_id).strip() if raw_owner_id is not None else None
            raw_video_id = payload.get("video_id")
            video_id = str(raw_video_id).strip() if raw_video_id is not None else None

            return await pipeline.run(
                url=url,
                source=source,
                source_video_id=source_video_id,
                owner_id=owner_id or None,
                video_id=video_id or None,
                job_id=job_id,
                conf=conf,
            )

        raise ValueError(f"Unsupported job track: {track}")

    async def _upsert_job_step(
        self,
        conn: asyncpg.Connection,
        job_id: str,
        step_name: str,
        status: str,
        artifacts: Mapping[str, Any],
        error_message: str | None,
    ) -> None:
        await conn.execute(
            UPSERT_JOB_STEP_SQL,
            job_id,
            step_name,
            status,
            json.dumps(dict(artifacts), default=str),
            error_message,
        )

    def _with_progress_callback(
        self,
        *,
        job_id: str,
        conf: Mapping[str, Any] | None,
    ) -> dict[str, Any]:
        runtime_conf = dict(conf or {})

        async def progress_callback(
            step_name: str,
            status: str,
            context: PipelineContext,
        ) -> None:
            await self._record_live_step_event(
                job_id=job_id,
                step_name=step_name,
                status=status,
                context=context,
            )

        async def step_log_callback(
            step_name: str,
            level: str,
            message: str,
            details: Mapping[str, Any],
            context: PipelineContext,
        ) -> None:
            self._append_step_log(
                context=context,
                step_name=step_name,
                level=level,
                message=message,
                details=details,
            )
            await self._record_live_step_event(
                job_id=job_id,
                step_name=step_name,
                status=self._derive_step_status(step_name, context),
                context=context,
            )

        runtime_conf["progress_callback"] = progress_callback
        runtime_conf["step_log_callback"] = step_log_callback
        return runtime_conf

    async def _record_live_step_event(
        self,
        *,
        job_id: str,
        step_name: str,
        status: str,
        context: PipelineContext,
    ) -> None:
        pool = await self._get_live_event_pool()
        async with pool.acquire() as conn:
            if not await self._job_is_writable(conn, job_id):
                return
            await self._upsert_job_step(
                conn=conn,
                job_id=job_id,
                step_name=step_name,
                status=status,
                artifacts=self._build_step_artifacts(step_name, context),
                error_message=context.error if status == "failed" else None,
            )
            await conn.execute(TOUCH_JOB_SQL, job_id)

    async def _get_live_event_pool(self) -> asyncpg.Pool:
        if self._live_event_pool is None:
            self._live_event_pool = await asyncpg.create_pool(
                self.db_url,
                min_size=1,
                max_size=4,
            )
        return self._live_event_pool

    async def _close_live_event_pool(self) -> None:
        if self._live_event_pool is None:
            return
        await self._live_event_pool.close()
        self._live_event_pool = None

    async def _job_is_writable(
        self,
        conn: asyncpg.Connection,
        job_id: str,
    ) -> bool:
        row = await conn.fetchval(JOB_WRITABLE_SQL, job_id)
        return bool(row)

    def _append_step_log(
        self,
        *,
        context: PipelineContext,
        step_name: str,
        level: str,
        message: str,
        details: Mapping[str, Any] | None,
    ) -> None:
        logs_by_step = context.data.setdefault("step_logs", {})
        existing_logs = list(logs_by_step.get(step_name) or [])
        entry: dict[str, Any] = {
            "at": datetime.now(timezone.utc).isoformat(),
            "level": str(level).strip() or "info",
            "message": str(message).strip(),
        }
        normalized_details = {
            str(key): value
            for key, value in dict(details or {}).items()
            if value is not None and value != ""
        }
        if normalized_details:
            entry["details"] = normalized_details

        existing_logs.append(entry)
        logs_by_step[step_name] = existing_logs[-MAX_STEP_LOG_ENTRIES:]

    def _derive_step_status(
        self,
        step_name: str,
        context: PipelineContext,
    ) -> str:
        if context.failed_step == step_name:
            return "failed"
        if step_name in context.completed_steps:
            return "completed"
        if step_name in context.skipped_steps:
            return "skipped"
        return "running"

    def _build_step_artifacts(
        self,
        step_name: str,
        context: PipelineContext,
    ) -> dict[str, Any]:
        data = context.data

        if step_name == "DiscoverAssetStep":
            return self._with_step_meta(
                context,
                step_name,
                {
                    "discovered_assets_count": data.get("discovered_assets_count", 0),
                    "discovery_warning_count": len(data.get("discovery_warnings", [])),
                },
            )
        if step_name == "FetchAssetMetadataStep":
            return self._with_step_meta(
                context,
                step_name,
                {
                    "new_assets_count": data.get("new_assets_count", 0),
                    "skipped_existing_count": data.get("skipped_existing_count", 0),
                    "duplicate_asset_count": data.get("duplicate_asset_count", 0),
                    "metadata_error_count": len(data.get("metadata_errors", {})),
                },
            )
        if step_name == "DownloadPreviewFrameStep":
            return self._with_step_meta(
                context,
                step_name,
                {
                    "frame_count": len(data.get("frame_paths", {})),
                    "frame_download_error_count": len(
                        data.get("frame_download_errors", {})
                    ),
                    "temp_dir": data.get("temp_dir"),
                },
            )
        if step_name == "GenerateEmbeddingStep":
            return self._with_step_meta(
                context,
                step_name,
                {
                    "embedding_count": len(data.get("embeddings", {})),
                    "embedding_dimension": data.get("embedding_dimension"),
                    "embedding_error_count": len(data.get("embedding_errors", {})),
                },
            )
        if step_name == "PersistBrollAssetStep":
            return self._with_step_meta(
                context,
                step_name,
                {
                    "indexed_assets_count": data.get("indexed_assets_count", 0),
                    "persisted_asset_count": len(data.get("persisted_assets", [])),
                },
            )
        if step_name == "MarkJobCompletedStep":
            return self._with_step_meta(
                context,
                step_name,
                {
                    "job_status": data.get("job_status"),
                    "job_artifacts": data.get("job_artifacts", {}),
                },
            )
        if step_name == "FetchKnowledgeMetadataStep":
            video_metadata = data.get("video_metadata", {})
            return self._with_step_meta(
                context,
                step_name,
                {
                    "source_video_id": data.get("source_video_id"),
                    "title": video_metadata.get("title"),
                    "source": video_metadata.get("source"),
                },
            )
        if step_name == "DownloadKnowledgeVideoStep":
            return self._with_step_meta(
                context,
                step_name,
                {
                    "video_path": data.get("video_path"),
                    "temp_dir": data.get("temp_dir"),
                },
            )
        if step_name == "TranscribeKnowledgeVideoStep":
            return self._with_step_meta(
                context,
                step_name,
                {
                    "transcript_segment_count": data.get("transcript_segment_count", 0),
                    "transcript_word_count": data.get("transcript_word_count", 0),
                    "transcript_source": data.get("transcript_source"),
                },
            )
        if step_name == "DetectKnowledgeScenesStep":
            return self._with_step_meta(
                context,
                step_name,
                {
                    "scene_count": data.get("scene_count", 0),
                },
            )
        if step_name == "AnalyzeKnowledgeFramesStep":
            return self._with_step_meta(
                context,
                step_name,
                {
                    "scene_analysis_count": len(data.get("scene_analyses", [])),
                    "scene_total": data.get("frame_analysis_scene_total", 0),
                    "current_scene_index": data.get("frame_analysis_current_scene_index"),
                    "current_scene_position": data.get("frame_analysis_current_scene_position"),
                    "current_route": data.get("frame_analysis_current_route"),
                    "candidate_frame_count": data.get("frame_analysis_candidate_frame_count"),
                    "unique_frame_count": data.get("frame_analysis_unique_frame_count"),
                    "selected_frame_count": data.get("frame_analysis_selected_frame_count"),
                    "annotation_frame_count": data.get("frame_analysis_annotation_frame_count", 0),
                    "extraction_cache_hit_count": data.get(
                        "frame_analysis_extraction_cache_hit_count",
                        0,
                    ),
                    "annotation_cache_hit_count": data.get(
                        "frame_analysis_annotation_cache_hit_count",
                        0,
                    ),
                    "extraction_time_ms": data.get("frame_analysis_extraction_time_ms", 0),
                    "dedup_time_ms": data.get("frame_analysis_dedup_time_ms", 0),
                    "filter_time_ms": data.get("frame_analysis_filter_time_ms", 0),
                    "ocr_time_ms": data.get("frame_analysis_ocr_time_ms", 0),
                    "prepare_time_ms": data.get("frame_analysis_prepare_time_ms", 0),
                    "annotation_time_ms": data.get("frame_analysis_annotation_time_ms", 0),
                    "total_candidate_frame_count": data.get(
                        "frame_analysis_total_candidate_frame_count",
                        0,
                    ),
                    "total_unique_frame_count": data.get(
                        "frame_analysis_total_unique_frame_count",
                        0,
                    ),
                    "total_selected_frame_count": data.get(
                        "frame_analysis_total_selected_frame_count",
                        0,
                    ),
                    "total_annotation_frame_count": data.get(
                        "frame_analysis_total_annotation_frame_count",
                        0,
                    ),
                    "total_extraction_cache_hit_count": data.get(
                        "frame_analysis_total_extraction_cache_hit_count",
                        0,
                    ),
                    "total_annotation_cache_hit_count": data.get(
                        "frame_analysis_total_annotation_cache_hit_count",
                        0,
                    ),
                    "total_extraction_time_ms": data.get(
                        "frame_analysis_total_extraction_time_ms",
                        0,
                    ),
                    "total_dedup_time_ms": data.get(
                        "frame_analysis_total_dedup_time_ms",
                        0,
                    ),
                    "total_filter_time_ms": data.get(
                        "frame_analysis_total_filter_time_ms",
                        0,
                    ),
                    "total_ocr_time_ms": data.get(
                        "frame_analysis_total_ocr_time_ms",
                        0,
                    ),
                    "total_prepare_time_ms": data.get(
                        "frame_analysis_total_prepare_time_ms",
                        0,
                    ),
                    "total_annotation_time_ms": data.get(
                        "frame_analysis_total_annotation_time_ms",
                        0,
                    ),
                    "route_counts": data.get("frame_analysis_route_counts", {}),
                    "annotation_timeout_count": data.get("frame_analysis_annotation_timeout_count", 0),
                    "annotation_error_count": data.get("frame_analysis_annotation_error_count", 0),
                },
            )
        if step_name == "SegmentKnowledgeTranscriptStep":
            return self._with_step_meta(
                context,
                step_name,
                {
                    "segment_count": data.get("segment_count", 0),
                },
            )
        if step_name == "EmbedKnowledgeSegmentsStep":
            return self._with_step_meta(
                context,
                step_name,
                {
                    "embedding_count": len(data.get("segment_embeddings", {})),
                    "embedding_dimension": data.get("embedding_dimension"),
                    "embedding_error_count": len(data.get("embedding_errors", {})),
                },
            )
        if step_name == "StoreKnowledgeSegmentsStep":
            return self._with_step_meta(
                context,
                step_name,
                {
                    "knowledge_video_id": data.get("knowledge_video_id"),
                    "indexed_segment_count": data.get("indexed_segment_count", 0),
                },
            )
        if step_name == "MarkKnowledgeJobCompletedStep":
            return self._with_step_meta(
                context,
                step_name,
                {
                    "job_status": data.get("job_status"),
                    "job_artifacts": data.get("job_artifacts", {}),
                },
            )
        if step_name == "FetchUnifiedMetadataStep":
            video_metadata = data.get("video_metadata", {})
            return self._with_step_meta(
                context,
                step_name,
                {
                    "source_video_id": data.get("source_video_id"),
                    "title": video_metadata.get("title"),
                    "source": video_metadata.get("source"),
                    "duration_seconds": video_metadata.get("duration_seconds"),
                },
            )
        if step_name == "BuildUnifiedRetrievalUnitsStep":
            units = list(
                data.get("units")
                or data.get("embedded_units")
                or data.get("stored_unified_units")
                or []
            )
            return self._with_step_meta(
                context,
                step_name,
                {
                    "unit_count": len(units),
                    "summary_count": sum(
                        1 for unit in units if unit.get("unit_type") == "summary"
                    ),
                    "speech_count": sum(
                        1 for unit in units if unit.get("unit_type") == "speech"
                    ),
                    "visual_count": sum(
                        1 for unit in units if unit.get("unit_type") == "visual"
                    ),
                },
            )
        if step_name == "EmbedUnifiedUnitsStep":
            embedded_units = list(data.get("embedded_units") or [])
            embedding_dimension = None
            if embedded_units:
                first_embedding = embedded_units[0].get("embedding") or []
                embedding_dimension = len(first_embedding)
            return self._with_step_meta(
                context,
                step_name,
                {
                    "embedding_count": len(embedded_units),
                    "embedding_dimension": embedding_dimension,
                },
            )
        if step_name == "PersistUnifiedUnitsStep":
            stored_video = data.get("stored_unified_video", {})
            stored_units = list(data.get("stored_unified_units") or [])
            return self._with_step_meta(
                context,
                step_name,
                {
                    "video_id": stored_video.get("id"),
                    "indexed_unit_count": len(stored_units),
                },
            )
        if step_name == "MarkUnifiedJobCompletedStep":
            return self._with_step_meta(
                context,
                step_name,
                {
                    "job_status": data.get("job_status"),
                    "job_artifacts": data.get("job_artifacts", {}),
                },
            )

        return self._with_step_meta(context, step_name, {})

    def _with_step_meta(
        self,
        context: PipelineContext,
        step_name: str,
        artifacts: Mapping[str, Any],
    ) -> dict[str, Any]:
        enriched = {
            str(key): value
            for key, value in dict(artifacts).items()
            if value is not None
        }

        duration_map = context.data.get("step_duration_ms")
        if isinstance(duration_map, Mapping) and step_name in duration_map:
            enriched["duration_ms"] = duration_map[step_name]

        timeout_map = context.data.get("step_timeout_seconds")
        if isinstance(timeout_map, Mapping) and step_name in timeout_map:
            enriched["timeout_seconds"] = timeout_map[step_name]

        guidance_map = context.data.get("step_guidance")
        if isinstance(guidance_map, Mapping) and step_name in guidance_map:
            enriched["guidance"] = guidance_map[step_name]

        logs_by_step = context.data.get("step_logs")
        if isinstance(logs_by_step, Mapping):
            logs = logs_by_step.get(step_name)
            if isinstance(logs, list) and logs:
                enriched["logs"] = logs

        return enriched

    def _install_signal_handlers(self) -> None:
        if not self._manage_signals:
            return
        if self._signals_installed:
            return

        loop = asyncio.get_running_loop()

        for current_signal in (signal.SIGINT, signal.SIGTERM):
            try:
                loop.add_signal_handler(current_signal, self._shutdown_event.set)
            except NotImplementedError:
                LOGGER.debug("Signal handlers are not supported on this platform.")
                break

        self._signals_installed = True

    def _require_mapping(
        self,
        payload: Any,
        field_name: str,
    ) -> dict[str, Any]:
        if payload is None:
            return {}
        if isinstance(payload, Mapping):
            return dict(payload)
        if isinstance(payload, str):
            decoded = json.loads(payload)
            if isinstance(decoded, Mapping):
                return dict(decoded)
        raise ValueError(f"{field_name} must be a JSON object.")

    def _optional_mapping(self, payload: Any) -> dict[str, Any] | None:
        if payload is None:
            return None
        return self._require_mapping(payload, "payload")


def build_default_worker_id() -> str:
    return f"{socket.gethostname()}-{os.getpid()}"


def build_worker_ids(base_worker_id: str, concurrency: int) -> list[str]:
    normalized_concurrency = max(int(concurrency), 1)
    if normalized_concurrency == 1:
        return [base_worker_id]

    return [
        f"{base_worker_id}-slot-{index + 1}"
        for index in range(normalized_concurrency)
    ]


def _default_worker_concurrency() -> int:
    raw_value = os.getenv("WORKER_CONCURRENCY", "").strip()
    if not raw_value:
        return DEFAULT_WORKER_CONCURRENCY

    try:
        parsed_value = int(raw_value)
    except ValueError:
        LOGGER.warning(
            "Invalid WORKER_CONCURRENCY=%r; falling back to %d.",
            raw_value,
            DEFAULT_WORKER_CONCURRENCY,
        )
        return DEFAULT_WORKER_CONCURRENCY

    return max(parsed_value, 1)


def _parse_worker_concurrency(value: str) -> int:
    try:
        parsed_value = int(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("concurrency must be an integer") from exc

    if parsed_value < 1:
        raise argparse.ArgumentTypeError("concurrency must be >= 1")

    return parsed_value


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the Cerul indexing worker.")
    parser.add_argument("--db-url", default=os.getenv("DATABASE_URL", "").strip())
    parser.add_argument("--worker-id", default=build_default_worker_id())
    parser.add_argument("--poll-interval", type=float, default=5)
    parser.add_argument(
        "--concurrency",
        type=_parse_worker_concurrency,
        default=_default_worker_concurrency(),
    )
    return parser.parse_args()


async def main() -> None:
    args = parse_args()
    if not args.db_url:
        raise SystemExit("DATABASE_URL or --db-url is required.")

    logging.basicConfig(
        level=os.getenv("LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )

    shutdown_event = asyncio.Event()
    heartbeat_pool = await asyncpg.create_pool(
        args.db_url,
        min_size=1,
        max_size=2,
    )
    worker_ids = build_worker_ids(args.worker_id, args.concurrency)
    heartbeat_metadata = {
        "python_version": platform.python_version(),
        "platform": platform.platform(),
        "concurrency": len(worker_ids),
    }
    LOGGER.info(
        "Starting %d worker slot(s): %s",
        len(worker_ids),
        ", ".join(worker_ids),
    )
    await register_worker(
        heartbeat_pool,
        worker_id=args.worker_id,
        hostname=socket.gethostname(),
        pid=os.getpid(),
        slots=len(worker_ids),
        metadata=heartbeat_metadata,
    )
    heartbeat_task = asyncio.create_task(
        heartbeat_loop(
            heartbeat_pool,
            worker_id=args.worker_id,
            shutdown_event=shutdown_event,
        )
    )

    try:
        await asyncio.gather(
            *[
                JobWorker(
                    worker_id=worker_id,
                    db_url=args.db_url,
                    poll_interval=args.poll_interval,
                    shutdown_event=shutdown_event,
                    manage_signals=index == 0,
                ).run_loop()
                for index, worker_id in enumerate(worker_ids)
            ]
        )
    finally:
        shutdown_event.set()
        heartbeat_task.cancel()
        try:
            await heartbeat_task
        except asyncio.CancelledError:
            pass

        try:
            await mark_worker_stopped(heartbeat_pool, args.worker_id)
        finally:
            await heartbeat_pool.close()


if __name__ == "__main__":
    asyncio.run(main())
