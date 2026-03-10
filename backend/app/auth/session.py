from __future__ import annotations

from dataclasses import dataclass

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


async def require_session(request: Request) -> SessionContext:
    # STUB: integrate with Better Auth once frontend session exchange is wired up.
    user_id = _first_non_empty(
        request.headers.get("X-Cerul-User-Id"),
        request.headers.get("X-User-Id"),
        request.cookies.get("cerul_user_id"),
        request.cookies.get("user_id"),
    )
    if user_id is None:
        raise _session_error(
            "Missing authenticated session. Provide X-Cerul-User-Id or a session cookie.",
        )

    email = _first_non_empty(
        request.headers.get("X-Cerul-User-Email"),
        request.headers.get("X-User-Email"),
        request.cookies.get("cerul_user_email"),
        request.cookies.get("user_email"),
    )
    return SessionContext(user_id=user_id, email=email)
