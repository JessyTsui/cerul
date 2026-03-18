from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.auth import SessionContext, require_session
from app.main import app
from app.search.base import DEFAULT_KNOWLEDGE_VECTOR_DIMENSION, build_placeholder_vector, vector_to_literal
from conftest import TEST_KNOWLEDGE_VIDEO_ID, TEST_USER_ID


def _admin_session() -> SessionContext:
    return SessionContext(user_id=TEST_USER_ID, email="owner@example.com")


def _viewer_session() -> SessionContext:
    return SessionContext(user_id=TEST_USER_ID, email="owner@example.com")


@pytest.fixture
def admin_client(database) -> TestClient:
    database.fetchval(
        """
        UPDATE user_profiles
        SET console_role = 'admin'
        WHERE id = $1
        RETURNING id
        """,
        TEST_USER_ID,
    )

    app.dependency_overrides[require_session] = _admin_session

    with TestClient(app) as client:
        yield client

    app.dependency_overrides.clear()


def seed_admin_metrics(database) -> None:
    now = datetime.now(timezone.utc)
    current_time = now - timedelta(hours=2)
    previous_time = now - timedelta(days=8)

    database.fetchval(
        """
        INSERT INTO user_profiles (
            id,
            email,
            console_role,
            tier,
            monthly_credit_limit,
            rate_limit_per_sec,
            created_at,
            updated_at
        )
        VALUES ($1, $2, 'user', 'builder', 10000, 10, $3, $3)
        RETURNING id
        """,
        "user_admin_extra",
        "builder@example.com",
        current_time,
    )
    database.fetchval(
        """
        INSERT INTO user_profiles (
            id,
            email,
            console_role,
            tier,
            monthly_credit_limit,
            rate_limit_per_sec,
            created_at,
            updated_at
        )
        VALUES ($1, $2, 'user', 'free', 1000, 5, $3, $3)
        RETURNING id
        """,
        "user_admin_prev",
        "viewer@example.com",
        previous_time,
    )

    for request_id, user_id, search_type, credits_used, occurred_at in [
        ("req_admin_current_a", TEST_USER_ID, "knowledge", 3, current_time),
        ("req_admin_current_b", "user_admin_extra", "broll", 1, current_time + timedelta(minutes=5)),
        ("req_admin_previous_a", "user_admin_prev", "knowledge", 2, previous_time),
    ]:
        database.fetchval(
            """
            INSERT INTO usage_events (
                request_id,
                user_id,
                api_key_id,
                search_type,
                include_answer,
                credits_used,
                occurred_at
            )
            VALUES ($1, $2, NULL, $3, FALSE, $4, $5)
            RETURNING credits_used
            """,
            request_id,
            user_id,
            search_type,
            credits_used,
            occurred_at,
        )

    for request_id, user_id, search_type, result_count, latency_ms, created_at in [
        ("req_admin_current_a", TEST_USER_ID, "knowledge", 3, 420, current_time),
        ("req_admin_current_b", "user_admin_extra", "broll", 0, 650, current_time + timedelta(minutes=5)),
        ("req_admin_previous_a", "user_admin_prev", "knowledge", 1, 300, previous_time),
    ]:
        database.fetchval(
            """
            INSERT INTO query_logs (
                request_id,
                user_id,
                api_key_id,
                search_type,
                query_text,
                filters,
                max_results,
                include_answer,
                result_count,
                latency_ms,
                created_at
            )
            VALUES ($1, $2, NULL, $3, 'agent workflows', '{}'::jsonb, 5, TRUE, $4, $5, $6)
            RETURNING result_count
            """,
            request_id,
            user_id,
            search_type,
            result_count,
            latency_ms,
            created_at,
        )

    source_id = database.fetchval(
        """
        INSERT INTO content_sources (
            slug,
            track,
            display_name,
            base_url,
            is_active,
            metadata,
            created_at,
            updated_at
        )
        VALUES (
            'youtube-openai',
            'knowledge',
            'OpenAI YouTube',
            'https://youtube.com',
            TRUE,
            '{}'::jsonb,
            $1,
            $1
        )
        RETURNING id
        """,
        current_time,
    )

    database.fetchval(
        """
        INSERT INTO processing_jobs (
            track,
            source_id,
            job_type,
            status,
            input_payload,
            error_message,
            started_at,
            completed_at,
            created_at,
            updated_at
        )
        VALUES (
            'knowledge',
            $1::uuid,
            'index_video',
            'completed',
            '{"video_id":"demo"}'::jsonb,
            NULL,
            $2,
            $2,
            $2,
            $2
        )
        RETURNING id
        """,
        source_id,
        current_time,
    )
    failed_job_id = database.fetchval(
        """
        INSERT INTO processing_jobs (
            track,
            source_id,
            job_type,
            status,
            input_payload,
            error_message,
            attempts,
            max_attempts,
            started_at,
            completed_at,
            created_at,
            updated_at
        )
        VALUES (
            'knowledge',
            $1::uuid,
            'index_video',
            'failed',
            '{"video_id":"demo"}'::jsonb,
            'ASR timeout',
            3,
            3,
            $2,
            $2,
            $2,
            $2
        )
        RETURNING id
        """,
        source_id,
        current_time + timedelta(minutes=10),
    )
    database.fetchval(
        """
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
            'TranscribeKnowledgeVideoStep',
            'failed',
            '{"provider":"openai"}'::jsonb,
            'ASR timeout',
            $2,
            $2,
            $2
        )
        RETURNING id
        """,
        failed_job_id,
        current_time + timedelta(minutes=10),
    )

    database.fetchval(
        """
        INSERT INTO knowledge_segments (
            video_id,
            segment_index,
            title,
            description,
            transcript_text,
            visual_summary,
            timestamp_start,
            timestamp_end,
            metadata,
            embedding,
            created_at,
            updated_at
        )
        VALUES (
            $1::uuid,
            1,
            'More agent discussion',
            'Extra segment for admin tests.',
            'Agents continue to reason about tool use.',
            'Speaker with slide',
            200.0,
            260.0,
            '{}'::jsonb,
            $3::vector,
            $2,
            $2
        )
        RETURNING segment_index
        """,
        TEST_KNOWLEDGE_VIDEO_ID,
        current_time,
        vector_to_literal(
            build_placeholder_vector(
                "admin metrics additional segment",
                DEFAULT_KNOWLEDGE_VECTOR_DIMENSION,
            )
        ),
    )


