import asyncio
import json
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, Mock, patch

from workers.common.pipeline import PipelineContext
from workers.worker import JobWorker, build_worker_ids


def run_async(coro):
    return asyncio.run(coro)


class ClaimConnection:
    def __init__(
        self,
        jobs: list[dict[str, object]],
        *,
        locked_job_ids: set[str] | None = None,
    ) -> None:
        self.jobs = jobs
        self.locked_job_ids = locked_job_ids or set()
        self.fetchrow_calls: list[tuple[str, tuple[object, ...]]] = []

    async def fetchrow(self, query: str, *params: object) -> dict[str, object] | None:
        normalized = " ".join(query.split())
        self.fetchrow_calls.append((normalized, params))

        worker_id = str(params[0])
        now = datetime.now(timezone.utc)

        candidates = [
            job
            for job in self.jobs
            if str(job["id"]) not in self.locked_job_ids
            and str(job["status"]) in {"pending", "retrying"}
            and (
                job.get("next_retry_at") is None
                or job["next_retry_at"] <= now
            )
        ]
        candidates.sort(
            key=lambda job: (
                0 if job["status"] == "retrying" else 1,
                job["created_at"],
            )
        )

        if not candidates:
            return None

        chosen = candidates[0]
        chosen["status"] = "running"
        chosen["locked_by"] = worker_id
        chosen["locked_at"] = now
        chosen["attempts"] = int(chosen.get("attempts", 0)) + 1
        chosen["started_at"] = chosen.get("started_at") or now
        return dict(chosen)


class RecordingConnection:
    def __init__(self) -> None:
        self.execute_calls: list[tuple[str, tuple[object, ...]]] = []
        self.closed = False

    async def execute(self, query: str, *params: object) -> str:
        normalized = " ".join(query.split())
        self.execute_calls.append((normalized, params))
        return "OK"

    async def close(self) -> None:
        self.closed = True


def build_job(
    job_id: str,
    *,
    track: str = "broll",
    status: str,
    attempts: int = 0,
    max_attempts: int = 3,
    created_at: datetime | None = None,
    next_retry_at: datetime | None = None,
    input_payload: dict[str, object] | None = None,
) -> dict[str, object]:
    return {
        "id": job_id,
        "track": track,
        "status": status,
        "attempts": attempts,
        "max_attempts": max_attempts,
        "created_at": created_at or datetime.now(timezone.utc),
        "started_at": None,
        "next_retry_at": next_retry_at,
        "input_payload": input_payload or {"query": "city skyline"},
    }


def test_claim_job_picks_pending_job_and_sets_status_to_running() -> None:
    worker = JobWorker("worker-a", "postgresql://example")
    conn = ClaimConnection([build_job("job-1", status="pending", attempts=0)])

    job = run_async(worker.claim_job(conn))

    assert job is not None
    assert job["id"] == "job-1"
    assert job["status"] == "running"
    assert job["locked_by"] == "worker-a"
    assert job["attempts"] == 1
    assert "FOR UPDATE SKIP LOCKED" in conn.fetchrow_calls[0][0]


def test_build_worker_ids_returns_base_id_for_single_slot() -> None:
    assert build_worker_ids("worker-a", 1) == ["worker-a"]


def test_build_worker_ids_suffixes_ids_for_multiple_slots() -> None:
    assert build_worker_ids("worker-a", 3) == [
        "worker-a-slot-1",
        "worker-a-slot-2",
        "worker-a-slot-3",
    ]


def test_claim_job_skips_locked_jobs() -> None:
    worker = JobWorker("worker-a", "postgresql://example")
    now = datetime.now(timezone.utc)
    conn = ClaimConnection(
        [
            build_job("job-1", status="pending", created_at=now),
            build_job("job-2", status="pending", created_at=now + timedelta(seconds=1)),
        ],
        locked_job_ids={"job-1"},
    )

    job = run_async(worker.claim_job(conn))

    assert job is not None
    assert job["id"] == "job-2"
    assert "FOR UPDATE SKIP LOCKED" in conn.fetchrow_calls[0][0]


def test_claim_job_picks_retrying_job_when_next_retry_has_passed() -> None:
    worker = JobWorker("worker-a", "postgresql://example")
    now = datetime.now(timezone.utc)
    conn = ClaimConnection(
        [
            build_job("job-pending", status="pending", created_at=now),
            build_job(
                "job-retrying",
                status="retrying",
                attempts=1,
                created_at=now + timedelta(seconds=5),
                next_retry_at=now - timedelta(seconds=1),
            ),
        ]
    )

    job = run_async(worker.claim_job(conn))

    assert job is not None
    assert job["id"] == "job-retrying"
    assert job["status"] == "running"
    assert job["attempts"] == 2


