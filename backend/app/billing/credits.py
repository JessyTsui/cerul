from __future__ import annotations

import calendar
from contextlib import asynccontextmanager
from datetime import date

import asyncpg


class InsufficientCreditsError(RuntimeError):
    """Raised when a request would exceed the current monthly credit limit."""


def calculate_credit_cost(search_type: str | None, include_answer: bool) -> int:
    normalized_search_type = (search_type or "unified").strip().lower()
    if normalized_search_type in {"broll", "unified"}:
        return 2 if include_answer else 1
    if normalized_search_type == "knowledge":
        return 2 if include_answer else 1
    raise ValueError(f"Unsupported search_type: {search_type}")


def current_billing_period(today: date | None = None) -> tuple[date, date]:
    current_day = today or date.today()
    period_start = current_day.replace(day=1)
    period_end = current_day.replace(
        day=calendar.monthrange(current_day.year, current_day.month)[1]
    )
    return period_start, period_end


@asynccontextmanager
async def transaction_scope(db: asyncpg.Connection):
    transaction = getattr(db, "transaction", None)
    if transaction is None:
        yield
        return

    async with transaction():
        yield


async def deduct_credits(
    db: asyncpg.Connection,
    user_id: str,
    api_key_id: str,
    request_id: str,
    search_type: str,
    include_answer: bool,
) -> int:
    async with transaction_scope(db):
        credits_used = calculate_credit_cost(search_type, include_answer)
        period_start, period_end = current_billing_period()

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
                include_answer,
                credits_used
            )
            VALUES ($1, $2, $3::uuid, $4, $5, $6)
            ON CONFLICT (request_id) DO NOTHING
            RETURNING credits_used
            """,
            request_id,
            user_id,
            api_key_id,
            search_type,
            include_answer,
            credits_used,
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

        monthly_usage = await db.fetchrow(
            """
            INSERT INTO usage_monthly (
                user_id,
                period_start,
                period_end,
                credits_limit,
                credits_used,
                request_count
            )
            SELECT
                up.id,
                $2,
                $3,
                up.monthly_credit_limit,
                $4,
                1
            FROM user_profiles AS up
            WHERE up.id = $1
              AND up.monthly_credit_limit >= $4
            ON CONFLICT (user_id, period_start)
            DO UPDATE SET
                period_end = EXCLUDED.period_end,
                credits_limit = EXCLUDED.credits_limit,
                credits_used = usage_monthly.credits_used + EXCLUDED.credits_used,
                request_count = usage_monthly.request_count + EXCLUDED.request_count,
                updated_at = NOW()
            WHERE usage_monthly.credits_used + EXCLUDED.credits_used
                <= EXCLUDED.credits_limit
            RETURNING credits_used
            """,
            user_id,
            period_start,
            period_end,
            credits_used,
        )

        if monthly_usage is None:
            profile = await db.fetchrow(
                """
                SELECT monthly_credit_limit
                FROM user_profiles
                WHERE id = $1
                """,
                user_id,
            )
            if profile is None:
                raise LookupError(f"Unknown user profile for {user_id}")

            raise InsufficientCreditsError("Monthly credit limit exhausted.")

        return int(inserted_usage["credits_used"])


async def refund_credits(
    db: asyncpg.Connection,
    request_id: str,
) -> int:
    async with transaction_scope(db):
        deleted_usage = await db.fetchrow(
            """
            DELETE FROM usage_events
            WHERE request_id = $1
            RETURNING user_id, credits_used, occurred_at
            """,
            request_id,
        )
        if deleted_usage is None:
            return 0

        occurred_at = deleted_usage["occurred_at"]
        period_start, period_end = current_billing_period(occurred_at.date())

        await db.execute(
            """
            UPDATE usage_monthly
            SET
                credits_used = GREATEST(usage_monthly.credits_used - $4, 0),
                request_count = GREATEST(usage_monthly.request_count - 1, 0),
                updated_at = NOW()
            WHERE user_id = $1
              AND period_start = $2
              AND period_end = $3
            """,
            deleted_usage["user_id"],
            period_start,
            period_end,
            int(deleted_usage["credits_used"]),
        )

        return int(deleted_usage["credits_used"])
