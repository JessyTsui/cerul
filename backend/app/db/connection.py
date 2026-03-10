import asyncio
from collections.abc import AsyncIterator

import asyncpg

from app.config import get_settings

_pool: asyncpg.Pool | None = None
_pool_lock = asyncio.Lock()


def database_url_configured() -> bool:
    database_url = get_settings().database.url
    return bool(database_url and database_url.strip())


def get_database_url() -> str:
    database_url = (get_settings().database.url or "").strip()

    if not database_url:
        raise RuntimeError("DATABASE_URL is not set.")

    return database_url


async def get_pool() -> asyncpg.Pool:
    global _pool

    if _pool is not None:
        return _pool

    async with _pool_lock:
        if _pool is None:
            _pool = await asyncpg.create_pool(
                dsn=get_database_url(),
                min_size=1,
                max_size=10,
                command_timeout=30,
            )

    return _pool


async def close_pool() -> None:
    global _pool

    if _pool is None:
        return

    await _pool.close()
    _pool = None


async def get_db() -> AsyncIterator[asyncpg.Connection]:
    pool = await get_pool()

    async with pool.acquire() as connection:
        yield connection
