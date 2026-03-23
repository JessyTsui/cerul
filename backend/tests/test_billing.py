from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import time
from datetime import date, datetime, timezone
from types import SimpleNamespace
from typing import Any

import asyncpg
import pytest
import stripe
from fastapi.testclient import TestClient

from app.auth import SessionContext, require_session
from app.billing.credits import InsufficientCreditsError, current_billing_period, deduct_credits
from app.billing.stripe_service import StripeServiceError
from app.config import reset_settings_cache
from app.db import get_db
from app.main import app
from app.routers import dashboard
from app.routers.dashboard import get_current_billing_period
from app.billing import stripe_service

TEST_USER_ID = "user_stub"
TEST_API_KEY_ID = "00000000-0000-0000-0000-000000000001"


def _run_async(coroutine: Any) -> Any:
    return asyncio.run(coroutine)


def session_override() -> SessionContext:
    return SessionContext(user_id="user_123", email="owner@example.com")


class DashboardBillingDb:
    def __init__(self) -> None:
        self.profiles: dict[str, dict[str, object]] = {}
        self.api_keys: list[dict[str, object]] = []
        self.usage_summaries: dict[tuple[str, object, object], dict[str, object]] = {}
        self.daily_usage: list[dict[str, object]] = []

    async def fetchrow(self, query: str, *params: object) -> dict[str, object] | None:
        normalized = " ".join(query.split())

        if "FROM user_profiles" in normalized:
            return self.profiles.get(str(params[0]))

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

        if "FROM usage_events" in normalized:
            period_start = params[1]
            period_end = params[2]
            return [
                point
                for point in self.daily_usage
                if period_start <= point["date"] <= period_end
            ]

        raise AssertionError(f"Unhandled fetch query: {normalized}")


class StripeWebhookDb:
    def __init__(self) -> None:
        self.profiles: dict[str, dict[str, object]] = {}
        self.stripe_events: dict[str, dict[str, object]] = {}
        self.checkout_updates = 0
        self.subscription_updates = 0

    def transaction(self):
        class _Transaction:
            async def __aenter__(self) -> None:
                return None

            async def __aexit__(self, exc_type, exc, tb) -> bool:
                return False

        return _Transaction()

    async def fetchrow(self, query: str, *params: object) -> dict[str, object] | None:
        normalized = " ".join(query.split())

        if "INSERT INTO stripe_events" in normalized:
            stripe_event_id = str(params[0])
            if stripe_event_id in self.stripe_events:
                return None

            created = {
                "stripe_event_id": stripe_event_id,
                "event_type": str(params[1]),
                "payload": params[2],
                "processed_at": None,
            }
            self.stripe_events[stripe_event_id] = created
            return {
                "stripe_event_id": stripe_event_id,
                "processed_at": None,
            }

        if "FROM stripe_events" in normalized:
            event = self.stripe_events.get(str(params[0]))
            if event is None:
                return None
            return {
                "stripe_event_id": str(params[0]),
                "processed_at": event["processed_at"],
            }

        raise AssertionError(f"Unhandled fetchrow query: {normalized}")

    async def execute(self, query: str, *params: object) -> str:
        normalized = " ".join(query.split())

        if "UPDATE stripe_events" in normalized:
            stripe_event_id = str(params[0])
            self.stripe_events[stripe_event_id]["processed_at"] = datetime.now(
                timezone.utc,
            )
            return "UPDATE 1"

        if "WHERE id = $5" in normalized:
            tier, monthly_limit, customer_id, subscription_id, user_id = params
            profile = self.profiles.get(str(user_id))
            if profile is None:
                return "UPDATE 0"
            profile["tier"] = str(tier)
            profile["monthly_credit_limit"] = int(monthly_limit)
            profile["stripe_customer_id"] = customer_id
            profile["stripe_subscription_id"] = subscription_id
            self.checkout_updates += 1
            return "UPDATE 1"

        if "WHERE stripe_customer_id = $3" in normalized:
            tier, monthly_limit, customer_id, subscription_id = params
            updated = 0
            for profile in self.profiles.values():
                if profile.get("stripe_customer_id") == customer_id:
                    profile["tier"] = str(tier)
                    profile["monthly_credit_limit"] = int(monthly_limit)
                    profile["stripe_subscription_id"] = subscription_id
                    updated += 1
            self.subscription_updates += updated
            return f"UPDATE {updated}"

        raise AssertionError(f"Unhandled execute query: {normalized}")


@pytest.fixture(autouse=True)
def reset_cached_settings() -> None:
    reset_settings_cache()
    yield
    reset_settings_cache()


