from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends

from app.auth import AuthContext, require_api_key
from app.billing import (
    calculate_credits_remaining,
    count_active_api_keys,
    fetch_usage_summary,
)
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


@router.get("/usage", response_model=UsageResponse)
async def usage_v1(
    auth: AuthContext = Depends(require_api_key),
    db: Any = Depends(get_db),
) -> UsageResponse:
    usage_summary = await fetch_usage_summary(db, auth.user_id)
    api_keys_active = await count_active_api_keys(db, auth.user_id)
    credits_remaining = calculate_credits_remaining(usage_summary)

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
