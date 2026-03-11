import asyncio
import json
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, Mock, patch

from workers.common.pipeline import PipelineContext
from workers.worker import JobWorker


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
    status: str,
    attempts: int = 0,
    max_attempts: int = 3,
    created_at: datetime | None = None,
    next_retry_at: datetime | None = None,
    input_payload: dict[str, object] | None = None,
) -> dict[str, object]:
    return {
        "id": job_id,
        "track": "broll",
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
    assert pipeline.run.await_args.kwargs == {
        "query": "city skyline",
        "category": None,
        "job_id": "job-1",
        "conf": {"per_page": 20},
    }


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