@pytest.fixture
def dashboard_client() -> TestClient:
    db = DashboardBillingDb()

    async def get_db_override() -> DashboardBillingDb:
        return db

    app.dependency_overrides[get_db] = get_db_override
    app.dependency_overrides[require_session] = session_override

    with TestClient(app) as test_client:
        test_client.app.state.test_db = db
        yield test_client

    app.dependency_overrides.clear()
    if hasattr(app.state, "test_db"):
        delattr(app.state, "test_db")


@pytest.fixture
def webhook_client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    db = StripeWebhookDb()

    async def get_db_override() -> StripeWebhookDb:
        return db

    app.dependency_overrides[get_db] = get_db_override
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", "whsec_test_secret")

    with TestClient(app) as test_client:
        test_client.app.state.test_db = db
        yield test_client

    app.dependency_overrides.clear()
    if hasattr(app.state, "test_db"):
        delattr(app.state, "test_db")


def make_signature(
    payload: bytes,
    secret: str,
    timestamp: int | None = None,
) -> str:
    timestamp = timestamp or int(time.time())
    signed_payload = f"{timestamp}.{payload.decode('utf-8')}".encode("utf-8")
    digest = hmac.new(
        secret.encode("utf-8"),
        signed_payload,
        hashlib.sha256,
    ).hexdigest()
    return f"t={timestamp},v1={digest}"