def test_admin_summary_returns_aggregated_metrics(
    admin_client: TestClient,
    database,
) -> None:
    seed_admin_metrics(database)
    database.fetchval(
        """
        INSERT INTO admin_metric_targets (
            metric_name,
            scope_type,
            scope_key,
            range_key,
            comparison_mode,
            target_value,
            note
        )
        VALUES ('requests_total', 'global', '', '7d', 'at_least', 2, 'Keep demand growing')
        RETURNING target_value
        """
    )

    response = admin_client.get("/admin/summary", params={"range": "7d"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["window"]["range_key"] == "7d"
    assert payload["metrics"]["requests"]["current"] >= 2
    assert payload["metrics"]["requests"]["target"] == 2
    assert len(payload["request_series"]) >= 1


def test_admin_requests_summary_includes_latency_percentiles(
    admin_client: TestClient,
    database,
) -> None:
    seed_admin_metrics(database)

    response = admin_client.get("/admin/requests/summary", params={"range": "7d"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["metrics"]["latency"]["p95_ms"]["current"] >= 420
    assert payload["top_queries"][0]["query_text"] == "agent workflows"


def test_admin_ingestion_summary_lists_failures(
    admin_client: TestClient,
    database,
) -> None:
    seed_admin_metrics(database)

    response = admin_client.get("/admin/ingestion/summary", params={"range": "7d"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["metrics"]["jobs_failed"]["current"] >= 1
    assert payload["recent_failed_jobs"][0]["error_message"] == "ASR timeout"
    assert payload["failed_steps"][0]["step_name"] == "TranscribeKnowledgeVideoStep"


def test_admin_ingestion_summary_filters_failed_jobs_to_selected_window(
    admin_client: TestClient,
    database,
) -> None:
    seed_admin_metrics(database)
    source_id = database.fetchval(
        "SELECT id FROM content_sources WHERE slug = 'youtube-openai'"
    )
    stale_time = datetime.now(timezone.utc) - timedelta(days=40)
    database.fetchval(
        """
        INSERT INTO processing_jobs (
            track,
            source_id,
            job_type,
            status,
            input_payload,
            error_message,
            attempts,
            max_attempts,
            started_at,
            completed_at,
            created_at,
            updated_at
        )
        VALUES (
            'knowledge',
            $1::uuid,
            'index_video',
            'failed',
            '{"video_id":"legacy"}'::jsonb,
            'Legacy failure',
            3,
            3,
            $2,
            $2,
            $2,
            $2
        )
        RETURNING id
        """,
        source_id,
        stale_time,
    )

    response = admin_client.get("/admin/ingestion/summary", params={"range": "7d"})

    assert response.status_code == 200
    payload = response.json()
    assert all(
        job["error_message"] != "Legacy failure"
        for job in payload["recent_failed_jobs"]
    )


def test_admin_targets_can_be_upserted_and_deleted(
    admin_client: TestClient,
    database,
) -> None:
    response = admin_client.put(
        "/admin/targets",
        params={"range": "7d"},
        json={
            "targets": [
                {
                    "metric_name": "knowledge_segments_added",
                    "scope_type": "global",
                    "scope_key": "",
                    "range_key": "7d",
                    "comparison_mode": "at_least",
                    "target_value": 12,
                    "note": "Grow knowledge coverage",
                }
            ]
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["targets"][0]["metric_name"] == "knowledge_segments_added"
    target_id = payload["targets"][0]["id"]

    delete_response = admin_client.delete(f"/admin/targets/{target_id}")

    assert delete_response.status_code == 204
    remaining = database.fetchval("SELECT COUNT(*) FROM admin_metric_targets")
    assert int(remaining or 0) == 0


def test_admin_targets_return_scoped_actuals(
    admin_client: TestClient,
    database,
) -> None:
    seed_admin_metrics(database)

    response = admin_client.put(
        "/admin/targets",
        params={"range": "7d"},
        json={
            "targets": [
                {
                    "metric_name": "requests_total",
                    "scope_type": "track",
                    "scope_key": "knowledge",
                    "range_key": "7d",
                    "comparison_mode": "at_least",
                    "target_value": 1,
                    "note": "Knowledge demand",
                },
                {
                    "metric_name": "broll_assets_added",
                    "scope_type": "source",
                    "scope_key": "pexels",
                    "range_key": "7d",
                    "comparison_mode": "at_least",
                    "target_value": 1,
                    "note": "Pexels growth",
                },
                {
                    "metric_name": "jobs_failed",
                    "scope_type": "source",
                    "scope_key": "youtube-openai",
                    "range_key": "7d",
                    "comparison_mode": "at_most",
                    "target_value": 1,
                    "note": "Keep YouTube failures low",
                },
            ]
        },
    )

    assert response.status_code == 200
    payload = response.json()
    targets = {
        (target["metric_name"], target["scope_type"], target["scope_key"]): target
        for target in payload["targets"]
    }

    assert targets[("requests_total", "track", "knowledge")]["actual_value"] == 1
    assert targets[("broll_assets_added", "source", "pexels")]["actual_value"] == 1
    assert targets[("jobs_failed", "source", "youtube-openai")]["actual_value"] == 1


def test_admin_targets_reject_unsupported_scope(
    admin_client: TestClient,
) -> None:
    response = admin_client.put(
        "/admin/targets",
        params={"range": "7d"},
        json={
            "targets": [
                {
                    "metric_name": "new_users",
                    "scope_type": "source",
                    "scope_key": "youtube",
                    "range_key": "7d",
                    "comparison_mode": "at_least",
                    "target_value": 1,
                    "note": "Invalid scope",
                }
            ]
        },
    )

    assert response.status_code == 400
    assert "does not support 'source' scope" in response.json()["detail"]


def test_admin_target_delete_rejects_invalid_uuid(
    admin_client: TestClient,
) -> None:
    response = admin_client.delete("/admin/targets/not-a-uuid")

    assert response.status_code == 422


@pytest.mark.parametrize(
    "path",
    [
        "/admin/summary",
        "/admin/users/summary",
        "/admin/requests/summary",
        "/admin/content/summary",
        "/admin/ingestion/summary",
        "/admin/targets",
    ],
)
def test_admin_routes_require_admin_access(
    database,
    path: str,
) -> None:
    app.dependency_overrides[require_session] = _viewer_session

    with TestClient(app) as client:
        response = client.get(path)

    app.dependency_overrides.clear()

    assert response.status_code == 403
    assert response.json()["detail"] == (
        "Admin console access is restricted to administrator accounts."
    )
