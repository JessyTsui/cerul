from __future__ import annotations

import json
import os
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Protocol
from uuid import uuid4


class UnifiedRepository(Protocol):
    async def job_exists(self, job_id: str | None) -> bool:
        ...

    async def upsert_video(self, video: Mapping[str, Any]) -> dict[str, Any]:
        ...

    async def ensure_video_access(self, video_id: str, owner_id: str | None) -> None:
        ...

    async def replace_units(
        self,
        *,
        video_id: str,
        units: Sequence[Mapping[str, Any]],
    ) -> list[dict[str, Any]]:
        ...

    async def mark_job_completed(
        self,
        job_id: str | None,
        artifacts: Mapping[str, Any],
    ) -> None:
        ...


@dataclass(slots=True)
class InMemoryUnifiedRepository:
    videos_by_key: dict[tuple[str, str], dict[str, Any]] = field(default_factory=dict)
    access_by_video_id: dict[str, set[str | None]] = field(default_factory=dict)
    units_by_video_id: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    completed_jobs: dict[str, dict[str, Any]] = field(default_factory=dict)

    async def job_exists(self, job_id: str | None) -> bool:
        return True

    async def upsert_video(self, video: Mapping[str, Any]) -> dict[str, Any]:
        payload = dict(video)
        key = (str(payload["source"]), str(payload["source_video_id"]))
        existing = self.videos_by_key.get(key)
        if existing is not None:
            payload["id"] = existing["id"]
        elif not payload.get("id"):
            payload["id"] = str(uuid4())

        self.videos_by_key[key] = payload
        return dict(payload)

    async def ensure_video_access(self, video_id: str, owner_id: str | None) -> None:
        self.access_by_video_id.setdefault(video_id, set()).add(owner_id)

    async def replace_units(
        self,
        *,
        video_id: str,
        units: Sequence[Mapping[str, Any]],
    ) -> list[dict[str, Any]]:
        stored_units: list[dict[str, Any]] = []
        for unit in units:
            payload = dict(unit)
            payload["video_id"] = video_id
            payload.setdefault("id", str(uuid4()))
            stored_units.append(payload)
        self.units_by_video_id[video_id] = stored_units
        return [dict(unit) for unit in stored_units]

    async def mark_job_completed(
        self,
        job_id: str | None,
        artifacts: Mapping[str, Any],
    ) -> None:
        if job_id is None:
            return
        self.completed_jobs[job_id] = dict(artifacts)


