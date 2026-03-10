"""Billing helpers shared across dashboard, search, and webhook flows."""

from __future__ import annotations

from app.billing.credits import calculate_credit_cost, current_billing_period, deduct_credits
from app.billing.usage import (
    calculate_credits_remaining,
    count_active_api_keys,
    fetch_usage_summary,
)

DEFAULT_MONTHLY_CREDIT_LIMITS: dict[str, int] = {
    "free": 1_000,
    "pro": 10_000,
    "builder": 10_000,
    "enterprise": 100_000,
}

TIER_KEY_LIMITS: dict[str, int] = {
    "free": 1,
    "pro": 5,
    "builder": 5,
    "enterprise": 25,
}

PAID_TIERS = {"pro", "builder", "enterprise"}


def key_limit_for_tier(tier: str | None) -> int:
    normalized_tier = (tier or "free").lower()
    return TIER_KEY_LIMITS.get(normalized_tier, TIER_KEY_LIMITS["free"])


def monthly_credit_limit_for_tier(tier: str | None) -> int:
    normalized_tier = (tier or "free").lower()
    return DEFAULT_MONTHLY_CREDIT_LIMITS.get(
        normalized_tier,
        DEFAULT_MONTHLY_CREDIT_LIMITS["free"],
    )


def is_paid_tier(tier: str | None) -> bool:
    normalized_tier = (tier or "free").lower()
    return normalized_tier in PAID_TIERS


__all__ = [
    "DEFAULT_MONTHLY_CREDIT_LIMITS",
    "PAID_TIERS",
    "TIER_KEY_LIMITS",
    "calculate_credit_cost",
    "calculate_credits_remaining",
    "count_active_api_keys",
    "current_billing_period",
    "deduct_credits",
    "fetch_usage_summary",
    "is_paid_tier",
    "key_limit_for_tier",
    "monthly_credit_limit_for_tier",
]
