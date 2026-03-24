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


def test_admin_ingestion_summary_excludes_cancelled_jobs_from_failed_metrics(
    admin_client: TestClient,
    database,
) -> None:
    seed_admin_metrics(database)
    source_id = database.fetchval(
        "SELECT id FROM content_sources WHERE slug = 'youtube-openai'"
    )
    now = datetime.now(timezone.utc)
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
            '{"video_id":"cancelled-job","cancelled_by_user":true}'::jsonb,
            'Cancelled by user.',
            1,
            3,
            $2,
            $2,
            $2,
            $2
        )
        RETURNING id
        """,
        source_id,
        now,
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
            (
                SELECT id
                FROM processing_jobs
                WHERE input_payload->>'video_id' = 'cancelled-job'
                LIMIT 1
            ),
            'AnalyzeKnowledgeFramesStep',
            'failed',
            '{}'::jsonb,
            'Cancelled by user.',
            $1,
            $1,
            $1
        )
        RETURNING id
        """,
        now,
    )

    response = admin_client.get("/admin/ingestion/summary", params={"range": "7d"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["metrics"]["jobs_failed"]["current"] == 1
    assert all(
        job["error_message"] != "Cancelled by user."
        for job in payload["recent_failed_jobs"]
    )
    assert all(
        step["step_name"] != "AnalyzeKnowledgeFramesStep"
        for step in payload["failed_steps"]
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


def test_admin_targets_keep_source_completed_counts_when_job_is_cancelled_later(
    admin_client: TestClient,
    database,
) -> None:
    seed_admin_metrics(database)
    source_id = database.fetchval(
        "SELECT id FROM content_sources WHERE slug = 'youtube-openai'"
    )
    now = datetime.now(timezone.utc)
    database.fetchval(
        """
        INSERT INTO processing_jobs (
            track,
            source_id,
            job_type,
            status,
            input_payload,
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
            '{"video_id":"cancelled-after-success","cancelled_by_user":true}'::jsonb,
            $2,
            $2,
            $2,
            $2
        )
        RETURNING id
        """,
        source_id,
        now,
    )

    response = admin_client.put(
        "/admin/targets",
        params={"range": "7d"},
        json={
            "targets": [
                {
                    "metric_name": "jobs_completed",
                    "scope_type": "source",
                    "scope_key": "youtube-openai",
                    "range_key": "7d",
                    "comparison_mode": "at_least",
                    "target_value": 1,
                    "note": "Keep source throughput visible",
                }
            ]
        },
    )

    assert response.status_code == 200
    payload = response.json()
    target = payload["targets"][0]
    assert target["metric_name"] == "jobs_completed"
    assert target["scope_type"] == "source"
    assert target["scope_key"] == "youtube-openai"
    assert target["actual_value"] == 2


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


def test_admin_worker_live_includes_retrying_jobs_and_steps(
    admin_client: TestClient,
    database,
) -> None:
    seed_admin_metrics(database)
    source_id = database.fetchval(
        "SELECT id FROM content_sources WHERE slug = 'youtube-openai'"
    )
    now = datetime.now(timezone.utc)
    running_job_id = database.fetchval(
        """
        INSERT INTO processing_jobs (
            track,
            source_id,
            job_type,
            status,
            input_payload,
            started_at,
            created_at,
            updated_at
        )
        VALUES (
            'knowledge',
            $1::uuid,
            'index_video',
            'running',
            '{"video_id":"live-running","source_metadata":{"title":"Running interview"}}'::jsonb,
            $2,
            $2,
            $2
        )
        RETURNING id
        """,
        source_id,
        now,
    )
    database.fetchval(
        """
        INSERT INTO processing_jobs (
            track,
            source_id,
            job_type,
            status,
            input_payload,
            started_at,
            created_at,
            updated_at
        )
        VALUES (
            'knowledge',
            $1::uuid,
            'index_video',
            'retrying',
            '{"video_id":"live-retrying","source_metadata":{"title":"Retrying interview"}}'::jsonb,
            $2,
            $2,
            $2
        )
        RETURNING id
        """,
        source_id,
        now + timedelta(minutes=1),
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
            'DownloadKnowledgeVideoStep',
            'running',
            '{"guidance":"Check yt-dlp reachability if this stays slow.","logs":[{"at":"2026-03-22T12:00:00Z","level":"info","message":"Starting source video download.","details":{"source":"youtube"}}]}'::jsonb,
            NULL,
            $2,
            NULL,
            $2
        )
        RETURNING id
        """,
        running_job_id,
        now,
    )

    response = admin_client.get("/admin/worker/live")

    assert response.status_code == 200
    payload = response.json()
    assert payload["queue"]["running"] >= 1
    assert payload["queue"]["retrying"] >= 1
    assert any(job["status"] == "retrying" for job in payload["active_jobs"])
    assert payload["active_jobs"][0]["source"] is None
    assert payload["active_jobs"][0]["attempts"] == 0
    assert payload["active_jobs"][0]["max_attempts"] == 3
    assert payload["active_jobs"][0]["steps"][0]["step_name"] == "DownloadKnowledgeVideoStep"
    assert payload["active_jobs"][0]["steps"][0]["guidance"] == "Check yt-dlp reachability if this stays slow."
    assert payload["active_jobs"][0]["steps"][0]["logs"][0]["message"] == "Starting source video download."
    assert payload["active_jobs"][0]["steps"][0]["duration_ms"] is not None


def test_admin_worker_live_includes_failed_jobs_and_completed_duration(
    admin_client: TestClient,
    database,
) -> None:
    seed_admin_metrics(database)
    source_id = database.fetchval(
        "SELECT id FROM content_sources WHERE slug = 'youtube-openai'"
    )
    started_at = datetime.now(timezone.utc) - timedelta(minutes=12)
    completed_job_id = database.fetchval(
        """
        INSERT INTO processing_jobs (
            track,
            source_id,
            job_type,
            status,
            input_payload,
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
            '{"video_id":"worker-completed","source":"youtube","source_metadata":{"title":"Completed run"}}'::jsonb,
            $2,
            $3,
            $2,
            $3
        )
        RETURNING id
        """,
        source_id,
        started_at,
        started_at + timedelta(minutes=5),
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
            'unified',
            $1::uuid,
            'index_video',
            'failed',
            '{"video_id":"worker-failed","source":"youtube","source_metadata":{"title":"Failed run"}}'::jsonb,
            'Gemini timeout',
            2,
            3,
            $2,
            $3,
            $2,
            $3
        )
        RETURNING id
        """,
        source_id,
        started_at,
        started_at + timedelta(minutes=7),
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
            'AnalyzeKnowledgeFramesStep',
            'failed',
            '{"guidance":"Investigate upstream vision latency."}'::jsonb,
            'Gemini timeout',
            $2,
            $3,
            $3
        )
        RETURNING id
        """,
        failed_job_id,
        started_at + timedelta(minutes=1),
        started_at + timedelta(minutes=7),
    )

    response = admin_client.get("/admin/worker/live")

    assert response.status_code == 200
    payload = response.json()
    completed = next(job for job in payload["recent_completed"] if job["job_id"] == str(completed_job_id))
    failed = next(job for job in payload["failed_jobs"] if job["job_id"] == str(failed_job_id))
    assert payload["failed_jobs_total"] >= 1
    assert payload["failed_jobs_limit"] == 10
    assert payload["failed_jobs_offset"] == 0
    assert completed["total_duration_ms"] >= 5 * 60 * 1000
    assert failed["total_duration_ms"] >= 7 * 60 * 1000
    assert failed["error_message"] == "Gemini timeout"
    assert failed["steps"][0]["step_name"] == "AnalyzeKnowledgeFramesStep"


def test_admin_worker_live_supports_failed_job_pagination(
    admin_client: TestClient,
    database,
) -> None:
    source_id = database.fetchval(
        "SELECT id FROM content_sources WHERE slug = 'youtube-openai'"
    )
    failed_job_ids: list[str] = []
    for index in range(3):
        failed_job_ids.append(
            str(
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
                        created_at,
                        updated_at
                    )
                    VALUES (
                        'knowledge',
                        $1::uuid,
                        'index_video',
                        'failed',
                        $2::jsonb,
                        $3,
                        3,
                        3,
                        NOW() - ($4::int * INTERVAL '1 minute'),
                        NOW() - ($4::int * INTERVAL '1 minute')
                    )
                    RETURNING id
                    """,
                    source_id,
                    f'{{"video_id":"failed-{index}"}}',
                    f"Failure {index}",
                    index,
                )
            )
        )

    response = admin_client.get("/admin/worker/live?failed_limit=1&failed_offset=1")

    assert response.status_code == 200
    payload = response.json()
    assert payload["failed_jobs_total"] >= 3
    assert payload["failed_jobs_limit"] == 1
    assert payload["failed_jobs_offset"] == 1
    assert len(payload["failed_jobs"]) == 1
    assert payload["failed_jobs"][0]["job_id"] == failed_job_ids[1]