class AsyncpgUnifiedRepository:
    def __init__(self, database_url: str) -> None:
        self._database_url = database_url

    async def job_exists(self, job_id: str | None) -> bool:
        if job_id is None:
            return True
        connection = await self._connect()
        try:
            row = await connection.fetchval(
                """
                SELECT TRUE
                FROM processing_jobs
                WHERE id = $1::uuid
                  AND COALESCE(
                      (input_payload->>'cancelled_by_user')::boolean,
                      FALSE
                  ) = FALSE
                LIMIT 1
                """,
                job_id,
            )
            return bool(row)
        finally:
            await connection.close()

    async def upsert_video(self, video: Mapping[str, Any]) -> dict[str, Any]:
        connection = await self._connect()
        try:
            row = await connection.fetchrow(
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
                    COALESCE($1::uuid, gen_random_uuid()),
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
                ON CONFLICT (source, source_video_id) DO UPDATE
                SET
                    source_url = EXCLUDED.source_url,
                    video_url = EXCLUDED.video_url,
                    thumbnail_url = EXCLUDED.thumbnail_url,
                    title = EXCLUDED.title,
                    description = EXCLUDED.description,
                    speaker = EXCLUDED.speaker,
                    published_at = EXCLUDED.published_at,
                    duration_seconds = EXCLUDED.duration_seconds,
                    license = EXCLUDED.license,
                    creator = EXCLUDED.creator,
                    has_captions = EXCLUDED.has_captions,
                    metadata = EXCLUDED.metadata,
                    updated_at = NOW()
                RETURNING
                    id::text AS id,
                    source,
                    source_video_id,
                    title,
                    video_url,
                    thumbnail_url,
                    duration_seconds,
                    metadata
                """,
                video.get("id"),
                video["source"],
                video["source_video_id"],
                video.get("source_url"),
                video["video_url"],
                video.get("thumbnail_url"),
                video["title"],
                video.get("description", ""),
                video.get("speaker"),
                video.get("published_at"),
                video.get("duration_seconds"),
                video.get("license"),
                video.get("creator"),
                bool(video.get("has_captions", False)),
                json.dumps(video.get("metadata", {}), default=str),
            )
        finally:
            await connection.close()

        return dict(row) if row is not None else dict(video)

    async def ensure_video_access(self, video_id: str, owner_id: str | None) -> None:
        connection = await self._connect()
        try:
            await connection.execute(
                """
                INSERT INTO video_access (video_id, owner_id)
                VALUES ($1::uuid, $2)
                ON CONFLICT (video_id, owner_scope) DO NOTHING
                """,
                video_id,
                owner_id,
            )
        finally:
            await connection.close()

    async def replace_units(
        self,
        *,
        video_id: str,
        units: Sequence[Mapping[str, Any]],
    ) -> list[dict[str, Any]]:
        connection = await self._connect()
        try:
            async with connection.transaction():
                incoming_keys = [
                    (str(unit["unit_type"]), int(unit["unit_index"]))
                    for unit in units
                ]
                if incoming_keys:
                    await connection.execute(
                        """
                        DELETE FROM retrieval_units
                        WHERE video_id = $1::uuid
                          AND NOT EXISTS (
                              SELECT 1
                              FROM UNNEST($2::text[], $3::int[]) AS incoming(unit_type, unit_index)
                              WHERE incoming.unit_type = retrieval_units.unit_type
                                AND incoming.unit_index = retrieval_units.unit_index
                          )
                        """,
                        video_id,
                        [item[0] for item in incoming_keys],
                        [item[1] for item in incoming_keys],
                    )
                else:
                    await connection.execute(
                        "DELETE FROM retrieval_units WHERE video_id = $1::uuid",
                        video_id,
                    )

                stored_rows: list[dict[str, Any]] = []
                for unit in units:
                    row = await connection.fetchrow(
                        """
                        INSERT INTO retrieval_units (
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
                            $2,
                            $3,
                            $4,
                            $5,
                            $6,
                            $7,
                            $8,
                            $9,
                            $10,
                            $11::jsonb,
                            $12::vector
                        )
                        ON CONFLICT (video_id, unit_type, unit_index) DO UPDATE
                        SET
                            timestamp_start = EXCLUDED.timestamp_start,
                            timestamp_end = EXCLUDED.timestamp_end,
                            content_text = EXCLUDED.content_text,
                            transcript = EXCLUDED.transcript,
                            visual_desc = EXCLUDED.visual_desc,
                            visual_type = EXCLUDED.visual_type,
                            keyframe_url = EXCLUDED.keyframe_url,
                            metadata = EXCLUDED.metadata,
                            embedding = EXCLUDED.embedding,
                            updated_at = NOW()
                        RETURNING
                            id::text AS id,
                            video_id::text AS video_id,
                            unit_type,
                            unit_index,
                            keyframe_url
                        """,
                        video_id,
                        unit["unit_type"],
                        unit["unit_index"],
                        unit.get("timestamp_start"),
                        unit.get("timestamp_end"),
                        unit["content_text"],
                        unit.get("transcript"),
                        unit.get("visual_desc"),
                        unit.get("visual_type"),
                        unit.get("keyframe_url"),
                        json.dumps(unit.get("metadata", {}), default=str),
                        _vector_literal(unit["embedding"]),
                    )
                    if row is not None:
                        stored_rows.append(dict(row))
        finally:
            await connection.close()

        return stored_rows

    async def mark_job_completed(
        self,
        job_id: str | None,
        artifacts: Mapping[str, Any],
    ) -> None:
        if job_id is None:
            return
        if not await self.job_exists(job_id):
            return

        connection = await self._connect()
        try:
            async with connection.transaction():
                update_result = await connection.execute(
                    """
                    UPDATE processing_jobs
                    SET
                        status = 'completed',
                        error_message = NULL,
                        completed_at = NOW(),
                        next_retry_at = NULL,
                        locked_by = NULL,
                        locked_at = NULL,
                        updated_at = NOW()
                    WHERE id = $1::uuid
                      AND COALESCE(
                          (input_payload->>'cancelled_by_user')::boolean,
                          FALSE
                      ) = FALSE
                    """,
                    job_id,
                )
                if str(update_result).endswith("0"):
                    return
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
                    "unified.pipeline.completed",
                    json.dumps(dict(artifacts), default=str),
                )
        finally:
            await connection.close()

    async def _connect(self) -> Any:
        asyncpg = _import_asyncpg()
        return await asyncpg.connect(self._database_url)


def resolve_default_unified_repository(db_url: str | None = None) -> UnifiedRepository:
    database_url = (db_url or os.getenv("DATABASE_URL", "")).strip()
    if not database_url:
        return InMemoryUnifiedRepository()
    return AsyncpgUnifiedRepository(database_url)


def _import_asyncpg():
    import asyncpg

    return asyncpg


def _vector_literal(vector: Sequence[float]) -> str:
    return "[" + ",".join(f"{float(value):.8f}" for value in vector) + "]"
