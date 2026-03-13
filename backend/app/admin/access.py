from __future__ import annotations

from typing import Any

from fastapi import HTTPException, status

from app.auth import SessionContext
from app.config import get_settings


def _normalize_email(value: str | None) -> str | None:
    if value is None:
        return None

    cleaned = value.strip().lower()
    return cleaned or None


async def fetch_console_identity(db: Any, user_id: str) -> dict[str, Any] | None:
    row = await db.fetchrow(
        """
        SELECT
            id,
            email,
            console_role
        FROM user_profiles
        WHERE id = $1
        """,
        user_id,
    )
    if row is None:
        return None
    return dict(row)


def _email_allowed(email: str | None, allowed_emails: set[str]) -> bool:
    normalized_email = _normalize_email(email)
    return normalized_email is not None and normalized_email in allowed_emails


def _operator_emails() -> set[str]:
    return {
        email
        for email in get_settings().dashboard.operator_emails
        if email
    }


def _admin_emails() -> set[str]:
    admin_emails = {
        email
        for email in get_settings().dashboard.admin_emails
        if email
    }
    return admin_emails or _operator_emails()


async def require_operator_access(
    session: SessionContext,
    db: Any,
) -> dict[str, Any]:
    identity = await fetch_console_identity(db, session.user_id)
    console_role = str((identity or {}).get("console_role") or "user").strip().lower()
    profile_email = _normalize_email((identity or {}).get("email"))
    session_email = _normalize_email(session.email) or profile_email

    if console_role in {"operator", "admin"} or _email_allowed(
        session_email,
        _operator_emails(),
    ):
        return identity or {
            "id": session.user_id,
            "email": session_email,
            "console_role": console_role,
        }

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Pipeline telemetry is restricted to configured operator accounts.",
    )


async def require_admin_access(
    session: SessionContext,
    db: Any,
) -> dict[str, Any]:
    identity = await fetch_console_identity(db, session.user_id)
    console_role = str((identity or {}).get("console_role") or "user").strip().lower()
    profile_email = _normalize_email((identity or {}).get("email"))
    session_email = _normalize_email(session.email) or profile_email

    if console_role == "admin" or _email_allowed(session_email, _admin_emails()):
        return identity or {
            "id": session.user_id,
            "email": session_email,
            "console_role": console_role,
        }

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Admin console access is restricted to administrator accounts.",
    )
