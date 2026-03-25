import asyncio
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Awaitable, TypeVar
from urllib.parse import urlparse, urlunparse

import asyncpg
import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_DIR = BACKEND_DIR.parent
MIGRATIONS_DIR = REPO_DIR / "db" / "migrations"
DEFAULT_TEST_DATABASE_URL = "postgresql://cerul:cerul@127.0.0.1:54329/cerul_test"
TEST_USER_ID = "user_stub"
TEST_API_KEY_ID = "00000000-0000-0000-0000-000000000001"
TEST_API_KEY = "cerul_sk_abcdefghijklmnopqrstuvwxyz123456"
TEST_BROLL_ASSET_ID = "00000000-0000-0000-0000-000000000010"
TEST_SECOND_BROLL_ASSET_ID = "00000000-0000-0000-0000-000000000011"
TEST_KNOWLEDGE_VIDEO_ID = "00000000-0000-0000-0000-000000000020"
TEST_KNOWLEDGE_SEGMENT_ID = "00000000-0000-0000-0000-000000000021"
TEST_UNIFIED_BROLL_VIDEO_ID = "00000000-0000-0000-0000-000000000030"
TEST_UNIFIED_BROLL_UNIT_ID = "00000000-0000-0000-0000-000000000031"
TEST_UNIFIED_KNOWLEDGE_UNIT_ID = "00000000-0000-0000-0000-000000000032"
ORIGINAL_DATABASE_URL = os.getenv("DATABASE_URL", "").strip()

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
    explicit_test_url = os.getenv("TEST_DATABASE_URL", "").strip()
    if explicit_test_url:
        return explicit_test_url

    if ORIGINAL_DATABASE_URL:
        return _derive_isolated_test_database_url(ORIGINAL_DATABASE_URL)

    return DEFAULT_TEST_DATABASE_URL


def _derive_isolated_test_database_url(database_url: str) -> str:
    database_name = _database_name(database_url)
    if database_name.endswith("_test"):
        return database_url
    return _with_database_name(database_url, f"{database_name}_test")


async def _ping_database(database_url: str) -> None:
    connection = await asyncpg.connect(database_url)
    await connection.close()


def _database_name(database_url: str) -> str:
    parsed = urlparse(database_url)
    database_name = parsed.path.lstrip("/")
    if not database_name:
        raise RuntimeError(f"Database URL must include a database name: {database_url}")
    return database_name


def _with_database_name(database_url: str, database_name: str) -> str:
    parsed = urlparse(database_url)
    return urlunparse(parsed._replace(path=f"/{database_name}"))


def _maintenance_database_urls(database_url: str) -> list[str]:
    target_database = _database_name(database_url)
    urls: list[str] = []

    for candidate in ("postgres", "cerul", target_database):
        candidate_url = _with_database_name(database_url, candidate)
        if candidate_url not in urls:
            urls.append(candidate_url)

    return urls


async def _ensure_database_exists(database_url: str) -> None:
    try:
        await _ping_database(database_url)
        return
    except Exception:
        pass

    last_error: Exception | None = None
    maintenance_connection: asyncpg.Connection | None = None

    for candidate_url in _maintenance_database_urls(database_url):
        try:
            maintenance_connection = await asyncpg.connect(candidate_url)
            break
        except Exception as exc:  # pragma: no cover - best effort setup path
            last_error = exc

    if maintenance_connection is None:
        raise RuntimeError(
            "Unable to connect to a maintenance database in order to create the test "
            f"database for {database_url}. Last error: {last_error}"
        )

    try:
        database_name = _database_name(database_url)
        exists = await maintenance_connection.fetchval(
            "SELECT 1 FROM pg_database WHERE datname = $1",
            database_name,
        )
        if exists:
            return

        escaped_name = database_name.replace('"', '""')
        await maintenance_connection.execute(f'CREATE DATABASE "{escaped_name}"')
    finally:
        await maintenance_connection.close()


def _ensure_test_database_ready(database_url: str, *, timeout_seconds: int = 60) -> None:
    deadline = time.time() + timeout_seconds
    last_error: Exception | None = None

    while time.time() < deadline:
        try:
            _run_async(_ensure_database_exists(database_url))
            _run_async(_ping_database(database_url))
            return
        except Exception as exc:  # pragma: no cover - best effort setup path
            last_error = exc
            time.sleep(1)

    raise RuntimeError(
        "Test database is unavailable. Start it with `docker compose up -d db` "
        f"and ensure {database_url} is reachable. Last error: {last_error}"
    )


