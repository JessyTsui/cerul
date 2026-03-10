"""Private dashboard API endpoints."""

from __future__ import annotations

import calendar
import hashlib
import secrets
from datetime import date, datetime, timedelta, timezone
from typing import Any, Mapping, cast

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, ConfigDict, Field

from ..auth import SessionContext, require_session
from ..billing import (
    is_paid_tier,
    key_limit_for_tier,
    monthly_credit_limit_for_tier,
)
from ..billing import stripe_service
from ..db import get_db

API_KEY_TOKEN_LENGTH = 32
API_KEY_PREFIX_LENGTH = 16

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


class CreateApiKeyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=120)


class CreateApiKeyResponse(BaseModel):
    key_id: str
    raw_key: str


class ApiKeySummary(BaseModel):
    id: str
    name: str
    prefix: str
    created_at: datetime | None = None
    last_used_at: datetime | None = None
    is_active: bool


class ApiKeyListResponse(BaseModel):
    api_keys: list[ApiKeySummary]


class DailyUsagePoint(BaseModel):
    date: date
    credits_used: int
    request_count: int


class MonthlyUsageResponse(BaseModel):
    tier: str
    period_start: date
    period_end: date
    credits_limit: int
    credits_used: int
    credits_remaining: int
    request_count: int
    daily_breakdown: list[DailyUsagePoint]


class CheckoutSessionResponse(BaseModel):
    checkout_url: str


class PortalSessionResponse(BaseModel):
    portal_url: str


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def get_current_billing_period(reference: date | None = None) -> tuple[date, date]:
    today = reference or _utc_now().date()
    period_start = today.replace(day=1)
    period_end = today.replace(
        day=calendar.monthrange(today.year, today.month)[1],
    )
    return period_start, period_end


def _record_to_dict(record: Any | None) -> dict[str, Any] | None:
    if record is None:
        return None
    if isinstance(record, Mapping):
        return dict(record)
    return cast(dict[str, Any], dict(record))


def generate_api_key() -> tuple[str, str, str]:
    token = secrets.token_hex(API_KEY_TOKEN_LENGTH // 2)
    raw_key = f"cerul_sk_{token}"
    key_hash = hashlib.sha256(raw_key.encode("utf-8")).hexdigest()
    return raw_key, key_hash, raw_key[:API_KEY_PREFIX_LENGTH]


async def fetch_user_profile(db: Any, user_id: str) -> dict[str, Any] | None:
    row = await db.fetchrow(
        """
        SELECT id, email, tier, monthly_credit_limit, stripe_customer_id
        FROM user_profiles
        WHERE id = $1
        """,
        user_id,
    )
    return _record_to_dict(row)


async def count_active_api_keys(db: Any, user_id: str) -> int:
    count = await db.fetchval(
        """
        SELECT COUNT(*)
        FROM api_keys
        WHERE user_id = $1
          AND is_active = TRUE
        """,
        user_id,
    )
    return int(count or 0)


async def insert_api_key(
    db: Any,
    *,
    user_id: str,
    name: str,
    key_hash: str,
    prefix: str,
) -> dict[str, Any]:
    row = await db.fetchrow(
        """
        INSERT INTO api_keys (user_id, name, key_hash, prefix, is_active)
        VALUES ($1, $2, $3, $4, TRUE)
        RETURNING id, name, prefix, created_at, last_used_at, is_active
        """,
        user_id,
        name,
        key_hash,
        prefix,
    )
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create API key.",
        )
    return cast(dict[str, Any], _record_to_dict(row))


async def list_api_keys_for_user(db: Any, user_id: str) -> list[dict[str, Any]]:
    rows = await db.fetch(
        """
        SELECT id, name, prefix, created_at, last_used_at, is_active
        FROM api_keys
        WHERE user_id = $1
        ORDER BY created_at DESC
        """,
        user_id,
    )
    return [cast(dict[str, Any], _record_to_dict(row)) for row in rows]


async def soft_delete_api_key(db: Any, key_id: str, user_id: str) -> bool:
    row = await db.fetchrow(
        """
        UPDATE api_keys
        SET is_active = FALSE
        WHERE id = $1
          AND user_id = $2
        RETURNING id
        """,
        key_id,
        user_id,
    )
    return row is not None


async def fetch_usage_summary(
    db: Any,
    *,
    user_id: str,
    period_start: date,
    period_end: date,
) -> dict[str, Any]:
    row = await db.fetchrow(
        """
        SELECT COALESCE(credits_used, 0) AS credits_used,
               COALESCE(request_count, 0) AS request_count
        FROM usage_monthly
        WHERE user_id = $1
          AND period_start = $2
          AND period_end = $3
        """,
        user_id,
        period_start,
        period_end,
    )
    return _record_to_dict(row) or {"credits_used": 0, "request_count": 0}