def test_claim_job_ignores_retrying_job_when_next_retry_is_in_future() -> None:
    worker = JobWorker("worker-a", "postgresql://example")
    now = datetime.now(timezone.utc)
    conn = ClaimConnection(
        [
            build_job(
                "job-retrying",
                status="retrying",
                attempts=1,
                created_at=now,
                next_retry_at=now + timedelta(minutes=5),
            ),
            build_job("job-pending", status="pending", created_at=now + timedelta(seconds=1)),
        ]
    )

    job = run_async(worker.claim_job(conn))

    assert job is not None
    assert job["id"] == "job-pending"
    assert job["status"] == "running"


def test_execute_job_marks_job_completed_on_pipeline_success() -> None:
    worker = JobWorker("worker-a", "postgresql://example")
    conn = RecordingConnection()
    job = {
        "id": "job-1",
        "track": "broll",
        "attempts": 1,
        "max_attempts": 3,
        "input_payload": {"query": "city skyline", "conf": {"per_page": 20}},
    }
    context = PipelineContext(
        data={"job_status": "completed", "job_artifacts": {"indexed_assets_count": 2}},
        completed_steps=["DiscoverAssetStep", "MarkJobCompletedStep"],
    )

    pipeline = Mock()
    pipeline.run = AsyncMock(return_value=context)

    with patch("workers.worker.BrollIndexingPipeline", return_value=pipeline):
        run_async(worker.execute_job(conn, job))

    assert conn.execute_calls
    assert "status = 'completed'" in conn.execute_calls[0][0]
    assert conn.execute_calls[0][1] == ("job-1",)
    assert worker._job_contexts["job-1"] is context
    assert pipeline.run.await_args.kwargs["query"] == "city skyline"
    assert pipeline.run.await_args.kwargs["category"] is None
    assert pipeline.run.await_args.kwargs["job_id"] == "job-1"
    assert pipeline.run.await_args.kwargs["conf"]["per_page"] == 20
    assert callable(pipeline.run.await_args.kwargs["conf"]["progress_callback"])


def test_handle_failure_sets_retrying_with_exponential_backoff() -> None:
    worker = JobWorker("worker-a", "postgresql://example")
    conn = RecordingConnection()
    job = {"id": "job-1", "attempts": 1, "max_attempts": 3}
    worker._job_contexts["job-1"] = PipelineContext(
        failed_step="GenerateEmbeddingStep",
        error="boom",
    )

    run_async(worker.handle_failure(conn, job, RuntimeError("boom")))

    assert "status = 'retrying'" in conn.execute_calls[0][0]
    assert conn.execute_calls[0][1] == ("job-1", "boom", 30)
    assert conn.execute_calls[1][1][1] == "GenerateEmbeddingStep"
    assert conn.execute_calls[1][1][2] == "failed"
    assert json.loads(conn.execute_calls[1][1][3])["error"] == "boom"


def test_handle_failure_sets_failed_when_attempt_limit_is_reached() -> None:
    worker = JobWorker("worker-a", "postgresql://example")
    conn = RecordingConnection()
    job = {"id": "job-1", "attempts": 3, "max_attempts": 3}

    run_async(worker.handle_failure(conn, job, RuntimeError("boom")))

    assert len(conn.execute_calls) == 1
    assert "status = 'failed'" in conn.execute_calls[0][0]
    assert conn.execute_calls[0][1] == ("job-1", "boom")


def test_compute_retry_delay_uses_exponential_backoff_with_cap() -> None:
    worker = JobWorker("worker-a", "postgresql://example")

    assert worker.compute_retry_delay(1) == 30
    assert worker.compute_retry_delay(2) == 60
    assert worker.compute_retry_delay(3) == 120
    assert worker.compute_retry_delay(20) == 3600


