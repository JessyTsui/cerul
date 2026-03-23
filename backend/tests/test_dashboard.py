from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, cast
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.auth import SessionContext, require_session
from app.config import reset_settings_cache
from app.db import get_db
from app.main import app
from app.routers import dashboard


class DashboardDb:
    def __init__(self) -> None:
        self.profiles: dict[str, dict[str, object]] = {}
        self.auth_users: dict[str, dict[str, object]] = {}
        self.api_keys: list[dict[str, object]] = []
        self.jobs: list[dict[str, object]] = []
        self.job_steps: list[dict[str, object]] = []
        self.usage_summaries: dict[tuple[str, object, object], dict[str, object]] = {}
        self.daily_usage: list[dict[str, object]] = []

    def _is_cancelled(self, job: dict[str, object]) -> bool:
        payload = job.get("input_payload")
        return isinstance(payload, dict) and bool(payload.get("cancelled_by_user"))

    def _list_jobs(
        self,
        *,
        status_filter: object = None,
        track_filter: object = None,
    ) -> list[dict[str, object]]:
        items = self.jobs

        if isinstance(status_filter, str):
            items = [job for job in items if job["status"] == status_filter]
            if status_filter == "failed":
                items = [job for job in items if not self._is_cancelled(job)]

        if isinstance(track_filter, str):
            items = [job for job in items if job["track"] == track_filter]

        return sorted(
            items,
            key=lambda item: cast(datetime, item["created_at"]),
            reverse=True,
        )

    def _coerce_datetime(self, value: object) -> datetime:
        if isinstance(value, datetime):
            return value
        raise AssertionError(f"Expected datetime, received {value!r}")

    def _job_stats(self) -> dict[str, int]:
        visible_jobs = list(self.jobs)
        genuine_failed_jobs = [
            job
            for job in self.jobs
            if job["status"] == "failed" and not self._is_cancelled(job)
        ]
        return {
            "total": len(visible_jobs),
            "pending": sum(1 for job in visible_jobs if job["status"] == "pending"),
            "running": sum(1 for job in visible_jobs if job["status"] == "running"),
            "retrying": sum(1 for job in visible_jobs if job["status"] == "retrying"),
            "completed": sum(1 for job in visible_jobs if job["status"] == "completed"),
            "failed": len(genuine_failed_jobs),
            "broll": sum(1 for job in visible_jobs if job["track"] == "broll"),
            "knowledge": sum(1 for job in visible_jobs if job["track"] == "knowledge"),
        }

    async def fetchrow(self, query: str, *params: object) -> dict[str, object] | None:
        normalized = " ".join(query.split())

        if "FROM user_profiles" in normalized:
            return self.profiles.get(str(params[0]))

        if 'FROM "user"' in normalized:
            return self.auth_users.get(str(params[0]))

        if "INSERT INTO user_profiles" in normalized:
            profile = self.profiles.get(str(params[0])) or {
                "id": str(params[0]),
                "email": params[1],
                "display_name": params[2],
                "console_role": "user",
                "tier": "free",
                "monthly_credit_limit": 1_000,
                "rate_limit_per_sec": 1,
                "stripe_customer_id": None,
            }
            if params[1]:
                profile["email"] = params[1]
            if params[2]:
                profile["display_name"] = params[2]
            self.profiles[str(params[0])] = profile
            return profile

        if "INSERT INTO api_keys" in normalized:
            created = {
                "id": f"key_{len(self.api_keys) + 1}",
                "user_id": str(params[0]),
                "name": str(params[1]),
                "key_hash": str(params[2]),
                "prefix": str(params[3]),
                "created_at": datetime.now(timezone.utc),
                "last_used_at": None,
                "is_active": True,
            }
            self.api_keys.append(created)
            return created

        if "UPDATE api_keys" in normalized:
            key_id = str(params[0])
            user_id = str(params[1])
            for api_key in self.api_keys:
                if api_key["id"] == key_id and api_key["user_id"] == user_id:
                    api_key["is_active"] = False
                    return {"id": key_id}
            return None

        if "FROM usage_monthly" in normalized:
            return self.usage_summaries.get((str(params[0]), params[1], params[2]))

        if "COUNT(*) AS total" in normalized and "FROM processing_jobs" in normalized:
            return self._job_stats()

        if "FROM processing_jobs" in normalized and "WHERE id = $1" in normalized:
            job_id = str(params[0])
            for job in self.jobs:
                if str(job["id"]) == job_id:
                    return job
            return None

        raise AssertionError(f"Unhandled fetchrow query: {normalized}")

    async def fetchval(self, query: str, *params: object) -> int:
        normalized = " ".join(query.split())
        if "SELECT COUNT(*)" not in normalized:
            raise AssertionError(f"Unhandled fetchval query: {normalized}")

        if "FROM processing_jobs" in normalized:
            return len(
                self._list_jobs(
                    status_filter=params[0] if len(params) > 0 else None,
                    track_filter=params[1] if len(params) > 1 else None,
                ),
            )

        user_id = str(params[0])
        return sum(
            1
            for api_key in self.api_keys
            if api_key["user_id"] == user_id and bool(api_key["is_active"])
        )

    async def fetch(self, query: str, *params: object) -> list[dict[str, object]]:
        normalized = " ".join(query.split())

        if "FROM processing_jobs" in normalized:
            items = self._list_jobs(
                status_filter=params[0] if len(params) > 0 else None,
                track_filter=params[1] if len(params) > 1 else None,
            )
            limit = int(params[2])
            offset = int(params[3])
            return items[offset : offset + limit]

        if "FROM processing_job_steps" in normalized:
            job_id = str(params[0])
            items = [step for step in self.job_steps if str(step["job_id"]) == job_id]
            return sorted(
                items,
                key=lambda item: (
                    self._coerce_datetime(
                        item.get("started_at")
                        or item.get("completed_at")
                        or item["updated_at"],
                    ),
                    cast(str, item["step_name"]),
                ),
            )

        if "FROM api_keys" in normalized:
            user_id = str(params[0])
            items = [api_key for api_key in self.api_keys if api_key["user_id"] == user_id]
            return sorted(
                items,
                key=lambda item: cast(datetime, item["created_at"]),
                reverse=True,
            )

        if "FROM usage_events" in normalized:
            start_date = params[1]
            return [
                point
                for point in self.daily_usage
                if point["date"] >= start_date
            ]

        raise AssertionError(f"Unhandled fetch query: {normalized}")


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    db = DashboardDb()
    monkeypatch.setenv("ADMIN_CONSOLE_EMAILS", "owner@example.com")
    reset_settings_cache()

    async def get_db_override() -> DashboardDb:
        return db

    def session_override() -> SessionContext:
        return cast(SessionContext, app.state.test_session)

    app.dependency_overrides[get_db] = get_db_override
    app.dependency_overrides[require_session] = session_override

    with TestClient(app) as test_client:
        test_client.app.state.test_db = db
        test_client.app.state.test_session = SessionContext(
            user_id="user_123",
            email="owner@example.com",
        )
        yield test_client

    app.dependency_overrides.clear()
    reset_settings_cache()
    if hasattr(app.state, "test_db"):
        delattr(app.state, "test_db")
    if hasattr(app.state, "test_session"):
        delattr(app.state, "test_session")