def test_create_checkout_session_uses_subscription_mode_with_customer_email(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("STRIPE_PRO_PRICE_ID", "price_pro_test")
    monkeypatch.setenv("WEB_BASE_URL", "http://frontend.test")

    captured: dict[str, Any] = {}

    def create_checkout_session(**kwargs: Any) -> SimpleNamespace:
        captured.update(kwargs)
        return SimpleNamespace(url="https://checkout.stripe.test/session")

    fake_client = SimpleNamespace(
        checkout=SimpleNamespace(
            Session=SimpleNamespace(create=create_checkout_session),
        ),
    )
    monkeypatch.setattr(stripe_service, "_stripe_client", lambda: fake_client)

    session_url = stripe_service.create_checkout_session(
        "user_123",
        "owner@example.com",
    )

    assert session_url == "https://checkout.stripe.test/session"
    assert captured == {
        "mode": "subscription",
        "line_items": [{"price": "price_pro_test", "quantity": 1}],
        "client_reference_id": "user_123",
        "metadata": {"user_id": "user_123"},
        "success_url": "http://frontend.test/dashboard?checkout=success",
        "cancel_url": "http://frontend.test/pricing?checkout=cancelled",
        "customer_email": "owner@example.com",
    }


def test_create_checkout_session_reuses_existing_customer(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("STRIPE_PRO_PRICE_ID", "price_pro_test")
    monkeypatch.setenv("WEB_BASE_URL", "http://frontend.test")

    captured: dict[str, Any] = {}

    def create_checkout_session(**kwargs: Any) -> SimpleNamespace:
        captured.update(kwargs)
        return SimpleNamespace(url="https://checkout.stripe.test/session")

    fake_client = SimpleNamespace(
        checkout=SimpleNamespace(
            Session=SimpleNamespace(create=create_checkout_session),
        ),
    )
    monkeypatch.setattr(stripe_service, "_stripe_client", lambda: fake_client)

    stripe_service.create_checkout_session(
        "user_123",
        "owner@example.com",
        "cus_existing",
    )

    assert captured["customer"] == "cus_existing"
    assert "customer_email" not in captured


def test_create_checkout_session_wraps_stripe_errors(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("STRIPE_PRO_PRICE_ID", "price_pro_test")
    monkeypatch.setenv("WEB_BASE_URL", "http://frontend.test")

    def create_checkout_session(**_: Any) -> SimpleNamespace:
        raise stripe.StripeError("Stripe is down")

    fake_client = SimpleNamespace(
        checkout=SimpleNamespace(
            Session=SimpleNamespace(create=create_checkout_session),
        ),
    )
    monkeypatch.setattr(stripe_service, "_stripe_client", lambda: fake_client)

    with pytest.raises(StripeServiceError, match="Stripe is down"):
        stripe_service.create_checkout_session("user_123", "owner@example.com")


def test_create_portal_session_returns_portal_url(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("WEB_BASE_URL", "http://frontend.test")

    captured: dict[str, Any] = {}

    def create_portal_session(**kwargs: Any) -> SimpleNamespace:
        captured.update(kwargs)
        return SimpleNamespace(url="https://billing.stripe.test/portal")

    fake_client = SimpleNamespace(
        billing_portal=SimpleNamespace(
            Session=SimpleNamespace(create=create_portal_session),
        ),
    )
    monkeypatch.setattr(stripe_service, "_stripe_client", lambda: fake_client)

    session_url = stripe_service.create_portal_session("cus_portal")

    assert session_url == "https://billing.stripe.test/portal"
    assert captured == {
        "customer": "cus_portal",
        "return_url": "http://frontend.test/dashboard/settings",
    }


def test_checkout_endpoint_happy_path_returns_checkout_url(
    dashboard_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = dashboard_client.app.state.test_db
    db.profiles["user_123"] = {
        "id": "user_123",
        "email": "owner@example.com",
        "tier": "free",
        "monthly_credit_limit": 1_000,
        "rate_limit_per_sec": 10,
        "stripe_customer_id": None,
    }
    monkeypatch.setattr(
        dashboard.stripe_service,
        "create_checkout_session",
        lambda user_id, email, stripe_customer_id=None: (
            f"https://checkout.test/{user_id}?email={email}&customer={stripe_customer_id}"
        ),
    )

    response = dashboard_client.post("/dashboard/billing/checkout")

    assert response.status_code == 200
    assert response.json()["checkout_url"] == (
        "https://checkout.test/user_123?email=owner@example.com&customer=None"
    )


def test_checkout_endpoint_rejects_paid_users(
    dashboard_client: TestClient,
) -> None:
    db = dashboard_client.app.state.test_db
    db.profiles["user_123"] = {
        "id": "user_123",
        "email": "owner@example.com",
        "tier": "pro",
        "monthly_credit_limit": 10_000,
        "rate_limit_per_sec": 10,
        "stripe_customer_id": "cus_existing",
    }

    response = dashboard_client.post("/dashboard/billing/checkout")

    assert response.status_code == 409
    assert response.json()["detail"] == (
        "Subscription already exists; use the billing portal instead."
    )


def test_checkout_endpoint_returns_503_when_stripe_fails(
    dashboard_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = dashboard_client.app.state.test_db
    db.profiles["user_123"] = {
        "id": "user_123",
        "email": "owner@example.com",
        "tier": "free",
        "monthly_credit_limit": 1_000,
        "rate_limit_per_sec": 10,
        "stripe_customer_id": None,
    }
    monkeypatch.setattr(
        dashboard.stripe_service,
        "create_checkout_session",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            StripeServiceError("Stripe checkout is unavailable."),
        ),
    )

    response = dashboard_client.post("/dashboard/billing/checkout")

    assert response.status_code == 503
    assert response.json()["detail"] == "Stripe checkout is unavailable."


def test_portal_endpoint_happy_path_returns_portal_url(
    dashboard_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = dashboard_client.app.state.test_db
    db.profiles["user_123"] = {
        "id": "user_123",
        "email": "owner@example.com",
        "tier": "pro",
        "monthly_credit_limit": 10_000,
        "rate_limit_per_sec": 10,
        "stripe_customer_id": "cus_portal",
    }
    monkeypatch.setattr(
        dashboard.stripe_service,
        "create_portal_session",
        lambda stripe_customer_id: f"https://portal.test/{stripe_customer_id}",
    )

    response = dashboard_client.post("/dashboard/billing/portal")

    assert response.status_code == 200
    assert response.json()["portal_url"] == "https://portal.test/cus_portal"


def test_portal_endpoint_returns_404_without_customer(
    dashboard_client: TestClient,
) -> None:
    db = dashboard_client.app.state.test_db
    db.profiles["user_123"] = {
        "id": "user_123",
        "email": "owner@example.com",
        "tier": "pro",
        "monthly_credit_limit": 10_000,
        "rate_limit_per_sec": 10,
        "stripe_customer_id": None,
    }

    response = dashboard_client.post("/dashboard/billing/portal")

    assert response.status_code == 404
    assert response.json()["detail"] == "Stripe customer not found for this user."


def test_portal_endpoint_returns_503_when_stripe_fails(
    dashboard_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = dashboard_client.app.state.test_db
    db.profiles["user_123"] = {
        "id": "user_123",
        "email": "owner@example.com",
        "tier": "pro",
        "monthly_credit_limit": 10_000,
        "rate_limit_per_sec": 10,
        "stripe_customer_id": "cus_portal",
    }
    monkeypatch.setattr(
        dashboard.stripe_service,
        "create_portal_session",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            StripeServiceError("Stripe billing portal is unavailable."),
        ),
    )

    response = dashboard_client.post("/dashboard/billing/portal")

    assert response.status_code == 503
    assert response.json()["detail"] == "Stripe billing portal is unavailable."


def test_usage_endpoint_includes_billing_metadata(
    dashboard_client: TestClient,
) -> None:
    db = dashboard_client.app.state.test_db
    period_start, period_end = get_current_billing_period()
    db.profiles["user_123"] = {
        "id": "user_123",
        "email": "owner@example.com",
        "tier": "pro",
        "monthly_credit_limit": 10_000,
        "rate_limit_per_sec": 12,
        "stripe_customer_id": "cus_usage",
    }
    db.api_keys = [
        {"user_id": "user_123", "is_active": True},
        {"user_id": "user_123", "is_active": False},
        {"user_id": "other_user", "is_active": True},
    ]
    db.usage_summaries[("user_123", period_start, period_end)] = {
        "credits_used": 240,
        "request_count": 36,
    }
    db.daily_usage = [
        {
            "date": period_start,
            "credits_used": 12,
            "request_count": 4,
        },
    ]

    response = dashboard_client.get("/dashboard/usage/monthly")

    assert response.status_code == 200
    assert response.json() == {
        "tier": "pro",
        "period_start": period_start.isoformat(),
        "period_end": period_end.isoformat(),
        "credits_limit": 10000,
        "credits_used": 240,
        "credits_remaining": 9760,
        "request_count": 36,
        "api_keys_active": 1,
        "rate_limit_per_sec": 12,
        "has_stripe_customer": True,
        "daily_breakdown": [
            {
                "date": period_start.isoformat(),
                "credits_used": 12,
                "request_count": 4,
            },
        ],
    }


def test_webhook_checkout_session_completed_promotes_user(
    webhook_client: TestClient,
) -> None:
    db = webhook_client.app.state.test_db
    db.profiles["user_123"] = {
        "id": "user_123",
        "tier": "free",
        "monthly_credit_limit": 1_000,
        "stripe_customer_id": None,
        "stripe_subscription_id": None,
    }

    payload = json.dumps(
        {
            "id": "evt_checkout",
            "type": "checkout.session.completed",
            "data": {
                "object": {
                    "id": "cs_test_123",
                    "customer": "cus_123",
                    "subscription": "sub_123",
                    "metadata": {"user_id": "user_123"},
                },
            },
        },
        separators=(",", ":"),
    ).encode("utf-8")
    signature = make_signature(payload, "whsec_test_secret")

    response = webhook_client.post(
        "/webhooks/stripe",
        content=payload,
        headers={"Stripe-Signature": signature},
    )

    assert response.status_code == 200
    assert db.profiles["user_123"]["tier"] == "pro"
    assert db.profiles["user_123"]["monthly_credit_limit"] == 10_000
    assert db.profiles["user_123"]["stripe_customer_id"] == "cus_123"
    assert db.profiles["user_123"]["stripe_subscription_id"] == "sub_123"
    assert isinstance(db.stripe_events["evt_checkout"]["payload"], str)


def test_webhook_subscription_deleted_downgrades_user(
    webhook_client: TestClient,
) -> None:
    db = webhook_client.app.state.test_db
    db.profiles["user_123"] = {
        "id": "user_123",
        "tier": "pro",
        "monthly_credit_limit": 10_000,
        "stripe_customer_id": "cus_123",
        "stripe_subscription_id": "sub_123",
    }

    payload = json.dumps(
        {
            "id": "evt_deleted",
            "type": "customer.subscription.deleted",
            "data": {
                "object": {
                    "id": "sub_123",
                    "customer": "cus_123",
                    "status": "canceled",
                },
            },
        },
        separators=(",", ":"),
    ).encode("utf-8")
    signature = make_signature(payload, "whsec_test_secret")

    response = webhook_client.post(
        "/webhooks/stripe",
        content=payload,
        headers={"Stripe-Signature": signature},
    )

    assert response.status_code == 200
    assert db.profiles["user_123"]["tier"] == "free"
    assert db.profiles["user_123"]["monthly_credit_limit"] == 1_000
    assert db.profiles["user_123"]["stripe_subscription_id"] == "sub_123"


def test_webhook_subscription_updated_syncs_status(
    webhook_client: TestClient,
) -> None:
    db = webhook_client.app.state.test_db
    db.profiles["user_123"] = {
        "id": "user_123",
        "tier": "free",
        "monthly_credit_limit": 1_000,
        "stripe_customer_id": "cus_123",
        "stripe_subscription_id": "sub_123",
    }

    payload = json.dumps(
        {
            "id": "evt_updated",
            "type": "customer.subscription.updated",
            "data": {
                "object": {
                    "id": "sub_123",
                    "customer": "cus_123",
                    "status": "active",
                },
            },
        },
        separators=(",", ":"),
    ).encode("utf-8")
    signature = make_signature(payload, "whsec_test_secret")

    response = webhook_client.post(
        "/webhooks/stripe",
        content=payload,
        headers={"Stripe-Signature": signature},
    )

    assert response.status_code == 200
    assert db.profiles["user_123"]["tier"] == "pro"
    assert db.profiles["user_123"]["monthly_credit_limit"] == 10_000


def test_duplicate_webhook_event_is_silently_skipped(
    webhook_client: TestClient,
) -> None:
    db = webhook_client.app.state.test_db
    db.profiles["user_123"] = {
        "id": "user_123",
        "tier": "free",
        "monthly_credit_limit": 1_000,
        "stripe_customer_id": None,
        "stripe_subscription_id": None,
    }

    payload = json.dumps(
        {
            "id": "evt_duplicate",
            "type": "checkout.session.completed",
            "data": {
                "object": {
                    "id": "cs_test_duplicate",
                    "customer": "cus_dup",
                    "subscription": "sub_dup",
                    "metadata": {"user_id": "user_123"},
                },
            },
        },
        separators=(",", ":"),
    ).encode("utf-8")
    signature = make_signature(payload, "whsec_test_secret")

    first_response = webhook_client.post(
        "/webhooks/stripe",
        content=payload,
        headers={"Stripe-Signature": signature},
    )
    second_response = webhook_client.post(
        "/webhooks/stripe",
        content=payload,
        headers={"Stripe-Signature": signature},
    )

    assert first_response.status_code == 200
    assert second_response.status_code == 200
    assert second_response.json() == {"status": "duplicate", "duplicate": True}
    assert db.checkout_updates == 1
    assert len(db.stripe_events) == 1


def test_invalid_webhook_signature_returns_400(
    webhook_client: TestClient,
) -> None:
    payload = json.dumps(
        {
            "id": "evt_invalid",
            "type": "invoice.created",
            "data": {"object": {"id": "in_123"}},
        },
        separators=(",", ":"),
    ).encode("utf-8")
    signature = make_signature(payload, "wrong_secret")

    response = webhook_client.post(
        "/webhooks/stripe",
        content=payload,
        headers={"Stripe-Signature": signature},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Invalid Stripe signature."


def test_deduct_credits_records_usage_and_updates_remaining_balance(database) -> None:
    async def run_test() -> None:
        db = await asyncpg.connect(database.database_url)
        period_start, period_end = current_billing_period()

        try:
            credits_used = await deduct_credits(
                db,
                TEST_USER_ID,
                TEST_API_KEY_ID,
                "req_billing_success",
                "knowledge",
                False,
            )
            monthly_usage = await db.fetchrow(
                """
                SELECT credits_limit, credits_used, request_count
                FROM usage_monthly
                WHERE user_id = $1
                  AND period_start = $2
                  AND period_end = $3
                """,
                TEST_USER_ID,
                period_start,
                period_end,
            )

            assert credits_used == 1
            assert monthly_usage is not None
            assert int(monthly_usage["credits_limit"]) == 1_000
            assert int(monthly_usage["credits_used"]) == 1
            assert int(monthly_usage["request_count"]) == 1
            assert int(monthly_usage["credits_limit"]) - int(monthly_usage["credits_used"]) == 999
        finally:
            await db.close()

    _run_async(run_test())


def test_deduct_credits_raises_when_monthly_limit_is_exhausted(database) -> None:
    async def run_test() -> None:
        db = await asyncpg.connect(database.database_url)
        period_start, period_end = current_billing_period()

        try:
            await db.execute(
                """
                UPDATE user_profiles
                SET monthly_credit_limit = $2
                WHERE id = $1
                """,
                TEST_USER_ID,
                1,
            )

            with pytest.raises(InsufficientCreditsError, match="Monthly credit limit exhausted."):
                await deduct_credits(
                    db,
                    TEST_USER_ID,
                    TEST_API_KEY_ID,
                    "req_billing_insufficient",
                    "knowledge",
                    True,
                )

            usage_count = await db.fetchval(
                """
                SELECT COUNT(*)
                FROM usage_events
                WHERE request_id = $1
                """,
                "req_billing_insufficient",
            )
            monthly_usage = await db.fetchrow(
                """
                SELECT credits_used, request_count
                FROM usage_monthly
                WHERE user_id = $1
                  AND period_start = $2
                  AND period_end = $3
                """,
                TEST_USER_ID,
                period_start,
                period_end,
            )

            assert int(usage_count or 0) == 0
            assert monthly_usage is None
        finally:
            await db.close()

    _run_async(run_test())
