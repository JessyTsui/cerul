from __future__ import annotations

from dataclasses import dataclass
import hashlib
from http.cookies import CookieError, SimpleCookie
import hmac
import os
import time
from typing import Any

import httpx
from fastapi import HTTPException, Request, status

DEFAULT_DEV_AUTH_SECRET = "cerul-local-better-auth-secret-for-development-only"
BETTER_AUTH_COOKIE_NAMES = (
    "better-auth.session_token",
    "better-auth.session_data",
    "__Secure-better-auth.session_token",
    "__Secure-better-auth.session_data",
)
SESSION_PROXY_MAX_AGE_SECONDS = 300
SESSION_PROXY_USER_ID_HEADER = "x-cerul-session-user-id"
SESSION_PROXY_EMAIL_HEADER = "x-cerul-session-user-email"
SESSION_PROXY_TIMESTAMP_HEADER = "x-cerul-session-timestamp"
SESSION_PROXY_SIGNATURE_HEADER = "x-cerul-session-signature"


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


def _get_auth_proxy_secret() -> str:
    return _first_non_empty(
        os.getenv("BETTER_AUTH_SECRET"),
        DEFAULT_DEV_AUTH_SECRET,
    ) or DEFAULT_DEV_AUTH_SECRET


def _build_proxy_signature(
    *,
    user_id: str,
    email: str | None,
    timestamp: int,
    method: str,
    path: str,
) -> str:
    payload = "\n".join(
        [
            user_id,
            email or "",
            str(timestamp),
            method.upper(),
            path,
        ]
    )
    return hmac.new(
        _get_auth_proxy_secret().encode("utf-8"),
        payload.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def _resolve_proxy_session(request: Request) -> SessionContext | None:
    user_id = _first_non_empty(request.headers.get(SESSION_PROXY_USER_ID_HEADER))
    timestamp_raw = _first_non_empty(request.headers.get(SESSION_PROXY_TIMESTAMP_HEADER))
    signature = _first_non_empty(request.headers.get(SESSION_PROXY_SIGNATURE_HEADER))

    if user_id is None or timestamp_raw is None or signature is None:
        return None

    try:
        timestamp = int(timestamp_raw)
    except ValueError:
        return None

    if abs(int(time.time()) - timestamp) > SESSION_PROXY_MAX_AGE_SECONDS:
        return None

    email = _first_non_empty(request.headers.get(SESSION_PROXY_EMAIL_HEADER))
    expected_signature = _build_proxy_signature(
        user_id=user_id,
        email=email,
        timestamp=timestamp,
        method=request.method,
        path=request.url.path,
    )

    if not hmac.compare_digest(signature, expected_signature):
        return None

    return SessionContext(user_id=user_id, email=email)


def _extract_better_auth_cookie_header(cookie_header: str | None) -> str | None:
    if not cookie_header:
        return None

    cookie = SimpleCookie()

    try:
        cookie.load(cookie_header)
    except CookieError:
        return None

    filtered = [
        morsel.OutputString()
        for name in BETTER_AUTH_COOKIE_NAMES
        if (morsel := cookie.get(name)) is not None
    ]

    if not filtered:
        return None

    return "; ".join(filtered)


async def fetch_better_auth_session(request: Request) -> dict[str, Any] | None:
    cookie_header = _extract_better_auth_cookie_header(request.headers.get("cookie"))

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
    proxy_session = _resolve_proxy_session(request)

    if proxy_session is not None:
        return proxy_session

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