def test_api_key_creation_respects_free_tier_limit(client: TestClient) -> None:
    db = client.app.state.test_db
    db.profiles["user_123"] = {
        "id": "user_123",
        "email": "owner@example.com",
        "tier": "free",
        "monthly_credit_limit": 1_000,
        "stripe_customer_id": None,
    }
    db.api_keys.append(
        {
            "id": "key_existing",
            "user_id": "user_123",
            "name": "Existing key",
            "key_hash": "hashed",
            "prefix": "cerul_sk_exist",
            "created_at": datetime.now(timezone.utc),
            "last_used_at": None,
            "is_active": True,
        },
    )

    response = client.post("/dashboard/api-keys", json={"name": "Another key"})

    assert response.status_code == 403
    assert "at most 1 active API key" in response.json()["detail"]


def test_api_key_creation_returns_raw_key_once(client: TestClient) -> None:
    db = client.app.state.test_db
    db.profiles["user_123"] = {
        "id": "user_123",
        "email": "owner@example.com",
        "tier": "pro",
        "monthly_credit_limit": 10_000,
        "stripe_customer_id": None,
    }

    response = client.post("/dashboard/api-keys", json={"name": "CLI key"})

    assert response.status_code == 201
    payload = response.json()
    assert payload["key_id"] == "key_1"
    assert payload["raw_key"].startswith("cerul_sk_")
    assert db.api_keys[0]["key_hash"] != payload["raw_key"]


