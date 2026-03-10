from __future__ import annotations

import calendar
from datetime import date
from typing import Any


def calculate_credit_cost(search_type: str, include_answer: bool) -> int:
    if search_type == "broll":
        return 1
    if search_type == "knowledge":
        return 3 if include_answer else 2
    raise ValueError(f"Unsupported search_type: {search_type}")


def current_billing_period(today: date | None = None) -> tuple[date, date]:
    current_day = today or date.today()
    period_start = current_day.replace(day=1)
    period_end = current_day.replace(
        day=calendar.monthrange(current_day.year, current_day.month)[1]
    )
    return period_start, period_end


async def deduct_credits(
    db: Any,
    user_id: str,
    api_key_id: str,
    request_id: str,
    search_type: str,
    include_answer: bool,
) -> int:
    credits_used = calculate_credit_cost(search_type, include_answer)
    period_start, period_end = current_billing_period()

    if hasattr(db, "record_usage_charge"):
        return await db.record_usage_charge(
            user_id=user_id,
            api_key_id=api_key_id,
            request_id=request_id,
            search_type=search_type,
            include_answer=include_answer,
            period_start=period_start,
            period_end=period_end,
            credits_used=credits_used,
        )

    existing_usage = await db.fetchrow(
        """
        SELECT credits_used
        FROM usage_events
        WHERE request_id = $1
        """,
        request_id,
    )
    if existing_usage is not None:
        return int(existing_usage["credits_used"])

    inserted_usage = await db.fetchrow(
        """
        INSERT INTO usage_events (
            request_id,
            user_id,
            api_key_id,
            search_type,
            credits_used,
            include_answer,
            period_start,
            period_end
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (request_id) DO NOTHING
        RETURNING credits_used
        """,
        request_id,
        user_id,
        api_key_id,
        search_type,
        credits_used,
        include_answer,
        period_start,
        period_end,
    )
    if inserted_usage is None:
        existing_usage = await db.fetchrow(
            """
            SELECT credits_used
            FROM usage_events
            WHERE request_id = $1
            """,
            request_id,
        )
        return 0 if existing_usage is None else int(existing_usage["credits_used"])

    await db.execute(
        """
        INSERT INTO usage_monthly (
            user_id,
            period_start,
            period_end,
            credits_used
        )
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (user_id, period_start, period_end)
        DO UPDATE SET
            credits_used = usage_monthly.credits_used + EXCLUDED.credits_used
        """,
        user_id,
        period_start,
        period_end,
        credits_used,
    )
    return int(inserted_usage["credits_used"])