def _assert_test_database_is_isolated(database_url: str) -> None:
    if (
        ORIGINAL_DATABASE_URL
        and ORIGINAL_DATABASE_URL == database_url
        and os.getenv("CERUL_ALLOW_SHARED_TEST_DATABASE") != "1"
    ):
        raise RuntimeError(
            "Refusing to run tests against the same database configured for development. "
            "Set TEST_DATABASE_URL to an isolated database, or explicitly set "
            "CERUL_ALLOW_SHARED_TEST_DATABASE=1 if you really want to share one."
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


async def _should_skip_migration(database_url: str, migration_name: str) -> bool:
    if migration_name != "010_hnsw_index.sql":
        return False

    connection = await asyncpg.connect(database_url)
    try:
        embedding_type = await connection.fetchval(
            """
            SELECT format_type(a.atttypid, a.atttypmod)
            FROM pg_attribute AS a
            JOIN pg_class AS c
                ON c.oid = a.attrelid
            JOIN pg_namespace AS n
                ON n.oid = c.relnamespace
            WHERE n.nspname = 'public'
              AND c.relname = 'retrieval_units'
              AND a.attname = 'embedding'
              AND a.attnum > 0
              AND NOT a.attisdropped
            """
        )
    finally:
        await connection.close()

    # Migration 011 replaces the incompatible 3072-dim HNSW definition.
    return embedding_type == "vector(3072)"


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
            if await _should_skip_migration(database_url, migration_file.name):
                continue
            _run_migration(database_url, migration_file)
    else:
        for migration_file in migration_files:
            if await _should_skip_migration(database_url, migration_file.name):
                continue
            _run_migration(database_url, migration_file)


async def _reset_database_state(database_url: str) -> None:
    connection = await asyncpg.connect(database_url)
    try:
        async with connection.transaction():
            await connection.execute(
                """
                TRUNCATE TABLE
                    admin_metric_targets,
                    processing_job_steps,
                    processing_jobs,
                    content_sources,
                    tracking_events,
                    tracking_links,
                    video_access,
                    retrieval_units,
                    videos,
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
                    console_role,
                    tier,
                    monthly_credit_limit,
                    rate_limit_per_sec
                )
                VALUES ($1, $2, $3, $4, $5, $6)
                """,
                TEST_USER_ID,
                "owner@example.com",
                "user",
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
            INSERT INTO videos (
                id,
                source,
                source_video_id,
                source_url,
                video_url,
                thumbnail_url,
                title,
                description,
                duration_seconds,
                license,
                creator,
                has_captions,
                metadata
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
                $10,
                $11,
                $12,
                $13::jsonb
            )
            """,
            TEST_UNIFIED_BROLL_VIDEO_ID,
            "pexels",
            "pexels_28192743",
            "https://www.pexels.com/video/28192743/",
            "https://videos.pexels.com/video-files/28192743/aerial-coastal-drone.mp4",
            "https://images.pexels.com/photos/28192743/pexels-photo-28192743.jpeg",
            "Aerial drone shot of coastal highway",
            (
                "Cinematic 4K drone footage of winding coastal road at golden hour "
                "with ocean views"
            ),
            18,
            "pexels-license",
            "Pexels",
            False,
            "{}",
        )
            await connection.execute(
            """
            INSERT INTO videos (
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
                license,
                creator,
                has_captions,
                metadata
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
                $12,
                $13,
                $14,
                $15::jsonb
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
            "OpenAI",
            True,
            "{}",
        )
            await connection.execute(
            """
            INSERT INTO video_access (video_id, owner_id)
            VALUES ($1::uuid, NULL), ($2::uuid, NULL)
            """,
            TEST_UNIFIED_BROLL_VIDEO_ID,
            TEST_KNOWLEDGE_VIDEO_ID,
        )
            await connection.execute(
            """
            INSERT INTO retrieval_units (
                id,
                video_id,
                unit_type,
                unit_index,
                timestamp_start,
                timestamp_end,
                content_text,
                transcript,
                visual_desc,
                visual_type,
                keyframe_url,
                metadata,
                embedding
            )
            VALUES (
                $1::uuid,
                $2::uuid,
                'visual',
                0,
                0,
                18,
                $3,
                NULL,
                $4,
                'scene',
                $5,
                $6::jsonb,
                $7::vector
            )
            """,
            TEST_UNIFIED_BROLL_UNIT_ID,
            TEST_UNIFIED_BROLL_VIDEO_ID,
            (
                "Aerial drone shot of coastal highway\n"
                "Cinematic 4K drone footage of winding coastal road at golden hour with ocean views"
            ),
            "Aerial drone shot of a coastal highway at golden hour with ocean views.",
            "https://images.pexels.com/photos/28192743/pexels-photo-28192743.jpeg",
            '{"visual_text_content":"coastal highway sunset"}',
            vector_to_literal(
                build_placeholder_vector(
                    "cinematic drone shot of coastal highway at sunset",
                    DEFAULT_KNOWLEDGE_VECTOR_DIMENSION,
                )
            ),
        )
            await connection.execute(
            """
            INSERT INTO retrieval_units (
                id,
                video_id,
                unit_type,
                unit_index,
                timestamp_start,
                timestamp_end,
                content_text,
                transcript,
                visual_desc,
                visual_type,
                keyframe_url,
                metadata,
                embedding
            )
            VALUES (
                $1::uuid,
                $2::uuid,
                'speech',
                0,
                120,
                178.5,
                $3,
                $4,
                $5,
                'slide',
                $6,
                $7::jsonb,
                $8::vector
            )
            """,
            TEST_UNIFIED_KNOWLEDGE_UNIT_ID,
            TEST_KNOWLEDGE_VIDEO_ID,
            (
                "OpenAI Dev Day Keynote\n"
                "Agents can use reasoning models to plan and execute tasks more reliably."
            ),
            "Agents can use reasoning models to plan and execute tasks more reliably.",
            "Presenter speaking on stage with slides about agent workflows.",
            "https://img.youtube.com/vi/openai-devday/hqdefault.jpg",
            '{"visual_text_content":"Agent workflows","segment_title":"Agent workflows and reasoning models"}',
            vector_to_literal(
                build_placeholder_vector(
                    "agent workflows",
                    DEFAULT_KNOWLEDGE_VECTOR_DIMENSION,
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
    os.environ["DATABASE_URL"] = _test_database_url()


@pytest.fixture(scope="session", autouse=True)
def initialize_test_database(configure_test_environment: None) -> None:
    database_url = _test_database_url()
    _assert_test_database_is_isolated(database_url)
    _ensure_test_database_ready(database_url)
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