def test_execute_job_marks_unified_job_completed_on_pipeline_success() -> None:
    worker = JobWorker("worker-a", "postgresql://example")
    conn = RecordingConnection()
    job = {
        "id": "job-unified-1",
        "track": "unified",
        "attempts": 1,
        "max_attempts": 3,
        "input_payload": {
            "url": "https://www.youtube.com/watch?v=abc123xyz00",
            "source": "youtube",
            "source_video_id": "abc123xyz00",
            "owner_id": "user-123",
            "video_id": "video-123",
            "conf": {"scene_threshold": 0.2},
        },
    }
    context = PipelineContext(
        data={"job_status": "completed", "job_artifacts": {"units_created": 3}},
        completed_steps=["BuildUnifiedRetrievalUnitsStep", "MarkUnifiedJobCompletedStep"],
    )

    pipeline = Mock()
    pipeline.run = AsyncMock(return_value=context)

    with patch("workers.worker.UnifiedIndexingPipeline", return_value=pipeline):
        run_async(worker.execute_job(conn, job))

    assert conn.execute_calls
    assert "status = 'completed'" in conn.execute_calls[0][0]
    assert conn.execute_calls[0][1] == ("job-unified-1",)
    assert worker._job_contexts["job-unified-1"] is context
    assert pipeline.run.await_args.kwargs["url"] == "https://www.youtube.com/watch?v=abc123xyz00"
    assert pipeline.run.await_args.kwargs["source"] == "youtube"
    assert pipeline.run.await_args.kwargs["source_video_id"] == "abc123xyz00"
    assert pipeline.run.await_args.kwargs["owner_id"] == "user-123"
    assert pipeline.run.await_args.kwargs["video_id"] == "video-123"
    assert pipeline.run.await_args.kwargs["job_id"] == "job-unified-1"
    assert pipeline.run.await_args.kwargs["conf"]["scene_threshold"] == 0.2
    assert callable(pipeline.run.await_args.kwargs["conf"]["progress_callback"])


def test_record_step_progress_writes_correct_step_statuses() -> None:
    worker = JobWorker("worker-a", "postgresql://example")
    conn = RecordingConnection()
    context = PipelineContext(
        data={
            "source_video_id": "openai-devday",
            "video_metadata": {"title": "DevDay", "source": "youtube"},
            "video_path": "/tmp/video.mp4",
            "temp_dir": "/tmp/job-1",
            "segment_embeddings": {"0": [0.1, 0.2]},
            "embedding_dimension": 768,
            "job_status": "completed",
            "job_artifacts": {"segment_count": 4},
        },
        completed_steps=[
            "FetchKnowledgeMetadataStep",
            "DownloadKnowledgeVideoStep",
        ],
        skipped_steps=["AnalyzeKnowledgeFramesStep"],
        failed_step="EmbedKnowledgeSegmentsStep",
        error="embedding failed",
    )

    run_async(worker.record_step_progress(conn, "job-1", context))

    statuses_by_step = {
        params[1]: params[2]
        for _, params in conn.execute_calls
    }

    assert statuses_by_step == {
        "FetchKnowledgeMetadataStep": "completed",
        "DownloadKnowledgeVideoStep": "completed",
        "AnalyzeKnowledgeFramesStep": "skipped",
        "EmbedKnowledgeSegmentsStep": "failed",
    }

    metadata_artifacts = json.loads(conn.execute_calls[0][1][3])
    assert metadata_artifacts["source_video_id"] == "openai-devday"

    failed_artifacts = json.loads(conn.execute_calls[-1][1][3])
    assert failed_artifacts["embedding_count"] == 1
    assert failed_artifacts["error"] == "embedding failed"


def test_record_step_progress_writes_unified_step_artifacts() -> None:
    worker = JobWorker("worker-a", "postgresql://example")
    conn = RecordingConnection()
    context = PipelineContext(
        data={
            "source_video_id": "abc123xyz00",
            "video_metadata": {
                "title": "Unified Demo",
                "source": "youtube",
                "duration_seconds": 42,
            },
            "embedded_units": [
                {"unit_type": "summary", "embedding": [0.1, 0.2, 0.3]},
                {"unit_type": "visual", "embedding": [0.4, 0.5, 0.6]},
            ],
            "stored_unified_video": {"id": "video-123"},
            "stored_unified_units": [
                {"id": "unit-1"},
                {"id": "unit-2"},
            ],
            "job_status": "completed",
            "job_artifacts": {"video_id": "video-123", "units_created": 2},
        },
        completed_steps=[
            "FetchUnifiedMetadataStep",
            "BuildUnifiedRetrievalUnitsStep",
            "EmbedUnifiedUnitsStep",
            "PersistUnifiedUnitsStep",
            "MarkUnifiedJobCompletedStep",
        ],
    )

    run_async(worker.record_step_progress(conn, "job-unified-1", context))

    artifacts_by_step = {
        params[1]: json.loads(params[3])
        for _, params in conn.execute_calls
    }

    assert artifacts_by_step["FetchUnifiedMetadataStep"] == {
        "source_video_id": "abc123xyz00",
        "title": "Unified Demo",
        "source": "youtube",
        "duration_seconds": 42,
    }
    assert artifacts_by_step["BuildUnifiedRetrievalUnitsStep"] == {
        "unit_count": 2,
        "summary_count": 1,
        "speech_count": 0,
        "visual_count": 1,
    }
    assert artifacts_by_step["EmbedUnifiedUnitsStep"] == {
        "embedding_count": 2,
        "embedding_dimension": 3,
    }
    assert artifacts_by_step["PersistUnifiedUnitsStep"] == {
        "video_id": "video-123",
        "indexed_unit_count": 2,
    }
    assert artifacts_by_step["MarkUnifiedJobCompletedStep"] == {
        "job_status": "completed",
        "job_artifacts": {"video_id": "video-123", "units_created": 2},
    }


