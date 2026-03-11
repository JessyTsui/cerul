import hashlib
import math
import re
from calendar import monthrange
from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Any
from uuid import UUID

import asyncpg
from fastapi import Depends, Header, HTTPException, status

from ..db import get_db
from ..middleware.rate_limit import get_rate_limiter

API_KEY_PREFIX = "cerul_sk_"
API_KEY_PATTERN = re.compile(r"^cerul_sk_[A-Za-z0-9]{32}$")


@dataclass(frozen=True, slots=True)
class AuthContext:
    user_id: str
    api_key_id: str
    tier: str
    credits_remaining: int
    rate_limit_per_sec: int


def _auth_error(
    status_code: int,
    message: str,
    *,
    headers: dict[str, str] | None = None,
) -> HTTPException:
    response_headers = dict(headers or {})

    if status_code == status.HTTP_401_UNAUTHORIZED:
        response_headers.setdefault("WWW-Authenticate", "Bearer")

    return HTTPException(
        status_code=status_code,
        detail=message,
        headers=response_headers or None,
    )


def parse_api_key_from_authorization(authorization: str | None) -> str:
    if not authorization:
        raise _auth_error(status.HTTP_401_UNAUTHORIZED, "Missing Authorization header.")

    scheme, separator, token = authorization.partition(" ")

    if separator == "" or scheme.lower() != "bearer":
        raise _auth_error(
            status.HTTP_401_UNAUTHORIZED,
            "Authorization header must use the Bearer scheme.",
        )

    api_key = token.strip()

    if not API_KEY_PATTERN.fullmatch(api_key):
        raise _auth_error(status.HTTP_401_UNAUTHORIZED, "Malformed API key.")

    return api_key


def hash_api_key(api_key: str) -> str:
    return hashlib.sha256(api_key.encode("utf-8")).hexdigest()


def current_billing_period(reference_date: date | None = None) -> tuple[date, date]:
    current_date = reference_date or datetime.now(timezone.utc).date()
    period_start = current_date.replace(day=1)
    period_end = current_date.replace(day=monthrange(current_date.year, current_date.month)[1])
    return period_start, period_end


def build_auth_context(row: dict[str, Any] | asyncpg.Record) -> AuthContext:
    record = dict(row)
    credits_limit = int(record["credits_limit"])
    credits_used = int(record.get("credits_used") or 0)

    return AuthContext(
        user_id=str(record["user_id"]),
        api_key_id=str(record["api_key_id"]),
        tier=str(record["tier"]),
        credits_remaining=max(credits_limit - credits_used, 0),
        rate_limit_per_sec=int(record["rate_limit_per_sec"] or 0),
    )


async def _fetch_auth_row(db: asyncpg.Connection, key_hash: str) -> asyncpg.Record | None:
    period_start, period_end = current_billing_period()

    return await db.fetchrow(
        """
        SELECT
            ak.id AS api_key_id,
            ak.user_id,
            ak.is_active,
            up.tier,
            up.rate_limit_per_sec,
            COALESCE(um.credits_limit, up.monthly_credit_limit) AS credits_limit,
            COALESCE(um.credits_used, 0) AS credits_used
        FROM api_keys AS ak
        JOIN user_profiles AS up ON up.id = ak.user_id
        LEFT JOIN usage_monthly AS um
            ON um.user_id = up.id
            AND um.period_start = $2
            AND um.period_end = $3
        WHERE ak.key_hash = $1
        """,
        key_hash,
        period_start,
        period_end,
    )


async def _enforce_rate_limit(auth_context: AuthContext) -> None:
    lease = await get_rate_limiter().acquire(
        auth_context.api_key_id,
        auth_context.rate_limit_per_sec,
    )

    if lease.allowed:
        return

    raise _auth_error(
        status.HTTP_429_TOO_MANY_REQUESTS,
        "Rate limit exceeded.",
        headers={"Retry-After": str(max(math.ceil(lease.retry_after_seconds), 1))},
    )


async def _touch_api_key_last_used(
    db: asyncpg.Connection,
    api_key_id: str,
) -> None:
    await db.execute(
        """
        UPDATE api_keys
        SET last_used_at = NOW(), updated_at = NOW()
        WHERE id = $1::uuid
        """,
        UUID(api_key_id),
    )


async def require_api_key(
    authorization: str | None = Header(default=None),
    db: asyncpg.Connection = Depends(get_db),
) -> AuthContext:
    api_key = parse_api_key_from_authorization(authorization)

    key_hash = hash_api_key(api_key)
    auth_row = await _fetch_auth_row(db, key_hash)

    if auth_row is None:
        raise _auth_error(status.HTTP_401_UNAUTHORIZED, "Invalid API key")

    if not auth_row["is_active"]:
        raise _auth_error(status.HTTP_403_FORBIDDEN, "API key is inactive")

    auth_context = build_auth_context(auth_row)

    if auth_context.credits_remaining <= 0:
        raise _auth_error(status.HTTP_403_FORBIDDEN, "Monthly credit limit exhausted")

    await _enforce_rate_limit(auth_context)
    await _touch_api_key_last_used(db, auth_context.api_key_id)

    return auth_context
