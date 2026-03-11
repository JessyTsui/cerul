from __future__ import annotations

import asyncio
import json
import os
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Protocol
from uuid import uuid4


class BrollAssetRepositoryProtocol(Protocol):
    async def connect(self) -> None:
        ...

    async def close(self) -> None:
        ...

    async def asset_exists(self, source: str, source_asset_id: str) -> bool:
        ...

    async def bulk_check_existing(
        self,
        assets: Sequence[Mapping[str, Any]],
    ) -> set[str]:
        ...

    async def store_asset(
        self,
        asset: Mapping[str, Any],
        embedding: Sequence[float],
    ) -> None:
        ...

    async def store_assets_batch(
        self,
        assets: Sequence[Mapping[str, Any]],
        embeddings: Sequence[Sequence[float]],
    ) -> int:
        ...

    async def count_assets(self) -> int:
        ...

    async def mark_job_completed(
        self,
        job_id: str | None,
        artifacts: Mapping[str, Any],
    ) -> None:
        ...


class BrollAssetRepository:
    def __init__(self, db_url: str) -> None:
        self._db_url = db_url
        self._pool: Any | None = None
        self._pool_lock = asyncio.Lock()

    async def connect(self) -> None:
        if self._pool is not None:
            return

        async with self._pool_lock:
            if self._pool is not None:
                return

            asyncpg = _import_asyncpg()
            self._pool = await asyncpg.create_pool(
                dsn=self._db_url,
                min_size=1,
                max_size=10,
                command_timeout=60,
            )

    async def close(self) -> None:
        if self._pool is None:
            return

        await self._pool.close()
        self._pool = None

    async def asset_exists(self, source: str, source_asset_id: str) -> bool:
        pool = await self._get_pool()
        async with pool.acquire() as connection:
            row = await connection.fetchrow(
                """
                SELECT 1
                FROM broll_assets
                WHERE source = $1
                  AND source_asset_id = $2
                """,
                source,
                source_asset_id,
            )
        return row is not None

    async def bulk_check_existing(
        self,
        assets: Sequence[Mapping[str, Any]],
    ) -> set[str]:
        if not assets:
            return set()

        lookup: dict[tuple[str, str], str] = {}
        sources: list[str] = []
        source_asset_ids: list[str] = []
        for asset in assets:
            source = str(asset["source"])
            source_asset_id = str(asset["source_asset_id"])
            lookup[(source, source_asset_id)] = str(asset.get("id") or "")
            sources.append(source)
            source_asset_ids.append(source_asset_id)

        pool = await self._get_pool()
        async with pool.acquire() as connection:
            rows = await connection.fetch(
                """
                SELECT source, source_asset_id
                FROM broll_assets
                WHERE (source, source_asset_id) IN (
                    SELECT *
                    FROM UNNEST($1::text[], $2::text[])
                )
                """,
                sources,
                source_asset_ids,
            )

        existing_ids: set[str] = set()
        for row in rows:
            asset_id = lookup.get((str(row["source"]), str(row["source_asset_id"])))
            if asset_id:
                existing_ids.add(asset_id)

        return existing_ids

    async def store_asset(
        self,
        asset: Mapping[str, Any],
        embedding: Sequence[float],
    ) -> None:
        pool = await self._get_pool()
        async with pool.acquire() as connection:
            await connection.execute(
                _UPSERT_BROLL_ASSET_QUERY,
                *self._build_asset_record(asset, embedding),
            )

    async def store_assets_batch(
        self,
        assets: Sequence[Mapping[str, Any]],
        embeddings: Sequence[Sequence[float]],
    ) -> int:
        if len(assets) != len(embeddings):
            raise ValueError("assets and embeddings must have the same length.")
        if not assets:
            return 0

        records = [
            self._build_asset_record(asset, embedding)
            for asset, embedding in zip(assets, embeddings, strict=True)
        ]

        pool = await self._get_pool()
        async with pool.acquire() as connection:
            async with connection.transaction():
                await connection.executemany(_UPSERT_BROLL_ASSET_QUERY, records)

        return len(records)

    async def count_assets(self) -> int:
        pool = await self._get_pool()
        async with pool.acquire() as connection:
            count = await connection.fetchval("SELECT COUNT(*) FROM broll_assets")
        return int(count or 0)

    async def mark_job_completed(
        self,
        job_id: str | None,
        artifacts: Mapping[str, Any],
    ) -> None:
        if job_id is None:
            return

        pool = await self._get_pool()
        async with pool.acquire() as connection:
            async with connection.transaction():
                await connection.execute(
                    """
                    UPDATE processing_jobs
                    SET
                        status = 'completed',
                        error_message = NULL,
                        completed_at = NOW(),
                        updated_at = NOW()
                    WHERE id = $1::uuid
                    """,
                    job_id,
                )
                await connection.execute(
                    """
                    INSERT INTO processing_job_steps (
                        job_id,
                        step_name,
                        status,
                        artifacts,
                        started_at,
                        completed_at,
                        updated_at
                    )
                    VALUES (
                        $1::uuid,
                        $2,
                        'completed',
                        $3::jsonb,
                        NOW(),
                        NOW(),
                        NOW()
                    )
                    ON CONFLICT (job_id, step_name) DO UPDATE
                    SET
                        status = 'completed',
                        artifacts = EXCLUDED.artifacts,
                        completed_at = NOW(),
                        updated_at = NOW()
                    """,
                    job_id,
                    "broll.pipeline.completed",
                    json.dumps(dict(artifacts), default=str),
                )

    async def upsert_broll_asset(
        self,
        asset: Mapping[str, Any],
        embedding: Sequence[float],
        frame_path: str | None = None,
    ) -> dict[str, Any]:
        payload = self._build_persisted_asset_payload(
            asset=asset,
            embedding=embedding,
            frame_path=frame_path,
        )
        await self.store_asset(asset, embedding)
        return payload

    async def _get_pool(self) -> Any:
        await self.connect()
        if self._pool is None:
            raise RuntimeError("B-roll database pool is not initialized.")
        return self._pool

    def _build_asset_record(
        self,
        asset: Mapping[str, Any],
        embedding: Sequence[float],
    ) -> tuple[Any, ...]:
        return (
            asset["source"],
            asset["source_asset_id"],
            asset.get("source_url"),
            asset["video_url"],
            asset.get("thumbnail_url"),
            asset.get("duration_seconds", asset.get("duration")),
            asset["title"],
            asset.get("description", ""),
            [str(tag) for tag in asset.get("tags", [])],
            asset.get("license"),
            asset.get("creator"),
            json.dumps(asset.get("metadata", {}), default=str),
            _vector_to_literal(embedding),
        )

    def _build_persisted_asset_payload(
        self,
        *,
        asset: Mapping[str, Any],
        embedding: Sequence[float],
        frame_path: str | None,
    ) -> dict[str, Any]:
        payload = dict(asset)
        payload["embedding"] = list(embedding)
        payload["frame_path"] = frame_path
        return payload