def test_record_step_progress_includes_frame_analysis_totals() -> None:
    worker = JobWorker("worker-a", "postgresql://example")
    conn = RecordingConnection()
    context = PipelineContext(
        data={
            "scene_analyses": [{"scene_index": 0}, {"scene_index": 1}],
            "frame_analysis_scene_total": 4,
            "frame_analysis_current_scene_index": 1,
            "frame_analysis_current_scene_position": 2,
            "frame_analysis_current_route": "annotate",
            "frame_analysis_candidate_frame_count": 3,
            "frame_analysis_unique_frame_count": 2,
            "frame_analysis_selected_frame_count": 2,
            "frame_analysis_annotation_frame_count": 1,
            "frame_analysis_extraction_cache_hit_count": 1,
            "frame_analysis_annotation_cache_hit_count": 1,
            "frame_analysis_extraction_time_ms": 420,
            "frame_analysis_dedup_time_ms": 35,
            "frame_analysis_filter_time_ms": 18,
            "frame_analysis_ocr_time_ms": 12,
            "frame_analysis_prepare_time_ms": 501,
            "frame_analysis_annotation_time_ms": 260,
            "frame_analysis_total_candidate_frame_count": 7,
            "frame_analysis_total_unique_frame_count": 5,
            "frame_analysis_total_selected_frame_count": 4,
            "frame_analysis_total_annotation_frame_count": 2,
            "frame_analysis_total_extraction_cache_hit_count": 2,
            "frame_analysis_total_annotation_cache_hit_count": 3,
            "frame_analysis_total_extraction_time_ms": 910,
            "frame_analysis_total_dedup_time_ms": 80,
            "frame_analysis_total_filter_time_ms": 44,
            "frame_analysis_total_ocr_time_ms": 26,
            "frame_analysis_total_prepare_time_ms": 1080,
            "frame_analysis_total_annotation_time_ms": 540,
            "frame_analysis_route_counts": {"text_only": 1, "embed_only": 0, "annotate": 1},
            "frame_analysis_annotation_timeout_count": 1,
            "frame_analysis_annotation_error_count": 2,
        },
        completed_steps=["AnalyzeKnowledgeFramesStep"],
    )

    run_async(worker.record_step_progress(conn, "job-frames-1", context))

    artifacts = json.loads(conn.execute_calls[0][1][3])
    assert artifacts == {
        "scene_analysis_count": 2,
        "scene_total": 4,
        "current_scene_index": 1,
        "current_scene_position": 2,
        "current_route": "annotate",
        "candidate_frame_count": 3,
        "unique_frame_count": 2,
        "selected_frame_count": 2,
        "annotation_frame_count": 1,
        "extraction_cache_hit_count": 1,
        "annotation_cache_hit_count": 1,
        "extraction_time_ms": 420,
        "dedup_time_ms": 35,
        "filter_time_ms": 18,
        "ocr_time_ms": 12,
        "prepare_time_ms": 501,
        "annotation_time_ms": 260,
        "total_candidate_frame_count": 7,
        "total_unique_frame_count": 5,
        "total_selected_frame_count": 4,
        "total_annotation_frame_count": 2,
        "total_extraction_cache_hit_count": 2,
        "total_annotation_cache_hit_count": 3,
        "total_extraction_time_ms": 910,
        "total_dedup_time_ms": 80,
        "total_filter_time_ms": 44,
        "total_ocr_time_ms": 26,
        "total_prepare_time_ms": 1080,
        "total_annotation_time_ms": 540,
        "route_counts": {"text_only": 1, "embed_only": 0, "annotate": 1},
        "annotation_timeout_count": 1,
        "annotation_error_count": 2,
    }
