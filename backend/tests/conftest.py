import asyncio
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Awaitable, TypeVar

import asyncpg
import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_DIR = BACKEND_DIR.parent
MIGRATIONS_DIR = REPO_DIR / "db" / "migrations"
DEFAULT_TEST_DATABASE_URL = "postgresql://cerul:cerul@127.0.0.1:54329/cerul"
TEST_USER_ID = "user_stub"
TEST_API_KEY_ID = "00000000-0000-0000-0000-000000000001"
TEST_API_KEY = "cerul_sk_abcdefghijklmnopqrstuvwxyz123456"
TEST_BROLL_ASSET_ID = "00000000-0000-0000-0000-000000000010"
TEST_SECOND_BROLL_ASSET_ID = "00000000-0000-0000-0000-000000000011"
TEST_KNOWLEDGE_VIDEO_ID = "00000000-0000-0000-0000-000000000020"
TEST_KNOWLEDGE_SEGMENT_ID = "00000000-0000-0000-0000-000000000021"

if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.auth.api_key import hash_api_key
from app.config import reset_settings_cache
from app.db import close_pool
from app.search.base import (
    DEFAULT_BROLL_VECTOR_DIMENSION,
    DEFAULT_KNOWLEDGE_VECTOR_DIMENSION,
    build_placeholder_vector,
    vector_to_literal,
)

T = TypeVar("T")


def _run_async(coroutine: Awaitable[T]) -> T:
    return asyncio.run(coroutine)


def _test_database_url() -> str:
    return os.getenv("TEST_DATABASE_URL", DEFAULT_TEST_DATABASE_URL)


async def _ping_database(database_url: str) -> None:
    connection = await asyncpg.connect(database_url)
    await connection.close()


def _wait_for_database(database_url: str, *, timeout_seconds: int = 60) -> None:
    deadline = time.time() + timeout_seconds
    last_error: Exception | None = None

    while time.time() < deadline:
        try:
            _run_async(_ping_database(database_url))
            return
        except Exception as exc:  # pragma: no cover - best effort setup path
            last_error = exc
            time.sleep(1)

    raise RuntimeError(
        "Test database is unavailable. Start it with `docker compose up -d db` "
        f"and ensure {database_url} is reachable. Last error: {last_error}"
    )


