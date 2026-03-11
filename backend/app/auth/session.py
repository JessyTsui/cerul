from __future__ import annotations

from dataclasses import dataclass
import os
from typing import Any

import httpx
from fastapi import HTTPException, Request, status


@dataclass(frozen=True, slots=True)
class SessionContext:
    user_id: str
    email: str | None = None


def _session_error(message: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=message,
    )


def _first_non_empty(*values: str | None) -> str | None:
    for value in values:
        if value is None:
            continue

        cleaned = value.strip()
        if cleaned:
            return cleaned

    return None


def _get_better_auth_base_url() -> str:
    return _first_non_empty(
        os.getenv("WEB_BASE_URL"),
        os.getenv("NEXT_PUBLIC_SITE_URL"),
        "http://localhost:3000",
    ) or "http://localhost:3000"


async def fetch_better_auth_session(request: Request) -> dict[str, Any] | None:
    cookie_header = request.headers.get("cookie")

    if not cookie_header:
        return None

    session_url = f"{_get_better_auth_base_url().rstrip('/')}/api/auth/get-session"

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(
                session_url,
                headers={
                    "cookie": cookie_header,
                    "accept": "application/json",
                },
            )
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Better Auth session service is unavailable.",
        ) from exc

    if response.status_code in {401, 403, 404}:
        return None

    if response.status_code >= 500:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Better Auth session service returned an error.",
        )

    try:
        payload = response.json()
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Better Auth session service returned invalid JSON.",
        ) from exc

    if payload is None:
        return None

    if not isinstance(payload, dict):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Better Auth session payload is malformed.",
        )

    return payload


async def require_session(request: Request) -> SessionContext:
    payload = await fetch_better_auth_session(request)

    if payload is None:
        raise _session_error("Missing authenticated session.")

    user = payload.get("user")

    if not isinstance(user, dict):
        raise _session_error("Missing authenticated session.")

    user_id = _first_non_empty(user.get("id"))

    if user_id is None:
        raise _session_error("Missing authenticated session.")

    email = _first_non_empty(user.get("email"))
    return SessionContext(user_id=user_id, email=email)
