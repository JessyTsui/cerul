from __future__ import annotations

import json
import os
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Protocol
from uuid import uuid4


class KnowledgeRepository(Protocol):
    async def upsert_knowledge_video(
        self,
        video: Mapping[str, Any],
    ) -> dict[str, Any]:
        ...

    async def replace_knowledge_segments(
        self,
        *,
        video_id: str,
        segments: Sequence[Mapping[str, Any]],
    ) -> list[dict[str, Any]]:
        ...

    async def mark_job_completed(
        self,
        job_id: str | None,
        artifacts: Mapping[str, Any],
    ) -> None:
        ...


@dataclass(slots=True)
class InMemoryKnowledgeRepository:
    # STUB: replace with a database-backed repository in production workers.
    videos_by_key: dict[tuple[str, str], dict[str, Any]] = field(default_factory=dict)
    segments_by_video_id: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    completed_jobs: dict[str, dict[str, Any]] = field(default_factory=dict)

    async def upsert_knowledge_video(
        self,
        video: Mapping[str, Any],
    ) -> dict[str, Any]:
        payload = dict(video)
        key = (str(payload["source"]), str(payload["source_video_id"]))
        existing = self.videos_by_key.get(key)
        if existing is not None:
            payload["id"] = existing["id"]
        else:
            payload.setdefault("id", str(uuid4()))

        self.videos_by_key[key] = payload
        return dict(payload)

    async def replace_knowledge_segments(
        self,
        *,
        video_id: str,
        segments: Sequence[Mapping[str, Any]],
    ) -> list[dict[str, Any]]:
        existing_by_index = {
            int(segment["segment_index"]): dict(segment)
            for segment in self.segments_by_video_id.get(video_id, [])
        }
        stored_segments: list[dict[str, Any]] = []

        for segment in segments:
            payload = dict(segment)
            payload["video_id"] = video_id
            segment_index = int(payload["segment_index"])
            existing_segment = existing_by_index.get(segment_index)
            payload["id"] = (
                existing_segment["id"] if existing_segment is not None else str(uuid4())
            )
            stored_segments.append(payload)

        stored_segments.sort(key=lambda segment: int(segment["segment_index"]))
        self.segments_by_video_id[video_id] = stored_segments
        return [dict(segment) for segment in stored_segments]

    async def mark_job_completed(
        self,
        job_id: str | None,
        artifacts: Mapping[str, Any],
    ) -> None:
        if job_id is None:
            return

        self.completed_jobs[job_id] = dict(artifacts)


class AsyncpgKnowledgeRepository:
    def __init__(self, database_url: str) -> None:
        self._database_url = database_url

    async def upsert_knowledge_video(
        self,
        video: Mapping[str, Any],
    ) -> dict[str, Any]:
        connection = await self._connect()
        try:
            row = await connection.fetchrow(
                """
                INSERT INTO knowledge_videos (
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
                    metadata
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
                    $9::timestamptz,
                    $10,
                    $11,
                    $12::jsonb
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
                    metadata = EXCLUDED.metadata,
                    updated_at = NOW()
                RETURNING
                    id::text AS id,
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
                    metadata
                """,
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
                json.dumps(video.get("metadata", {}), default=str),
            )
        finally:
            await connection.close()

        return dict(row) if row is not None else dict(video)

    async def replace_knowledge_segments(
        self,
        *,
        video_id: str,
        segments: Sequence[Mapping[str, Any]],
    ) -> list[dict[str, Any]]:
        connection = await self._connect()
        try:
            async with connection.transaction():
                incoming_indexes = [int(segment["segment_index"]) for segment in segments]
                if incoming_indexes:
                    await connection.execute(
                        """
                        DELETE FROM knowledge_segments
                        WHERE video_id = $1::uuid
                          AND NOT (segment_index = ANY($2::int[]))
                        """,
                        video_id,
                        incoming_indexes,
                    )
                else:
                    await connection.execute(
                        "DELETE FROM knowledge_segments WHERE video_id = $1::uuid",
                        video_id,
                    )

                stored_rows: list[dict[str, Any]] = []
                for segment in segments:
                    row = await connection.fetchrow(
                        """
                        INSERT INTO knowledge_segments (
                            video_id,
                            segment_index,
                            title,
                            description,
                            transcript_text,
                            visual_summary,
                            timestamp_start,
                            timestamp_end,
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
                            $9::jsonb,
                            $10::vector
                        )
                        ON CONFLICT (video_id, segment_index) DO UPDATE
                        SET
                            title = EXCLUDED.title,
                            description = EXCLUDED.description,
                            transcript_text = EXCLUDED.transcript_text,
                            visual_summary = EXCLUDED.visual_summary,
                            timestamp_start = EXCLUDED.timestamp_start,
                            timestamp_end = EXCLUDED.timestamp_end,
                            metadata = EXCLUDED.metadata,
                            embedding = EXCLUDED.embedding,
                            updated_at = NOW()
                        RETURNING
                            id::text AS id,
                            video_id::text AS video_id,
                            segment_index,
                            title,
                            description,
                            transcript_text,
                            visual_summary,
                            timestamp_start,
                            timestamp_end,
                            metadata,
                            embedding::text AS embedding
                        """,
                        video_id,
                        int(segment["segment_index"]),
                        segment["title"],
                        segment.get("description", ""),
                        segment["transcript_text"],
                        segment.get("visual_summary"),
                        float(segment["timestamp_start"]),
                        float(segment["timestamp_end"]),
                        json.dumps(segment.get("metadata", {}), default=str),
                        _vector_to_literal(segment["embedding"]),
                    )
                    if row is not None:
                        stored_rows.append(dict(row))
        finally:
            await connection.close()

        stored_rows.sort(key=lambda segment: int(segment["segment_index"]))
        return stored_rows

    async def mark_job_completed(
        self,
        job_id: str | None,
        artifacts: Mapping[str, Any],
    ) -> None:
        if job_id is None:
            return

        connection = await self._connect()
        try:
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
                    "knowledge.pipeline.completed",
                    json.dumps(dict(artifacts), default=str),
                )
        finally:
            await connection.close()

    async def _connect(self) -> Any:
        try:
            import asyncpg
        except ImportError as exc:
            raise RuntimeError(
                "AsyncpgKnowledgeRepository requires asyncpg to be installed."
            ) from exc

        return await asyncpg.connect(self._database_url)


def resolve_default_knowledge_repository() -> KnowledgeRepository:
    database_url = os.getenv("DATABASE_URL", "").strip()
    if database_url:
        return AsyncpgKnowledgeRepository(database_url)
    return InMemoryKnowledgeRepository()


def _vector_to_literal(values: Sequence[float]) -> str:
    return "[" + ",".join(f"{float(value):.12g}" for value in values) + "]"
