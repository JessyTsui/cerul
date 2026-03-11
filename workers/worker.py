from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import signal
import socket
from collections.abc import Mapping
from typing import Any

import asyncpg

from workers.broll import BrollIndexingPipeline
from workers.common.pipeline import PipelineContext
from workers.knowledge import AsyncpgKnowledgeRepository, KnowledgeIndexingPipeline

LOGGER = logging.getLogger(__name__)


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
    locked_by = NULL,
    locked_at = NULL,
    updated_at = NOW()
WHERE id = $1::uuid
"""

RETRY_JOB_SQL = """
UPDATE processing_jobs
SET
    status = 'retrying',
    error_message = $2,
    completed_at = NULL,
    next_retry_at = NOW() + ($3 * INTERVAL '1 second'),
    locked_by = NULL,
    locked_at = NULL,
    updated_at = NOW()
WHERE id = $1::uuid
"""

FAIL_JOB_SQL = """
UPDATE processing_jobs
SET
    status = 'failed',
    error_message = $2,
    completed_at = NULL,
    next_retry_at = NULL,
    locked_by = NULL,
    locked_at = NULL,
    updated_at = NOW()
WHERE id = $1::uuid
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
    NOW(),
    NOW(),
    NOW()
)
ON CONFLICT (job_id, step_name) DO UPDATE
SET
    status = EXCLUDED.status,
    artifacts = EXCLUDED.artifacts,
    error_message = EXCLUDED.error_message,
    completed_at = NOW(),
    updated_at = NOW()
"""


class JobWorker:
    base_backoff_seconds = 30
    max_backoff_seconds = 3600

    def __init__(
        self,
        worker_id: str,
        db_url: str,
        poll_interval: float = 5,
    ) -> None:
        self.worker_id = worker_id
        self.db_url = db_url
        self.poll_interval = poll_interval
        self._shutdown_event = asyncio.Event()
        self._job_contexts: dict[str, PipelineContext] = {}
        self._signals_installed = False

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

                context = self._job_contexts.pop(job_id, None)
                if context is not None:
                    await self.record_step_progress(conn, job_id, context)
        finally:
            await self.release_locked_jobs(conn)
            await conn.close()

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
        conf = self._optional_mapping(payload.get("conf"))

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

    def _build_step_artifacts(
        self,
        step_name: str,
        context: PipelineContext,
    ) -> dict[str, Any]:
        data = context.data

        if step_name == "DiscoverAssetStep":
            return {
                "discovered_assets_count": data.get("discovered_assets_count", 0),
                "discovery_warning_count": len(data.get("discovery_warnings", [])),
            }
        if step_name == "FetchAssetMetadataStep":
            return {
                "new_assets_count": data.get("new_assets_count", 0),
                "skipped_existing_count": data.get("skipped_existing_count", 0),
                "duplicate_asset_count": data.get("duplicate_asset_count", 0),
                "metadata_error_count": len(data.get("metadata_errors", {})),
            }
        if step_name == "DownloadPreviewFrameStep":
            return {
                "frame_count": len(data.get("frame_paths", {})),
                "frame_download_error_count": len(
                    data.get("frame_download_errors", {})
                ),
                "temp_dir": data.get("temp_dir"),
            }
        if step_name == "GenerateEmbeddingStep":
            return {
                "embedding_count": len(data.get("embeddings", {})),
                "embedding_dimension": data.get("embedding_dimension"),
                "embedding_error_count": len(data.get("embedding_errors", {})),
            }
        if step_name == "PersistBrollAssetStep":
            return {
                "indexed_assets_count": data.get("indexed_assets_count", 0),
                "persisted_asset_count": len(data.get("persisted_assets", [])),
            }
        if step_name == "MarkJobCompletedStep":
            return {
                "job_status": data.get("job_status"),
                "job_artifacts": data.get("job_artifacts", {}),
            }
        if step_name == "FetchKnowledgeMetadataStep":
            video_metadata = data.get("video_metadata", {})
            return {
                "source_video_id": data.get("source_video_id"),
                "title": video_metadata.get("title"),
                "source": video_metadata.get("source"),
            }
        if step_name == "DownloadKnowledgeVideoStep":
            return {
                "video_path": data.get("video_path"),
                "temp_dir": data.get("temp_dir"),
            }
        if step_name == "TranscribeKnowledgeVideoStep":
            return {
                "transcript_segment_count": data.get("transcript_segment_count", 0),
                "transcript_word_count": data.get("transcript_word_count", 0),
            }
        if step_name == "DetectKnowledgeScenesStep":
            return {
                "scene_count": data.get("scene_count", 0),
            }
        if step_name == "AnalyzeKnowledgeFramesStep":
            return {
                "scene_analysis_count": len(data.get("scene_analyses", [])),
            }
        if step_name == "SegmentKnowledgeTranscriptStep":
            return {
                "segment_count": data.get("segment_count", 0),
            }
        if step_name == "EmbedKnowledgeSegmentsStep":
            return {
                "embedding_count": len(data.get("segment_embeddings", {})),
                "embedding_dimension": data.get("embedding_dimension"),
                "embedding_error_count": len(data.get("embedding_errors", {})),
            }
        if step_name == "StoreKnowledgeSegmentsStep":
            return {
                "knowledge_video_id": data.get("knowledge_video_id"),
                "indexed_segment_count": data.get("indexed_segment_count", 0),
            }
        if step_name == "MarkKnowledgeJobCompletedStep":
            return {
                "job_status": data.get("job_status"),
                "job_artifacts": data.get("job_artifacts", {}),
            }

        return {}

    def _install_signal_handlers(self) -> None:
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


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the Cerul ingestion worker.")
    parser.add_argument("--db-url", default=os.getenv("DATABASE_URL", "").strip())
    parser.add_argument("--worker-id", default=build_default_worker_id())
    parser.add_argument("--poll-interval", type=float, default=5)
    return parser.parse_args()


async def main() -> None:
    args = parse_args()
    if not args.db_url:
        raise SystemExit("DATABASE_URL or --db-url is required.")

    logging.basicConfig(
        level=os.getenv("LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )

    worker = JobWorker(
        worker_id=args.worker_id,
        db_url=args.db_url,
        poll_interval=args.poll_interval,
    )
    await worker.run_loop()


if __name__ == "__main__":
    asyncio.run(main())
