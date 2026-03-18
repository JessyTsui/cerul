"""Private dashboard API endpoints."""

from __future__ import annotations

import calendar
import hashlib
import secrets
from datetime import date, datetime, timedelta, timezone
from typing import Any, Literal, Mapping, cast

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, ConfigDict, Field

from ..admin.access import require_admin_access
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

JobStatus = Literal["pending", "running", "retrying", "completed", "failed"]
JobTrack = Literal["broll", "knowledge"]
JobStepStatus = Literal["completed", "failed", "skipped"]


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
    api_keys_active: int
    rate_limit_per_sec: int
    has_stripe_customer: bool
    daily_breakdown: list[DailyUsagePoint]


class CheckoutSessionResponse(BaseModel):
    checkout_url: str


class PortalSessionResponse(BaseModel):
    portal_url: str


class JobSummary(BaseModel):
    id: str
    track: JobTrack
    job_type: str
    status: JobStatus
    attempts: int
    max_attempts: int
    error_message: str | None = None
    created_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None
    updated_at: datetime


class JobListResponse(BaseModel):
    jobs: list[JobSummary]
    total_count: int


class JobStepDetail(BaseModel):
    id: str
    step_name: str
    status: JobStepStatus
    artifacts: Any = Field(default_factory=dict)
    error_message: str | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    updated_at: datetime


class JobDetailResponse(BaseModel):
    id: str
    track: JobTrack
    source_id: str | None = None
    job_type: str
    status: JobStatus
    input_payload: Any = Field(default_factory=dict)
    error_message: str | None = None
    attempts: int
    max_attempts: int
    locked_by: str | None = None
    locked_at: datetime | None = None
    next_retry_at: datetime | None = None
    created_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None
    updated_at: datetime
    steps: list[JobStepDetail]


class JobTrackCounts(BaseModel):
    broll: int
    knowledge: int


class JobStatsResponse(BaseModel):
    total: int
    pending: int
    running: int
    retrying: int
    completed: int
    failed: int
    tracks: JobTrackCounts


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


async def _find_auth_user(db: Any, user_id: str) -> dict[str, Any] | None:
    row = await db.fetchrow(
        '''
        SELECT id, email, name
        FROM "user"
        WHERE id = $1
        ''',
        user_id,
    )
    return _record_to_dict(row)


async def _provision_user_profile_from_auth_user(
    db: Any,
    user_id: str,
) -> dict[str, Any] | None:
    auth_user = await _find_auth_user(db, user_id)

    if auth_user is None:
        return None

    email = str(auth_user.get("email") or "").strip().lower() or None
    display_name = str(auth_user.get("name") or "").strip() or None
    row = await db.fetchrow(
        """
        INSERT INTO user_profiles (id, email, display_name)
        VALUES ($1, $2, $3)
        ON CONFLICT (id) DO UPDATE
        SET email = COALESCE(EXCLUDED.email, user_profiles.email),
            display_name = COALESCE(EXCLUDED.display_name, user_profiles.display_name),
            updated_at = NOW()
        RETURNING
            id,
            email,
            console_role,
            tier,
            monthly_credit_limit,
            rate_limit_per_sec,
            stripe_customer_id
        """,
        user_id,
        email,
        display_name,
    )
    return _record_to_dict(row)


async def fetch_user_profile(db: Any, user_id: str) -> dict[str, Any] | None:
    row = await db.fetchrow(
        """
        SELECT
            id,
            email,
            console_role,
            tier,
            monthly_credit_limit,
            rate_limit_per_sec,
            stripe_customer_id
        FROM user_profiles
        WHERE id = $1
        """,
        user_id,
    )
    profile = _record_to_dict(row)

    if profile is not None:
        return profile

    return await _provision_user_profile_from_auth_user(db, user_id)


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


def _normalize_api_key_summary(record: dict[str, Any] | None) -> dict[str, Any]:
    payload = record or {}
    return {
        "id": str(payload.get("id") or ""),
        "name": str(payload.get("name") or ""),
        "prefix": str(payload.get("prefix") or ""),
        "created_at": payload.get("created_at"),
        "last_used_at": payload.get("last_used_at"),
        "is_active": bool(payload.get("is_active", False)),
    }


