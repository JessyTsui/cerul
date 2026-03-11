import re

import pytest
from fastapi.testclient import TestClient

import app.auth.api_key as api_key_module
from app.auth import AuthContext, require_api_key
from app.auth.api_key import hash_api_key
from app.main import app
from app.middleware.rate_limit import InMemoryTokenBucketRateLimiter

TEST_USER_ID = "user_stub"
TEST_API_KEY_ID = "00000000-0000-0000-0000-000000000001"
TEST_API_KEY = "cerul_sk_abcdefghijklmnopqrstuvwxyz123456"
SECOND_TEST_API_KEY_ID = "00000000-0000-0000-0000-000000000002"
SECOND_TEST_API_KEY = "cerul_sk_1234567890abcdefghijklmnopqrstuv"


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


def test_search_endpoint_records_usage_and_query_logs(database) -> None:
    app.dependency_overrides[require_api_key] = override_auth

    with TestClient(app) as client:
        response = client.post(
            "/v1/search",
            json={
                "query": "cinematic drone shot of coastal highway at sunset",
                "search_type": "broll",
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
    assert payload["results"][0]["id"] == "pexels_28192743"
    assert database.fetchval("SELECT COUNT(*) FROM query_logs") == 1


def test_search_endpoint_rejects_missing_auth_header() -> None:
    with TestClient(app) as client:
        response = client.post(
            "/v1/search",
            json={
                "query": "cinematic drone shot",
                "search_type": "broll",
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
                "search_type": "broll",
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
                "search_type": "broll",
            },
        )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthorized"


def test_search_endpoint_returns_documented_validation_shape() -> None:
    app.dependency_overrides[require_api_key] = override_auth

    with TestClient(app) as client:
        response = client.post(
            "/v1/search",
            json={
                "search_type": "broll",
            },
        )

    app.dependency_overrides.clear()

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_request"
    assert "Field required" in response.json()["error"]["message"]


def test_search_endpoint_reports_persisted_remaining_credits(database) -> None:
    app.dependency_overrides[require_api_key] = override_auth

    with TestClient(app) as client:
        first_response = client.post(
            "/v1/search",
            json={
                "query": "cinematic drone shot",
                "search_type": "broll",
            },
        )
        second_response = client.post(
            "/v1/search",
            json={
                "query": "cinematic drone shot",
                "search_type": "broll",
            },
        )

    app.dependency_overrides.clear()

    assert first_response.status_code == 200
    assert second_response.status_code == 200
    assert first_response.json()["credits_remaining"] == 999
    assert second_response.json()["credits_remaining"] == 998
    assert database.fetchval("SELECT COUNT(*) FROM usage_events") == 2


def test_usage_endpoint_returns_current_summary(database) -> None:
    app.dependency_overrides[require_api_key] = override_auth

    with TestClient(app) as client:
        search_response = client.post(
            "/v1/search",
            json={
                "query": "agent workflows",
                "search_type": "knowledge",
                "include_answer": True,
                "max_results": 1,
            },
        )
        usage_response = client.get("/v1/usage")

    app.dependency_overrides.clear()

    assert search_response.status_code == 200
    assert usage_response.status_code == 200
    payload = usage_response.json()
    assert payload["credits_used"] == 3
    assert payload["credits_remaining"] == 997
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
                "search_type": "broll",
            },
        )
        second = client.post(
            "/v1/search",
            headers={"Authorization": f"Bearer {TEST_API_KEY}"},
            json={
                "query": "cinematic drone shot",
                "search_type": "broll",
            },
        )
        clock.advance(1.0)
        third = client.post(
            "/v1/search",
            headers={"Authorization": f"Bearer {TEST_API_KEY}"},
            json={
                "query": "cinematic drone shot",
                "search_type": "broll",
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
                "search_type": "broll",
            },
        )
        second = client.post(
            "/v1/search",
            headers={"Authorization": f"Bearer {TEST_API_KEY}"},
            json={
                "query": "cinematic drone shot",
                "search_type": "broll",
            },
        )
        third = client.post(
            "/v1/search",
            headers={"Authorization": f"Bearer {SECOND_TEST_API_KEY}"},
            json={
                "query": "cinematic drone shot",
                "search_type": "broll",
            },
        )

    assert first.status_code == 200
    assert second.status_code == 429
    assert third.status_code == 200
