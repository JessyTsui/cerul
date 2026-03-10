import secrets
import string
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from ..db import get_pool
from .api_key import API_KEY_PREFIX, hash_api_key

_KEY_ALPHABET = string.ascii_letters + string.digits
_PREFIX_LENGTH = len(API_KEY_PREFIX) + 8


@dataclass(frozen=True, slots=True)
class ApiKeyMetadata:
    id: str
    name: str
    prefix: str
    created_at: datetime
    last_used_at: datetime | None
    is_active: bool


def _generate_raw_key() -> str:
    suffix = "".join(secrets.choice(_KEY_ALPHABET) for _ in range(32))
    return f"{API_KEY_PREFIX}{suffix}"


def _build_prefix(raw_key: str) -> str:
    return raw_key[:_PREFIX_LENGTH]


async def create_api_key(user_id: str, name: str) -> tuple[str, str]:
    clean_name = name.strip()

    if not clean_name:
        raise ValueError("API key name cannot be empty.")

    raw_key = _generate_raw_key()
    pool = await get_pool()

    async with pool.acquire() as db:
        key_id = await db.fetchval(
            """
            INSERT INTO api_keys (user_id, name, key_hash, prefix)
            VALUES ($1, $2, $3, $4)
            RETURNING id::text
            """,
            user_id,
            clean_name,
            hash_api_key(raw_key),
            _build_prefix(raw_key),
        )

    return str(key_id), raw_key


async def revoke_api_key(key_id: str, user_id: str) -> bool:
    try:
        parsed_key_id = UUID(key_id)
    except ValueError:
        return False

    pool = await get_pool()

    async with pool.acquire() as db:
        result = await db.execute(
            """
            UPDATE api_keys
            SET is_active = FALSE, revoked_at = NOW(), updated_at = NOW()
            WHERE id = $1
              AND user_id = $2
              AND is_active = TRUE
            """,
            parsed_key_id,
            user_id,
        )

    return result.endswith("1")


async def list_api_keys(user_id: str) -> list[ApiKeyMetadata]:
    pool = await get_pool()

    async with pool.acquire() as db:
        rows = await db.fetch(
            """
            SELECT id::text AS id, name, prefix, created_at, last_used_at, is_active
            FROM api_keys
            WHERE user_id = $1
            ORDER BY created_at DESC
            """,
            user_id,
        )

    return [
        ApiKeyMetadata(
            id=row["id"],
            name=row["name"],
            prefix=row["prefix"],
            created_at=row["created_at"],
            last_used_at=row["last_used_at"],
            is_active=row["is_active"],
        )
        for row in rows
    ]
