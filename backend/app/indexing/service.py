from __future__ import annotations

import hashlib
import json
import re
import secrets
from typing import Any
from urllib.parse import parse_qs, urlparse
from uuid import UUID, uuid4

from fastapi import HTTPException, status

from app.auth import AuthContext
from app.indexing.models import (
    DeleteIndexResponse,
    IndexListItem,
    IndexListResponse,
    IndexRequest,
    IndexStatusResponse,
    SubmitIndexResponse,
)

YOUTUBE_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"}
DIRECT_VIDEO_EXTENSIONS = (".mp4", ".webm", ".mov", ".m4v")
INDEX_LIMITS_BY_TIER = {
    "free": 50,
    "builder": 500,
    "pro": 5000,
    "enterprise": 50000,
}
MAX_INDEX_DURATION_SECONDS = 4 * 60 * 60


class UnifiedIndexService:
    def __init__(self, db: Any) -> None:
        self.db = db

    async def submit(
        self,
        payload: IndexRequest,
        *,
        auth: AuthContext,
    ) -> SubmitIndexResponse:
        await self._enforce_submit_rate_limit(auth.user_id)
        await self._enforce_video_limit(auth.user_id, auth.tier)

        resolved = self.resolve_source(payload.url)
        existing_video = await self._find_video_by_source(
            resolved["source"],
            resolved["source_video_id"],
        )
        request_id = self.generate_request_id()

        if existing_video is None:
            video_id = str(uuid4())
            await self._insert_placeholder_video(
                video_id=video_id,
                url=payload.url,
                source=resolved["source"],
                source_video_id=resolved["source_video_id"],
            )
        else:
            video_id = str(existing_video["id"])

        await self._ensure_video_access(video_id, auth.user_id)

        existing_job = await self._find_active_job(video_id)
        if existing_job is not None and not payload.force:
            return SubmitIndexResponse(
                video_id=video_id,
                status=str(existing_job["status"]),
                request_id=str(existing_job["request_id"]),
            )

        completed_units = await self._count_retrieval_units(video_id)
        if completed_units > 0 and not payload.force:
            return SubmitIndexResponse(
                video_id=video_id,
                status="completed",
                request_id=request_id,
            )

        await self._enforce_max_duration(
            url=payload.url,
            source=resolved["source"],
            source_video_id=resolved["source_video_id"],
        )

        await self.db.execute(
            """
            INSERT INTO processing_jobs (
                track,
                source_id,
                job_type,
                status,
                input_payload
            )
            VALUES (
                'unified',
                NULL,
                'index_video',
                'pending',
                $1::jsonb
            )
            """,
            json.dumps(
                {
                    "request_id": request_id,
                    "video_id": video_id,
                    "owner_id": auth.user_id,
                    "url": payload.url,
                    "source": resolved["source"],
                    "source_video_id": resolved["source_video_id"],
                    "force": payload.force,
                }
            ),
        )

        return SubmitIndexResponse(
            video_id=video_id,
            status="processing",
            request_id=request_id,
        )

    async def get_status(
        self,
        video_id: str,
        *,
        auth: AuthContext,
    ) -> IndexStatusResponse:
        normalized_video_id = self._normalize_video_id(video_id)
        row = await self.db.fetchrow(
            """
            SELECT
                v.id::text AS video_id,
                v.title,
                v.duration_seconds,
                COALESCE(ru_counts.units_created, 0) AS units_created,
                pj.status AS job_status,
                pj.error_message,
                pj.created_at AS job_created_at,
                pj.completed_at AS job_completed_at,
                pj.updated_at AS job_updated_at,
                pj.input_payload->>'request_id' AS request_id,
                step_counts.steps_completed,
                step_counts.steps_total,
                active_step.current_step
            FROM videos AS v
            JOIN video_access AS va
                ON va.video_id = v.id
            LEFT JOIN LATERAL (
                SELECT COUNT(*)::int AS units_created
                FROM retrieval_units
                WHERE video_id = v.id
            ) AS ru_counts ON TRUE
            LEFT JOIN LATERAL (
                SELECT *
                FROM processing_jobs
                WHERE track = 'unified'
                  AND input_payload->>'video_id' = v.id::text
                ORDER BY created_at DESC
                LIMIT 1
            ) AS pj ON TRUE
            LEFT JOIN LATERAL (
                SELECT
                    COUNT(*) FILTER (WHERE status = 'completed')::int AS steps_completed,
                    COUNT(*)::int AS steps_total
                FROM processing_job_steps
                WHERE job_id = pj.id
            ) AS step_counts ON TRUE
            LEFT JOIN LATERAL (
                SELECT step_name AS current_step
                FROM processing_job_steps
                WHERE job_id = pj.id
                  AND status IN ('pending', 'running', 'failed')
                ORDER BY updated_at DESC
                LIMIT 1
            ) AS active_step ON TRUE
            WHERE v.id = $1::uuid
              AND va.owner_id = $2
            LIMIT 1
            """,
            normalized_video_id,
            auth.user_id,
        )
        if row is None:
            raise HTTPException(status_code=404, detail="Indexed video not found.")

        payload = dict(row)
        units_created = int(payload.get("units_created") or 0)
        job_status = str(payload.get("job_status") or "").strip()

        if job_status == "failed":
            status_value = "failed"
        elif units_created > 0 and job_status in {"", "completed"}:
            status_value = "completed"
        else:
            status_value = "processing"

        return IndexStatusResponse(
            video_id=str(payload["video_id"]),
            status=status_value,
            title=payload.get("title"),
            current_step=payload.get("current_step"),
            steps_completed=payload.get("steps_completed"),
            steps_total=payload.get("steps_total"),
            duration=payload.get("duration_seconds"),
            units_created=units_created,
            error=payload.get("error_message"),
            created_at=payload.get("job_created_at") or payload.get("job_updated_at"),
            completed_at=payload.get("job_completed_at"),
            failed_at=payload.get("job_updated_at") if status_value == "failed" else None,
        )

    async def list_videos(
        self,
        *,
        auth: AuthContext,
        page: int,
        per_page: int,
    ) -> IndexListResponse:
        offset = max(page - 1, 0) * per_page
        rows = await self.db.fetch(
            """
            SELECT
                v.id::text AS video_id,
                v.title,
                va.created_at,
                COALESCE(ru_counts.units_created, 0) AS units_created,
                pj.status AS job_status,
                pj.completed_at
            FROM videos AS v
            JOIN video_access AS va
                ON va.video_id = v.id
            LEFT JOIN LATERAL (
                SELECT COUNT(*)::int AS units_created
                FROM retrieval_units
                WHERE video_id = v.id
            ) AS ru_counts ON TRUE
            LEFT JOIN LATERAL (
                SELECT status, completed_at
                FROM processing_jobs
                WHERE track = 'unified'
                  AND input_payload->>'video_id' = v.id::text
                ORDER BY created_at DESC
                LIMIT 1
            ) AS pj ON TRUE
            WHERE va.owner_id = $1
            ORDER BY va.created_at DESC
            LIMIT $2 OFFSET $3
            """,
            auth.user_id,
            per_page,
            offset,
        )
        total = await self.db.fetchval(
            """
            SELECT COUNT(*)
            FROM video_access
            WHERE owner_id = $1
            """,
            auth.user_id,
        )
        videos = [
            IndexListItem(
                video_id=str(row["video_id"]),
                title=str(row["title"]),
                status="completed"
                if int(row["units_created"] or 0) > 0 and str(row["job_status"] or "") != "failed"
                else str(row["job_status"] or "processing"),
                units_created=int(row["units_created"] or 0),
                created_at=row["created_at"],
                completed_at=row["completed_at"],
            )
            for row in rows
        ]
        return IndexListResponse(
            videos=videos,
            total=int(total or 0),
            page=page,
            per_page=per_page,
        )

    async def delete(
        self,
        video_id: str,
        *,
        auth: AuthContext,
    ) -> DeleteIndexResponse:
        normalized_video_id = self._normalize_video_id(video_id)
        deleted = await self.db.fetchval(
            """
            DELETE FROM video_access
            WHERE video_id = $1::uuid
              AND owner_id = $2
            RETURNING TRUE
            """,
            normalized_video_id,
            auth.user_id,
        )
        if not deleted:
            raise HTTPException(status_code=404, detail="Indexed video not found.")

        remaining_access = await self.db.fetchval(
            """
            SELECT COUNT(*)
            FROM video_access
            WHERE video_id = $1::uuid
            """,
            normalized_video_id,
        )
        if int(remaining_access or 0) == 0:
            await self.db.execute(
                "DELETE FROM videos WHERE id = $1::uuid",
                normalized_video_id,
            )

        return DeleteIndexResponse(deleted=True)

    def resolve_source(self, url: str) -> dict[str, str]:
        parsed = urlparse(url)
        host = parsed.netloc.lower()
        path = parsed.path.strip()

        youtube_id = self._extract_youtube_video_id(parsed)
        if youtube_id is not None:
            return {"source": "youtube", "source_video_id": youtube_id}

        pexels_match = re.search(r"/video/[^/]*-([0-9]+)/?$", path)
        if "pexels.com" in host and pexels_match is not None:
            return {"source": "pexels", "source_video_id": pexels_match.group(1)}

        pixabay_match = re.search(r"/videos/(?:[^/]*-)?([0-9]+)/?$", path)
        if "pixabay.com" in host and pixabay_match is not None:
            return {"source": "pixabay", "source_video_id": pixabay_match.group(1)}

        if path.lower().endswith(DIRECT_VIDEO_EXTENSIONS):
            return {
                "source": "upload",
                "source_video_id": hashlib.sha256(url.encode("utf-8")).hexdigest()[:24],
            }

        raise HTTPException(status_code=422, detail="Unsupported URL format")

    def generate_request_id(self) -> str:
        return f"req_{secrets.token_hex(12)}"

    def _normalize_video_id(self, video_id: str) -> str:
        try:
            return str(UUID(str(video_id)))
        except (TypeError, ValueError):
            raise HTTPException(status_code=404, detail="Indexed video not found.") from None

    async def _find_video_by_source(
        self,
        source: str,
        source_video_id: str,
    ) -> dict[str, Any] | None:
        row = await self.db.fetchrow(
            """
            SELECT id::text AS id
            FROM videos
            WHERE source = $1
              AND source_video_id = $2
            """,
            source,
            source_video_id,
        )
        return dict(row) if row is not None else None

    async def _insert_placeholder_video(
        self,
        *,
        video_id: str,
        url: str,
        source: str,
        source_video_id: str,
    ) -> None:
        title = self._build_placeholder_title(url, source, source_video_id)
        await self.db.execute(
            """
            INSERT INTO videos (
                id,
                source,
                source_video_id,
                source_url,
                video_url,
                title,
                description,
                metadata
            )
            VALUES ($1::uuid, $2, $3, $4, $5, $6, '', '{}'::jsonb)
            ON CONFLICT (source, source_video_id) DO NOTHING
            """,
            video_id,
            source,
            source_video_id,
            url,
            url,
            title,
        )

    async def _ensure_video_access(self, video_id: str, owner_id: str) -> None:
        await self.db.execute(
            """
            INSERT INTO video_access (video_id, owner_id)
            VALUES ($1::uuid, $2)
            ON CONFLICT (video_id, owner_scope) DO NOTHING
            """,
            video_id,
            owner_id,
        )

    async def _find_active_job(self, video_id: str) -> dict[str, Any] | None:
        row = await self.db.fetchrow(
            """
            SELECT
                id::text AS id,
                status,
                input_payload->>'request_id' AS request_id
            FROM processing_jobs
            WHERE track = 'unified'
              AND input_payload->>'video_id' = $1
              AND status IN ('pending', 'running', 'retrying')
            ORDER BY created_at DESC
            LIMIT 1
            """,
            video_id,
        )
        return dict(row) if row is not None else None

    async def _count_retrieval_units(self, video_id: str) -> int:
        count = await self.db.fetchval(
            """
            SELECT COUNT(*)
            FROM retrieval_units
            WHERE video_id = $1::uuid
            """,
            video_id,
        )
        return int(count or 0)

    async def _delete_video_units(self, video_id: str) -> None:
        await self.db.execute(
            "DELETE FROM retrieval_units WHERE video_id = $1::uuid",
            video_id,
        )

    async def _enforce_max_duration(
        self,
        *,
        url: str,
        source: str,
        source_video_id: str,
    ) -> None:
        duration_seconds = await self._fetch_source_duration_seconds(
            url=url,
            source=source,
            source_video_id=source_video_id,
        )
        if duration_seconds is not None and duration_seconds > MAX_INDEX_DURATION_SECONDS:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Videos longer than 4 hours are not supported.",
            )

    async def _fetch_source_duration_seconds(
        self,
        *,
        url: str,
        source: str,
        source_video_id: str,
    ) -> int | None:
        try:
            if source == "youtube":
                from workers.common.sources import YouTubeClient

                metadata = await YouTubeClient().get_video_metadata(source_video_id)
                return self._coerce_duration_seconds(
                    metadata.get("duration_seconds") or metadata.get("duration")
                )
            if source == "pexels":
                from workers.common.sources import PexelsClient

                payload = await PexelsClient().get_video(source_video_id)
                return self._coerce_duration_seconds(payload.get("duration"))
            if source == "pixabay":
                from workers.common.sources import PixabayClient

                payload = await PixabayClient().get_video(source_video_id)
                return self._coerce_duration_seconds(payload.get("duration"))
        except Exception:
            return None

        if source == "upload" and url.lower().endswith(DIRECT_VIDEO_EXTENSIONS):
            return None

        return None

    async def _enforce_submit_rate_limit(self, user_id: str) -> None:
        recent_count = await self.db.fetchval(
            """
            SELECT COUNT(*)
            FROM processing_jobs
            WHERE track = 'unified'
              AND input_payload->>'owner_id' = $1
              AND created_at > NOW() - INTERVAL '1 minute'
            """,
            user_id,
        )
        if int(recent_count or 0) >= 10:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Index rate limit exceeded.",
            )

    async def _enforce_video_limit(self, user_id: str, tier: str) -> None:
        limit = INDEX_LIMITS_BY_TIER.get(tier, INDEX_LIMITS_BY_TIER["free"])
        count = await self.db.fetchval(
            """
            SELECT COUNT(*)
            FROM video_access
            WHERE owner_id = $1
            """,
            user_id,
        )
        if int(count or 0) >= limit:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Indexed video limit reached for this account.",
            )

    def _coerce_duration_seconds(self, value: Any) -> int | None:
        if value is None:
            return None
        if isinstance(value, bool):
            return None
        try:
            return int(value)
        except (TypeError, ValueError):
            return None

    def _extract_youtube_video_id(self, parsed_url) -> str | None:
        host = parsed_url.netloc.lower()
        path = parsed_url.path.strip("/")
        if host == "youtu.be" and path:
            return path.split("/", maxsplit=1)[0]
        if host not in YOUTUBE_HOSTS:
            return None

        query_values = parse_qs(parsed_url.query)
        if "v" in query_values and query_values["v"]:
            return query_values["v"][0]
        if path.startswith("shorts/"):
            return path.split("/", maxsplit=1)[1]
        return None

    def _build_placeholder_title(
        self,
        url: str,
        source: str,
        source_video_id: str,
    ) -> str:
        parsed = urlparse(url)
        slug = parsed.path.rstrip("/").split("/")[-1]
        if slug:
            return slug.replace("-", " ").replace("_", " ").strip() or f"{source} {source_video_id}"
        return f"{source} {source_video_id}"
