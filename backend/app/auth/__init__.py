from __future__ import annotations

# STUB: replaced by codex/feature-db-auth

from dataclasses import dataclass
import re
from typing import Any

from fastapi import Depends, Header, HTTPException, status

from app.billing import current_billing_period
from app.db import get_db

API_KEY_PATTERN = re.compile(r"^cerul_sk_[A-Za-z0-9]{32}$")


@dataclass(frozen=True)
class AuthContext:
    user_id: str
    api_key_id: str
    tier: str
    credits_remaining: int
    rate_limit_per_sec: int


async def require_api_key(
    authorization: str | None = Header(default=None),
    db: Any = Depends(get_db),
) -> AuthContext:
    if authorization is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Authorization header",
        )

    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization header must use Bearer token format",
        )

    if not API_KEY_PATTERN.match(token):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Cerul API key format",
        )

    period_start, period_end = current_billing_period()
    credits_limit = 1000
    credits_used = 0
    rate_limit_per_sec = 1
    tier = "free"

    if hasattr(db, "get_user_profile"):
        profile = await db.get_user_profile("user_stub")
        if profile is not None:
            credits_limit = int(profile.get("monthly_credit_limit", credits_limit))
            rate_limit_per_sec = int(profile.get("rate_limit_per_sec", rate_limit_per_sec))
            tier = str(profile.get("tier", tier))

    if hasattr(db, "get_usage_summary"):
        usage_summary = await db.get_usage_summary("user_stub", period_start, period_end)
        credits_limit = int(usage_summary.get("credits_limit", credits_limit))
        credits_used = int(usage_summary.get("credits_used", credits_used))
        rate_limit_per_sec = int(
            usage_summary.get("rate_limit_per_sec", rate_limit_per_sec)
        )
        tier = str(usage_summary.get("tier", tier))

    return AuthContext(
        user_id="user_stub",
        api_key_id="key_stub",
        tier=tier,
        credits_remaining=max(credits_limit - credits_used, 0),
        rate_limit_per_sec=rate_limit_per_sec,
    )
