from datetime import date

import pytest
from fastapi import HTTPException, status

from app.auth.api_key import (
    build_auth_context,
    current_billing_period,
    hash_api_key,
    parse_api_key_from_authorization,
)
from app.auth.key_manager import revoke_api_key


def test_parse_api_key_from_authorization_accepts_valid_key() -> None:
    api_key = "cerul_sk_abcdefghijklmnopqrstuvwx12345678"

    assert parse_api_key_from_authorization(f"Bearer {api_key}") == api_key


def test_parse_api_key_from_authorization_rejects_missing_header() -> None:
    with pytest.raises(HTTPException) as exc_info:
        parse_api_key_from_authorization(None)

    assert exc_info.value.status_code == status.HTTP_401_UNAUTHORIZED
    assert exc_info.value.headers == {"WWW-Authenticate": "Bearer"}


def test_parse_api_key_from_authorization_rejects_malformed_token() -> None:
    with pytest.raises(HTTPException) as exc_info:
        parse_api_key_from_authorization("Bearer malformed-key")

    assert exc_info.value.status_code == status.HTTP_401_UNAUTHORIZED
    assert exc_info.value.detail == "Malformed API key."


def test_parse_api_key_from_authorization_rejects_wrong_scheme() -> None:
    with pytest.raises(HTTPException) as exc_info:
        parse_api_key_from_authorization("Token cerul_sk_abcdefghijklmnopqrstuvwx12345678")

    assert exc_info.value.status_code == status.HTTP_401_UNAUTHORIZED
    assert exc_info.value.detail == "Authorization header must use the Bearer scheme."


def test_hash_api_key_matches_expected_sha256() -> None:
    api_key = "cerul_sk_abcdefghijklmnopqrstuvwx12345678"

    assert hash_api_key(api_key) == "c4d90fc3b59a7a6f232cfa6c13d69df4c69bcd2c1ad58f185eeaad556b35158a"


def test_current_billing_period_uses_calendar_month() -> None:
    assert current_billing_period(date(2026, 2, 15)) == (date(2026, 2, 1), date(2026, 2, 28))


def test_build_auth_context_from_db_row() -> None:
    auth_context = build_auth_context(
        {
            "user_id": "user_123",
            "api_key_id": "key_123",
            "tier": "free",
            "credits_limit": 1000,
            "credits_used": 128,
            "rate_limit_per_sec": 1,
        }
    )

    assert auth_context.user_id == "user_123"
    assert auth_context.api_key_id == "key_123"
    assert auth_context.tier == "free"
    assert auth_context.credits_remaining == 872
    assert auth_context.rate_limit_per_sec == 1


@pytest.mark.anyio
async def test_revoke_api_key_returns_false_for_invalid_uuid() -> None:
    assert await revoke_api_key("invalid-key-id", "user_123") is False
