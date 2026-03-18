from __future__ import annotations

import time

import pytest
from fastapi import HTTPException, Request, status

from app.auth import session as session_module
from app.auth.session import SessionContext, require_session


@pytest.mark.anyio
async def test_require_session_returns_better_auth_user(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fetch_session(_: Request) -> dict[str, object]:
        return {
            "session": {
                "id": "session_123",
            },
            "user": {
                "id": "user_123",
                "email": "owner@example.com",
            },
        }

    monkeypatch.setattr(
        "app.auth.session.fetch_better_auth_session",
        fetch_session,
    )

    request = Request(
        {
            "type": "http",
            "method": "GET",
            "headers": [],
            "path": "/dashboard",
        },
    )

    session = await require_session(request)

    assert session == SessionContext(
        user_id="user_123",
        email="owner@example.com",
    )


@pytest.mark.anyio
async def test_require_session_accepts_signed_proxy_context(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("BETTER_AUTH_SECRET", "test-secret")

    async def fetch_session(_: Request) -> dict[str, object] | None:
        raise AssertionError("Proxy-authenticated requests should not call Better Auth.")

    monkeypatch.setattr(
        "app.auth.session.fetch_better_auth_session",
        fetch_session,
    )

    timestamp = int(time.time())
    signature = session_module._build_proxy_signature(
        user_id="user_123",
        email="owner@example.com",
        timestamp=timestamp,
        method="GET",
        path="/dashboard/api-keys",
    )

    request = Request(
        {
            "type": "http",
            "scheme": "http",
            "method": "GET",
            "path": "/dashboard/api-keys",
            "query_string": b"",
            "headers": [
                (b"x-cerul-session-user-id", b"user_123"),
                (b"x-cerul-session-user-email", b"owner@example.com"),
                (f"{session_module.SESSION_PROXY_TIMESTAMP_HEADER}".encode("utf-8"), str(timestamp).encode("utf-8")),
                (f"{session_module.SESSION_PROXY_SIGNATURE_HEADER}".encode("utf-8"), signature.encode("utf-8")),
            ],
            "server": ("testserver", 80),
            "client": ("127.0.0.1", 1234),
        },
    )

    session = await require_session(request)

    assert session == SessionContext(
        user_id="user_123",
        email="owner@example.com",
    )


def test_extract_better_auth_cookie_header_filters_unrelated_cookies() -> None:
    filtered = session_module._extract_better_auth_cookie_header(
        "theme=dark; better-auth.session_token=session_token; csrftoken=abc123",
    )

    assert filtered == "better-auth.session_token=session_token"


@pytest.mark.anyio
async def test_require_session_rejects_missing_better_auth_session(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fetch_session(_: Request) -> None:
        return None

    monkeypatch.setattr(
        "app.auth.session.fetch_better_auth_session",
        fetch_session,
    )

    request = Request(
        {
            "type": "http",
            "method": "GET",
            "headers": [],
            "path": "/dashboard",
        },
    )

    with pytest.raises(HTTPException) as exc_info:
        await require_session(request)

    assert exc_info.value.status_code == status.HTTP_401_UNAUTHORIZED
    assert exc_info.value.detail == "Missing authenticated session."


@pytest.mark.anyio
async def test_require_session_rejects_payload_without_user_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fetch_session(_: Request) -> dict[str, object]:
        return {
            "user": {
                "email": "owner@example.com",
            },
        }

    monkeypatch.setattr(
        "app.auth.session.fetch_better_auth_session",
        fetch_session,
    )

    request = Request(
        {
            "type": "http",
            "method": "GET",
            "headers": [],
            "path": "/dashboard",
        },
    )

    with pytest.raises(HTTPException) as exc_info:
        await require_session(request)

    assert exc_info.value.status_code == status.HTTP_401_UNAUTHORIZED
    assert exc_info.value.detail == "Missing authenticated session."