def _run_migration(database_url: str, migration_file: Path) -> None:
    completed = subprocess.run(
        [
            "psql",
            database_url,
            "-v",
            "ON_ERROR_STOP=1",
            "-f",
            str(migration_file),
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        raise RuntimeError(
            f"Migration {migration_file.name} failed: "
            f"{completed.stderr.strip() or completed.stdout.strip()}"
        )


async def _ensure_schema(database_url: str) -> None:
    migration_files = sorted(MIGRATIONS_DIR.glob("*.sql"))
    if not migration_files:
        raise RuntimeError(f"No migration files found in {MIGRATIONS_DIR}")

    connection = await asyncpg.connect(database_url)
    try:
        schema_exists = (
            await connection.fetchval("SELECT to_regclass('public.user_profiles')")
            is not None
        )
    finally:
        await connection.close()

    if schema_exists:
        # Schema already exists — only run migrations after the initial one.
        for migration_file in migration_files:
            if migration_file.name.startswith("001_"):
                continue
            _run_migration(database_url, migration_file)
    else:
        for migration_file in migration_files:
            _run_migration(database_url, migration_file)


async def _reset_database_state(database_url: str) -> None:
    connection = await asyncpg.connect(database_url)
    try:
        await connection.execute(
            """
            TRUNCATE TABLE
                processing_job_steps,
                processing_jobs,
                content_sources,
                query_logs,
                usage_events,
                usage_monthly,
                api_keys,
                knowledge_segments,
                knowledge_videos,
                broll_assets,
                stripe_events,
                user_profiles
            RESTART IDENTITY CASCADE
            """
        )

        await connection.execute(
            """
            INSERT INTO user_profiles (
                id,
                email,
                tier,
                monthly_credit_limit,
                rate_limit_per_sec
            )
            VALUES ($1, $2, $3, $4, $5)
            """,
            TEST_USER_ID,
            "owner@example.com",
            "free",
            1000,
            10,
        )
        await connection.execute(
            """
            INSERT INTO api_keys (id, user_id, name, key_hash, prefix, is_active)
            VALUES ($1::uuid, $2, $3, $4, $5, TRUE)
            """,
            TEST_API_KEY_ID,
            TEST_USER_ID,
            "Default key",
            hash_api_key(TEST_API_KEY),
            TEST_API_KEY[:16],
        )

        await connection.execute(
            """
            INSERT INTO broll_assets (
                id,
                source,
                source_asset_id,
                source_url,
                video_url,
                thumbnail_url,
                duration_seconds,
                title,
                description,
                license,
                embedding
            )
            VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::vector)
            """,
            TEST_BROLL_ASSET_ID,
            "pexels",
            "pexels_28192743",
            "https://www.pexels.com/video/28192743/",
            "https://videos.pexels.com/video-files/28192743/aerial-coastal-drone.mp4",
            "https://images.pexels.com/photos/28192743/pexels-photo-28192743.jpeg",
            18,
            "Aerial drone shot of coastal highway",
            (
                "Cinematic 4K drone footage of winding coastal road at golden hour "
                "with ocean views"
            ),
            "pexels-license",
            vector_to_literal(
                build_placeholder_vector(
                    "aerial drone shot coastal highway sunset",
                    DEFAULT_BROLL_VECTOR_DIMENSION,
                )
            ),
        )
        await connection.execute(
            """
            INSERT INTO broll_assets (
                id,
                source,
                source_asset_id,
                source_url,
                video_url,
                thumbnail_url,
                duration_seconds,
                title,
                description,
                license,
                embedding
            )
            VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::vector)
            """,
            TEST_SECOND_BROLL_ASSET_ID,
            "pixabay",
            "pixabay_992100",
            "https://pixabay.com/videos/id-992100/",
            "https://cdn.pixabay.com/video/2024/01/12/business-handshake.mp4",
            "https://cdn.pixabay.com/photo/2024/01/12/business-handshake.jpg",
            12,
            "Business handshake in modern office",
            "Professional office handshake with shallow depth of field",
            "pixabay-license",
            vector_to_literal(
                build_placeholder_vector(
                    "business handshake in modern office",
                    DEFAULT_BROLL_VECTOR_DIMENSION,
                )
            ),
        )

        await connection.execute(
            """
            INSERT INTO knowledge_videos (
                id,
                source,
                source_video_id,
                source_url,
                video_url,
                thumbnail_url,
                title,
                description,
                speaker,
                published_at,
                duration_seconds,
                license
            )
            VALUES (
                $1::uuid,
                $2,
                $3,
                $4,
                $5,
                $6,
                $7,
                $8,
                $9,
                $10::timestamptz,
                $11,
                $12
            )
            """,
            TEST_KNOWLEDGE_VIDEO_ID,
            "youtube",
            "openai-devday",
            "https://www.youtube.com/watch?v=openai-devday",
            "https://www.youtube.com/watch?v=openai-devday",
            "https://img.youtube.com/vi/openai-devday/hqdefault.jpg",
            "OpenAI Dev Day Keynote",
            "Discussion about agent workflows and reasoning models.",
            "Sam Altman",
            datetime(2025, 11, 6, tzinfo=timezone.utc),
            3600,
            "standard-youtube-license",
        )
        await connection.execute(
            """
            INSERT INTO knowledge_segments (
                id,
                video_id,
                segment_index,
                title,
                description,
                transcript_text,
                visual_summary,
                timestamp_start,
                timestamp_end,
                embedding
            )
            VALUES (
                $1::uuid,
                $2::uuid,
                $3,
                $4,
                $5,
                $6,
                $7,
                $8,
                $9,
                $10::vector
            )
            """,
            TEST_KNOWLEDGE_SEGMENT_ID,
            TEST_KNOWLEDGE_VIDEO_ID,
            0,
            "Agent workflows and reasoning models",
            "Discussion about agent workflows and reasoning models.",
            "Agents can use reasoning models to plan and execute tasks more reliably.",
            "Presenter speaking on stage with slides about agent workflows.",
            120.0,
            178.5,
            vector_to_literal(
                build_placeholder_vector(
                    "agents reasoning models keynote answer",
                    DEFAULT_KNOWLEDGE_VECTOR_DIMENSION,
                )
            ),
        )
    finally:
        await connection.close()


class DatabaseHarness:
    def __init__(self, database_url: str) -> None:
        self.database_url = database_url

    async def fetchval_async(self, query: str, *params: object) -> object:
        connection = await asyncpg.connect(self.database_url)
        try:
            return await connection.fetchval(query, *params)
        finally:
            await connection.close()

    async def fetchrow_async(self, query: str, *params: object) -> asyncpg.Record | None:
        connection = await asyncpg.connect(self.database_url)
        try:
            return await connection.fetchrow(query, *params)
        finally:
            await connection.close()

    async def fetch_async(self, query: str, *params: object) -> list[asyncpg.Record]:
        connection = await asyncpg.connect(self.database_url)
        try:
            return list(await connection.fetch(query, *params))
        finally:
            await connection.close()

    def fetchval(self, query: str, *params: object) -> object:
        return _run_async(self.fetchval_async(query, *params))

    def fetchrow(self, query: str, *params: object) -> asyncpg.Record | None:
        return _run_async(self.fetchrow_async(query, *params))

    def fetch(self, query: str, *params: object) -> list[asyncpg.Record]:
        return _run_async(self.fetch_async(query, *params))


@pytest.fixture(scope="session", autouse=True)
def configure_test_environment() -> None:
    os.environ["CERUL_ENV"] = "test"
    os.environ["DATABASE_URL"] = _test_database_url()


@pytest.fixture(scope="session", autouse=True)
def initialize_test_database(configure_test_environment: None) -> None:
    database_url = _test_database_url()
    _wait_for_database(database_url)
    _run_async(_ensure_schema(database_url))


@pytest.fixture(autouse=True)
def clear_settings_cache() -> None:
    reset_settings_cache()
    yield
    reset_settings_cache()


@pytest.fixture(autouse=True)
def reset_database(initialize_test_database: None) -> None:
    _run_async(close_pool())
    _run_async(_reset_database_state(_test_database_url()))
    yield
    _run_async(close_pool())


@pytest.fixture
def database() -> DatabaseHarness:
    return DatabaseHarness(_test_database_url())
