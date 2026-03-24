import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import app.auth.api_key as api_key_module
import app.routers.search as search_router
from app.auth import AuthContext, require_api_key
from app.auth.api_key import hash_api_key
from app.embedding.gemini import GeminiEmbeddingBackend
from app.main import app
from app.middleware.rate_limit import InMemoryTokenBucketRateLimiter
from app.search.base import build_placeholder_vector

TEST_USER_ID = "user_stub"
TEST_API_KEY_ID = "00000000-0000-0000-0000-000000000001"
TEST_API_KEY = "cerul_sk_abcdefghijklmnopqrstuvwxyz123456"
SECOND_TEST_API_KEY_ID = "00000000-0000-0000-0000-000000000002"
SECOND_TEST_API_KEY = "cerul_sk_1234567890abcdefghijklmnopqrstuv"
TEST_UNIFIED_BROLL_UNIT_ID = "00000000-0000-0000-0000-000000000031"


class FakeClock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


def override_auth() -> AuthContext:
    return AuthContext(
        user_id=TEST_USER_ID,
        api_key_id=TEST_API_KEY_ID,
        tier="free",
        credits_remaining=1000,
        rate_limit_per_sec=10,
    )


@pytest.fixture(autouse=True)
def stub_query_embeddings(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_embed_text(self: GeminiEmbeddingBackend, text: str) -> list[float]:
        return build_placeholder_vector(text, self.dimension())

    def fake_embed_query_with_image(
        self: GeminiEmbeddingBackend,
        text: str | None = None,
        *,
        image_path: str | Path | None = None,
    ) -> list[float]:
        seed = text or (f"image:{Path(image_path).name}" if image_path is not None else "image")
        return build_placeholder_vector(seed, self.dimension())

    monkeypatch.setattr(GeminiEmbeddingBackend, "embed_text", fake_embed_text)
    monkeypatch.setattr(GeminiEmbeddingBackend, "embed_query", fake_embed_text)
    monkeypatch.setattr(
        GeminiEmbeddingBackend,
        "embed_query_with_image",
        fake_embed_query_with_image,
    )


def test_search_endpoint_records_usage_query_logs_and_tracking_links(database) -> None:
    app.dependency_overrides[require_api_key] = override_auth

    with TestClient(app) as client:
        response = client.post(
            "/v1/search",
            json={
                "query": "cinematic drone shot of coastal highway at sunset",
                "max_results": 5,
                "filters": {
                    "min_duration": 5,
                    "max_duration": 30,
                    "source": "pexels",
                },
            },
        )

    app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = response.json()
    assert payload["credits_used"] == 1
    assert payload["credits_remaining"] == 999
    assert re.fullmatch(r"req_[a-f0-9]{24}", payload["request_id"])
    assert payload["results"][0]["id"] == TEST_UNIFIED_BROLL_UNIT_ID
    assert payload["results"][0]["unit_type"] == "visual"
    assert payload["results"][0]["url"].startswith(("http://localhost:3000/v/", "http://127.0.0.1:3000/v/"))
    assert database.fetchval("SELECT COUNT(*) FROM query_logs") == 1
    assert database.fetchval("SELECT COUNT(*) FROM tracking_links") == 1
    latency_ms = database.fetchval(
        "SELECT latency_ms FROM query_logs WHERE request_id = $1",
        payload["request_id"],
    )
    assert latency_ms is not None
    assert int(latency_ms) >= 0
    assert database.fetchval(
        "SELECT search_type FROM query_logs WHERE request_id = $1",
        payload["request_id"],
    ) == "unified"


def test_search_endpoint_rejects_missing_auth_header() -> None:
    with TestClient(app) as client:
        response = client.post(
            "/v1/search",
            json={
                "query": "cinematic drone shot",
            },
        )

    assert response.status_code == 401
    assert response.json() == {
        "error": {
            "code": "unauthorized",
            "message": "Missing Authorization header",
        }
    }


def test_search_endpoint_rejects_malformed_api_key() -> None:
    with TestClient(app) as client:
        response = client.post(
            "/v1/search",
            headers={"Authorization": "Bearer cerul_sk_short"},
            json={
                "query": "cinematic drone shot",
            },
        )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthorized"


def test_search_endpoint_rejects_unknown_but_well_formed_api_key() -> None:
    with TestClient(app) as client:
        response = client.post(
            "/v1/search",
            headers={
                "Authorization": "Bearer cerul_sk_1234567890abcdef1234567890abcdef"
            },
            json={
                "query": "cinematic drone shot",
            },
        )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthorized"


def test_search_endpoint_returns_documented_validation_shape() -> None:
    app.dependency_overrides[require_api_key] = override_auth

    with TestClient(app) as client:
        response = client.post(
            "/v1/search",
            json={},
        )

    app.dependency_overrides.clear()

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_request"
    assert "At least one of 'query' or 'image' must be provided" in response.json()["error"]["message"]


def test_search_endpoint_reports_persisted_remaining_credits(database) -> None:
    app.dependency_overrides[require_api_key] = override_auth

    with TestClient(app) as client:
        first_response = client.post(
            "/v1/search",
            json={
                "query": "cinematic drone shot",
            },
        )
        second_response = client.post(
            "/v1/search",
            json={
                "query": "cinematic drone shot",
            },
        )

    app.dependency_overrides.clear()

    assert first_response.status_code == 200
    assert second_response.status_code == 200
    assert first_response.json()["credits_remaining"] == 999
    assert second_response.json()["credits_remaining"] == 998
    assert database.fetchval("SELECT COUNT(*) FROM usage_events") == 2


def test_search_endpoint_accepts_json_base64_image(
    database,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app.dependency_overrides[require_api_key] = override_auth
    image_path = tmp_path / "query-base64.jpg"
    image_path.write_bytes(b"query-image")
    uploaded: list[tuple[str, str]] = []
    cleaned: list[str] = []

    async def fake_resolve_image_to_local(**kwargs):
        assert kwargs["base64_str"] == "aGVsbG8="
        return image_path, "image/jpeg"

    async def fake_upload_query_image_to_r2(path: Path, *, request_id: str) -> str:
        uploaded.append((str(path), request_id))
        return "query-inputs/2026-03-23/req_stub/query-base64.jpg"

    def fake_cleanup_local_image(path: Path) -> None:
        cleaned.append(str(path))
        path.unlink(missing_ok=True)

    monkeypatch.setattr(search_router, "resolve_image_to_local", fake_resolve_image_to_local)
    monkeypatch.setattr(search_router, "upload_query_image_to_r2", fake_upload_query_image_to_r2)
    monkeypatch.setattr(search_router, "cleanup_local_image", fake_cleanup_local_image)

    with TestClient(app) as client:
        response = client.post(
            "/v1/search",
            json={
                "image": {
                    "base64": "aGVsbG8=",
                },
                "max_results": 1,
            },
        )

    app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = response.json()
    assert payload["results"]
    assert uploaded == [(str(image_path), payload["request_id"])]
    assert cleaned == [str(image_path)]
    assert database.fetchval(
        "SELECT query_text FROM query_logs WHERE request_id = $1",
        payload["request_id"],
    ) == ""


def test_search_endpoint_accepts_json_image_url_with_text(
    database,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app.dependency_overrides[require_api_key] = override_auth
    image_path = tmp_path / "query-url.jpg"
    image_path.write_bytes(b"query-image")

    async def fake_resolve_image_to_local(**kwargs):
        assert kwargs["url"] == "https://example.com/query.jpg"
        return image_path, "image/jpeg"

    async def fake_upload_query_image_to_r2(path: Path, *, request_id: str) -> str:
        return "query-inputs/2026-03-23/req_stub/query-url.jpg"

    def fake_cleanup_local_image(path: Path) -> None:
        path.unlink(missing_ok=True)

    monkeypatch.setattr(search_router, "resolve_image_to_local", fake_resolve_image_to_local)
    monkeypatch.setattr(search_router, "upload_query_image_to_r2", fake_upload_query_image_to_r2)
    monkeypatch.setattr(search_router, "cleanup_local_image", fake_cleanup_local_image)

    with TestClient(app) as client:
        response = client.post(
            "/v1/search",
            json={
                "query": "fireplace interview",
                "image": {
                    "url": "https://example.com/query.jpg",
                },
                "max_results": 1,
            },
        )

    app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = response.json()
    assert payload["results"]
    assert database.fetchval(
        "SELECT query_text FROM query_logs WHERE request_id = $1",
        payload["request_id"],
    ) == "fireplace interview"


def test_search_upload_endpoint_accepts_image_file_bytes(
    database,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app.dependency_overrides[require_api_key] = override_auth
    image_path = tmp_path / "query-upload.jpg"
    image_path.write_bytes(b"query-image")
    uploaded: list[tuple[str, str]] = []

    async def fake_resolve_image_to_local(**kwargs):
        assert kwargs["file_bytes"] == b"file-image"
        assert kwargs["file_content_type"] == "image/jpeg"
        return image_path, "image/jpeg"

    async def fake_upload_query_image_to_r2(path: Path, *, request_id: str) -> str:
        uploaded.append((str(path), request_id))
        return "query-inputs/2026-03-23/req_stub/query-upload.jpg"

    def fake_cleanup_local_image(path: Path) -> None:
        path.unlink(missing_ok=True)

    monkeypatch.setattr(search_router, "resolve_image_to_local", fake_resolve_image_to_local)
    monkeypatch.setattr(search_router, "upload_query_image_to_r2", fake_upload_query_image_to_r2)
    monkeypatch.setattr(search_router, "cleanup_local_image", fake_cleanup_local_image)

    with TestClient(app) as client:
        response = client.post(
            "/v1/search",
            data={
                "query": "fireplace interview",
                "max_results": "1",
            },
            files={
                "image_file": ("query.jpg", b"file-image", "image/jpeg"),
            },
        )

    app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = response.json()
    assert payload["results"]
    assert uploaded == [(str(image_path), payload["request_id"])]
    assert database.fetchval(
        "SELECT query_text FROM query_logs WHERE request_id = $1",
        payload["request_id"],
    ) == "fireplace interview"


def test_search_endpoint_rejects_request_when_remaining_credits_are_below_cost(database) -> None:
    database.fetchval(
        "UPDATE user_profiles SET monthly_credit_limit = 1 WHERE id = $1 RETURNING id",
        TEST_USER_ID,
    )

    search_called = False

    class StubService:
        async def search(self, payload, *, user_id: str, request_id: str):
            nonlocal search_called
            search_called = True
            return search_router.SearchExecution(results=[], answer=None, tracking_links=[])

    app.dependency_overrides[require_api_key] = override_auth

    with pytest.MonkeyPatch.context() as monkeypatch:
        monkeypatch.setattr(search_router, "resolve_search_service", lambda *_args, **_kwargs: StubService())

        with TestClient(app) as client:
            response = client.post(
                "/v1/search",
                json={
                    "query": "agent workflows",
                    "include_answer": True,
                    "max_results": 1,
                },
            )

    app.dependency_overrides.clear()

    assert response.status_code == 403
    assert response.json() == {
        "error": {
            "code": "forbidden",
            "message": "Insufficient credits for this request",
        }
    }
    assert search_called is False


def test_search_endpoint_reserves_credits_before_service_execution(database) -> None:
    observed_usage_count: int | None = None

    class StubService:
        async def search(self, payload, *, user_id: str, request_id: str, image_path=None):
            nonlocal observed_usage_count
            observed_usage_count = await database.fetchval_async(
                "SELECT COUNT(*) FROM usage_events WHERE request_id = $1",
                request_id,
            )
            return search_router.SearchExecution(results=[], answer=None, tracking_links=[])

    app.dependency_overrides[require_api_key] = override_auth

    with pytest.MonkeyPatch.context() as monkeypatch:
        monkeypatch.setattr(search_router, "resolve_search_service", lambda *_args, **_kwargs: StubService())

        with TestClient(app) as client:
            response = client.post(
                "/v1/search",
                json={
                    "query": "agent workflows",
                    "max_results": 1,
                },
            )

    app.dependency_overrides.clear()

    assert response.status_code == 200
    assert observed_usage_count == 1


def test_search_endpoint_refunds_reserved_credits_when_search_fails(database) -> None:
    class StubService:
        async def search(self, payload, *, user_id: str, request_id: str, image_path=None):
            raise RuntimeError("embedding backend exploded")

    app.dependency_overrides[require_api_key] = override_auth

    with pytest.MonkeyPatch.context() as monkeypatch:
        monkeypatch.setattr(search_router, "resolve_search_service", lambda *_args, **_kwargs: StubService())

        with TestClient(app, raise_server_exceptions=False) as client:
            response = client.post(
                "/v1/search",
                json={
                    "query": "agent workflows",
                    "max_results": 1,
                },
            )

    app.dependency_overrides.clear()

    assert response.status_code == 500
    assert database.fetchval("SELECT COUNT(*) FROM usage_events") == 0
    usage_row = database.fetchrow(
        """
        SELECT credits_used, request_count
        FROM usage_monthly
        WHERE user_id = $1
        """,
        TEST_USER_ID,
    )
    assert usage_row["credits_used"] == 0
    assert usage_row["request_count"] == 0


def test_usage_endpoint_returns_current_summary() -> None:
    app.dependency_overrides[require_api_key] = override_auth

    with TestClient(app) as client:
        search_response = client.post(
            "/v1/search",
            json={
                "query": "agent workflows",
                "include_answer": True,
                "max_results": 1,
            },
        )
        usage_response = client.get("/v1/usage")

    app.dependency_overrides.clear()

    assert search_response.status_code == 200
    assert usage_response.status_code == 200
    payload = usage_response.json()
    assert payload["credits_used"] == 2
    assert payload["credits_remaining"] == 998
    assert payload["api_keys_active"] == 1
    assert payload["tier"] == "free"


def test_search_endpoint_rate_limit_recovers_after_one_second(
    database,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    database.fetchval(
        """
        UPDATE user_profiles
        SET rate_limit_per_sec = 1
        WHERE id = $1
        RETURNING rate_limit_per_sec
        """,
        TEST_USER_ID,
    )
    clock = FakeClock()
    limiter = InMemoryTokenBucketRateLimiter(clock=clock)
    monkeypatch.setattr(api_key_module, "get_rate_limiter", lambda: limiter)

    with TestClient(app) as client:
        first = client.post(
            "/v1/search",
            headers={"Authorization": f"Bearer {TEST_API_KEY}"},
            json={
                "query": "cinematic drone shot",
            },
        )
        second = client.post(
            "/v1/search",
            headers={"Authorization": f"Bearer {TEST_API_KEY}"},
            json={
                "query": "cinematic drone shot",
            },
        )
        clock.advance(1.0)
        third = client.post(
            "/v1/search",
            headers={"Authorization": f"Bearer {TEST_API_KEY}"},
            json={
                "query": "cinematic drone shot",
            },
        )

    assert first.status_code == 200
    assert second.status_code == 429
    assert second.json() == {
        "error": {
            "code": "rate_limited",
            "message": "Rate limit exceeded",
        }
    }
    assert second.headers["Retry-After"] == "1"
    assert third.status_code == 200
    assert database.fetchval(
        "SELECT last_used_at IS NOT NULL FROM api_keys WHERE id = $1::uuid",
        TEST_API_KEY_ID,
    ) is True


def test_search_endpoint_rate_limit_is_isolated_per_api_key(
    database,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    database.fetchval(
        """
        UPDATE user_profiles
        SET rate_limit_per_sec = 1
        WHERE id = $1
        RETURNING rate_limit_per_sec
        """,
        TEST_USER_ID,
    )
    database.fetchval(
        """
        INSERT INTO api_keys (id, user_id, name, key_hash, prefix, is_active)
        VALUES ($1::uuid, $2, $3, $4, $5, TRUE)
        RETURNING id::text
        """,
        SECOND_TEST_API_KEY_ID,
        TEST_USER_ID,
        "Second key",
        hash_api_key(SECOND_TEST_API_KEY),
        SECOND_TEST_API_KEY[:16],
    )
    limiter = InMemoryTokenBucketRateLimiter(clock=FakeClock())
    monkeypatch.setattr(api_key_module, "get_rate_limiter", lambda: limiter)

    with TestClient(app) as client:
        first = client.post(
            "/v1/search",
            headers={"Authorization": f"Bearer {TEST_API_KEY}"},
            json={
                "query": "cinematic drone shot",
            },
        )
        second = client.post(
            "/v1/search",
            headers={"Authorization": f"Bearer {TEST_API_KEY}"},
            json={
                "query": "cinematic drone shot",
            },
        )
        third = client.post(
            "/v1/search",
            headers={"Authorization": f"Bearer {SECOND_TEST_API_KEY}"},
            json={
                "query": "cinematic drone shot",
            },
        )

    assert first.status_code == 200
    assert second.status_code == 429
    assert third.status_code == 200
