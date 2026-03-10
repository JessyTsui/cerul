from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends

from app.auth import AuthContext, require_api_key
from app.billing import current_billing_period
from app.db import get_db
from app.search import ErrorResponse, UsageResponse

router = APIRouter(
    prefix="/v1",
    tags=["usage"],
    responses={
        401: {"model": ErrorResponse},
        429: {"model": ErrorResponse},
        500: {"model": ErrorResponse},
    },
)


async def fetch_usage_summary(db: Any, user_id: str) -> dict[str, Any]:
    period_start, period_end = current_billing_period()

    if hasattr(db, "get_usage_summary"):
        summary = await db.get_usage_summary(user_id, period_start, period_end)
        return {
            **summary,
            "period_start": period_start,
            "period_end": period_end,
        }

    row = await db.fetchrow(
        """
        SELECT
            up.tier,
            up.monthly_credit_limit AS credits_limit,
            up.rate_limit_per_sec,
            COALESCE(um.credits_used, 0) AS credits_used
        FROM user_profiles AS up
        LEFT JOIN usage_monthly AS um
            ON um.user_id = up.id
            AND um.period_start = $2
            AND um.period_end = $3
        WHERE up.id = $1
        """,
        user_id,
        period_start,
        period_end,
    )
    if row is None:
        raise LookupError(f"Unknown user profile for {user_id}")

    return {
        "tier": row["tier"],
        "credits_limit": int(row["credits_limit"]),
        "credits_used": int(row["credits_used"]),
        "rate_limit_per_sec": int(row["rate_limit_per_sec"]),
        "period_start": period_start,
        "period_end": period_end,
    }


async def count_active_api_keys(db: Any, user_id: str) -> int:
    if hasattr(db, "count_active_api_keys"):
        return int(await db.count_active_api_keys(user_id))

    row = await db.fetchrow(
        """
        SELECT COUNT(*) AS active_count
        FROM api_keys
        WHERE user_id = $1 AND is_active = TRUE
        """,
        user_id,
    )
    return 0 if row is None else int(row["active_count"])


@router.get("/usage", response_model=UsageResponse)
async def usage_v1(
    auth: AuthContext = Depends(require_api_key),
    db: Any = Depends(get_db),
) -> UsageResponse:
    usage_summary = await fetch_usage_summary(db, auth.user_id)
    api_keys_active = await count_active_api_keys(db, auth.user_id)
    credits_remaining = max(
        int(usage_summary["credits_limit"]) - int(usage_summary["credits_used"]),
        0,
    )

    return UsageResponse(
        tier=usage_summary["tier"],
        period_start=usage_summary["period_start"],
        period_end=usage_summary["period_end"],
        credits_limit=int(usage_summary["credits_limit"]),
        credits_used=int(usage_summary["credits_used"]),
        credits_remaining=credits_remaining,
        rate_limit_per_sec=int(usage_summary["rate_limit_per_sec"]),
        api_keys_active=api_keys_active,
    )
