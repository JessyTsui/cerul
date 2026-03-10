from __future__ import annotations

# STUB: replaced by codex/feature-db-auth

from dataclasses import dataclass
import re

from fastapi import Header, HTTPException, status

API_KEY_PATTERN = re.compile(r"^cerul_sk_[A-Za-z0-9]{16,}$")


@dataclass(frozen=True)
class AuthContext:
    user_id: str
    api_key_id: str
    tier: str
    credits_remaining: int
    rate_limit_per_sec: int


async def require_api_key(
    authorization: str | None = Header(default=None),
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

    return AuthContext(
        user_id="user_stub",
        api_key_id="key_stub",
        tier="free",
        credits_remaining=1000,
        rate_limit_per_sec=1,
    )
