from __future__ import annotations

import os
from collections.abc import AsyncIterator

from .connection import (
    close_pool,
    database_url_configured,
    get_db as get_connection_db,
    get_pool,
)
from .stub import StubDatabase, create_stub_database

_stub_database = create_stub_database()


async def get_db() -> AsyncIterator[object]:
    if database_url_configured():
        async for connection in get_connection_db():
            yield connection
        return

    if os.getenv("CERUL_ENV", "development").lower() in {"development", "test"}:
        # STUB: keep local dev and unit tests runnable before DB wiring is mandatory.
        yield _stub_database
        return

    raise RuntimeError("DATABASE_URL is not set.")


__all__ = [
    "StubDatabase",
    "close_pool",
    "create_stub_database",
    "database_url_configured",
    "get_db",
    "get_pool",
]
