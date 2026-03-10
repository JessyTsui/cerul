from __future__ import annotations

from datetime import datetime, timezone
from typing import cast

import pytest
from fastapi.testclient import TestClient

from app.auth import SessionContext, require_session
from app.db import get_db
from app.main import app
from app.routers import dashboard


class DashboardDb:
    def __init__(self) -> None:
        self.profiles: dict[str, dict[str, object]] = {}
        self.api_keys: list[dict[str, object]] = []
        self.usage_summaries: dict[tuple[str, object, object], dict[str, object]] = {}
        self.daily_usage: list[dict[str, object]] = []

    async def fetchrow(self, query: str, *params: object) -> dict[str, object] | None:
        normalized = " ".join(query.split())

        if "FROM user_profiles" in normalized:
            return self.profiles.get(str(params[0]))

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

        raise AssertionError(f"Unhandled fetchrow query: {normalized}")

    async def fetchval(self, query: str, *params: object) -> int:
        normalized = " ".join(query.split())
        if "SELECT COUNT(*)" not in normalized:
            raise AssertionError(f"Unhandled fetchval query: {normalized}")

        user_id = str(params[0])
        return sum(
            1
            for api_key in self.api_keys
            if api_key["user_id"] == user_id and bool(api_key["is_active"])
        )

    async def fetch(self, query: str, *params: object) -> list[dict[str, object]]:
        normalized = " ".join(query.split())

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


def session_override() -> SessionContext:
    return SessionContext(user_id="user_123", email="owner@example.com")


@pytest.fixture
def client() -> TestClient:
    db = DashboardDb()

    async def get_db_override() -> DashboardDb:
        return db

    app.dependency_overrides[get_db] = get_db_override
    app.dependency_overrides[require_session] = session_override

    with TestClient(app) as test_client:
        test_client.app.state.test_db = db
        yield test_client

    app.dependency_overrides.clear()
    if hasattr(app.state, "test_db"):
        delattr(app.state, "test_db")


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