def test_api_key_list_serializes_uuid_ids(client: TestClient) -> None:
    db = client.app.state.test_db
    db.profiles["user_123"] = {
        "id": "user_123",
        "email": "owner@example.com",
        "tier": "pro",
        "monthly_credit_limit": 10_000,
        "stripe_customer_id": None,
    }
    db.api_keys.append(
        {
            "id": uuid4(),
            "user_id": "user_123",
            "name": "CLI key",
            "key_hash": "hashed",
            "prefix": "cerul_sk_test",
            "created_at": datetime.now(timezone.utc),
            "last_used_at": None,
            "is_active": True,
        },
    )

    response = client.get("/dashboard/api-keys")

    assert response.status_code == 200
    payload = response.json()
    assert payload["api_keys"][0]["id"] == str(db.api_keys[0]["id"])


def test_api_key_creation_provisions_missing_profile_from_auth_user(
    client: TestClient,
) -> None:
    db = client.app.state.test_db
    db.auth_users["user_123"] = {
        "id": "user_123",
        "email": "owner@example.com",
        "name": "Owner",
    }

    response = client.post("/dashboard/api-keys", json={"name": "CLI key"})

    assert response.status_code == 201
    assert db.profiles["user_123"]["email"] == "owner@example.com"
    assert db.api_keys[0]["user_id"] == "user_123"


def test_api_key_deletion_requires_ownership(client: TestClient) -> None:
    db = client.app.state.test_db
    db.profiles["user_123"] = {
        "id": "user_123",
        "email": "owner@example.com",
        "tier": "pro",
        "monthly_credit_limit": 10_000,
        "stripe_customer_id": None,
    }
    db.api_keys.append(
        {
            "id": "key_foreign",
            "user_id": "other_user",
            "name": "Foreign key",
            "key_hash": "hashed",
            "prefix": "cerul_sk_fore",
            "created_at": datetime.now(timezone.utc),
            "last_used_at": None,
            "is_active": True,
        },
    )

    response = client.delete("/dashboard/api-keys/key_foreign")

    assert response.status_code == 404
    assert db.api_keys[0]["is_active"] is True


