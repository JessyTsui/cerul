from fastapi.testclient import TestClient

from app.auth import AuthContext, require_api_key
from app.indexing.service import UnifiedIndexService
from app.main import app
from app.search.base import DEFAULT_KNOWLEDGE_VECTOR_DIMENSION, build_placeholder_vector, vector_to_literal

TEST_USER_ID = "user_stub"
TEST_API_KEY_ID = "00000000-0000-0000-0000-000000000001"
TEST_INDEX_URL = "https://www.youtube.com/watch?v=unifieddemo01"


def override_auth() -> AuthContext:
    return AuthContext(
        user_id=TEST_USER_ID,
        api_key_id=TEST_API_KEY_ID,
        tier="free",
        credits_remaining=1000,
        rate_limit_per_sec=10,
    )


def test_submit_index_enqueues_unified_job(database) -> None:
    app.dependency_overrides[require_api_key] = override_auth

    with TestClient(app) as client:
        response = client.post(
            "/v1/index",
            json={
                "url": TEST_INDEX_URL,
            },
        )

    app.dependency_overrides.clear()

    assert response.status_code == 202
    payload = response.json()
    assert payload["status"] == "processing"
    assert database.fetchval("SELECT COUNT(*) FROM processing_jobs WHERE track = 'unified'") == 1
    assert database.fetchval(
        """
        SELECT input_payload->>'source'
        FROM processing_jobs
        WHERE track = 'unified'
        ORDER BY created_at DESC
        LIMIT 1
        """
    ) == "youtube"


def test_submit_index_reuses_existing_pending_job(database) -> None:
    app.dependency_overrides[require_api_key] = override_auth

    with TestClient(app) as client:
        first_response = client.post(
            "/v1/index",
            json={"url": TEST_INDEX_URL},
        )
        second_response = client.post(
            "/v1/index",
            json={"url": TEST_INDEX_URL},
        )

    app.dependency_overrides.clear()

    assert first_response.status_code == 202
    assert second_response.status_code == 202
    assert first_response.json()["video_id"] == second_response.json()["video_id"]
    assert database.fetchval("SELECT COUNT(*) FROM processing_jobs WHERE track = 'unified'") == 1


def test_force_reindex_keeps_existing_units_until_replacement(database) -> None:
    video_id = "11111111-1111-1111-1111-111111111111"
    vector = build_placeholder_vector(
        "existing retrieval unit",
        DEFAULT_KNOWLEDGE_VECTOR_DIMENSION,
    )
    database.fetchval(
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
            $1::uuid,
            'youtube',
            'unifieddemo01',
            $2,
            $2,
            'https://example.com/thumb.jpg',
            'Existing indexed video',
            'Existing description',
            'Cerul',
            120,
            '{}'::jsonb
        )
        RETURNING id::text
        """,
        video_id,
        TEST_INDEX_URL,
    )
    database.fetchval(
        """
        INSERT INTO video_access (video_id, owner_id)
        VALUES ($1::uuid, $2)
        RETURNING video_id::text
        """,
        video_id,
        TEST_USER_ID,
    )
    database.fetchval(
        """
        INSERT INTO retrieval_units (
            id,
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
            '22222222-2222-2222-2222-222222222222'::uuid,
            $1::uuid,
            'speech',
            0,
            0,
            30,
            'Existing indexed content',
            'Existing indexed transcript',
            NULL,
            NULL,
            'https://example.com/keyframe.jpg',
            '{}'::jsonb,
            $2::vector
        )
        RETURNING id::text
        """,
        video_id,
        vector_to_literal(vector),
    )

    app.dependency_overrides[require_api_key] = override_auth

    with TestClient(app) as client:
        response = client.post(
            "/v1/index",
            json={
                "url": TEST_INDEX_URL,
                "force": True,
            },
        )

    app.dependency_overrides.clear()

    assert response.status_code == 202
    assert response.json()["video_id"] == video_id
    assert database.fetchval(
        "SELECT COUNT(*) FROM retrieval_units WHERE video_id = $1::uuid",
        video_id,
    ) == 1


def test_get_index_status_and_list(database) -> None:
    app.dependency_overrides[require_api_key] = override_auth

    with TestClient(app) as client:
        submit_response = client.post(
            "/v1/index",
            json={"url": TEST_INDEX_URL},
        )
        video_id = submit_response.json()["video_id"]
        status_response = client.get(f"/v1/index/{video_id}")
        list_response = client.get("/v1/index?page=1&per_page=20")

    app.dependency_overrides.clear()

    assert status_response.status_code == 200
    assert status_response.json()["status"] == "processing"
    assert list_response.status_code == 200
    assert list_response.json()["total"] == 1
    assert list_response.json()["videos"][0]["video_id"] == video_id


def test_get_index_status_returns_404_for_non_uuid_id(database) -> None:
    app.dependency_overrides[require_api_key] = override_auth

    with TestClient(app) as client:
        response = client.get("/v1/index/U-TSafAIzXw")

    app.dependency_overrides.clear()

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


def test_delete_indexed_video_removes_owner_access_and_video(database) -> None:
    app.dependency_overrides[require_api_key] = override_auth

    with TestClient(app) as client:
        submit_response = client.post(
            "/v1/index",
            json={"url": TEST_INDEX_URL},
        )
        video_id = submit_response.json()["video_id"]
        delete_response = client.delete(f"/v1/index/{video_id}")

    app.dependency_overrides.clear()

    assert delete_response.status_code == 200
    assert delete_response.json() == {"deleted": True}
    assert database.fetchval(
        "SELECT COUNT(*) FROM video_access WHERE video_id = $1::uuid",
        video_id,
    ) == 0
    assert database.fetchval(
        "SELECT COUNT(*) FROM videos WHERE id = $1::uuid",
        video_id,
    ) == 0


def test_submit_index_rejects_unsupported_url() -> None:
    app.dependency_overrides[require_api_key] = override_auth

    with TestClient(app) as client:
        response = client.post(
            "/v1/index",
            json={"url": "https://example.com/not-a-video"},
        )

    app.dependency_overrides.clear()

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_request"


def test_submit_index_rejects_video_longer_than_four_hours(database, monkeypatch) -> None:
    async def fake_duration(
        self,
        *,
        url: str,
        source: str,
        source_video_id: str,
    ) -> int | None:
        return 4 * 60 * 60 + 1

    monkeypatch.setattr(
        UnifiedIndexService,
        "_fetch_source_duration_seconds",
        fake_duration,
    )
    app.dependency_overrides[require_api_key] = override_auth

    with TestClient(app) as client:
        response = client.post(
            "/v1/index",
            json={"url": TEST_INDEX_URL},
        )

    app.dependency_overrides.clear()

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_request"
    assert "4 hours" in response.json()["error"]["message"]
