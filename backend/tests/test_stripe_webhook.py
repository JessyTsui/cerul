from __future__ import annotations

import hashlib
import hmac
import json
import time
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from app.db import get_db
from app.main import app


class StripeWebhookDb:
    def __init__(self) -> None:
        self.profiles: dict[str, dict[str, object]] = {}
        self.stripe_events: dict[str, dict[str, object]] = {}
        self.checkout_updates = 0
        self.subscription_updates = 0
        self.transaction_entries = 0
        self.transaction_exits = 0

    def transaction(self):
        db = self

        class _Transaction:
            async def __aenter__(self) -> None:
                db.transaction_entries += 1

            async def __aexit__(self, exc_type, exc, tb) -> bool:
                db.transaction_exits += 1
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
                "payload": str(params[2]),
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


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
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


def test_webhook_signature_verification_accepts_valid_signature(
    client: TestClient,
) -> None:
    payload = json.dumps(
        {
            "id": "evt_valid",
            "type": "invoice.created",
            "data": {"object": {"id": "in_123"}},
        },
        separators=(",", ":"),
    ).encode("utf-8")
    signature = make_signature(payload, "whsec_test_secret")

    response = client.post(
        "/webhooks/stripe",
        content=payload,
        headers={"Stripe-Signature": signature},
    )

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "duplicate": False}


def test_webhook_signature_verification_rejects_invalid_signature(
    client: TestClient,
) -> None:
    payload = json.dumps(
        {
            "id": "evt_invalid",
            "type": "invoice.created",
            "data": {"object": {"id": "in_456"}},
        },
        separators=(",", ":"),
    ).encode("utf-8")
    signature = make_signature(payload, "wrong_secret")

    response = client.post(
        "/webhooks/stripe",
        content=payload,
        headers={"Stripe-Signature": signature},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Invalid Stripe signature."


def test_checkout_session_completed_updates_user_tier(client: TestClient) -> None:
    db = client.app.state.test_db
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

    response = client.post(
        "/webhooks/stripe",
        content=payload,
        headers={"Stripe-Signature": signature},
    )

    assert response.status_code == 200
    assert db.profiles["user_123"]["tier"] == "pro"
    assert db.profiles["user_123"]["monthly_credit_limit"] == 10_000
    assert db.profiles["user_123"]["stripe_customer_id"] == "cus_123"


def test_subscription_update_without_customer_mapping_returns_conflict(
    client: TestClient,
) -> None:
    payload = json.dumps(
        {
            "id": "evt_missing_customer",
            "type": "customer.subscription.updated",
            "data": {
                "object": {
                    "id": "sub_missing",
                    "customer": "cus_missing",
                    "status": "active",
                },
            },
        },
        separators=(",", ":"),
    ).encode("utf-8")
    signature = make_signature(payload, "whsec_test_secret")

    response = client.post(
        "/webhooks/stripe",
        content=payload,
        headers={"Stripe-Signature": signature},
    )

    db = client.app.state.test_db
    assert response.status_code == 409
    assert response.json()["detail"] == (
        "No matching user profile found for Stripe customer."
    )
    assert db.stripe_events["evt_missing_customer"]["processed_at"] is None


def test_webhook_processing_is_idempotent_for_duplicate_event(
    client: TestClient,
) -> None:
    db = client.app.state.test_db
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

    first_response = client.post(
        "/webhooks/stripe",
        content=payload,
        headers={"Stripe-Signature": signature},
    )
    second_response = client.post(
        "/webhooks/stripe",
        content=payload,
        headers={"Stripe-Signature": signature},
    )

    assert first_response.status_code == 200
    assert second_response.status_code == 200
    assert second_response.json() == {"status": "duplicate", "duplicate": True}
    assert db.checkout_updates == 1
    assert len(db.stripe_events) == 1
    assert db.transaction_entries == 1
    assert db.transaction_exits == 1
