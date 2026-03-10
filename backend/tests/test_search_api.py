import re

from fastapi.testclient import TestClient

from app.auth import AuthContext, require_api_key
from app.db import create_stub_database, get_db
from app.main import app


def override_auth() -> AuthContext:
    return AuthContext(
        user_id="user_stub",
        api_key_id="key_stub",
        tier="free",
        credits_remaining=1000,
        rate_limit_per_sec=1,
    )


def test_search_endpoint_records_usage_and_query_logs() -> None:
    db = create_stub_database()

    async def override_db():
        yield db

    app.dependency_overrides[get_db] = override_db
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
    assert len(db.query_logs) == 1


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


def test_search_endpoint_reports_persisted_remaining_credits() -> None:
    db = create_stub_database()

    async def override_db():
        yield db

    app.dependency_overrides[get_db] = override_db
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


def test_usage_endpoint_returns_current_summary() -> None:
    db = create_stub_database()

    async def override_db():
        yield db

    app.dependency_overrides[get_db] = override_db
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