def _normalize_processing_job_summary(record: dict[str, Any] | None) -> dict[str, Any]:
    payload = record or {}
    return {
        "id": str(payload.get("id") or ""),
        "track": payload.get("track"),
        "job_type": str(payload.get("job_type") or ""),
        "status": payload.get("status"),
        "attempts": int(payload.get("attempts", 0) or 0),
        "max_attempts": int(payload.get("max_attempts", 0) or 0),
        "error_message": payload.get("error_message"),
        "created_at": payload.get("created_at"),
        "started_at": payload.get("started_at"),
        "completed_at": payload.get("completed_at"),
        "updated_at": payload.get("updated_at"),
    }


def _normalize_processing_job_detail(record: dict[str, Any] | None) -> dict[str, Any]:
    payload = _normalize_processing_job_summary(record)
    source_id = (record or {}).get("source_id")
    detail_payload = {
        **payload,
        "source_id": str(source_id) if source_id is not None else None,
        "input_payload": (record or {}).get("input_payload") or {},
        "locked_by": (record or {}).get("locked_by"),
        "locked_at": (record or {}).get("locked_at"),
        "next_retry_at": (record or {}).get("next_retry_at"),
    }
    return detail_payload


def _normalize_processing_job_step(record: dict[str, Any] | None) -> dict[str, Any]:
    payload = record or {}
    return {
        "id": str(payload.get("id") or ""),
        "step_name": str(payload.get("step_name") or ""),
        "status": payload.get("status"),
        "artifacts": payload.get("artifacts") or {},
        "error_message": payload.get("error_message"),
        "started_at": payload.get("started_at"),
        "completed_at": payload.get("completed_at"),
        "updated_at": payload.get("updated_at"),
    }


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
    return [
        _normalize_api_key_summary(cast(dict[str, Any], _record_to_dict(row)))
        for row in rows
    ]


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
    period_end: date,
) -> list[dict[str, Any]]:
    rows = await db.fetch(
        """
        SELECT DATE(occurred_at) AS date,
               COUNT(*) AS request_count,
               COALESCE(SUM(credits_used), 0) AS credits_used
        FROM usage_events
        WHERE user_id = $1
          AND occurred_at >= $2
          AND occurred_at < ($3::date + INTERVAL '1 day')
        GROUP BY DATE(occurred_at)
        ORDER BY date ASC
        """,
        user_id,
        period_start,
        period_end,
    )
    return [cast(dict[str, Any], _record_to_dict(row)) for row in rows]


async def count_processing_jobs(
    db: Any,
    *,
    job_status: JobStatus | None = None,
    track: JobTrack | None = None,
) -> int:
    count = await db.fetchval(
        """
        SELECT COUNT(*)
        FROM processing_jobs
        WHERE ($1::text IS NULL OR status = $1)
          AND ($2::text IS NULL OR track = $2)
        """,
        job_status,
        track,
    )
    return int(count or 0)


async def list_processing_jobs(
    db: Any,
    *,
    job_status: JobStatus | None = None,
    track: JobTrack | None = None,
    limit: int,
    offset: int,
) -> list[dict[str, Any]]:
    rows = await db.fetch(
        """
        SELECT
            id,
            track,
            job_type,
            status,
            attempts,
            max_attempts,
            error_message,
            created_at,
            started_at,
            completed_at,
            updated_at
        FROM processing_jobs
        WHERE ($1::text IS NULL OR status = $1)
          AND ($2::text IS NULL OR track = $2)
        ORDER BY created_at DESC
        LIMIT $3
        OFFSET $4
        """,
        job_status,
        track,
        limit,
        offset,
    )
    return [
        _normalize_processing_job_summary(cast(dict[str, Any], _record_to_dict(row)))
        for row in rows
    ]


async def fetch_processing_job(
    db: Any,
    job_id: str,
) -> dict[str, Any] | None:
    row = await db.fetchrow(
        """
        SELECT
            id,
            track,
            source_id,
            job_type,
            status,
            input_payload,
            error_message,
            attempts,
            max_attempts,
            locked_by,
            locked_at,
            next_retry_at,
            created_at,
            started_at,
            completed_at,
            updated_at
        FROM processing_jobs
        WHERE id = $1
        """,
        job_id,
    )
    payload = _record_to_dict(row)

    if payload is None:
        return None

    return _normalize_processing_job_detail(payload)


