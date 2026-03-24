from __future__ import annotations

import asyncio
import asyncpg
import hashlib
import ipaddress
import json
import re
import socket
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

        resolved = self.resolve_source(payload.url)
        if resolved["source"] == "upload":
            await self._validate_direct_video_url(payload.url)
        await self._enforce_max_duration(
            url=payload.url,
            source=resolved["source"],
            source_video_id=resolved["source_video_id"],
        )
        request_id = self.generate_request_id()
        async with self.db.transaction():
            await self._acquire_submit_lock(
                source=resolved["source"],
                source_video_id=resolved["source_video_id"],
            )
            existing_video = await self._find_video_by_source(
                resolved["source"],
                resolved["source_video_id"],
            )
            created_placeholder = False

            if existing_video is None:
                placeholder_video_id = str(uuid4())
                video_id, created_placeholder = await self._insert_placeholder_video(
                    video_id=placeholder_video_id,
                    url=payload.url,
                    source=resolved["source"],
                    source_video_id=resolved["source_video_id"],
                )
            else:
                video_id = str(existing_video["id"])

            has_access = await self._has_video_access(video_id, auth.user_id)
            if not has_access:
                try:
                    await self._enforce_video_limit(auth.user_id, auth.tier)
                except Exception:
                    if created_placeholder:
                        await self._delete_placeholder_video_if_unowned(video_id)
                    raise
                await self._ensure_video_access(video_id, auth.user_id)

            existing_job = await self._find_active_job(video_id)
            if existing_job is not None:
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

            try:
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
            except asyncpg.UniqueViolationError:
                existing_job = await self._find_active_job(video_id)
                if existing_job is None:
                    raise
                return SubmitIndexResponse(
                    video_id=video_id,
                    status=str(existing_job["status"]),
                    request_id=str(existing_job["request_id"]),
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
                latest_success.created_at AS latest_success_created_at,
                latest_success.completed_at AS latest_success_completed_at,
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
                SELECT created_at, completed_at
                FROM processing_jobs
                WHERE track = 'unified'
                  AND input_payload->>'video_id' = v.id::text
                  AND status = 'completed'
                ORDER BY completed_at DESC NULLS LAST, created_at DESC
                LIMIT 1
            ) AS latest_success ON TRUE
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

        if job_status in {"pending", "running", "retrying"}:
            status_value = "processing"
        elif units_created > 0:
            status_value = "completed"
        elif job_status == "failed":
            status_value = "failed"
        else:
            status_value = "processing"

        completed_with_previous_units = (
            status_value == "completed" and job_status == "failed" and units_created > 0
        )
        created_at = payload.get("job_created_at") or payload.get("job_updated_at")
        completed_at = payload.get("job_completed_at")
        current_step = payload.get("current_step")
        steps_completed = payload.get("steps_completed")
        steps_total = payload.get("steps_total")
        error = payload.get("error_message")

        if completed_with_previous_units:
            created_at = (
                payload.get("latest_success_created_at")
                or payload.get("job_created_at")
                or payload.get("job_updated_at")
            )
            completed_at = (
                payload.get("latest_success_completed_at")
                or payload.get("job_completed_at")
                or payload.get("job_updated_at")
            )
            current_step = None
            steps_completed = None
            steps_total = None
            error = None

        return IndexStatusResponse(
            video_id=str(payload["video_id"]),
            status=status_value,
            title=payload.get("title"),
            current_step=current_step,
            steps_completed=steps_completed,
            steps_total=steps_total,
            duration=payload.get("duration_seconds"),
            units_created=units_created,
            error=error if status_value == "failed" else None,
            created_at=created_at,
            completed_at=completed_at,
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
                pj.completed_at,
                latest_success.completed_at AS latest_success_completed_at
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
            LEFT JOIN LATERAL (
                SELECT completed_at
                FROM processing_jobs
                WHERE track = 'unified'
                  AND input_payload->>'video_id' = v.id::text
                  AND status = 'completed'
                ORDER BY completed_at DESC NULLS LAST, created_at DESC
                LIMIT 1
            ) AS latest_success ON TRUE
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
                status=(
                    "processing"
                    if str(row["job_status"] or "") in {"pending", "running", "retrying"}
                    else (
                        "completed"
                        if int(row["units_created"] or 0) > 0
                        else str(row["job_status"] or "processing")
                    )
                ),
                units_created=int(row["units_created"] or 0),
                created_at=row["created_at"],
                completed_at=(
                    row["latest_success_completed_at"]
                    if (
                        str(row["job_status"] or "") == "failed"
                        and int(row["units_created"] or 0) > 0
                    )
                    else row["completed_at"]
                ),
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
            await self._cancel_video_jobs(normalized_video_id)
            await self.db.execute(
                "DELETE FROM videos WHERE id = $1::uuid",
                normalized_video_id,
            )

        return DeleteIndexResponse(deleted=True)

    def resolve_source(self, url: str) -> dict[str, str]:
        parsed = urlparse(url)
        hostname = str(parsed.hostname or "").strip().lower()
        path = parsed.path.strip()

        youtube_id = self._extract_youtube_video_id(parsed)
        if youtube_id is not None:
            return {"source": "youtube", "source_video_id": youtube_id}

        pexels_match = re.search(r"/video/[^/]*-([0-9]+)/?$", path)
        if self._host_matches_domain(hostname, "pexels.com") and pexels_match is not None:
            return {"source": "pexels", "source_video_id": pexels_match.group(1)}

        pixabay_match = re.search(r"/videos/(?:[^/]*-)?([0-9]+)/?$", path)
        if self._host_matches_domain(hostname, "pixabay.com") and pixabay_match is not None:
            return {"source": "pixabay", "source_video_id": pixabay_match.group(1)}

        if path.lower().endswith(DIRECT_VIDEO_EXTENSIONS):
            self._validate_direct_video_url_structure(parsed)
            return {
                "source": "upload",
                "source_video_id": hashlib.sha256(url.encode("utf-8")).hexdigest()[:24],
            }

        raise HTTPException(status_code=422, detail="Unsupported URL format")

    def _host_matches_domain(self, hostname: str, domain: str) -> bool:
        if not hostname:
            return False
        normalized_host = hostname.rstrip(".")
        normalized_domain = domain.rstrip(".")
        return normalized_host == normalized_domain or normalized_host.endswith(
            f".{normalized_domain}"
        )

    def generate_request_id(self) -> str:
        return f"req_{secrets.token_hex(12)}"

    async def _validate_direct_video_url(self, url: str) -> None:
        parsed = urlparse(url)
        hostname = self._validate_direct_video_url_structure(parsed)
        candidate_ips = await self._resolve_direct_video_host(hostname)
        for ip_text in candidate_ips:
            ip = ipaddress.ip_address(ip_text)
            if not ip.is_global:
                raise HTTPException(
                    status_code=422,
                    detail="Direct video URLs must resolve to public internet addresses.",
                )

    def _validate_direct_video_url_structure(self, parsed: Any) -> str:
        scheme = str(parsed.scheme or "").strip().lower()
        hostname = str(parsed.hostname or "").strip().lower()

        if scheme not in {"http", "https"}:
            raise HTTPException(
                status_code=422,
                detail="Direct video URLs must use http or https.",
            )
        if not hostname:
            raise HTTPException(
                status_code=422,
                detail="Direct video URLs must include a valid host.",
            )
        if parsed.username or parsed.password:
            raise HTTPException(
                status_code=422,
                detail="Direct video URLs must not include embedded credentials.",
            )
        if hostname in {"localhost"} or hostname.endswith(".local"):
            raise HTTPException(
                status_code=422,
                detail="Direct video URLs must be publicly reachable.",
            )
        return hostname

    async def _resolve_direct_video_host(self, hostname: str) -> set[str]:
        candidate_ips: set[str] = set()
        try:
            candidate_ips.add(str(ipaddress.ip_address(hostname)))
        except ValueError:
            if "." not in hostname:
                raise HTTPException(
                    status_code=422,
                    detail="Direct video URLs must use a public host.",
                ) from None
            try:
                infos = await asyncio.to_thread(
                    socket.getaddrinfo,
                    hostname,
                    None,
                    type=socket.SOCK_STREAM,
                )
            except (socket.gaierror, UnicodeError) as exc:
                raise HTTPException(
                    status_code=422,
                    detail="Direct video host could not be resolved.",
                ) from exc
            candidate_ips.update(info[4][0] for info in infos if info and info[4])

        if not candidate_ips:
            raise HTTPException(
                status_code=422,
                detail="Direct video host could not be resolved.",
            )
        return candidate_ips

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
    ) -> tuple[str, bool]:
        title = self._build_placeholder_title(url, source, source_video_id)
        row = await self.db.fetchrow(
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
            RETURNING id::text AS id
            """,
            video_id,
            source,
            source_video_id,
            url,
            url,
            title,
        )
        if row is not None:
            return str(row["id"]), True

        existing_video = await self._find_video_by_source(source, source_video_id)
        if existing_video is None:
            raise RuntimeError(
                "Failed to resolve canonical indexed video after placeholder conflict."
            )
        return str(existing_video["id"]), False

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

    async def _acquire_submit_lock(self, *, source: str, source_video_id: str) -> None:
        await self.db.fetchval(
            """
            SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))
            """,
            source,
            source_video_id,
        )

    async def _has_video_access(self, video_id: str, owner_id: str) -> bool:
        row = await self.db.fetchval(
            """
            SELECT TRUE
            FROM video_access
            WHERE video_id = $1::uuid
              AND owner_id = $2
            LIMIT 1
            """,
            video_id,
            owner_id,
        )
        return bool(row)

    async def _delete_placeholder_video_if_unowned(self, video_id: str) -> None:
        await self.db.execute(
            """
            DELETE FROM videos
            WHERE id = $1::uuid
              AND NOT EXISTS (
                  SELECT 1
                  FROM video_access
                  WHERE video_id = $1::uuid
              )
            """,
            video_id,
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

    async def _cancel_video_jobs(self, video_id: str) -> None:
        await self.db.execute(
            """
            UPDATE processing_jobs
            SET
                status = CASE
                    WHEN status IN ('pending', 'running', 'retrying') THEN 'failed'
                    ELSE status
                END,
                error_message = CASE
                    WHEN status IN ('pending', 'running', 'retrying')
                        THEN 'Cancelled by user.'
                    ELSE error_message
                END,
                completed_at = CASE
                    WHEN status IN ('pending', 'running', 'retrying') THEN NOW()
                    ELSE completed_at
                END,
                next_retry_at = NULL,
                locked_by = NULL,
                locked_at = NULL,
                input_payload = jsonb_set(
                    COALESCE(input_payload, '{}'::jsonb),
                    '{cancelled_by_user}',
                    'true'::jsonb,
                    true
                ),
                updated_at = NOW()
            WHERE input_payload->>'video_id' = $1::text
            """,
            video_id,
        )
        await self.db.execute(
            """
            UPDATE processing_job_steps
            SET
                status = 'skipped',
                error_message = 'Cancelled by user.',
                completed_at = COALESCE(completed_at, NOW()),
                updated_at = NOW()
            WHERE status IN ('pending', 'running')
              AND job_id IN (
                  SELECT id
                  FROM processing_jobs
                  WHERE input_payload->>'video_id' = $1::text
              )
            """,
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