def test_admin_worker_live_excludes_cancelled_jobs_from_failed_queue(
    admin_client: TestClient,
    database,
) -> None:
    seed_admin_metrics(database)
    source_id = database.fetchval(
        "SELECT id FROM content_sources WHERE slug = 'youtube-openai'"
    )
    now = datetime.now(timezone.utc)
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
            created_at,
            updated_at
        )
        VALUES (
            'knowledge',
            $1::uuid,
            'index_video',
            'failed',
            '{"video_id":"cancelled-live","cancelled_by_user":true}'::jsonb,
            'Cancelled by user.',
            1,
            3,
            $2,
            $2
        )
        RETURNING id
        """,
        source_id,
        now,
    )

    response = admin_client.get("/admin/worker/live")

    assert response.status_code == 200
    payload = response.json()
    assert payload["queue"]["failed"] == 1
    assert all(
        job["error_message"] != "Cancelled by user."
        for job in payload["failed_jobs"]
    )


def test_admin_indexed_videos_supports_query_and_pagination(
    admin_client: TestClient,
    database,
) -> None:
    first_video_id = database.fetchval(
        """
        INSERT INTO videos (
            id,
            source,
            source_video_id,
            source_url,
            video_url,
            thumbnail_url,
            title,
            description,
            speaker,
            duration_seconds,
            metadata,
            created_at,
            updated_at
        )
        VALUES (
            '11111111-1111-1111-1111-111111111111'::uuid,
            'youtube',
            'LCEmiRjPEtQ',
            'https://www.youtube.com/watch?v=LCEmiRjPEtQ',
            'https://www.youtube.com/watch?v=LCEmiRjPEtQ',
            'https://img.youtube.com/vi/LCEmiRjPEtQ/hqdefault.jpg',
            'Andrej Karpathy: Software Is Changing (Again)',
            'Y Combinator talk.',
            'Y Combinator',
            2372,
            '{}'::jsonb,
            NOW() - INTERVAL '1 day',
            NOW() - INTERVAL '1 day'
        )
        RETURNING id
        """
    )
    second_video_id = database.fetchval(
        """
        INSERT INTO videos (
            id,
            source,
            source_video_id,
            source_url,
            video_url,
            thumbnail_url,
            title,
            description,
            speaker,
            duration_seconds,
            metadata,
            created_at,
            updated_at
        )
        VALUES (
            '22222222-2222-2222-2222-222222222222'::uuid,
            'youtube',
            'PromptCachingDemo',
            'https://www.youtube.com/watch?v=PromptCachingDemo',
            'https://www.youtube.com/watch?v=PromptCachingDemo',
            'https://img.youtube.com/vi/PromptCachingDemo/hqdefault.jpg',
            'Build Hour: Prompt Caching',
            'Build Hour talk.',
            'Builder',
            3364,
            '{}'::jsonb,
            NOW(),
            NOW()
        )
        RETURNING id
        """
    )
    database.fetchval(
        """
        INSERT INTO retrieval_units (
            video_id,
            unit_type,
            unit_index,
            timestamp_start,
            timestamp_end,
            content_text,
            transcript,
            visual_desc,
            visual_type,
            keyframe_url,
            metadata,
            embedding
        )
        VALUES (
            $1::uuid,
            'speech',
            0,
            0,
            10,
            'Karpathy segment',
            'Karpathy transcript',
            NULL,
            NULL,
            'https://cdn.cerul.ai/frames/karpathy/000.jpg',
            '{}'::jsonb,
            $2::vector
        )
        RETURNING id
        """,
        first_video_id,
        vector_to_literal(build_placeholder_vector("karpathy", DEFAULT_KNOWLEDGE_VECTOR_DIMENSION)),
    )
    database.fetchval(
        """
        INSERT INTO retrieval_units (
            video_id,
            unit_type,
            unit_index,
            timestamp_start,
            timestamp_end,
            content_text,
            transcript,
            visual_desc,
            visual_type,
            keyframe_url,
            metadata,
            embedding
        )
        VALUES (
            $1::uuid,
            'speech',
            0,
            0,
            10,
            'Prompt caching segment',
            'Prompt caching transcript',
            NULL,
            NULL,
            'https://cdn.cerul.ai/frames/prompt/000.jpg',
            '{}'::jsonb,
            $2::vector
        )
        RETURNING id
        """,
        second_video_id,
        vector_to_literal(build_placeholder_vector("prompt-caching", DEFAULT_KNOWLEDGE_VECTOR_DIMENSION)),
    )
    database.fetchval(
        """
        INSERT INTO processing_jobs (
            track,
            source_id,
            job_type,
            status,
            input_payload,
            created_at,
            updated_at
        )
        VALUES (
            'unified',
            NULL,
            'index_video',
            'completed',
            $1::jsonb,
            NOW(),
            NOW()
        )
        RETURNING id
        """,
        f'{{"video_id":"{second_video_id}","source":"youtube"}}',
    )

    by_url = admin_client.get("/admin/videos?query=LCEmiRjPEtQ&limit=10&offset=0")

    assert by_url.status_code == 200
    url_payload = by_url.json()
    assert url_payload["total"] == 1
    assert url_payload["videos"][0]["video_id"] == str(first_video_id)
    assert url_payload["videos"][0]["source_url"] == "https://www.youtube.com/watch?v=LCEmiRjPEtQ"

    paged = admin_client.get("/admin/videos?limit=1&offset=1")

    assert paged.status_code == 200
    paged_payload = paged.json()
    assert paged_payload["total"] >= 2
    assert paged_payload["limit"] == 1
    assert paged_payload["offset"] == 1
    assert len(paged_payload["videos"]) == 1

    by_title = admin_client.get("/admin/videos?query=Prompt%20Catching")

    assert by_title.status_code == 200
    assert by_title.json()["total"] == 0

    exact_title = admin_client.get("/admin/videos?query=Prompt%20Caching")

    assert exact_title.status_code == 200
    title_payload = exact_title.json()
    assert title_payload["total"] == 1
    assert title_payload["videos"][0]["title"] == "Build Hour: Prompt Caching"
    assert title_payload["videos"][0]["last_job_status"] == "completed"


def test_admin_delete_indexed_video_removes_video_and_related_jobs(
    admin_client: TestClient,
    database,
) -> None:
    video_id = database.fetchval(
        """
        INSERT INTO videos (
            id,
            source,
            source_video_id,
            source_url,
            video_url,
            thumbnail_url,
            title,
            description,
            speaker,
            duration_seconds,
            metadata
        )
        VALUES (
            '33333333-3333-3333-3333-333333333333'::uuid,
            'youtube',
            'delete-me-123',
            'https://www.youtube.com/watch?v=delete-me-123',
            'https://www.youtube.com/watch?v=delete-me-123',
            'https://img.youtube.com/vi/delete-me-123/hqdefault.jpg',
            'Delete Me Demo',
            'Delete me.',
            'Host',
            600,
            '{}'::jsonb
        )
        RETURNING id
        """
    )
    unit_id = database.fetchval(
        """
        INSERT INTO retrieval_units (
            video_id,
            unit_type,
            unit_index,
            timestamp_start,
            timestamp_end,
            content_text,
            transcript,
            visual_desc,
            visual_type,
            keyframe_url,
            metadata,
            embedding
        )
        VALUES (
            $1::uuid,
            'speech',
            0,
            0,
            10,
            'Delete me segment',
            'Delete me transcript',
            NULL,
            NULL,
            'https://cdn.cerul.ai/frames/delete/000.jpg',
            '{}'::jsonb,
            $2::vector
        )
        RETURNING id
        """,
        video_id,
        vector_to_literal(build_placeholder_vector("delete-me", DEFAULT_KNOWLEDGE_VECTOR_DIMENSION)),
    )
    database.fetchval(
        """
        INSERT INTO video_access (
            video_id,
            owner_id,
            created_at
        )
        VALUES (
            $1::uuid,
            $2,
            NOW()
        )
        RETURNING video_id
        """,
        video_id,
        TEST_USER_ID,
    )
    database.fetchval(
        """
        INSERT INTO tracking_links (
            short_id,
            request_id,
            result_rank,
            video_id,
            unit_id,
            target_url,
            created_at
        )
        VALUES (
            'delete01',
            'req_delete_video',
            0,
            $1::uuid,
            $2::uuid,
            'https://www.youtube.com/watch?v=delete-me-123&t=0',
            NOW()
        )
        RETURNING short_id
        """,
        video_id,
        unit_id,
    )
    job_id = database.fetchval(
        """
        INSERT INTO processing_jobs (
            track,
            source_id,
            job_type,
            status,
            input_payload,
            created_at,
            updated_at
        )
        VALUES (
            'unified',
            NULL,
            'index_video',
            'completed',
            $1::jsonb,
            NOW(),
            NOW()
        )
        RETURNING id
        """,
        f'{{"video_id":"{video_id}","source":"youtube"}}',
    )
    database.fetchval(
        """
        INSERT INTO processing_job_steps (
            job_id,
            step_name,
            status,
            artifacts,
            created_at,
            updated_at
        )
        VALUES (
            $1::uuid,
            'PersistUnifiedUnitsStep',
            'completed',
            '{}'::jsonb,
            NOW(),
            NOW()
        )
        RETURNING id
        """,
        job_id,
    )

    response = admin_client.delete(f"/admin/videos/{video_id}")

    assert response.status_code == 200
    assert response.json() == {
        "ok": True,
        "video_id": str(video_id),
        "title": "Delete Me Demo",
        "units_deleted": 1,
        "processing_jobs_deleted": 1,
    }
    assert database.fetchval("SELECT COUNT(*) FROM videos WHERE id = $1::uuid", video_id) == 0
    assert database.fetchval("SELECT COUNT(*) FROM retrieval_units WHERE video_id = $1::uuid", video_id) == 0
    assert database.fetchval("SELECT COUNT(*) FROM processing_jobs WHERE id = $1::uuid", job_id) == 0
    assert database.fetchval("SELECT COUNT(*) FROM processing_job_steps WHERE job_id = $1::uuid", job_id) == 0
    assert database.fetchval("SELECT COUNT(*) FROM video_access WHERE video_id = $1::uuid", video_id) == 0
    assert database.fetchval("SELECT COUNT(*) FROM tracking_links WHERE short_id = 'delete01'") == 1
    assert (
        database.fetchval(
            """
            SELECT target_url
            FROM tracking_links
            WHERE short_id = 'delete01'
            """
        )
        == "https://www.youtube.com/watch?v=delete-me-123&t=0"
    )


def test_admin_retry_failed_job_resets_failed_state(
    admin_client: TestClient,
    database,
) -> None:
    source_id = database.fetchval(
        "SELECT id FROM content_sources WHERE slug = 'youtube-openai'"
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
            locked_by,
            locked_at,
            next_retry_at,
            created_at,
            updated_at
        )
        VALUES (
            'knowledge',
            $1::uuid,
            'index_video',
            'failed',
            '{"video_id":"retry-me"}'::jsonb,
            'ASR timeout',
            3,
            3,
            'worker-a',
            NOW(),
            NOW() + INTERVAL '5 minutes',
            NOW(),
            NOW()
        )
        RETURNING id
        """,
        source_id,
    )

    response = admin_client.post(f"/admin/jobs/{failed_job_id}/retry")

    assert response.status_code == 200
    assert response.json() == {"ok": True, "job_id": str(failed_job_id)}
    row = database.fetchrow(
        """
        SELECT status, attempts, error_message, locked_by, locked_at, next_retry_at
        FROM processing_jobs
        WHERE id = $1::uuid
        """,
        failed_job_id,
    )
    assert row["status"] == "pending"
    assert row["attempts"] == 0
    assert row["error_message"] is None
    assert row["locked_by"] is None
    assert row["locked_at"] is None
    assert row["next_retry_at"] is None