def test_job_list_supports_filters_and_pagination(client: TestClient) -> None:
    db = client.app.state.test_db
    now = datetime.now(timezone.utc)
    db.jobs = [
        {
            "id": "job_1",
            "track": "knowledge",
            "source_id": "source_1",
            "job_type": "transcribe",
            "status": "failed",
            "input_payload": {"url": "https://example.com/a"},
            "error_message": "ASR provider timeout",
            "attempts": 3,
            "max_attempts": 3,
            "locked_by": None,
            "locked_at": None,
            "next_retry_at": None,
            "created_at": now,
            "started_at": now,
            "completed_at": now,
            "updated_at": now,
        },
        {
            "id": "job_2",
            "track": "knowledge",
            "source_id": "source_2",
            "job_type": "embed",
            "status": "running",
            "input_payload": {"url": "https://example.com/b"},
            "error_message": None,
            "attempts": 1,
            "max_attempts": 3,
            "locked_by": "worker-a",
            "locked_at": now,
            "next_retry_at": None,
            "created_at": now.replace(minute=max(now.minute - 1, 0)),
            "started_at": now,
            "completed_at": None,
            "updated_at": now,
        },
        {
            "id": "job_3",
            "track": "broll",
            "source_id": None,
            "job_type": "ingest",
            "status": "failed",
            "input_payload": {"url": "https://example.com/c"},
            "error_message": "Video download failed",
            "attempts": 2,
            "max_attempts": 3,
            "locked_by": None,
            "locked_at": None,
            "next_retry_at": None,
            "created_at": now.replace(minute=max(now.minute - 2, 0)),
            "started_at": now,
            "completed_at": now,
            "updated_at": now,
        },
    ]

    response = client.get(
        "/dashboard/jobs",
        params={"status": "failed", "track": "knowledge", "limit": 1, "offset": 0},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["total_count"] == 1
    assert [job["id"] for job in payload["jobs"]] == ["job_1"]
    assert payload["jobs"][0]["attempts"] == 3
    assert payload["jobs"][0]["error_message"] == "ASR provider timeout"


def test_job_list_serializes_uuid_ids(client: TestClient) -> None:
    db = client.app.state.test_db
    now = datetime.now(timezone.utc)
    db.jobs = [
        {
            "id": uuid4(),
            "track": "knowledge",
            "source_id": None,
            "job_type": "transcribe",
            "status": "running",
            "input_payload": {},
            "error_message": None,
            "attempts": 1,
            "max_attempts": 3,
            "locked_by": None,
            "locked_at": None,
            "next_retry_at": None,
            "created_at": now,
            "started_at": now,
            "completed_at": None,
            "updated_at": now,
        },
    ]

    response = client.get("/dashboard/jobs")

    assert response.status_code == 200
    payload = response.json()
    assert payload["jobs"][0]["id"] == str(db.jobs[0]["id"])


def test_job_detail_returns_steps(client: TestClient) -> None:
    db = client.app.state.test_db
    now = datetime.now(timezone.utc)
    db.jobs = [
        {
            "id": "job_detail",
            "track": "knowledge",
            "source_id": "source_detail",
            "job_type": "index",
            "status": "completed",
            "input_payload": {"source_url": "https://example.com/detail"},
            "error_message": None,
            "attempts": 1,
            "max_attempts": 3,
            "locked_by": None,
            "locked_at": None,
            "next_retry_at": None,
            "created_at": now,
            "started_at": now,
            "completed_at": now,
            "updated_at": now,
        },
    ]
    db.job_steps = [
        {
            "id": "step_2",
            "job_id": "job_detail",
            "step_name": "embed_segments",
            "status": "completed",
            "artifacts": {"segments_indexed": 8},
            "error_message": None,
            "started_at": now,
            "completed_at": now,
            "updated_at": now,
        },
        {
            "id": "step_1",
            "job_id": "job_detail",
            "step_name": "extract_transcript",
            "status": "completed",
            "artifacts": {"transcript_language": "en"},
            "error_message": None,
            "started_at": now - timedelta(minutes=1),
            "completed_at": now - timedelta(minutes=1),
            "updated_at": now - timedelta(minutes=1),
        },
    ]

    response = client.get("/dashboard/jobs/job_detail")

    assert response.status_code == 200
    payload = response.json()
    assert payload["id"] == "job_detail"
    assert [step["step_name"] for step in payload["steps"]] == [
        "extract_transcript",
        "embed_segments",
    ]
    assert payload["steps"][0]["artifacts"] == {"transcript_language": "en"}


def test_job_detail_serializes_uuid_fields(client: TestClient) -> None:
    db = client.app.state.test_db
    now = datetime.now(timezone.utc)
    job_id = uuid4()
    source_id = uuid4()
    step_id = uuid4()
    db.jobs = [
        {
            "id": job_id,
            "track": "knowledge",
            "source_id": source_id,
            "job_type": "index",
            "status": "running",
            "input_payload": {},
            "error_message": None,
            "attempts": 1,
            "max_attempts": 3,
            "locked_by": "worker-a",
            "locked_at": now,
            "next_retry_at": None,
            "created_at": now,
            "started_at": now,
            "completed_at": None,
            "updated_at": now,
        },
    ]
    db.job_steps = [
        {
            "id": step_id,
            "job_id": str(job_id),
            "step_name": "embed",
            "status": "completed",
            "artifacts": {},
            "error_message": None,
            "started_at": now,
            "completed_at": now,
            "updated_at": now,
        },
    ]

    response = client.get(f"/dashboard/jobs/{job_id}")

    assert response.status_code == 200
    payload = response.json()
    assert payload["id"] == str(job_id)
    assert payload["source_id"] == str(source_id)
    assert payload["steps"][0]["id"] == str(step_id)


def test_job_detail_returns_404_for_unknown_job(client: TestClient) -> None:
    response = client.get("/dashboard/jobs/missing_job")

    assert response.status_code == 404
    assert response.json()["detail"] == "Processing job not found."


def test_job_stats_returns_status_and_track_counts(client: TestClient) -> None:
    db = client.app.state.test_db
    now = datetime.now(timezone.utc)
    db.jobs = [
        {
            "id": "job_pending",
            "track": "knowledge",
            "source_id": None,
            "job_type": "index",
            "status": "pending",
            "input_payload": {},
            "error_message": None,
            "attempts": 0,
            "max_attempts": 3,
            "locked_by": None,
            "locked_at": None,
            "next_retry_at": None,
            "created_at": now,
            "started_at": None,
            "completed_at": None,
            "updated_at": now,
        },
        {
            "id": "job_running",
            "track": "knowledge",
            "source_id": None,
            "job_type": "index",
            "status": "running",
            "input_payload": {},
            "error_message": None,
            "attempts": 1,
            "max_attempts": 3,
            "locked_by": "worker-a",
            "locked_at": now,
            "next_retry_at": None,
            "created_at": now,
            "started_at": now,
            "completed_at": None,
            "updated_at": now,
        },
        {
            "id": "job_retrying",
            "track": "broll",
            "source_id": None,
            "job_type": "index",
            "status": "retrying",
            "input_payload": {},
            "error_message": "Rate limited",
            "attempts": 2,
            "max_attempts": 3,
            "locked_by": None,
            "locked_at": None,
            "next_retry_at": now,
            "created_at": now,
            "started_at": now,
            "completed_at": None,
            "updated_at": now,
        },
        {
            "id": "job_completed",
            "track": "broll",
            "source_id": None,
            "job_type": "index",
            "status": "completed",
            "input_payload": {},
            "error_message": None,
            "attempts": 1,
            "max_attempts": 3,
            "locked_by": None,
            "locked_at": None,
            "next_retry_at": None,
            "created_at": now,
            "started_at": now,
            "completed_at": now,
            "updated_at": now,
        },
        {
            "id": "job_failed",
            "track": "knowledge",
            "source_id": None,
            "job_type": "index",
            "status": "failed",
            "input_payload": {},
            "error_message": "Permanent failure",
            "attempts": 3,
            "max_attempts": 3,
            "locked_by": None,
            "locked_at": None,
            "next_retry_at": None,
            "created_at": now,
            "started_at": now,
            "completed_at": now,
            "updated_at": now,
        },
    ]

    response = client.get("/dashboard/jobs/stats")

    assert response.status_code == 200
    payload = response.json()
    assert payload == {
        "total": 5,
        "pending": 1,
        "running": 1,
        "retrying": 1,
        "completed": 1,
        "failed": 1,
        "tracks": {
            "broll": 2,
            "knowledge": 3,
            "unified": 0,
        },
    }


def test_job_telemetry_excludes_cancelled_failed_jobs(client: TestClient) -> None:
    db = client.app.state.test_db
    now = datetime.now(timezone.utc)
    db.jobs = [
        {
            "id": "job_failed",
            "track": "knowledge",
            "source_id": None,
            "job_type": "index",
            "status": "failed",
            "input_payload": {},
            "error_message": "Permanent failure",
            "attempts": 3,
            "max_attempts": 3,
            "locked_by": None,
            "locked_at": None,
            "next_retry_at": None,
            "created_at": now,
            "started_at": now,
            "completed_at": now,
            "updated_at": now,
        },
        {
            "id": "job_cancelled",
            "track": "knowledge",
            "source_id": None,
            "job_type": "index",
            "status": "failed",
            "input_payload": {"cancelled_by_user": True},
            "error_message": "Cancelled by user.",
            "attempts": 1,
            "max_attempts": 3,
            "locked_by": None,
            "locked_at": None,
            "next_retry_at": None,
            "created_at": now,
            "started_at": now,
            "completed_at": now,
            "updated_at": now,
        },
    ]

    jobs_response = client.get(
        "/dashboard/jobs",
        params={"status": "failed", "track": "knowledge", "limit": 10, "offset": 0},
    )
    stats_response = client.get("/dashboard/jobs/stats")

    assert jobs_response.status_code == 200
    assert jobs_response.json()["total_count"] == 1
    assert [job["id"] for job in jobs_response.json()["jobs"]] == ["job_failed"]

    assert stats_response.status_code == 200
    assert stats_response.json()["failed"] == 1
    assert stats_response.json()["total"] == 2


@pytest.mark.parametrize(
    "path",
    [
        "/dashboard/jobs",
        "/dashboard/jobs/stats",
        "/dashboard/jobs/job_secure",
    ],
)
def test_job_telemetry_requires_admin_access(
    client: TestClient,
    path: str,
) -> None:
    db = client.app.state.test_db
    now = datetime.now(timezone.utc)
    db.jobs = [
        {
            "id": "job_secure",
            "track": "knowledge",
            "source_id": None,
            "job_type": "index",
            "status": "running",
            "input_payload": {},
            "error_message": None,
            "attempts": 1,
            "max_attempts": 3,
            "locked_by": "worker-a",
            "locked_at": now,
            "next_retry_at": None,
            "created_at": now,
            "started_at": now,
            "completed_at": None,
            "updated_at": now,
        },
    ]
    client.app.state.test_session = SessionContext(
        user_id="user_123",
        email="viewer@example.com",
    )

    response = client.get(path)

    assert response.status_code == 403
    assert response.json()["detail"] == (
        "Admin console access is restricted to administrator accounts."
    )


def test_checkout_endpoint_returns_checkout_url(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = client.app.state.test_db
    db.profiles["user_123"] = {
        "id": "user_123",
        "email": "owner@example.com",
        "tier": "free",
        "monthly_credit_limit": 1_000,
        "stripe_customer_id": None,
    }
    monkeypatch.setattr(
        dashboard.stripe_service,
        "create_checkout_session",
        lambda user_id, email, stripe_customer_id=None: (
            f"https://checkout.test/{user_id}?email={email}&customer={stripe_customer_id}"
        ),
    )

    response = client.post("/dashboard/billing/checkout")

    assert response.status_code == 200
    assert response.json()["checkout_url"] == (
        "https://checkout.test/user_123?email=owner@example.com&customer=None"
    )


def test_checkout_endpoint_rejects_existing_subscription_state(
    client: TestClient,
) -> None:
    db = client.app.state.test_db
    db.profiles["user_123"] = {
        "id": "user_123",
        "email": "owner@example.com",
        "tier": "pro",
        "monthly_credit_limit": 10_000,
        "stripe_customer_id": "cus_existing",
    }

    response = client.post("/dashboard/billing/checkout")

    assert response.status_code == 409
    assert response.json()["detail"] == (
        "Subscription already exists; use the billing portal instead."
    )


def test_checkout_endpoint_reuses_existing_stripe_customer(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = client.app.state.test_db
    db.profiles["user_123"] = {
        "id": "user_123",
        "email": "owner@example.com",
        "tier": "free",
        "monthly_credit_limit": 1_000,
        "stripe_customer_id": "cus_existing",
    }
    monkeypatch.setattr(
        dashboard.stripe_service,
        "create_checkout_session",
        lambda user_id, email, stripe_customer_id=None: (
            f"https://checkout.test/{user_id}?customer={stripe_customer_id}"
        ),
    )

    response = client.post("/dashboard/billing/checkout")

    assert response.status_code == 200
    assert response.json()["checkout_url"] == (
        "https://checkout.test/user_123?customer=cus_existing"
    )


def test_portal_endpoint_returns_portal_url(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = client.app.state.test_db
    db.profiles["user_123"] = {
        "id": "user_123",
        "email": "owner@example.com",
        "tier": "pro",
        "monthly_credit_limit": 10_000,
        "stripe_customer_id": "cus_portal",
    }
    monkeypatch.setattr(
        dashboard.stripe_service,
        "create_portal_session",
        lambda stripe_customer_id: f"https://portal.test/{stripe_customer_id}",
    )

    response = client.post("/dashboard/billing/portal")

    assert response.status_code == 200
    assert response.json()["portal_url"] == "https://portal.test/cus_portal"


def test_usage_endpoint_returns_current_period_dates(client: TestClient) -> None:
    db = client.app.state.test_db
    period_start, period_end = dashboard.get_current_billing_period()

    db.profiles["user_123"] = {
        "id": "user_123",
        "email": "owner@example.com",
        "tier": "free",
        "monthly_credit_limit": 1_000,
        "stripe_customer_id": None,
    }
    db.usage_summaries[("user_123", period_start, period_end)] = {
        "credits_used": 128,
        "request_count": 42,
    }
    db.daily_usage = [
        {
            "date": period_start,
            "credits_used": 5,
            "request_count": 2,
        },
    ]

    response = client.get("/dashboard/usage/monthly")

    assert response.status_code == 200
    payload = response.json()
    assert payload["period_start"] == period_start.isoformat()
    assert payload["period_end"] == period_end.isoformat()
    assert payload["credits_used"] == 128
    assert payload["credits_remaining"] == 872
    assert payload["request_count"] == 42