async def list_processing_job_steps(
    db: Any,
    job_id: str,
) -> list[dict[str, Any]]:
    rows = await db.fetch(
        """
        SELECT
            id,
            step_name,
            status,
            artifacts,
            error_message,
            started_at,
            completed_at,
            updated_at
        FROM processing_job_steps
        WHERE job_id = $1
        ORDER BY
            COALESCE(started_at, completed_at, updated_at) ASC,
            step_name ASC
        """,
        job_id,
    )
    return [
        _normalize_processing_job_step(cast(dict[str, Any], _record_to_dict(row)))
        for row in rows
    ]


async def fetch_processing_job_stats(
    db: Any,
) -> dict[str, int]:
    row = await db.fetchrow(
        """
        SELECT
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE status = 'pending') AS pending,
            COUNT(*) FILTER (WHERE status = 'running') AS running,
            COUNT(*) FILTER (WHERE status = 'retrying') AS retrying,
            COUNT(*) FILTER (WHERE status = 'completed') AS completed,
            COUNT(*) FILTER (WHERE status = 'failed') AS failed,
            COUNT(*) FILTER (WHERE track = 'broll') AS broll,
            COUNT(*) FILTER (WHERE track = 'knowledge') AS knowledge
        FROM processing_jobs
        """
    )
    payload = _record_to_dict(row) or {}
    return {
        "total": int(payload.get("total", 0) or 0),
        "pending": int(payload.get("pending", 0) or 0),
        "running": int(payload.get("running", 0) or 0),
        "retrying": int(payload.get("retrying", 0) or 0),
        "completed": int(payload.get("completed", 0) or 0),
        "failed": int(payload.get("failed", 0) or 0),
        "broll": int(payload.get("broll", 0) or 0),
        "knowledge": int(payload.get("knowledge", 0) or 0),
    }


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
        period_end=period_end,
    )
    api_keys_active = await count_active_api_keys(db, session.user_id)

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
        api_keys_active=api_keys_active,
        rate_limit_per_sec=int(profile.get("rate_limit_per_sec") or 0),
        has_stripe_customer=bool(profile.get("stripe_customer_id")),
        daily_breakdown=daily_breakdown,
    )


@router.get("/jobs", response_model=JobListResponse)
async def get_dashboard_jobs(
    status_filter: JobStatus | None = Query(default=None, alias="status"),
    track: JobTrack | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    session: SessionContext = Depends(require_session),
    db: Any = Depends(get_db),
) -> JobListResponse:
    await require_admin_access(session, db)
    jobs = await list_processing_jobs(
        db,
        job_status=status_filter,
        track=track,
        limit=limit,
        offset=offset,
    )
    total_count = await count_processing_jobs(
        db,
        job_status=status_filter,
        track=track,
    )
    return JobListResponse(jobs=jobs, total_count=total_count)


@router.get("/jobs/stats", response_model=JobStatsResponse)
async def get_dashboard_job_stats(
    session: SessionContext = Depends(require_session),
    db: Any = Depends(get_db),
) -> JobStatsResponse:
    await require_admin_access(session, db)
    stats = await fetch_processing_job_stats(db)
    return JobStatsResponse(
        total=stats["total"],
        pending=stats["pending"],
        running=stats["running"],
        retrying=stats["retrying"],
        completed=stats["completed"],
        failed=stats["failed"],
        tracks=JobTrackCounts(
            broll=stats["broll"],
            knowledge=stats["knowledge"],
        ),
    )


@router.get("/jobs/{job_id}", response_model=JobDetailResponse)
async def get_dashboard_job_detail(
    job_id: str,
    session: SessionContext = Depends(require_session),
    db: Any = Depends(get_db),
) -> JobDetailResponse:
    await require_admin_access(session, db)
    job = await fetch_processing_job(db, job_id)
    if job is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Processing job not found.",
        )

    steps = await list_processing_job_steps(db, job_id)
    return JobDetailResponse(**job, steps=steps)


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
