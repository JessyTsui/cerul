from __future__ import annotations

import pytest
from fastapi import HTTPException, Request, status

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