@dataclass(slots=True)
class InMemoryBrollAssetRepository:
    existing_assets: set[tuple[str, str]] = field(default_factory=set)
    stored_assets: list[dict[str, Any]] = field(default_factory=list)
    completed_jobs: dict[str, dict[str, Any]] = field(default_factory=dict)

    async def connect(self) -> None:
        return None

    async def close(self) -> None:
        return None

    async def asset_exists(self, source: str, source_asset_id: str) -> bool:
        return (source, source_asset_id) in self.existing_assets

    async def bulk_check_existing(
        self,
        assets: Sequence[Mapping[str, Any]],
    ) -> set[str]:
        existing_ids: set[str] = set()
        for asset in assets:
            asset_key = (str(asset["source"]), str(asset["source_asset_id"]))
            if asset_key in self.existing_assets and asset.get("id"):
                existing_ids.add(str(asset["id"]))
        return existing_ids

    async def store_asset(
        self,
        asset: Mapping[str, Any],
        embedding: Sequence[float],
    ) -> None:
        await self.upsert_broll_asset(asset, embedding)

    async def store_assets_batch(
        self,
        assets: Sequence[Mapping[str, Any]],
        embeddings: Sequence[Sequence[float]],
    ) -> int:
        if len(assets) != len(embeddings):
            raise ValueError("assets and embeddings must have the same length.")

        for asset, embedding in zip(assets, embeddings, strict=True):
            await self.upsert_broll_asset(asset, embedding)

        return len(assets)

    async def count_assets(self) -> int:
        return len(self.stored_assets)

    async def upsert_broll_asset(
        self,
        asset: Mapping[str, Any],
        embedding: Sequence[float],
        frame_path: str | None = None,
    ) -> dict[str, Any]:
        payload = dict(asset)
        payload["id"] = str(payload.get("id") or uuid4())
        payload["embedding"] = list(embedding)
        payload["frame_path"] = frame_path

        key = (str(payload["source"]), str(payload["source_asset_id"]))
        self.existing_assets.add(key)

        for index, existing_asset in enumerate(self.stored_assets):
            if (
                existing_asset["source"],
                existing_asset["source_asset_id"],
            ) == key:
                self.stored_assets[index] = payload
                return dict(payload)

        self.stored_assets.append(payload)
        return dict(payload)

    async def mark_job_completed(
        self,
        job_id: str | None,
        artifacts: Mapping[str, Any],
    ) -> None:
        if job_id is None:
            return

        self.completed_jobs[job_id] = dict(artifacts)


def resolve_default_broll_repository(
    db_url: str | None = None,
) -> BrollAssetRepositoryProtocol:
    database_url = (db_url or os.getenv("DATABASE_URL") or "").strip()
    if database_url:
        return BrollAssetRepository(database_url)
    return InMemoryBrollAssetRepository()


def _import_asyncpg() -> Any:
    try:
        import asyncpg
    except ImportError as exc:
        raise RuntimeError("BrollAssetRepository requires asyncpg to be installed.") from exc

    return asyncpg


def _vector_to_literal(values: Sequence[float]) -> str:
    return "[" + ",".join(f"{float(value):.12g}" for value in values) + "]"


_UPSERT_BROLL_ASSET_QUERY = """
INSERT INTO broll_assets (
    source,
    source_asset_id,
    source_url,
    video_url,
    thumbnail_url,
    duration_seconds,
    title,
    description,
    tags,
    license,
    creator,
    metadata,
    embedding
)
VALUES (
    $1,
    $2,
    $3,
    $4,
    $5,
    $6,
    $7,
    $8,
    $9::text[],
    $10,
    $11,
    $12::jsonb,
    $13::vector
)
ON CONFLICT (source, source_asset_id) DO UPDATE
SET
    source_url = EXCLUDED.source_url,
    video_url = EXCLUDED.video_url,
    thumbnail_url = EXCLUDED.thumbnail_url,
    duration_seconds = EXCLUDED.duration_seconds,
    title = EXCLUDED.title,
    description = EXCLUDED.description,
    tags = EXCLUDED.tags,
    license = EXCLUDED.license,
    creator = EXCLUDED.creator,
    metadata = EXCLUDED.metadata,
    embedding = EXCLUDED.embedding,
    updated_at = NOW()
"""