def test_admin_kill_failed_job_deletes_job_and_steps(
    admin_client: TestClient,
    database,
) -> None:
    source_id = database.fetchval(
        "SELECT id FROM content_sources WHERE slug = 'youtube-openai'"
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
            created_at,
            updated_at
        )
        VALUES (
            'knowledge',
            $1::uuid,
            'index_video',
            'failed',
            '{"video_id":"kill-me"}'::jsonb,
            'Vision timeout',
            3,
            3,
            NOW(),
            NOW()
        )
        RETURNING id
        """,
        source_id,
    )
    database.fetchval(
        """
        INSERT INTO processing_job_steps (
            job_id,
            step_name,
            status,
            artifacts,
            error_message,
            created_at,
            updated_at
        )
        VALUES (
            $1::uuid,
            'AnalyzeKnowledgeFramesStep',
            'failed',
            '{}'::jsonb,
            'Vision timeout',
            NOW(),
            NOW()
        )
        RETURNING id
        """,
        failed_job_id,
    )

    response = admin_client.post(f"/admin/jobs/{failed_job_id}/kill")

    assert response.status_code == 200
    assert response.json() == {"ok": True, "job_id": str(failed_job_id)}
    assert database.fetchval(
        "SELECT COUNT(*) FROM processing_jobs WHERE id = $1::uuid",
        failed_job_id,
    ) == 0
    assert database.fetchval(
        "SELECT COUNT(*) FROM processing_job_steps WHERE job_id = $1::uuid",
        failed_job_id,
    ) == 0


def test_admin_retry_failed_job_returns_not_found_for_non_failed_job(
    admin_client: TestClient,
    database,
) -> None:
    source_id = database.fetchval(
        "SELECT id FROM content_sources WHERE slug = 'youtube-openai'"
    )
    running_job_id = database.fetchval(
        """
        INSERT INTO processing_jobs (
            track,
            source_id,
            job_type,
            status,
            input_payload,
            created_at,
            updated_at
        )
        VALUES (
            'knowledge',
            $1::uuid,
            'index_video',
            'running',
            '{"video_id":"still-running"}'::jsonb,
            NOW(),
            NOW()
        )
        RETURNING id
        """,
        source_id,
    )

    response = admin_client.post(f"/admin/jobs/{running_job_id}/retry")

    assert response.status_code == 404
    assert response.json()["detail"] == "Job not found or not in failed state."


def test_admin_kill_failed_job_returns_not_found_for_non_failed_job(
    admin_client: TestClient,
    database,
) -> None:
    source_id = database.fetchval(
        "SELECT id FROM content_sources WHERE slug = 'youtube-openai'"
    )
    running_job_id = database.fetchval(
        """
        INSERT INTO processing_jobs (
            track,
            source_id,
            job_type,
            status,
            input_payload,
            created_at,
            updated_at
        )
        VALUES (
            'knowledge',
            $1::uuid,
            'index_video',
            'running',
            '{"video_id":"still-running"}'::jsonb,
            NOW(),
            NOW()
        )
        RETURNING id
        """,
        source_id,
    )

    response = admin_client.post(f"/admin/jobs/{running_job_id}/kill")

    assert response.status_code == 404
    assert response.json()["detail"] == "Job not found or not in failed state."


@pytest.mark.parametrize("action", ["retry", "kill"])
def test_admin_failed_job_actions_ignore_cancelled_jobs(
    admin_client: TestClient,
    database,
    action: str,
) -> None:
    source_id = database.fetchval(
        "SELECT id FROM content_sources WHERE slug = 'youtube-openai'"
    )
    cancelled_job_id = database.fetchval(
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
            created_at,
            updated_at
        )
        VALUES (
            'knowledge',
            $1::uuid,
            'index_video',
            'failed',
            '{"video_id":"cancelled-action","cancelled_by_user":true}'::jsonb,
            'Cancelled by user.',
            1,
            3,
            NOW(),
            NOW()
        )
        RETURNING id
        """,
        source_id,
    )

    response = admin_client.post(f"/admin/jobs/{cancelled_job_id}/{action}")

    assert response.status_code == 404
    assert response.json()["detail"] == "Job not found or not in failed state."


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
