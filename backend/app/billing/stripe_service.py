"""Stripe billing integration helpers."""

from __future__ import annotations

import json
from typing import Any, Mapping, cast

import stripe

from app.config import get_settings

from . import monthly_credit_limit_for_tier


ACTIVE_SUBSCRIPTION_STATUSES = {"active", "trialing", "past_due"}


class StripeServiceError(RuntimeError):
    """Raised when Stripe cannot fulfill a billing action."""


class StripeWebhookVerificationError(StripeServiceError):
    """Raised when webhook verification fails."""


def _web_base_url() -> str:
    return get_settings().public.web_base_url.rstrip("/")


def _require_setting(name: str, value: str | None) -> str:
    if not value:
        raise StripeServiceError(f"{name} is not configured.")
    return value


def _stripe_client() -> Any:
    stripe.api_key = _require_setting(
        "STRIPE_SECRET_KEY",
        get_settings().stripe.secret_key,
    )
    return stripe


def _rows_affected(command_status: Any) -> int:
    if not isinstance(command_status, str):
        return 0

    parts = command_status.strip().split()
    if not parts:
        return 0

    try:
        return int(parts[-1])
    except ValueError:
        return 0


def _to_plain_dict(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return dict(value)
    if type(value).__module__.startswith("stripe."):
        return cast(dict[str, Any], json.loads(str(value)))
    if isinstance(value, Mapping):
        return dict(value)
    return cast(dict[str, Any], dict(value))


def create_checkout_session(
    user_id: str,
    email: str,
    stripe_customer_id: str | None = None,
) -> str:
    client = _stripe_client()
    session_payload: dict[str, Any] = {
        "mode": "subscription",
        "line_items": [
            {
                "price": _require_setting(
                    "STRIPE_PRO_PRICE_ID",
                    get_settings().stripe.pro_price_id,
                ),
                "quantity": 1,
            }
        ],
        "client_reference_id": user_id,
        "metadata": {"user_id": user_id},
        "success_url": f"{_web_base_url()}/dashboard?checkout=success",
        "cancel_url": f"{_web_base_url()}/pricing?checkout=cancelled",
    }
    if stripe_customer_id:
        session_payload["customer"] = stripe_customer_id
    else:
        session_payload["customer_email"] = email

    session = client.checkout.Session.create(
        **session_payload,
    )
    session_url = getattr(session, "url", None)

    if not session_url:
        raise StripeServiceError("Stripe checkout session did not return a URL.")

    return cast(str, session_url)


def create_portal_session(stripe_customer_id: str) -> str:
    client = _stripe_client()
    session = client.billing_portal.Session.create(
        customer=stripe_customer_id,
        return_url=f"{_web_base_url()}/dashboard/settings",
    )
    session_url = getattr(session, "url", None)

    if not session_url:
        raise StripeServiceError("Stripe billing portal did not return a URL.")

    return cast(str, session_url)


def construct_webhook_event(
    payload: bytes,
    signature_header: str | None,
) -> dict[str, Any]:
    if not signature_header:
        raise StripeWebhookVerificationError("Missing Stripe-Signature header.")

    try:
        event = stripe.Webhook.construct_event(
            payload=payload,
            sig_header=signature_header,
            secret=_require_setting(
                "STRIPE_WEBHOOK_SECRET",
                get_settings().stripe.webhook_secret,
            ),
        )
    except ValueError as exc:
        raise StripeWebhookVerificationError("Invalid Stripe payload.") from exc
    except stripe.SignatureVerificationError as exc:
        raise StripeWebhookVerificationError("Invalid Stripe signature.") from exc

    return _to_plain_dict(event)


def subscription_tier(subscription: Mapping[str, Any]) -> tuple[str, int]:
    status = str(subscription.get("status") or "").lower()
    tier = "pro" if status in ACTIVE_SUBSCRIPTION_STATUSES else "free"
    return tier, monthly_credit_limit_for_tier(tier)


async def activate_checkout_subscription(
    db: Any,
    *,
    user_id: str,
    stripe_customer_id: str | None,
    subscription_id: str | None = None,
) -> dict[str, Any]:
    tier = "pro"
    monthly_credit_limit = monthly_credit_limit_for_tier(tier)

    command_status = await db.execute(
        """
        UPDATE user_profiles
        SET tier = $1,
            monthly_credit_limit = $2,
            stripe_customer_id = COALESCE($3, stripe_customer_id),
            stripe_subscription_id = COALESCE($4, stripe_subscription_id)
        WHERE id = $5
        """,
        tier,
        monthly_credit_limit,
        stripe_customer_id,
        subscription_id,
        user_id,
    )
    if _rows_affected(command_status) == 0:
        raise StripeServiceError(
            "No matching user profile found for checkout session completion.",
        )

    return {
        "tier": tier,
        "monthly_credit_limit": monthly_credit_limit,
    }


async def sync_subscription_status(
    db: Any,
    stripe_customer_id: str,
    subscription: Mapping[str, Any],
) -> dict[str, Any]:
    tier, monthly_credit_limit = subscription_tier(subscription)
    subscription_id = cast(str | None, subscription.get("id"))

    command_status = await db.execute(
        """
        UPDATE user_profiles
        SET tier = $1,
            monthly_credit_limit = $2,
            stripe_customer_id = $3,
            stripe_subscription_id = COALESCE($4, stripe_subscription_id)
        WHERE stripe_customer_id = $3
        """,
        tier,
        monthly_credit_limit,
        stripe_customer_id,
        subscription_id,
    )
    updated_rows = _rows_affected(command_status)
    if updated_rows == 0:
        raise StripeServiceError(
            "No matching user profile found for Stripe customer.",
        )

    return {
        "tier": tier,
        "monthly_credit_limit": monthly_credit_limit,
        "updated_rows": updated_rows,
    }