async def fetch_daily_usage_breakdown(
    db: Any,
    *,
    user_id: str,
    period_start: date,
) -> list[dict[str, Any]]:
    rows = await db.fetch(
        """
        SELECT DATE(created_at) AS date,
               COUNT(*) AS request_count,
               COALESCE(SUM(credits_used), 0) AS credits_used
        FROM usage_events
        WHERE user_id = $1
          AND created_at >= $2
        GROUP BY DATE(created_at)
        ORDER BY date ASC
        """,
        user_id,
        period_start,
    )
    return [cast(dict[str, Any], _record_to_dict(row)) for row in rows]


@router.post(
    "/api-keys",
    response_model=CreateApiKeyResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_api_key(
    payload: CreateApiKeyRequest,
    session: SessionContext = Depends(require_session),
    db: Any = Depends(get_db),
) -> CreateApiKeyResponse:
    profile = await fetch_user_profile(db, session.user_id)
    if profile is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User profile not found.",
        )

    tier = str(profile.get("tier") or "free").lower()
    active_key_count = await count_active_api_keys(db, session.user_id)
    key_limit = key_limit_for_tier(tier)

    if active_key_count >= key_limit:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"{tier} tier allows at most {key_limit} active API key(s).",
        )

    name = payload.name.strip()
    if not name:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="API key name must not be empty.",
        )

    raw_key, key_hash, prefix = generate_api_key()
    created = await insert_api_key(
        db,
        user_id=session.user_id,
        name=name,
        key_hash=key_hash,
        prefix=prefix,
    )
    return CreateApiKeyResponse(key_id=str(created["id"]), raw_key=raw_key)


@router.get("/api-keys", response_model=ApiKeyListResponse)
async def list_api_keys(
    session: SessionContext = Depends(require_session),
    db: Any = Depends(get_db),
) -> ApiKeyListResponse:
    api_keys = await list_api_keys_for_user(db, session.user_id)
    return ApiKeyListResponse(api_keys=api_keys)


@router.delete("/api-keys/{key_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_api_key(
    key_id: str,
    session: SessionContext = Depends(require_session),
    db: Any = Depends(get_db),
) -> Response:
    deleted = await soft_delete_api_key(db, key_id, session.user_id)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="API key not found.",
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/usage/monthly", response_model=MonthlyUsageResponse)
async def get_monthly_usage(
    session: SessionContext = Depends(require_session),
    db: Any = Depends(get_db),
) -> MonthlyUsageResponse:
    profile = await fetch_user_profile(db, session.user_id)
    if profile is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User profile not found.",
        )

    period_start, period_end = get_current_billing_period()
    breakdown_start = max(period_start, (_utc_now().date() - timedelta(days=29)))
    summary = await fetch_usage_summary(
        db,
        user_id=session.user_id,
        period_start=period_start,
        period_end=period_end,
    )
    daily_breakdown = await fetch_daily_usage_breakdown(
        db,
        user_id=session.user_id,
        period_start=breakdown_start,
    )

    tier = str(profile.get("tier") or "free").lower()
    credits_limit = int(
        profile.get("monthly_credit_limit") or monthly_credit_limit_for_tier(tier),
    )
    credits_used = int(summary.get("credits_used", 0) or 0)
    request_count = int(summary.get("request_count", 0) or 0)

    return MonthlyUsageResponse(
        tier=tier,
        period_start=period_start,
        period_end=period_end,
        credits_limit=credits_limit,
        credits_used=credits_used,
        credits_remaining=max(credits_limit - credits_used, 0),
        request_count=request_count,
        daily_breakdown=daily_breakdown,
    )


@router.post("/billing/checkout", response_model=CheckoutSessionResponse)
async def create_billing_checkout(
    session: SessionContext = Depends(require_session),
    db: Any = Depends(get_db),
) -> CheckoutSessionResponse:
    profile = await fetch_user_profile(db, session.user_id)
    if profile is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User profile not found.",
        )

    current_tier = str(profile.get("tier") or "free").lower()
    if is_paid_tier(current_tier):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Subscription already exists; use the billing portal instead.",
        )

    email = session.email or cast(str | None, profile.get("email"))
    if not email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Authenticated session is missing an email address.",
        )

    try:
        checkout_url = stripe_service.create_checkout_session(
            session.user_id,
            email,
            cast(str | None, profile.get("stripe_customer_id")),
        )
    except stripe_service.StripeServiceError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc

    return CheckoutSessionResponse(checkout_url=checkout_url)


@router.post("/billing/portal", response_model=PortalSessionResponse)
async def create_billing_portal(
    session: SessionContext = Depends(require_session),
    db: Any = Depends(get_db),
) -> PortalSessionResponse:
    profile = await fetch_user_profile(db, session.user_id)
    if profile is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User profile not found.",
        )

    stripe_customer_id = cast(str | None, profile.get("stripe_customer_id"))
    if not stripe_customer_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Stripe customer not found for this user.",
        )

    try:
        portal_url = stripe_service.create_portal_session(stripe_customer_id)
    except stripe_service.StripeServiceError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc

    return PortalSessionResponse(portal_url=portal_url)
