from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
import json
from typing import Any

import asyncpg

import os
import re as _re

import httpx

from .models import (
    AdminActiveUser,
    AdminContentSummaryResponse,
    AdminDeleteVideoResponse,
    AdminFailedJob,
    AdminFailedStep,
    AdminIngestionMetrics,
    AdminIndexedVideo,
    AdminIndexedVideosResponse,
    AdminIngestionSummaryResponse,
    AdminInventoryMetrics,
    AdminJobStatusCounts,
    AdminLatencyMetrics,
    AdminMetricTarget,
    AdminMetricTargetUpsert,
    AdminMetricValue,
    AdminVideoJobStatus,
    CreateSourceFromUrlResponse,
    SubmitVideoResponse,
    SyncSourceResponse,
    TriggerSearchResponse,
    AdminNamedCount,
    AdminNotice,
    AdminOverviewMetrics,
    AdminRecentUser,
    AdminRequestsMetrics,
    AdminRequestsSummaryResponse,
    AdminSource,
    AdminSourceAnalytics,
    AdminSourceFreshness,
    AdminSourceGrowth,
    AdminSourceHealth,
    AdminSourceRecentVideo,
    AdminSourceRecentVideosEntry,
    AdminSourcesAnalyticsResponse,
    AdminSourcesRecentVideosResponse,
    AdminSourcesResponse,
    AdminSummaryPoint,
    AdminSummaryResponse,
    AdminTargetsResponse,
    AdminUsersMetrics,
    AdminUsersSummaryResponse,
    AdminWindow,
    AdminWorkerCompletedJob,
    AdminWorkerJob,
    AdminWorkerLiveResponse,
    AdminWorkerQueueCounts,
    AdminWorkerStep,
    CreateSourceRequest,
    UpdateSourceRequest,
)

ALLOWED_TARGET_METRICS = {
    "new_users",
    "active_users",
    "requests_total",
    "credits_used",
    "broll_assets_added",
    "knowledge_videos_added",
    "knowledge_segments_added",
    "jobs_completed",
    "jobs_failed",
}

TARGET_SCOPE_RULES: dict[str, set[str]] = {
    "new_users": {"global"},
    "active_users": {"global", "track"},
    "requests_total": {"global", "track"},
    "credits_used": {"global", "track"},
    "broll_assets_added": {"global", "track", "source"},
    "knowledge_videos_added": {"global", "track", "source"},
    "knowledge_segments_added": {"global", "track", "source"},
    "jobs_completed": {"global", "track", "source"},
    "jobs_failed": {"global", "track", "source"},
}

TRACK_SCOPE_KEYS: dict[str, set[str]] = {
    "active_users": {"broll", "knowledge"},
    "requests_total": {"broll", "knowledge"},
    "credits_used": {"broll", "knowledge"},
    "broll_assets_added": {"broll"},
    "knowledge_videos_added": {"knowledge"},
    "knowledge_segments_added": {"knowledge"},
    "jobs_completed": {"broll", "knowledge"},
    "jobs_failed": {"broll", "knowledge"},
}


@dataclass(frozen=True, slots=True)
class TimeWindow:
    range_key: str
    current_start: datetime
    current_end: datetime
    previous_start: datetime
    previous_end: datetime

    @property
    def start_date(self) -> date:
        return self.current_start.date()

    @property
    def end_date(self) -> date:
        return self.current_end.date()


def _utc_now() -> datetime:
    return datetime.now(UTC)


def _coerce_json_value(value: Any) -> Any:
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return value
    return value


def _extract_step_logs(artifacts: Any) -> list[dict[str, Any]]:
    payload = _coerce_json_value(artifacts)
    if not isinstance(payload, dict):
        return []
    raw_logs = payload.get("logs")
    if not isinstance(raw_logs, list):
        return []

    normalized: list[dict[str, Any]] = []
    for item in raw_logs:
        if not isinstance(item, dict):
            continue
        message = str(item.get("message") or "").strip()
        if not message:
            continue
        normalized.append(
            {
                "at": item.get("at"),
                "level": str(item.get("level") or "info"),
                "message": message,
                "details": item.get("details") if isinstance(item.get("details"), dict) else None,
            }
        )
    return normalized


def _extract_step_guidance(artifacts: Any) -> str | None:
    payload = _coerce_json_value(artifacts)
    if not isinstance(payload, dict):
        return None
    guidance = payload.get("guidance")
    if guidance is None:
        return None
    cleaned = str(guidance).strip()
    return cleaned or None


def _step_duration_ms(
    *,
    started_at: datetime | None,
    completed_at: datetime | None,
    updated_at: datetime | None,
    reference_now: datetime,
) -> int | None:
    if started_at is None:
        return None
    end = completed_at or updated_at or reference_now
    duration = end - started_at
    return max(int(duration.total_seconds() * 1000), 0)


def _job_duration_ms(
    *,
    started_at: datetime | None,
    created_at: datetime | None,
    completed_at: datetime | None,
    updated_at: datetime | None,
    reference_now: datetime,
) -> int | None:
    start = started_at or created_at
    if start is None:
        return None
    end = completed_at or updated_at or reference_now
    duration = end - start
    return max(int(duration.total_seconds() * 1000), 0)


def _not_cancelled_job_condition(alias: str | None = None) -> str:
    prefix = f"{alias}." if alias else ""
    return f"COALESCE(({prefix}input_payload->>'cancelled_by_user')::boolean, FALSE) = FALSE"


def _normalize_source_slug(value: str) -> str:
    slug = str(value).strip().lower()
    if not slug:
        raise ValueError("Content source slug is required.")
    return slug


def _normalize_source_track(value: str) -> str:
    track = str(value).strip().lower()
    if track not in {"broll", "knowledge", "shared", "unified"}:
        raise ValueError(
            "Content source track must be one of: broll, knowledge, shared, unified."
        )
    return track


def _normalize_source_display_name(value: str) -> str:
    display_name = str(value).strip()
    if not display_name:
        raise ValueError("Content source display_name is required.")
    return display_name


def _normalize_source_base_url(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def _normalize_source_type(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip().lower()
    return normalized or None


def _normalize_source_sync_cursor(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def _normalize_source_mapping(value: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    return dict(value)


def _infer_source_type(
    *,
    track: str,
    slug: str,
    base_url: str | None,
    config: dict[str, Any],
    metadata: dict[str, Any],
    source_type: str | None,
) -> str | None:
    explicit_source_type = _normalize_source_type(source_type)
    if explicit_source_type is not None:
        return explicit_source_type

    for candidate_key in ("source_type", "provider", "source", "source_name"):
        candidate = _normalize_source_type(config.get(candidate_key)) or _normalize_source_type(
            metadata.get(candidate_key)
        )
        if candidate is not None:
            return candidate

    if track == "knowledge":
        return "youtube"

    normalized_slug = slug.lower()
    normalized_base_url = (base_url or "").lower()
    for candidate in ("youtube", "pexels", "pixabay"):
        if candidate in normalized_slug or candidate in normalized_base_url:
            return candidate

    return None


def _serialize_admin_source(row: Any) -> AdminSource:
    raw_config = _coerce_json_value(row.get("config"))
    raw_metadata = _coerce_json_value(row.get("metadata"))
    config = raw_config if isinstance(raw_config, dict) else {}
    metadata = raw_metadata if isinstance(raw_metadata, dict) else {}

    return AdminSource(
        id=str(row["id"]),
        slug=str(row["slug"]),
        track=str(row["track"]),
        source_type=_normalize_source_type(row.get("source_type")),
        display_name=str(row["display_name"]),
        base_url=str(row["base_url"]) if row.get("base_url") else None,
        is_active=bool(row["is_active"]),
        config=config,
        sync_cursor=_normalize_source_sync_cursor(row.get("sync_cursor")),
        metadata=metadata,
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


async def fetch_sources(db: Any) -> AdminSourcesResponse:
    rows = await db.fetch(
        """
        SELECT
            id::text AS id,
            slug,
            track,
            source_type,
            display_name,
            base_url,
            is_active,
            config,
            sync_cursor,
            metadata,
            created_at,
            updated_at
        FROM content_sources
        ORDER BY display_name ASC, slug ASC
        """
    )

    return AdminSourcesResponse(
        generated_at=_utc_now(),
        sources=[_serialize_admin_source(row) for row in rows],
    )


async def create_source(
    db: Any,
    *,
    payload: CreateSourceRequest,
) -> AdminSource:
    slug = _normalize_source_slug(payload.slug)
    track = _normalize_source_track(payload.track)
    base_url = _normalize_source_base_url(payload.base_url)
    config = _normalize_source_mapping(payload.config)
    metadata = _normalize_source_mapping(payload.metadata)
    if not config and metadata:
        config = dict(metadata)
    source_type = _infer_source_type(
        track=track,
        slug=slug,
        base_url=base_url,
        config=config,
        metadata=metadata,
        source_type=payload.source_type,
    )

    try:
        row = await db.fetchrow(
            """
            INSERT INTO content_sources (
                slug,
                track,
                source_type,
                display_name,
                base_url,
                is_active,
                config,
                sync_cursor,
                metadata
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb)
            RETURNING
                id::text AS id,
                slug,
                track,
                source_type,
                display_name,
                base_url,
                is_active,
                config,
                sync_cursor,
                metadata,
                created_at,
                updated_at
            """,
            slug,
            track,
            source_type,
            _normalize_source_display_name(payload.display_name),
            base_url,
            payload.is_active,
            json.dumps(config),
            _normalize_source_sync_cursor(payload.sync_cursor),
            json.dumps(metadata),
        )
    except asyncpg.UniqueViolationError as exc:
        raise ValueError("Content source slug already exists.") from exc

    if row is None:
        raise ValueError("Unable to create content source.")

    return _serialize_admin_source(row)


async def update_source(
    db: Any,
    *,
    source_id: str,
    payload: UpdateSourceRequest,
) -> AdminSource | None:
    if not payload.model_fields_set:
        raise ValueError("At least one field must be provided.")

    assignments: list[str] = []
    params: list[Any] = []
    normalized_metadata: dict[str, Any] | None = None
    normalized_config: dict[str, Any] | None = None

    if "slug" in payload.model_fields_set:
        params.append(_normalize_source_slug(payload.slug or ""))
        assignments.append(f"slug = ${len(params)}")

    if "track" in payload.model_fields_set:
        params.append(_normalize_source_track(payload.track or ""))
        assignments.append(f"track = ${len(params)}")

    if "source_type" in payload.model_fields_set:
        params.append(_normalize_source_type(payload.source_type))
        assignments.append(f"source_type = ${len(params)}")

    if "display_name" in payload.model_fields_set:
        params.append(_normalize_source_display_name(payload.display_name or ""))
        assignments.append(f"display_name = ${len(params)}")

    if "base_url" in payload.model_fields_set:
        params.append(_normalize_source_base_url(payload.base_url))
        assignments.append(f"base_url = ${len(params)}")

    if "is_active" in payload.model_fields_set:
        params.append(payload.is_active)
        assignments.append(f"is_active = ${len(params)}")

    if "config" in payload.model_fields_set:
        normalized_config = _normalize_source_mapping(payload.config)
    if "metadata" in payload.model_fields_set:
        normalized_metadata = _normalize_source_mapping(payload.metadata)

    if normalized_config is not None:
        params.append(json.dumps(normalized_config))
        assignments.append(f"config = ${len(params)}::jsonb")

    if "sync_cursor" in payload.model_fields_set:
        params.append(_normalize_source_sync_cursor(payload.sync_cursor))
        assignments.append(f"sync_cursor = ${len(params)}")

    if "metadata" in payload.model_fields_set:
        params.append(json.dumps(normalized_metadata or {}))
        assignments.append(f"metadata = ${len(params)}::jsonb")

    if not assignments:
        raise ValueError("At least one field must be provided.")

    params.append(source_id)

    try:
        row = await db.fetchrow(
            f"""
            UPDATE content_sources
            SET {", ".join(assignments)},
                updated_at = NOW()
            WHERE id = ${len(params)}::uuid
            RETURNING
                id::text AS id,
                slug,
                track,
                source_type,
                display_name,
                base_url,
                is_active,
                config,
                sync_cursor,
                metadata,
                created_at,
                updated_at
            """,
            *params,
        )
    except asyncpg.UniqueViolationError as exc:
        raise ValueError("Content source slug already exists.") from exc

    if row is None:
        return None

    return _serialize_admin_source(row)


async def delete_source(
    db: Any,
    *,
    source_id: str,
) -> bool:
    row = await db.fetchrow(
        """
        DELETE FROM content_sources
        WHERE id = $1::uuid
        RETURNING id
        """,
        source_id,
    )
    return row is not None


async def retry_job(db: Any, job_id: str) -> dict[str, Any] | None:
    row = await db.fetchrow(
        f"""
        UPDATE processing_jobs
        SET status = 'pending',
            attempts = 0,
            error_message = NULL,
            locked_by = NULL,
            locked_at = NULL,
            next_retry_at = NULL,
            updated_at = NOW()
        WHERE id = $1::uuid
          AND status = 'failed'
          AND {_not_cancelled_job_condition()}
        RETURNING id
        """,
        job_id,
    )
    return dict(row) if row else None


async def kill_job(db: Any, job_id: str) -> dict[str, Any] | None:
    row = await db.fetchrow(
        f"""
        DELETE FROM processing_jobs
        WHERE id = $1::uuid
          AND status = 'failed'
          AND {_not_cancelled_job_condition()}
        RETURNING id
        """,
        job_id,
    )
    return dict(row) if row else None


async def fetch_indexed_videos(
    db: Any,
    *,
    query: str | None = None,
    limit: int = 10,
    offset: int = 0,
) -> AdminIndexedVideosResponse:
    normalized_query = (query or "").strip()
    safe_limit = max(1, min(int(limit), 100))
    safe_offset = max(int(offset), 0)

    conditions: list[str] = []
    params: list[Any] = []
    if normalized_query:
        params.append(f"%{normalized_query}%")
        search_param = f"${len(params)}"
        conditions.append(
            "("
            f"v.title ILIKE {search_param} "
            f"OR COALESCE(v.source_url, '') ILIKE {search_param} "
            f"OR COALESCE(v.video_url, '') ILIKE {search_param} "
            f"OR v.source_video_id ILIKE {search_param}"
            ")"
        )

    where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""

    total = _as_int(
        await db.fetchval(
            f"""
            SELECT COUNT(*)
            FROM videos AS v
            {where_clause}
            """,
            *params,
        )
    )

    params.extend([safe_limit, safe_offset])
    rows = await db.fetch(
        f"""
        SELECT
            v.id::text AS video_id,
            v.source,
            v.source_video_id,
            v.title,
            v.source_url,
            v.video_url,
            v.speaker,
            v.created_at,
            v.updated_at,
            COALESCE(ru_counts.units_created, 0) AS units_created,
            last_job.status AS last_job_status,
            COALESCE(last_job.updated_at, last_job.completed_at, last_job.created_at) AS last_job_at
        FROM videos AS v
        LEFT JOIN LATERAL (
            SELECT COUNT(*)::int AS units_created
            FROM retrieval_units
            WHERE video_id = v.id
        ) AS ru_counts ON TRUE
        LEFT JOIN LATERAL (
            SELECT status, updated_at, completed_at, created_at
            FROM processing_jobs
            WHERE input_payload->>'video_id' = v.id::text
            ORDER BY created_at DESC
            LIMIT 1
        ) AS last_job ON TRUE
        {where_clause}
        ORDER BY
            COALESCE(last_job.updated_at, last_job.completed_at, v.updated_at, v.created_at) DESC,
            v.created_at DESC
        LIMIT ${len(params) - 1}
        OFFSET ${len(params)}
        """,
        *params,
    )

    return AdminIndexedVideosResponse(
        generated_at=_utc_now(),
        videos=[
            AdminIndexedVideo(
                video_id=str(row["video_id"]),
                source=str(row["source"]),
                source_video_id=str(row["source_video_id"]),
                title=str(row["title"]),
                source_url=str(row["source_url"]) if row.get("source_url") else None,
                video_url=str(row["video_url"]) if row.get("video_url") else None,
                speaker=str(row["speaker"]) if row.get("speaker") else None,
                created_at=row["created_at"],
                updated_at=row["updated_at"],
                units_created=_as_int(row.get("units_created")),
                last_job_status=str(row["last_job_status"]) if row.get("last_job_status") else None,
                last_job_at=row.get("last_job_at"),
            )
            for row in rows
        ],
        total=total,
        limit=safe_limit,
        offset=safe_offset,
        query=normalized_query or None,
    )


async def delete_indexed_video_data(
    db: Any,
    *,
    video_id: str,
) -> AdminDeleteVideoResponse | None:
    async with db.transaction():
        video_row = await db.fetchrow(
            """
            SELECT id::text AS video_id, title
            FROM videos
            WHERE id = $1::uuid
            """,
            video_id,
        )
        if video_row is None:
            return None

        units_deleted = _as_int(
            await db.fetchval(
                """
                SELECT COUNT(*)
                FROM retrieval_units
                WHERE video_id = $1::uuid
                """,
                video_id,
            )
        )
        processing_jobs_deleted = _as_int(
            await db.fetchval(
                """
                SELECT COUNT(*)
                FROM processing_jobs
                WHERE input_payload->>'video_id' = $1::text
                """,
                video_id,
            )
        )

        await db.execute(
            """
            DELETE FROM processing_jobs
            WHERE input_payload->>'video_id' = $1::text
            """,
            video_id,
        )
        await db.execute(
            """
            DELETE FROM videos
            WHERE id = $1::uuid
            """,
            video_id,
        )

    return AdminDeleteVideoResponse(
        ok=True,
        video_id=str(video_row["video_id"]),
        title=str(video_row["title"]),
        units_deleted=units_deleted,
        processing_jobs_deleted=processing_jobs_deleted,
    )


async def _fetch_worker_steps(
    db: Any,
    *,
    job_ids: list[str],
    reference_now: datetime,
) -> dict[str, list[AdminWorkerStep]]:
    if not job_ids:
        return {}

    step_rows = await db.fetch(
        """
        SELECT
            job_id,
            step_name,
            status,
            artifacts,
            started_at,
            completed_at,
            updated_at,
            error_message
        FROM processing_job_steps
        WHERE job_id = ANY($1::uuid[])
        ORDER BY created_at
        """,
        job_ids,
    )

    steps_by_job: dict[str, list[AdminWorkerStep]] = {}
    for step in step_rows:
        jid = str(step["job_id"])
        artifacts = _coerce_json_value(step.get("artifacts")) or {}
        steps_by_job.setdefault(jid, []).append(
            AdminWorkerStep(
                step_name=str(step["step_name"]),
                status=str(step["status"]),
                artifacts=artifacts,
                started_at=step.get("started_at"),
                completed_at=step.get("completed_at"),
                updated_at=step.get("updated_at"),
                duration_ms=_step_duration_ms(
                    started_at=step.get("started_at"),
                    completed_at=step.get("completed_at"),
                    updated_at=step.get("updated_at"),
                    reference_now=reference_now,
                ),
                guidance=_extract_step_guidance(artifacts),
                logs=_extract_step_logs(artifacts),
                error_message=str(step["error_message"]) if step.get("error_message") else None,
            )
        )
    return steps_by_job


def resolve_time_window(range_key: str) -> TimeWindow:
    now = _utc_now()
    today_start = datetime.combine(now.date(), time.min, tzinfo=UTC)

    if range_key == "today":
        current_start = today_start
    elif range_key == "30d":
        current_start = today_start - timedelta(days=29)
    else:
        range_key = "7d"
        current_start = today_start - timedelta(days=6)

    current_end = now
    duration = current_end - current_start
    previous_end = current_start
    previous_start = previous_end - duration
    return TimeWindow(
        range_key=range_key,
        current_start=current_start,
        current_end=current_end,
        previous_start=previous_start,
        previous_end=previous_end,
    )


def serialize_window(window: TimeWindow) -> AdminWindow:
    return AdminWindow(
        range_key=window.range_key,
        current_start=window.current_start,
        current_end=window.current_end,
        previous_start=window.previous_start,
        previous_end=window.previous_end,
    )


def _as_float(value: object | None) -> float:
    if value is None:
        return 0.0
    return float(value)


def _as_int(value: object | None) -> int:
    if value is None:
        return 0
    return int(value)


def _normalize_target_scope(scope_type: str | None, scope_key: str | None) -> tuple[str, str]:
    normalized_scope_type = str(scope_type or "global").strip().lower() or "global"
    normalized_scope_key = str(scope_key or "").strip().lower()
    if normalized_scope_type == "global":
        return "global", ""
    return normalized_scope_type, normalized_scope_key


def _validate_target_scope(metric_name: str, scope_type: str, scope_key: str) -> None:
    allowed_scopes = TARGET_SCOPE_RULES.get(metric_name, {"global"})
    if scope_type not in allowed_scopes:
        raise ValueError(
            f"Metric '{metric_name}' does not support '{scope_type}' scope."
        )

    if scope_type == "global":
        if scope_key:
            raise ValueError("Global admin targets cannot include a scope key.")
        return

    if not scope_key:
        raise ValueError(f"Metric '{metric_name}' requires a scope key for '{scope_type}' scope.")

    if scope_type == "track":
        allowed_track_keys = TRACK_SCOPE_KEYS.get(metric_name, set())
        if scope_key not in allowed_track_keys:
            expected = ", ".join(sorted(allowed_track_keys))
            raise ValueError(
                f"Metric '{metric_name}' expects one of [{expected}] for track scope."
            )


def _delta_ratio(current: float, previous: float) -> float | None:
    if previous == 0:
        return None
    return (current - previous) / previous


def _build_metric(
    *,
    current: float | int,
    previous: float | int,
    target: float | None = None,
    comparison_mode: str | None = None,
) -> AdminMetricValue:
    current_value = float(current)
    previous_value = float(previous)
    target_gap: float | None = None
    attainment_ratio: float | None = None

    if target is not None:
        if comparison_mode == "at_most":
            target_gap = target - current_value
            if current_value <= 0:
                attainment_ratio = 1.0
            else:
                attainment_ratio = target / current_value
        else:
            target_gap = current_value - target
            if target > 0:
                attainment_ratio = current_value / target

    return AdminMetricValue(
        current=current_value,
        previous=previous_value,
        delta=current_value - previous_value,
        delta_ratio=_delta_ratio(current_value, previous_value),
        target=target,
        target_gap=target_gap,
        attainment_ratio=attainment_ratio,
        comparison_mode=comparison_mode if comparison_mode in {"at_least", "at_most"} else None,
    )


def _lookup_target(
    targets: dict[tuple[str, str, str], dict[str, Any]],
    metric_name: str,
    *,
    scope_type: str = "global",
    scope_key: str = "",
) -> tuple[float | None, str | None]:
    payload = targets.get((metric_name, scope_type, scope_key))
    if payload is None:
        return None, None
    return _as_float(payload.get("target_value")), str(payload.get("comparison_mode") or "at_least")


async def _fetch_target_rows(db: Any, range_key: str) -> list[dict[str, Any]]:
    rows = await db.fetch(
        """
        SELECT
            id::text AS id,
            metric_name,
            scope_type,
            scope_key,
            range_key,
            comparison_mode,
            target_value,
            note,
            updated_at
        FROM admin_metric_targets
        WHERE range_key = $1
        ORDER BY metric_name ASC, scope_type ASC, scope_key ASC
        """,
        range_key,
    )
    return [dict(row) for row in rows]


async def _fetch_target_map(db: Any, range_key: str) -> dict[tuple[str, str, str], dict[str, Any]]:
    rows = await _fetch_target_rows(db, range_key)
    return {
        (
            str(row["metric_name"]),
            str(row.get("scope_type") or "global"),
            str(row.get("scope_key") or ""),
        ): row
        for row in rows
    }


async def upsert_targets(
    db: Any,
    *,
    targets: list[AdminMetricTargetUpsert],
) -> list[dict[str, Any]]:
    saved_rows: list[dict[str, Any]] = []

    async with db.transaction():
        for target in targets:
            metric_name = target.metric_name.strip()
            if metric_name not in ALLOWED_TARGET_METRICS:
                raise ValueError(f"Unsupported target metric: {metric_name}")
            scope_type, scope_key = _normalize_target_scope(
                target.scope_type,
                target.scope_key,
            )
            _validate_target_scope(metric_name, scope_type, scope_key)

            row = await db.fetchrow(
                """
                INSERT INTO admin_metric_targets (
                    metric_name,
                    scope_type,
                    scope_key,
                    range_key,
                    comparison_mode,
                    target_value,
                    note
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (metric_name, scope_type, scope_key, range_key)
                DO UPDATE SET
                    comparison_mode = EXCLUDED.comparison_mode,
                    target_value = EXCLUDED.target_value,
                    note = EXCLUDED.note,
                    updated_at = NOW()
                RETURNING
                    id::text AS id,
                    metric_name,
                    scope_type,
                    scope_key,
                    range_key,
                    comparison_mode,
                    target_value,
                    note,
                    updated_at
                """,
                metric_name,
                scope_type,
                scope_key,
                target.range_key,
                target.comparison_mode,
                target.target_value,
                target.note,
            )
            if row is not None:
                saved_rows.append(dict(row))

    return saved_rows


async def delete_target(
    db: Any,
    *,
    target_id: str,
) -> bool:
    row = await db.fetchrow(
        """
        DELETE FROM admin_metric_targets
        WHERE id = $1::uuid
        RETURNING id
        """,
        target_id,
    )
    return row is not None


async def _fetch_target_actual(
    db: Any,
    *,
    window: TimeWindow,
    metric_name: str,
    scope_type: str,
    scope_key: str,
) -> float | None:
    normalized_scope_type, normalized_scope_key = _normalize_target_scope(
        scope_type,
        scope_key,
    )

    try:
        _validate_target_scope(metric_name, normalized_scope_type, normalized_scope_key)
    except ValueError:
        return None

    if metric_name == "new_users":
        if normalized_scope_type != "global":
            return None
        return _as_float(
            await db.fetchval(
                """
                SELECT COUNT(*)
                FROM user_profiles
                WHERE created_at >= $1
                  AND created_at < $2
                """,
                window.current_start,
                window.current_end,
            )
        )

    if metric_name == "active_users":
        if normalized_scope_type == "global":
            return _as_float(
                await db.fetchval(
                    """
                    SELECT COUNT(DISTINCT user_id)
                    FROM usage_events
                    WHERE occurred_at >= $1
                      AND occurred_at < $2
                    """,
                    window.current_start,
                    window.current_end,
                )
            )
        if normalized_scope_type == "track":
            return _as_float(
                await db.fetchval(
                    """
                    SELECT COUNT(DISTINCT user_id)
                    FROM usage_events
                    WHERE occurred_at >= $1
                      AND occurred_at < $2
                      AND search_type = $3
                    """,
                    window.current_start,
                    window.current_end,
                    normalized_scope_key,
                )
            )
        return None

    if metric_name == "requests_total":
        if normalized_scope_type == "global":
            return _as_float(
                await db.fetchval(
                    """
                    SELECT COUNT(*)
                    FROM usage_events
                    WHERE occurred_at >= $1
                      AND occurred_at < $2
                    """,
                    window.current_start,
                    window.current_end,
                )
            )
        if normalized_scope_type == "track":
            return _as_float(
                await db.fetchval(
                    """
                    SELECT COUNT(*)
                    FROM usage_events
                    WHERE occurred_at >= $1
                      AND occurred_at < $2
                      AND search_type = $3
                    """,
                    window.current_start,
                    window.current_end,
                    normalized_scope_key,
                )
            )
        return None

    if metric_name == "credits_used":
        if normalized_scope_type == "global":
            return _as_float(
                await db.fetchval(
                    """
                    SELECT COALESCE(SUM(credits_used), 0)
                    FROM usage_events
                    WHERE occurred_at >= $1
                      AND occurred_at < $2
                    """,
                    window.current_start,
                    window.current_end,
                )
            )
        if normalized_scope_type == "track":
            return _as_float(
                await db.fetchval(
                    """
                    SELECT COALESCE(SUM(credits_used), 0)
                    FROM usage_events
                    WHERE occurred_at >= $1
                      AND occurred_at < $2
                      AND search_type = $3
                    """,
                    window.current_start,
                    window.current_end,
                    normalized_scope_key,
                )
            )
        return None

    if metric_name == "broll_assets_added":
        if normalized_scope_type in {"global", "track"}:
            return _as_float(
                await db.fetchval(
                    """
                    SELECT COUNT(*)
                    FROM videos
                    WHERE created_at >= $1
                      AND created_at < $2
                      AND source <> 'youtube'
                    """,
                    window.current_start,
                    window.current_end,
                )
            )
        if normalized_scope_type == "source":
            return _as_float(
                await db.fetchval(
                    """
                    SELECT COUNT(*)
                    FROM videos
                    WHERE created_at >= $1
                      AND created_at < $2
                      AND LOWER(source) = $3
                    """,
                    window.current_start,
                    window.current_end,
                    normalized_scope_key,
                )
            )
        return None

    if metric_name == "knowledge_videos_added":
        if normalized_scope_type in {"global", "track"}:
            return _as_float(
                await db.fetchval(
                    """
                    SELECT COUNT(*)
                    FROM videos
                    WHERE created_at >= $1
                      AND created_at < $2
                      AND source = 'youtube'
                    """,
                    window.current_start,
                    window.current_end,
                )
            )
        if normalized_scope_type == "source":
            return _as_float(
                await db.fetchval(
                    """
                    SELECT COUNT(*)
                    FROM videos
                    WHERE created_at >= $1
                      AND created_at < $2
                      AND LOWER(source) = $3
                    """,
                    window.current_start,
                    window.current_end,
                    normalized_scope_key,
                )
            )
        return None

    if metric_name == "knowledge_segments_added":
        if normalized_scope_type in {"global", "track"}:
            return _as_float(
                await db.fetchval(
                    """
                    SELECT COUNT(*)
                    FROM retrieval_units
                    WHERE created_at >= $1
                      AND created_at < $2
                      AND unit_type = 'speech'
                    """,
                    window.current_start,
                    window.current_end,
                )
            )
        if normalized_scope_type == "source":
            return _as_float(
                await db.fetchval(
                    """
                    SELECT COUNT(*)
                    FROM retrieval_units AS ru
                    JOIN videos AS v
                      ON v.id = ru.video_id
                    WHERE ru.created_at >= $1
                      AND ru.created_at < $2
                      AND ru.unit_type = 'speech'
                      AND LOWER(v.source) = $3
                    """,
                    window.current_start,
                    window.current_end,
                    normalized_scope_key,
                )
            )
        return None

    if metric_name in {"jobs_completed", "jobs_failed"}:
        job_status = "completed" if metric_name == "jobs_completed" else "failed"
        failed_clause = (
            f" AND {_not_cancelled_job_condition()}"
            if job_status == "failed"
            else ""
        )
        if normalized_scope_type == "global":
            return _as_float(
                await db.fetchval(
                    f"""
                    SELECT COUNT(*)
                    FROM processing_jobs
                    WHERE status = $1
                      AND updated_at >= $2
                      AND updated_at < $3
                      {failed_clause}
                    """,
                    job_status,
                    window.current_start,
                    window.current_end,
                )
            )
        if normalized_scope_type == "track":
            return _as_float(
                await db.fetchval(
                    f"""
                    SELECT COUNT(*)
                    FROM processing_jobs
                    WHERE status = $1
                      AND updated_at >= $2
                      AND updated_at < $3
                      AND track = $4
                      {failed_clause}
                    """,
                    job_status,
                    window.current_start,
                    window.current_end,
                    normalized_scope_key,
                )
            )
        if normalized_scope_type == "source":
            source_failed_clause = (
                f" AND {_not_cancelled_job_condition('pj')}"
                if job_status == "failed"
                else ""
            )
            return _as_float(
                await db.fetchval(
                    f"""
                    SELECT COUNT(*)
                    FROM processing_jobs AS pj
                    LEFT JOIN content_sources AS cs
                      ON cs.id = pj.source_id
                    WHERE pj.status = $1
                      AND pj.updated_at >= $2
                      AND pj.updated_at < $3
                      {source_failed_clause}
                      AND (
                        LOWER(COALESCE(cs.slug, '')) = $4
                        OR LOWER(COALESCE(pj.source_id::text, '')) = $4
                      )
                    """,
                    job_status,
                    window.current_start,
                    window.current_end,
                    normalized_scope_key,
                )
            )
        return None

    return None


async def _fetch_summary_counts(
    db: Any,
    *,
    window: TimeWindow,
) -> dict[str, float]:
    row = await db.fetchrow(
        f"""
        SELECT
            (SELECT COUNT(*) FROM user_profiles) AS total_users,
            (SELECT COUNT(*) FROM user_profiles WHERE created_at >= $1 AND created_at < $2) AS new_users_current,
            (SELECT COUNT(*) FROM user_profiles WHERE created_at >= $3 AND created_at < $4) AS new_users_previous,
            (SELECT COUNT(DISTINCT user_id) FROM usage_events WHERE occurred_at >= $1 AND occurred_at < $2) AS active_users_current,
            (SELECT COUNT(DISTINCT user_id) FROM usage_events WHERE occurred_at >= $3 AND occurred_at < $4) AS active_users_previous,
            (SELECT COUNT(*) FROM usage_events WHERE occurred_at >= $1 AND occurred_at < $2) AS requests_current,
            (SELECT COUNT(*) FROM usage_events WHERE occurred_at >= $3 AND occurred_at < $4) AS requests_previous,
            (SELECT COALESCE(SUM(credits_used), 0) FROM usage_events WHERE occurred_at >= $1 AND occurred_at < $2) AS credits_current,
            (SELECT COALESCE(SUM(credits_used), 0) FROM usage_events WHERE occurred_at >= $3 AND occurred_at < $4) AS credits_previous,
            (SELECT COUNT(*) FROM query_logs WHERE created_at >= $1 AND created_at < $2 AND result_count = 0) AS zero_results_current,
            (SELECT COUNT(*) FROM query_logs WHERE created_at >= $3 AND created_at < $4 AND result_count = 0) AS zero_results_previous,
            (SELECT COUNT(*) FROM query_logs WHERE created_at >= $1 AND created_at < $2) AS queries_current,
            (SELECT COUNT(*) FROM query_logs WHERE created_at >= $3 AND created_at < $4) AS queries_previous,
            (SELECT COUNT(*) FROM videos WHERE source <> 'youtube') AS indexed_assets_current,
            (SELECT COUNT(*) FROM videos WHERE source <> 'youtube' AND created_at < $3) AS indexed_assets_previous,
            (SELECT COUNT(*) FROM retrieval_units WHERE unit_type = 'speech') AS indexed_segments_current,
            (SELECT COUNT(*) FROM retrieval_units WHERE unit_type = 'speech' AND created_at < $3) AS indexed_segments_previous,
            (SELECT COUNT(*) FROM processing_jobs WHERE status IN ('pending', 'running', 'retrying')) AS pending_jobs_current,
            (SELECT COUNT(*) FROM processing_jobs
              WHERE status IN ('pending', 'running', 'retrying')
                AND updated_at < $3) AS pending_jobs_previous,
            (SELECT COUNT(*) FROM processing_jobs
              WHERE status = 'failed'
                AND {_not_cancelled_job_condition()}
                AND updated_at >= $1
                AND updated_at < $2) AS failed_jobs_current,
            (SELECT COUNT(*) FROM processing_jobs
              WHERE status = 'failed'
                AND {_not_cancelled_job_condition()}
                AND updated_at >= $3
                AND updated_at < $4) AS failed_jobs_previous
        """,
        window.current_start,
        window.current_end,
        window.previous_start,
        window.previous_end,
    )
    return dict(row) if row is not None else {}


async def _fetch_daily_series(
    db: Any,
    *,
    window: TimeWindow,
) -> list[dict[str, Any]]:
    rows = await db.fetch(
        f"""
        WITH dates AS (
            SELECT generate_series($1::date, $2::date, INTERVAL '1 day')::date AS bucket_date
        ),
        request_stats AS (
            SELECT
                DATE(ue.occurred_at) AS bucket_date,
                COUNT(*) AS requests,
                COALESCE(SUM(ue.credits_used), 0) AS credits_used
            FROM usage_events AS ue
            WHERE ue.occurred_at >= $3
              AND ue.occurred_at < $4
            GROUP BY DATE(ue.occurred_at)
        ),
        query_stats AS (
            SELECT
                DATE(ql.created_at) AS bucket_date,
                COUNT(*) FILTER (WHERE ql.result_count = 0) AS zero_result_queries,
                percentile_cont(0.95) WITHIN GROUP (ORDER BY ql.latency_ms)
                    FILTER (WHERE ql.latency_ms IS NOT NULL) AS latency_p95_ms
            FROM query_logs AS ql
            WHERE ql.created_at >= $3
              AND ql.created_at < $4
            GROUP BY DATE(ql.created_at)
        ),
        broll_growth AS (
            SELECT DATE(created_at) AS bucket_date, COUNT(*) AS additions
            FROM videos
            WHERE created_at >= $3
              AND created_at < $4
              AND source <> 'youtube'
            GROUP BY DATE(created_at)
        ),
        knowledge_video_growth AS (
            SELECT DATE(created_at) AS bucket_date, COUNT(*) AS additions
            FROM videos
            WHERE created_at >= $3
              AND created_at < $4
              AND source = 'youtube'
            GROUP BY DATE(created_at)
        ),
        knowledge_segment_growth AS (
            SELECT DATE(created_at) AS bucket_date, COUNT(*) AS additions
            FROM retrieval_units
            WHERE created_at >= $3
              AND created_at < $4
              AND unit_type = 'speech'
            GROUP BY DATE(created_at)
        ),
        job_stats AS (
            SELECT
                DATE(updated_at) AS bucket_date,
                COUNT(*) FILTER (WHERE status = 'completed') AS jobs_completed,
                COUNT(*) FILTER (
                    WHERE status = 'failed'
                      AND {_not_cancelled_job_condition()}
                ) AS jobs_failed
            FROM processing_jobs
            WHERE updated_at >= $3
              AND updated_at < $4
            GROUP BY DATE(updated_at)
        )
        SELECT
            dates.bucket_date AS date,
            COALESCE(request_stats.requests, 0) AS requests,
            COALESCE(request_stats.credits_used, 0) AS credits_used,
            COALESCE(query_stats.zero_result_queries, 0) AS zero_result_queries,
            COALESCE(broll_growth.additions, 0) AS broll_assets_added,
            COALESCE(knowledge_video_growth.additions, 0) AS knowledge_videos_added,
            COALESCE(knowledge_segment_growth.additions, 0) AS knowledge_segments_added,
            COALESCE(job_stats.jobs_completed, 0) AS jobs_completed,
            COALESCE(job_stats.jobs_failed, 0) AS jobs_failed,
            query_stats.latency_p95_ms
        FROM dates
        LEFT JOIN request_stats
            ON request_stats.bucket_date = dates.bucket_date
        LEFT JOIN query_stats
            ON query_stats.bucket_date = dates.bucket_date
        LEFT JOIN broll_growth
            ON broll_growth.bucket_date = dates.bucket_date
        LEFT JOIN knowledge_video_growth
            ON knowledge_video_growth.bucket_date = dates.bucket_date
        LEFT JOIN knowledge_segment_growth
            ON knowledge_segment_growth.bucket_date = dates.bucket_date
        LEFT JOIN job_stats
            ON job_stats.bucket_date = dates.bucket_date
        ORDER BY dates.bucket_date ASC
        """,
        window.start_date,
        window.end_date,
        window.current_start,
        window.current_end,
    )
    return [dict(row) for row in rows]


async def fetch_admin_summary(
    db: Any,
    *,
    range_key: str,
) -> AdminSummaryResponse:
    window = resolve_time_window(range_key)
    targets = await _fetch_target_map(db, window.range_key)
    counts = await _fetch_summary_counts(db, window=window)
    daily_rows = await _fetch_daily_series(db, window=window)

    current_zero_rate = (
        _as_float(counts.get("zero_results_current"))
        / max(_as_float(counts.get("queries_current")), 1.0)
    )
    previous_zero_rate = (
        _as_float(counts.get("zero_results_previous"))
        / max(_as_float(counts.get("queries_previous")), 1.0)
    )

    requests_target, requests_mode = _lookup_target(targets, "requests_total")
    active_users_target, active_users_mode = _lookup_target(targets, "active_users")
    credits_target, credits_mode = _lookup_target(targets, "credits_used")
    failed_jobs_target, failed_jobs_mode = _lookup_target(targets, "jobs_failed")

    metrics = AdminOverviewMetrics(
        total_users=_build_metric(
            current=_as_float(counts.get("total_users")),
            previous=_as_float(counts.get("total_users")) - _as_float(counts.get("new_users_current")),
        ),
        new_users=_build_metric(
            current=_as_float(counts.get("new_users_current")),
            previous=_as_float(counts.get("new_users_previous")),
            target=_lookup_target(targets, "new_users")[0],
            comparison_mode=_lookup_target(targets, "new_users")[1],
        ),
        active_users=_build_metric(
            current=_as_float(counts.get("active_users_current")),
            previous=_as_float(counts.get("active_users_previous")),
            target=active_users_target,
            comparison_mode=active_users_mode,
        ),
        requests=_build_metric(
            current=_as_float(counts.get("requests_current")),
            previous=_as_float(counts.get("requests_previous")),
            target=requests_target,
            comparison_mode=requests_mode,
        ),
        credits_used=_build_metric(
            current=_as_float(counts.get("credits_current")),
            previous=_as_float(counts.get("credits_previous")),
            target=credits_target,
            comparison_mode=credits_mode,
        ),
        zero_result_rate=_build_metric(
            current=current_zero_rate,
            previous=previous_zero_rate,
        ),
        indexed_assets=_build_metric(
            current=_as_float(counts.get("indexed_assets_current")),
            previous=_as_float(counts.get("indexed_assets_previous")),
        ),
        indexed_segments=_build_metric(
            current=_as_float(counts.get("indexed_segments_current")),
            previous=_as_float(counts.get("indexed_segments_previous")),
        ),
        pending_jobs=_build_metric(
            current=_as_float(counts.get("pending_jobs_current")),
            previous=_as_float(counts.get("pending_jobs_previous")),
        ),
        failed_jobs=_build_metric(
            current=_as_float(counts.get("failed_jobs_current")),
            previous=_as_float(counts.get("failed_jobs_previous")),
            target=failed_jobs_target,
            comparison_mode=failed_jobs_mode,
        ),
    )

    notices: list[AdminNotice] = []
    if metrics.zero_result_rate.current > 0.2:
        notices.append(
            AdminNotice(
                tone="warning",
                title="Zero-result rate is elevated",
                description="More than 20% of recent queries returned no results. Review indexing freshness and query quality.",
            )
        )
    if metrics.failed_jobs.current > 0:
        notices.append(
            AdminNotice(
                tone="error",
                title="Recent ingestion failures detected",
                description=f"{int(metrics.failed_jobs.current)} job(s) failed in the selected window.",
            )
        )

    series = [
        AdminSummaryPoint(
            date=row["date"],
            requests=_as_int(row.get("requests")),
            credits_used=_as_int(row.get("credits_used")),
            zero_result_queries=_as_int(row.get("zero_result_queries")),
            broll_assets_added=_as_int(row.get("broll_assets_added")),
            knowledge_videos_added=_as_int(row.get("knowledge_videos_added")),
            knowledge_segments_added=_as_int(row.get("knowledge_segments_added")),
            jobs_completed=_as_int(row.get("jobs_completed")),
            jobs_failed=_as_int(row.get("jobs_failed")),
            latency_p95_ms=_as_float(row.get("latency_p95_ms")) if row.get("latency_p95_ms") is not None else None,
        )
        for row in daily_rows
    ]

    return AdminSummaryResponse(
        generated_at=_utc_now(),
        window=serialize_window(window),
        metrics=metrics,
        request_series=series,
        content_series=series,
        ingestion_series=series,
        notices=notices,
    )


async def fetch_users_summary(
    db: Any,
    *,
    range_key: str,
) -> AdminUsersSummaryResponse:
    window = resolve_time_window(range_key)
    targets = await _fetch_target_map(db, window.range_key)

    counts_row = await db.fetchrow(
        """
        SELECT
            (SELECT COUNT(*) FROM user_profiles) AS total_users,
            (SELECT COUNT(*) FROM user_profiles WHERE created_at >= $1 AND created_at < $2) AS new_users_current,
            (SELECT COUNT(*) FROM user_profiles WHERE created_at >= $3 AND created_at < $4) AS new_users_previous,
            (SELECT COUNT(DISTINCT user_id) FROM usage_events WHERE occurred_at >= $1 AND occurred_at < $2) AS active_users_current,
            (SELECT COUNT(DISTINCT user_id) FROM usage_events WHERE occurred_at >= $3 AND occurred_at < $4) AS active_users_previous,
            (SELECT COUNT(*) FROM api_keys WHERE is_active = TRUE) AS active_api_keys_current,
            (SELECT COUNT(*) FROM api_keys WHERE is_active = TRUE AND created_at < $3) AS active_api_keys_previous
        """,
        window.current_start,
        window.current_end,
        window.previous_start,
        window.previous_end,
    )
    counts = dict(counts_row) if counts_row is not None else {}

    tier_rows = await db.fetch(
        """
        SELECT tier AS key, tier AS label, COUNT(*) AS count
        FROM user_profiles
        GROUP BY tier
        ORDER BY count DESC, tier ASC
        """
    )
    role_rows = await db.fetch(
        """
        SELECT console_role AS key, console_role AS label, COUNT(*) AS count
        FROM user_profiles
        GROUP BY console_role
        ORDER BY count DESC, console_role ASC
        """
    )
    signup_rows = await db.fetch(
        """
        SELECT
            DATE(created_at) AS key,
            TO_CHAR(DATE(created_at), 'YYYY-MM-DD') AS label,
            COUNT(*) AS count
        FROM user_profiles
        WHERE created_at >= $1
          AND created_at < $2
        GROUP BY DATE(created_at)
        ORDER BY key ASC
        """,
        window.current_start,
        window.current_end,
    )
    recent_rows = await db.fetch(
        """
        SELECT
            up.id AS user_id,
            up.email,
            up.tier,
            up.console_role,
            up.created_at,
            COUNT(ak.id) FILTER (WHERE ak.is_active = TRUE) AS active_api_keys,
            MAX(ue.occurred_at) AS last_request_at
        FROM user_profiles AS up
        LEFT JOIN api_keys AS ak
            ON ak.user_id = up.id
        LEFT JOIN usage_events AS ue
            ON ue.user_id = up.id
        GROUP BY up.id, up.email, up.tier, up.console_role, up.created_at
        ORDER BY up.created_at DESC
        LIMIT 10
        """
    )
    active_rows = await db.fetch(
        """
        SELECT
            up.id AS user_id,
            up.email,
            up.tier,
            COUNT(*) AS request_count,
            COALESCE(SUM(ue.credits_used), 0) AS credits_used,
            MAX(ue.occurred_at) AS last_request_at
        FROM usage_events AS ue
        JOIN user_profiles AS up
            ON up.id = ue.user_id
        WHERE ue.occurred_at >= $1
          AND ue.occurred_at < $2
        GROUP BY up.id, up.email, up.tier
        ORDER BY request_count DESC, credits_used DESC, last_request_at DESC
        LIMIT 10
        """,
        window.current_start,
        window.current_end,
    )

    return AdminUsersSummaryResponse(
        generated_at=_utc_now(),
        window=serialize_window(window),
        metrics=AdminUsersMetrics(
            total_users=_build_metric(
                current=_as_float(counts.get("total_users")),
                previous=_as_float(counts.get("total_users")) - _as_float(counts.get("new_users_current")),
            ),
            new_users=_build_metric(
                current=_as_float(counts.get("new_users_current")),
                previous=_as_float(counts.get("new_users_previous")),
                target=_lookup_target(targets, "new_users")[0],
                comparison_mode=_lookup_target(targets, "new_users")[1],
            ),
            active_users=_build_metric(
                current=_as_float(counts.get("active_users_current")),
                previous=_as_float(counts.get("active_users_previous")),
                target=_lookup_target(targets, "active_users")[0],
                comparison_mode=_lookup_target(targets, "active_users")[1],
            ),
            active_api_keys=_build_metric(
                current=_as_float(counts.get("active_api_keys_current")),
                previous=_as_float(counts.get("active_api_keys_previous")),
            ),
        ),
        daily_signups=[
            AdminNamedCount(
                key=str(row["key"]),
                label=str(row["label"]),
                count=_as_int(row["count"]),
            )
            for row in signup_rows
        ],
        tiers=[
            AdminNamedCount(
                key=str(row["key"]),
                label=str(row["label"]).title(),
                count=_as_int(row["count"]),
            )
            for row in tier_rows
        ],
        console_roles=[
            AdminNamedCount(
                key=str(row["key"]),
                label=str(row["label"]).title(),
                count=_as_int(row["count"]),
            )
            for row in role_rows
        ],
        recent_users=[
            AdminRecentUser(
                user_id=str(row["user_id"]),
                email=str(row["email"]) if row.get("email") is not None else None,
                tier=str(row["tier"]),
                console_role=str(row["console_role"]),
                created_at=row["created_at"],
                active_api_keys=_as_int(row["active_api_keys"]),
                last_request_at=row.get("last_request_at"),
            )
            for row in recent_rows
        ],
        most_active_users=[
            AdminActiveUser(
                user_id=str(row["user_id"]),
                email=str(row["email"]) if row.get("email") is not None else None,
                tier=str(row["tier"]),
                request_count=_as_int(row["request_count"]),
                credits_used=_as_int(row["credits_used"]),
                last_request_at=row.get("last_request_at"),
            )
            for row in active_rows
        ],
    )


async def fetch_requests_summary(
    db: Any,
    *,
    range_key: str,
) -> AdminRequestsSummaryResponse:
    window = resolve_time_window(range_key)
    targets = await _fetch_target_map(db, window.range_key)
    usage_row = await db.fetchrow(
        """
        SELECT
            COUNT(*) FILTER (WHERE occurred_at >= $1 AND occurred_at < $2) AS requests_current,
            COUNT(*) FILTER (WHERE occurred_at >= $3 AND occurred_at < $4) AS requests_previous,
            COALESCE(SUM(credits_used) FILTER (WHERE occurred_at >= $1 AND occurred_at < $2), 0) AS credits_current,
            COALESCE(SUM(credits_used) FILTER (WHERE occurred_at >= $3 AND occurred_at < $4), 0) AS credits_previous,
            COUNT(DISTINCT user_id) FILTER (WHERE occurred_at >= $1 AND occurred_at < $2) AS active_users_current,
            COUNT(DISTINCT user_id) FILTER (WHERE occurred_at >= $3 AND occurred_at < $4) AS active_users_previous
        FROM usage_events
        """,
        window.current_start,
        window.current_end,
        window.previous_start,
        window.previous_end,
    )
    query_row = await db.fetchrow(
        """
        SELECT
            COUNT(*) FILTER (WHERE created_at >= $1 AND created_at < $2) AS queries_current,
            COUNT(*) FILTER (WHERE created_at >= $3 AND created_at < $4) AS queries_previous,
            COUNT(*) FILTER (WHERE created_at >= $1 AND created_at < $2 AND result_count = 0) AS zero_results_current,
            COUNT(*) FILTER (WHERE created_at >= $3 AND created_at < $4 AND result_count = 0) AS zero_results_previous,
            COUNT(*) FILTER (WHERE created_at >= $1 AND created_at < $2 AND include_answer = TRUE) AS answers_current,
            COUNT(*) FILTER (WHERE created_at >= $3 AND created_at < $4 AND include_answer = TRUE) AS answers_previous
        FROM query_logs
        """,
        window.current_start,
        window.current_end,
        window.previous_start,
        window.previous_end,
    )
    latency_row = await db.fetchrow(
        """
        WITH current_latencies AS (
            SELECT latency_ms
            FROM query_logs
            WHERE created_at >= $1
              AND created_at < $2
              AND latency_ms IS NOT NULL
        ),
        previous_latencies AS (
            SELECT latency_ms
            FROM query_logs
            WHERE created_at >= $3
              AND created_at < $4
              AND latency_ms IS NOT NULL
        )
        SELECT
            (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) FROM current_latencies) AS p50_current,
            (SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) FROM current_latencies) AS p95_current,
            (SELECT percentile_cont(0.99) WITHIN GROUP (ORDER BY latency_ms) FROM current_latencies) AS p99_current,
            (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) FROM previous_latencies) AS p50_previous,
            (SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) FROM previous_latencies) AS p95_previous,
            (SELECT percentile_cont(0.99) WITHIN GROUP (ORDER BY latency_ms) FROM previous_latencies) AS p99_previous
        """
        ,
        window.current_start,
        window.current_end,
        window.previous_start,
        window.previous_end,
    )
    top_query_rows = await db.fetch(
        """
        SELECT
            query_text,
            COUNT(*) AS request_count,
            COUNT(*) FILTER (WHERE result_count = 0) AS zero_result_count,
            COUNT(*) FILTER (WHERE include_answer = TRUE) AS answer_count,
            AVG(latency_ms) FILTER (WHERE latency_ms IS NOT NULL) AS avg_latency_ms
        FROM query_logs
        WHERE created_at >= $1
          AND created_at < $2
        GROUP BY query_text
        ORDER BY request_count DESC, query_text ASC
        LIMIT 10
        """,
        window.current_start,
        window.current_end,
    )
    zero_result_rows = await db.fetch(
        """
        SELECT
            query_text,
            COUNT(*) AS request_count,
            COUNT(*) FILTER (WHERE result_count = 0) AS zero_result_count,
            COUNT(*) FILTER (WHERE include_answer = TRUE) AS answer_count,
            AVG(latency_ms) FILTER (WHERE latency_ms IS NOT NULL) AS avg_latency_ms
        FROM query_logs
        WHERE created_at >= $1
          AND created_at < $2
          AND result_count = 0
        GROUP BY query_text
        ORDER BY request_count DESC, query_text ASC
        LIMIT 10
        """,
        window.current_start,
        window.current_end,
    )
    daily_rows = await _fetch_daily_series(db, window=window)
    usage_counts = dict(usage_row) if usage_row is not None else {}
    query_counts = dict(query_row) if query_row is not None else {}
    latency_counts = dict(latency_row) if latency_row is not None else {}

    current_request_count = _as_float(usage_counts.get("requests_current"))
    previous_request_count = _as_float(usage_counts.get("requests_previous"))
    current_query_count = _as_float(query_counts.get("queries_current"))
    previous_query_count = _as_float(query_counts.get("queries_previous"))
    current_zero_rate = _as_float(query_counts.get("zero_results_current")) / max(current_query_count, 1.0)
    previous_zero_rate = _as_float(query_counts.get("zero_results_previous")) / max(previous_query_count, 1.0)
    current_answer_rate = _as_float(query_counts.get("answers_current")) / max(current_query_count, 1.0)
    previous_answer_rate = _as_float(query_counts.get("answers_previous")) / max(previous_query_count, 1.0)
    current_avg_credits = _as_float(usage_counts.get("credits_current")) / max(current_request_count, 1.0)
    previous_avg_credits = _as_float(usage_counts.get("credits_previous")) / max(previous_request_count, 1.0)

    return AdminRequestsSummaryResponse(
        generated_at=_utc_now(),
        window=serialize_window(window),
        metrics=AdminRequestsMetrics(
            total_requests=_build_metric(
                current=current_request_count,
                previous=previous_request_count,
                target=_lookup_target(targets, "requests_total")[0],
                comparison_mode=_lookup_target(targets, "requests_total")[1],
            ),
            credits_used=_build_metric(
                current=_as_float(usage_counts.get("credits_current")),
                previous=_as_float(usage_counts.get("credits_previous")),
                target=_lookup_target(targets, "credits_used")[0],
                comparison_mode=_lookup_target(targets, "credits_used")[1],
            ),
            active_users=_build_metric(
                current=_as_float(usage_counts.get("active_users_current")),
                previous=_as_float(usage_counts.get("active_users_previous")),
                target=_lookup_target(targets, "active_users")[0],
                comparison_mode=_lookup_target(targets, "active_users")[1],
            ),
            average_credits_per_request=_build_metric(
                current=current_avg_credits,
                previous=previous_avg_credits,
            ),
            zero_result_rate=_build_metric(
                current=current_zero_rate,
                previous=previous_zero_rate,
            ),
            answer_usage_rate=_build_metric(
                current=current_answer_rate,
                previous=previous_answer_rate,
            ),
            latency=AdminLatencyMetrics(
                p50_ms=_build_metric(
                    current=_as_float(latency_counts.get("p50_current")),
                    previous=_as_float(latency_counts.get("p50_previous")),
                ),
                p95_ms=_build_metric(
                    current=_as_float(latency_counts.get("p95_current")),
                    previous=_as_float(latency_counts.get("p95_previous")),
                ),
                p99_ms=_build_metric(
                    current=_as_float(latency_counts.get("p99_current")),
                    previous=_as_float(latency_counts.get("p99_previous")),
                ),
            ),
        ),
        daily_series=[
            AdminSummaryPoint(
                date=row["date"],
                requests=_as_int(row.get("requests")),
                credits_used=_as_int(row.get("credits_used")),
                zero_result_queries=_as_int(row.get("zero_result_queries")),
                latency_p95_ms=_as_float(row.get("latency_p95_ms")) if row.get("latency_p95_ms") is not None else None,
            )
            for row in daily_rows
        ],
        top_queries=[
            {
                "query_text": str(row["query_text"]),
                "request_count": _as_int(row["request_count"]),
                "zero_result_count": _as_int(row["zero_result_count"]),
                "answer_count": _as_int(row["answer_count"]),
                "avg_latency_ms": _as_float(row.get("avg_latency_ms")) if row.get("avg_latency_ms") is not None else None,
            }
            for row in top_query_rows
        ],
        zero_result_queries=[
            {
                "query_text": str(row["query_text"]),
                "request_count": _as_int(row["request_count"]),
                "zero_result_count": _as_int(row["zero_result_count"]),
                "answer_count": _as_int(row["answer_count"]),
                "avg_latency_ms": _as_float(row.get("avg_latency_ms")) if row.get("avg_latency_ms") is not None else None,
            }
            for row in zero_result_rows
        ],
    )


async def fetch_content_summary(
    db: Any,
    *,
    range_key: str,
) -> AdminContentSummaryResponse:
    window = resolve_time_window(range_key)
    targets = await _fetch_target_map(db, window.range_key)
    counts_row = await db.fetchrow(
        """
        SELECT
            (SELECT COUNT(*) FROM videos WHERE source <> 'youtube') AS broll_assets_total_current,
            (SELECT COUNT(*) FROM videos WHERE source <> 'youtube' AND created_at < $3) AS broll_assets_total_previous,
            (SELECT COUNT(*) FROM videos WHERE source = 'youtube') AS knowledge_videos_total_current,
            (SELECT COUNT(*) FROM videos WHERE source = 'youtube' AND created_at < $3) AS knowledge_videos_total_previous,
            (SELECT COUNT(*) FROM retrieval_units WHERE unit_type = 'speech') AS knowledge_segments_total_current,
            (SELECT COUNT(*) FROM retrieval_units WHERE unit_type = 'speech' AND created_at < $3) AS knowledge_segments_total_previous,
            (SELECT COUNT(*) FROM content_sources WHERE is_active = TRUE) AS active_sources_total_current,
            (SELECT COUNT(*) FROM content_sources WHERE is_active = TRUE AND created_at < $3) AS active_sources_total_previous,
            (SELECT COUNT(*) FROM videos WHERE created_at >= $1 AND created_at < $2 AND source <> 'youtube') AS broll_assets_added_current,
            (SELECT COUNT(*) FROM videos WHERE created_at >= $3 AND created_at < $4 AND source <> 'youtube') AS broll_assets_added_previous,
            (SELECT COUNT(*) FROM videos WHERE created_at >= $1 AND created_at < $2 AND source = 'youtube') AS knowledge_videos_added_current,
            (SELECT COUNT(*) FROM videos WHERE created_at >= $3 AND created_at < $4 AND source = 'youtube') AS knowledge_videos_added_previous,
            (SELECT COUNT(*) FROM retrieval_units WHERE created_at >= $1 AND created_at < $2 AND unit_type = 'speech') AS knowledge_segments_added_current,
            (SELECT COUNT(*) FROM retrieval_units WHERE created_at >= $3 AND created_at < $4 AND unit_type = 'speech') AS knowledge_segments_added_previous
        """,
        window.current_start,
        window.current_end,
        window.previous_start,
        window.previous_end,
    )
    per_source_rows = await db.fetch(
        """
        SELECT track, source_key, SUM(additions) AS additions
        FROM (
            SELECT 'broll'::text AS track, source AS source_key, COUNT(*) AS additions
            FROM videos
            WHERE created_at >= $1
              AND created_at < $2
              AND source <> 'youtube'
            GROUP BY source
            UNION ALL
            SELECT 'knowledge'::text AS track, source AS source_key, COUNT(*) AS additions
            FROM videos
            WHERE created_at >= $1
              AND created_at < $2
              AND source = 'youtube'
            GROUP BY source
        ) AS additions
        GROUP BY track, source_key
        ORDER BY additions DESC, track ASC, source_key ASC
        """,
        window.current_start,
        window.current_end,
    )
    stale_rows = await db.fetch(
        """
        SELECT
            cs.id::text AS source_id,
            cs.slug,
            cs.display_name,
            cs.track,
            cs.is_active,
            MAX(pj.updated_at) AS last_job_at,
            COUNT(*) FILTER (WHERE pj.updated_at >= $1 AND pj.updated_at < $2) AS jobs_in_range
        FROM content_sources AS cs
        LEFT JOIN processing_jobs AS pj
            ON pj.source_id = cs.id
        GROUP BY cs.id, cs.slug, cs.display_name, cs.track, cs.is_active
        ORDER BY cs.display_name ASC
        """,
        window.current_start,
        window.current_end,
    )
    daily_rows = await _fetch_daily_series(db, window=window)
    counts = dict(counts_row) if counts_row is not None else {}
    stale_cutoff = _utc_now() - timedelta(days=7)

    return AdminContentSummaryResponse(
        generated_at=_utc_now(),
        window=serialize_window(window),
        metrics=AdminInventoryMetrics(
            broll_assets_total=_build_metric(
                current=_as_float(counts.get("broll_assets_total_current")),
                previous=_as_float(counts.get("broll_assets_total_previous")),
            ),
            knowledge_videos_total=_build_metric(
                current=_as_float(counts.get("knowledge_videos_total_current")),
                previous=_as_float(counts.get("knowledge_videos_total_previous")),
            ),
            knowledge_segments_total=_build_metric(
                current=_as_float(counts.get("knowledge_segments_total_current")),
                previous=_as_float(counts.get("knowledge_segments_total_previous")),
            ),
            active_sources_total=_build_metric(
                current=_as_float(counts.get("active_sources_total_current")),
                previous=_as_float(counts.get("active_sources_total_previous")),
            ),
            broll_assets_added=_build_metric(
                current=_as_float(counts.get("broll_assets_added_current")),
                previous=_as_float(counts.get("broll_assets_added_previous")),
                target=_lookup_target(targets, "broll_assets_added")[0],
                comparison_mode=_lookup_target(targets, "broll_assets_added")[1],
            ),
            knowledge_videos_added=_build_metric(
                current=_as_float(counts.get("knowledge_videos_added_current")),
                previous=_as_float(counts.get("knowledge_videos_added_previous")),
                target=_lookup_target(targets, "knowledge_videos_added")[0],
                comparison_mode=_lookup_target(targets, "knowledge_videos_added")[1],
            ),
            knowledge_segments_added=_build_metric(
                current=_as_float(counts.get("knowledge_segments_added_current")),
                previous=_as_float(counts.get("knowledge_segments_added_previous")),
                target=_lookup_target(targets, "knowledge_segments_added")[0],
                comparison_mode=_lookup_target(targets, "knowledge_segments_added")[1],
            ),
        ),
        daily_series=[
            AdminSummaryPoint(
                date=row["date"],
                broll_assets_added=_as_int(row.get("broll_assets_added")),
                knowledge_videos_added=_as_int(row.get("knowledge_videos_added")),
                knowledge_segments_added=_as_int(row.get("knowledge_segments_added")),
            )
            for row in daily_rows
        ],
        per_source_growth=[
            AdminSourceGrowth(
                track=str(row["track"]),
                source_key=str(row["source_key"]),
                additions=_as_int(row["additions"]),
            )
            for row in per_source_rows
        ],
        stale_sources=[
            AdminSourceFreshness(
                source_id=str(row["source_id"]),
                slug=str(row["slug"]),
                display_name=str(row["display_name"]),
                track=str(row["track"]),
                is_active=bool(row["is_active"]),
                last_job_at=row.get("last_job_at"),
                jobs_in_range=_as_int(row["jobs_in_range"]),
                is_stale=(row.get("last_job_at") is None) or row["last_job_at"] < stale_cutoff,
            )
            for row in stale_rows
        ],
    )


async def fetch_ingestion_summary(
    db: Any,
    *,
    range_key: str,
) -> AdminIngestionSummaryResponse:
    window = resolve_time_window(range_key)
    targets = await _fetch_target_map(db, window.range_key)
    metric_row = await db.fetchrow(
        f"""
        SELECT
            (SELECT COUNT(*) FROM processing_jobs WHERE created_at >= $1 AND created_at < $2) AS jobs_created_current,
            (SELECT COUNT(*) FROM processing_jobs WHERE created_at >= $3 AND created_at < $4) AS jobs_created_previous,
            (SELECT COUNT(*) FROM processing_jobs WHERE status = 'completed' AND updated_at >= $1 AND updated_at < $2) AS jobs_completed_current,
            (SELECT COUNT(*) FROM processing_jobs WHERE status = 'completed' AND updated_at >= $3 AND updated_at < $4) AS jobs_completed_previous,
            (SELECT COUNT(*) FROM processing_jobs
              WHERE status = 'failed'
                AND {_not_cancelled_job_condition()}
                AND updated_at >= $1
                AND updated_at < $2) AS jobs_failed_current,
            (SELECT COUNT(*) FROM processing_jobs
              WHERE status = 'failed'
                AND {_not_cancelled_job_condition()}
                AND updated_at >= $3
                AND updated_at < $4) AS jobs_failed_previous,
            (SELECT COUNT(*) FROM processing_jobs WHERE status IN ('pending', 'running', 'retrying')) AS pending_backlog_current,
            (SELECT COUNT(*) FROM processing_jobs
              WHERE status IN ('pending', 'running', 'retrying')
                AND updated_at < $3) AS pending_backlog_previous,
            (SELECT AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000)
             FROM processing_jobs
             WHERE started_at IS NOT NULL
               AND completed_at IS NOT NULL
               AND updated_at >= $1
               AND updated_at < $2) AS avg_processing_current,
            (SELECT AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000)
             FROM processing_jobs
             WHERE started_at IS NOT NULL
               AND completed_at IS NOT NULL
               AND updated_at >= $3
               AND updated_at < $4) AS avg_processing_previous
        """,
        window.current_start,
        window.current_end,
        window.previous_start,
        window.previous_end,
    )
    status_row = await db.fetchrow(
        f"""
        SELECT
            COUNT(*) FILTER (WHERE status = 'pending') AS pending,
            COUNT(*) FILTER (WHERE status = 'running') AS running,
            COUNT(*) FILTER (WHERE status = 'retrying') AS retrying,
            COUNT(*) FILTER (WHERE status = 'completed') AS completed,
            COUNT(*) FILTER (
                WHERE status = 'failed'
                  AND {_not_cancelled_job_condition()}
            ) AS failed
        FROM processing_jobs
        """
    )
    source_rows = await db.fetch(
        f"""
        SELECT
            cs.id::text AS source_id,
            cs.slug,
            cs.display_name,
            cs.track,
            cs.is_active,
            COUNT(pj.id) FILTER (WHERE pj.created_at >= $1 AND pj.created_at < $2) AS jobs_created,
            COUNT(pj.id) FILTER (WHERE pj.status = 'completed' AND pj.updated_at >= $1 AND pj.updated_at < $2) AS jobs_completed,
            COUNT(pj.id) FILTER (
                WHERE pj.status = 'failed'
                  AND {_not_cancelled_job_condition("pj")}
                  AND pj.updated_at >= $1
                  AND pj.updated_at < $2
            ) AS jobs_failed,
            COUNT(pj.id) FILTER (WHERE pj.status IN ('pending', 'running', 'retrying')) AS backlog,
            MAX(pj.updated_at) AS last_job_at
        FROM content_sources AS cs
        LEFT JOIN processing_jobs AS pj
            ON pj.source_id = cs.id
        GROUP BY cs.id, cs.slug, cs.display_name, cs.track, cs.is_active
        ORDER BY jobs_failed DESC, backlog DESC, cs.display_name ASC
        """,
        window.current_start,
        window.current_end,
    )
    failed_job_rows = await db.fetch(
        f"""
        SELECT
            id::text AS job_id,
            track,
            job_type,
            source_id::text AS source_id,
            error_message,
            attempts,
            max_attempts,
            updated_at
        FROM processing_jobs
        WHERE status = 'failed'
          AND {_not_cancelled_job_condition()}
          AND updated_at >= $1
          AND updated_at < $2
        ORDER BY updated_at DESC
        LIMIT 10
        """,
        window.current_start,
        window.current_end,
    )
    failed_step_rows = await db.fetch(
        f"""
        SELECT
            pjs.step_name,
            COUNT(*) AS failure_count,
            MAX(pjs.updated_at) AS last_failed_at
        FROM processing_job_steps AS pjs
        JOIN processing_jobs AS pj
          ON pj.id = pjs.job_id
        WHERE pjs.status = 'failed'
          AND {_not_cancelled_job_condition("pj")}
          AND pjs.updated_at >= $1
          AND pjs.updated_at < $2
        GROUP BY pjs.step_name
        ORDER BY failure_count DESC, pjs.step_name ASC
        LIMIT 10
        """,
        window.current_start,
        window.current_end,
    )
    daily_rows = await _fetch_daily_series(db, window=window)
    metrics = dict(metric_row) if metric_row is not None else {}
    status_counts = dict(status_row) if status_row is not None else {}
    jobs_completed_current = _as_float(metrics.get("jobs_completed_current"))
    jobs_failed_current = _as_float(metrics.get("jobs_failed_current"))
    jobs_completed_previous = _as_float(metrics.get("jobs_completed_previous"))
    jobs_failed_previous = _as_float(metrics.get("jobs_failed_previous"))

    return AdminIngestionSummaryResponse(
        generated_at=_utc_now(),
        window=serialize_window(window),
        metrics=AdminIngestionMetrics(
            jobs_created=_build_metric(
                current=_as_float(metrics.get("jobs_created_current")),
                previous=_as_float(metrics.get("jobs_created_previous")),
            ),
            jobs_completed=_build_metric(
                current=jobs_completed_current,
                previous=jobs_completed_previous,
                target=_lookup_target(targets, "jobs_completed")[0],
                comparison_mode=_lookup_target(targets, "jobs_completed")[1],
            ),
            jobs_failed=_build_metric(
                current=jobs_failed_current,
                previous=jobs_failed_previous,
                target=_lookup_target(targets, "jobs_failed")[0],
                comparison_mode=_lookup_target(targets, "jobs_failed")[1],
            ),
            completion_rate=_build_metric(
                current=jobs_completed_current / max(jobs_completed_current + jobs_failed_current, 1.0),
                previous=jobs_completed_previous / max(jobs_completed_previous + jobs_failed_previous, 1.0),
            ),
            failure_rate=_build_metric(
                current=jobs_failed_current / max(jobs_completed_current + jobs_failed_current, 1.0),
                previous=jobs_failed_previous / max(jobs_completed_previous + jobs_failed_previous, 1.0),
            ),
            pending_backlog=_build_metric(
                current=_as_float(metrics.get("pending_backlog_current")),
                previous=_as_float(metrics.get("pending_backlog_previous")),
            ),
            average_processing_ms=_build_metric(
                current=_as_float(metrics.get("avg_processing_current")),
                previous=_as_float(metrics.get("avg_processing_previous")),
            ),
        ),
        status_counts=AdminJobStatusCounts(
            pending=_as_int(status_counts.get("pending")),
            running=_as_int(status_counts.get("running")),
            retrying=_as_int(status_counts.get("retrying")),
            completed=_as_int(status_counts.get("completed")),
            failed=_as_int(status_counts.get("failed")),
        ),
        daily_series=[
            AdminSummaryPoint(
                date=row["date"],
                jobs_completed=_as_int(row.get("jobs_completed")),
                jobs_failed=_as_int(row.get("jobs_failed")),
            )
            for row in daily_rows
        ],
        source_health=[
            AdminSourceHealth(
                source_id=str(row["source_id"]),
                slug=str(row["slug"]),
                display_name=str(row["display_name"]),
                track=str(row["track"]),
                is_active=bool(row["is_active"]),
                jobs_created=_as_int(row["jobs_created"]),
                jobs_completed=_as_int(row["jobs_completed"]),
                jobs_failed=_as_int(row["jobs_failed"]),
                backlog=_as_int(row["backlog"]),
                last_job_at=row.get("last_job_at"),
            )
            for row in source_rows
        ],
        recent_failed_jobs=[
            AdminFailedJob(
                job_id=str(row["job_id"]),
                track=str(row["track"]),
                job_type=str(row["job_type"]),
                source_id=str(row["source_id"]) if row.get("source_id") is not None else None,
                error_message=str(row["error_message"]) if row.get("error_message") is not None else None,
                attempts=_as_int(row["attempts"]),
                max_attempts=_as_int(row["max_attempts"]),
                updated_at=row["updated_at"],
            )
            for row in failed_job_rows
        ],
        failed_steps=[
            AdminFailedStep(
                step_name=str(row["step_name"]),
                failure_count=_as_int(row["failure_count"]),
                last_failed_at=row.get("last_failed_at"),
            )
            for row in failed_step_rows
        ],
    )


async def fetch_targets_summary(
    db: Any,
    *,
    range_key: str,
) -> AdminTargetsResponse:
    window = resolve_time_window(range_key)
    target_rows = await _fetch_target_rows(db, window.range_key)
    serialized_targets: list[AdminMetricTarget] = []

    for row in target_rows:
        metric_name = str(row["metric_name"])
        scope_type, scope_key = _normalize_target_scope(
            str(row.get("scope_type") or "global"),
            str(row.get("scope_key") or ""),
        )
        actual_value = await _fetch_target_actual(
            db,
            window=window,
            metric_name=metric_name,
            scope_type=scope_type,
            scope_key=scope_key,
        )
        target_value = _as_float(row.get("target_value"))
        comparison_mode = str(row.get("comparison_mode") or "at_least")

        if actual_value is None:
            attainment_ratio = None
            target_gap = None
        elif comparison_mode == "at_most":
            target_gap = target_value - actual_value
            attainment_ratio = 1.0 if actual_value <= 0 else target_value / actual_value
        else:
            target_gap = actual_value - target_value
            attainment_ratio = None if target_value <= 0 else actual_value / target_value

        serialized_targets.append(
            AdminMetricTarget(
                id=str(row["id"]),
                metric_name=metric_name,
                scope_type=scope_type,
                scope_key=scope_key,
                range_key=row["range_key"],
                comparison_mode=row["comparison_mode"],
                target_value=target_value,
                note=str(row["note"]) if row.get("note") is not None else None,
                updated_at=row["updated_at"],
                actual_value=actual_value,
                attainment_ratio=attainment_ratio,
                target_gap=target_gap,
            )
        )

    return AdminTargetsResponse(
        generated_at=_utc_now(),
        window=serialize_window(window),
        targets=serialized_targets,
    )


async def fetch_worker_live(
    db: Any,
    *,
    failed_limit: int = 10,
    failed_offset: int = 0,
) -> AdminWorkerLiveResponse:
    """Return a real-time snapshot of the worker queue and active jobs."""

    # Queue counts across all time
    counts_row = await db.fetchrow(f"""
        SELECT
            COUNT(*) FILTER (WHERE status = 'pending')   AS pending,
            COUNT(*) FILTER (WHERE status = 'running')   AS running,
            COUNT(*) FILTER (WHERE status = 'retrying')  AS retrying,
            COUNT(*) FILTER (WHERE status = 'completed') AS completed,
            COUNT(*) FILTER (
                WHERE status = 'failed'
                  AND {_not_cancelled_job_condition()}
            ) AS failed
        FROM processing_jobs
    """)

    queue = AdminWorkerQueueCounts(
        pending=_as_int(counts_row["pending"]),
        running=_as_int(counts_row["running"]),
        retrying=_as_int(counts_row["retrying"]),
        completed=_as_int(counts_row["completed"]),
        failed=_as_int(counts_row["failed"]),
    )

    # Active jobs: running first, then pending, capped at 20
    active_rows = await db.fetch("""
        SELECT
            pj.id,
            pj.track,
            pj.status,
            input_payload->>'source'                            AS source,
            input_payload->>'video_id'                          AS video_id,
            COALESCE(
                v.title,
                input_payload->'source_metadata'->>'title',
                input_payload->>'title',
                input_payload->>'video_id'
            )                                                   AS title,
            pj.attempts,
            pj.max_attempts,
            pj.error_message,
            pj.started_at,
            pj.created_at,
            pj.updated_at
        FROM processing_jobs AS pj
        LEFT JOIN videos AS v
            ON v.id::text = pj.input_payload->>'video_id'
        WHERE pj.status IN ('running', 'retrying', 'pending')
        ORDER BY
            CASE pj.status
                WHEN 'running' THEN 0
                WHEN 'retrying' THEN 1
                ELSE 2
            END,
            pj.started_at NULLS LAST,
            pj.created_at
        LIMIT 20
    """)

    generated_at = _utc_now()

    active_job_ids = [str(row["id"]) for row in active_rows]
    failed_jobs_total = _as_int(
        await db.fetchval(
            f"""
            SELECT COUNT(*)
            FROM processing_jobs
            WHERE status = 'failed'
              AND {_not_cancelled_job_condition()}
            """
        )
    )

    failed_rows = await db.fetch(
        f"""
        SELECT
            pj.id,
            pj.track,
            pj.status,
            input_payload->>'source'                            AS source,
            input_payload->>'video_id'                          AS video_id,
            COALESCE(
                v.title,
                input_payload->'source_metadata'->>'title',
                input_payload->>'title',
                input_payload->>'video_id'
            )                                                   AS title,
            pj.attempts,
            pj.max_attempts,
            pj.error_message,
            pj.started_at,
            pj.completed_at,
            pj.created_at,
            pj.updated_at
        FROM processing_jobs AS pj
        LEFT JOIN videos AS v
            ON v.id::text = pj.input_payload->>'video_id'
        WHERE pj.status = 'failed'
          AND {_not_cancelled_job_condition("pj")}
        ORDER BY pj.updated_at DESC
        LIMIT $1
        OFFSET $2
        """,
        failed_limit,
        failed_offset,
    )

    steps_by_job = await _fetch_worker_steps(
        db,
        job_ids=active_job_ids + [str(row["id"]) for row in failed_rows],
        reference_now=generated_at,
    )

    active_jobs = [
        AdminWorkerJob(
            job_id=str(row["id"]),
            track=str(row["track"]),
            status=str(row["status"]),
            source=str(row["source"]) if row.get("source") else None,
            video_id=str(row["video_id"]) if row.get("video_id") else None,
            title=str(row["title"]) if row.get("title") else None,
            started_at=row.get("started_at"),
            created_at=row["created_at"],
            last_activity_at=row.get("updated_at"),
            attempts=_as_int(row.get("attempts")),
            max_attempts=_as_int(row.get("max_attempts")),
            total_duration_ms=_job_duration_ms(
                started_at=row.get("started_at"),
                created_at=row.get("created_at"),
                completed_at=row.get("completed_at"),
                updated_at=row.get("updated_at"),
                reference_now=generated_at,
            ),
            error_message=str(row["error_message"]) if row.get("error_message") else None,
            steps=steps_by_job.get(str(row["id"]), []),
        )
        for row in active_rows
    ]

    # Recent completed jobs with segment counts
    completed_rows = await db.fetch("""
        SELECT
            pj.id,
            COALESCE(
                pj.input_payload->>'source_video_id',
                pj.input_payload->'item'->>'video_id',
                pj.input_payload->>'video_id'
            )                                                       AS video_id,
            COALESCE(
                v.title,
                pj.input_payload->'source_metadata'->>'title',
                pj.input_payload->'item'->>'title',
                pj.input_payload->>'title',
                pj.input_payload->>'source_video_id'
            )                                                       AS title,
            pj.completed_at,
            pj.started_at,
            pj.created_at,
            pj.updated_at,
            COUNT(ru.id) FILTER (WHERE ru.unit_type = 'speech')     AS segment_count
        FROM processing_jobs pj
        LEFT JOIN content_sources cs
            ON cs.id = pj.source_id
        LEFT JOIN LATERAL (
            SELECT v.*
            FROM videos v
            WHERE v.source_video_id = COALESCE(
                pj.input_payload->>'source_video_id',
                pj.input_payload->'item'->>'video_id',
                pj.input_payload->>'video_id'
            )
            ORDER BY
                CASE
                    WHEN COALESCE(
                        NULLIF(BTRIM(pj.input_payload->>'source'), ''),
                        NULLIF(BTRIM(cs.source_type), ''),
                        NULLIF(BTRIM(cs.metadata->>'source_type'), ''),
                        NULLIF(BTRIM(cs.metadata->>'provider'), ''),
                        NULLIF(BTRIM(cs.metadata->>'source'), '')
                    ) IS NOT NULL
                    AND v.source = COALESCE(
                        NULLIF(BTRIM(pj.input_payload->>'source'), ''),
                        NULLIF(BTRIM(cs.source_type), ''),
                        NULLIF(BTRIM(cs.metadata->>'source_type'), ''),
                        NULLIF(BTRIM(cs.metadata->>'provider'), ''),
                        NULLIF(BTRIM(cs.metadata->>'source'), '')
                    )
                    THEN 0
                    ELSE 1
                END,
                v.updated_at DESC,
                v.created_at DESC
            LIMIT 1
        ) v
            ON TRUE
        LEFT JOIN retrieval_units ru
            ON ru.video_id = v.id
        WHERE pj.status = 'completed'
        GROUP BY pj.id, pj.input_payload, pj.completed_at, v.title
        ORDER BY pj.completed_at DESC NULLS LAST
        LIMIT 8
    """)

    recent_completed = [
        AdminWorkerCompletedJob(
            job_id=str(row["id"]),
            video_id=str(row["video_id"]) if row.get("video_id") else None,
            title=str(row["title"]) if row.get("title") else None,
            segment_count=_as_int(row["segment_count"]),
            completed_at=row.get("completed_at"),
            total_duration_ms=_job_duration_ms(
                started_at=row.get("started_at"),
                created_at=row.get("created_at"),
                completed_at=row.get("completed_at"),
                updated_at=row.get("updated_at"),
                reference_now=generated_at,
            ),
        )
        for row in completed_rows
    ]

    failed_jobs = [
        AdminWorkerJob(
            job_id=str(row["id"]),
            track=str(row["track"]),
            status=str(row["status"]),
            source=str(row["source"]) if row.get("source") else None,
            video_id=str(row["video_id"]) if row.get("video_id") else None,
            title=str(row["title"]) if row.get("title") else None,
            started_at=row.get("started_at"),
            created_at=row["created_at"],
            last_activity_at=row.get("updated_at"),
            attempts=_as_int(row.get("attempts")),
            max_attempts=_as_int(row.get("max_attempts")),
            total_duration_ms=_job_duration_ms(
                started_at=row.get("started_at"),
                created_at=row.get("created_at"),
                completed_at=row.get("completed_at"),
                updated_at=row.get("updated_at"),
                reference_now=generated_at,
            ),
            error_message=str(row["error_message"]) if row.get("error_message") else None,
            steps=steps_by_job.get(str(row["id"]), []),
        )
        for row in failed_rows
    ]

    return AdminWorkerLiveResponse(
        generated_at=generated_at,
        queue=queue,
        active_jobs=active_jobs,
        recent_completed=recent_completed,
        failed_jobs=failed_jobs,
        failed_jobs_total=failed_jobs_total,
        failed_jobs_limit=failed_limit,
        failed_jobs_offset=failed_offset,
    )


def _resolve_source_analytics_window(range_key: str) -> TimeWindow:
    """Like resolve_time_window but supports 24h, 3d, 7d, 15d, 30d."""
    now = _utc_now()
    today_start = datetime.combine(now.date(), time.min, tzinfo=UTC)
    days_map = {"24h": 1, "3d": 3, "7d": 7, "15d": 15, "30d": 30}
    days = days_map.get(range_key, 7)
    current_start = today_start - timedelta(days=days - 1)
    current_end = now
    duration = current_end - current_start
    previous_end = current_start
    previous_start = previous_end - duration
    return TimeWindow(
        range_key=range_key,
        current_start=current_start,
        current_end=current_end,
        previous_start=previous_start,
        previous_end=previous_end,
    )


async def fetch_sources_analytics(
    db: Any,
    *,
    range_key: str = "7d",
) -> AdminSourcesAnalyticsResponse:
    window = _resolve_source_analytics_window(range_key)
    not_cancelled = _not_cancelled_job_condition("pj")

    rows = await db.fetch(
        f"""
        SELECT
            cs.id::text AS source_id,
            cs.slug,
            cs.display_name,
            COUNT(pj.id) FILTER (
                WHERE pj.created_at >= $1 AND pj.created_at < $2
            ) AS jobs_created,
            COUNT(pj.id) FILTER (
                WHERE pj.status = 'completed'
                  AND pj.updated_at >= $1 AND pj.updated_at < $2
            ) AS jobs_completed,
            COUNT(pj.id) FILTER (
                WHERE pj.status = 'failed'
                  AND {not_cancelled}
                  AND pj.updated_at >= $1 AND pj.updated_at < $2
            ) AS jobs_failed,
            COUNT(pj.id) FILTER (
                WHERE pj.created_at >= $3 AND pj.created_at < $4
            ) AS prev_jobs_created,
            COUNT(pj.id) FILTER (
                WHERE pj.status = 'completed'
                  AND pj.updated_at >= $3 AND pj.updated_at < $4
            ) AS prev_jobs_completed,
            COUNT(pj.id) FILTER (
                WHERE pj.status = 'failed'
                  AND {not_cancelled}
                  AND pj.updated_at >= $3 AND pj.updated_at < $4
            ) AS prev_jobs_failed
        FROM content_sources AS cs
        LEFT JOIN processing_jobs AS pj ON pj.source_id = cs.id
        WHERE cs.is_active = TRUE
        GROUP BY cs.id, cs.slug, cs.display_name
        ORDER BY cs.display_name
        """,
        window.current_start,
        window.current_end,
        window.previous_start,
        window.previous_end,
    )

    sources = [
        AdminSourceAnalytics(
            source_id=str(row["source_id"]),
            slug=str(row["slug"]),
            display_name=str(row["display_name"]),
            jobs_created=int(row["jobs_created"]),
            jobs_completed=int(row["jobs_completed"]),
            jobs_failed=int(row["jobs_failed"]),
            prev_jobs_created=int(row["prev_jobs_created"]),
            prev_jobs_completed=int(row["prev_jobs_completed"]),
            prev_jobs_failed=int(row["prev_jobs_failed"]),
        )
        for row in rows
    ]

    return AdminSourcesAnalyticsResponse(
        generated_at=_utc_now(),
        range_key=window.range_key,
        current_start=window.current_start,
        current_end=window.current_end,
        sources=sources,
    )


async def fetch_sources_recent_videos(
    db: Any,
    *,
    limit: int = 3,
) -> AdminSourcesRecentVideosResponse:
    rows = await db.fetch(
        """
        WITH ranked AS (
            SELECT
                pj.source_id,
                cs.slug,
                pj.input_payload->>'source_item_id' AS video_id,
                COALESCE(
                    pj.input_payload->'item'->>'title',
                    pj.input_payload->>'title',
                    ''
                ) AS title,
                pj.input_payload->'item'->>'thumbnail_url' AS thumbnail_url,
                pj.input_payload->'item'->>'view_count' AS view_count,
                pj.input_payload->'item'->>'duration_seconds' AS duration_seconds,
                pj.input_payload->'item'->>'published_at' AS published_at,
                ROW_NUMBER() OVER (
                    PARTITION BY pj.source_id
                    ORDER BY pj.created_at DESC
                ) AS rn
            FROM processing_jobs AS pj
            JOIN content_sources AS cs ON cs.id = pj.source_id
            WHERE cs.is_active = TRUE
              AND cs.source_type = 'youtube'
        )
        SELECT * FROM ranked WHERE rn <= $1
        ORDER BY slug, rn
        """,
        limit,
    )

    sources_map: dict[str, AdminSourceRecentVideosEntry] = {}
    for row in rows:
        sid = str(row["source_id"])
        if sid not in sources_map:
            sources_map[sid] = AdminSourceRecentVideosEntry(
                source_id=sid,
                slug=str(row["slug"]),
            )

        view_count_raw = row["view_count"]
        duration_raw = row["duration_seconds"]

        sources_map[sid].videos.append(
            AdminSourceRecentVideo(
                video_id=str(row["video_id"] or ""),
                title=str(row["title"] or ""),
                thumbnail_url=row["thumbnail_url"],
                view_count=int(view_count_raw) if view_count_raw is not None else None,
                duration_seconds=int(float(duration_raw)) if duration_raw is not None else None,
                published_at=row["published_at"],
            )
        )

    return AdminSourcesRecentVideosResponse(
        generated_at=_utc_now(),
        sources=list(sources_map.values()),
    )


_YT_CHANNEL_ID_RE = _re.compile(r"UC[\w-]{20,}")


def _extract_channel_id_from_url(url: str) -> tuple[str | None, str | None]:
    """Extract channel ID or handle from a YouTube URL.
    Returns (channel_id, handle). At least one will be set if valid."""
    url = url.strip()
    if _YT_CHANNEL_ID_RE.fullmatch(url):
        return url, None

    try:
        from urllib.parse import urlparse
        parsed = urlparse(url if url.startswith("http") else f"https://{url}")
        if "youtube.com" not in parsed.hostname or "":
            return None, None
        parts = [p for p in parsed.path.split("/") if p]
        if not parts:
            return None, None
        if parts[0] == "channel" and len(parts) > 1:
            return parts[1], None
        if parts[0].startswith("@"):
            return None, parts[0][1:]
        if parts[0] in ("c", "user") and len(parts) > 1:
            return None, parts[1]
    except Exception:
        pass
    return None, None


async def _resolve_channel_id(handle: str) -> str | None:
    """Resolve a YouTube handle to a channel ID via the API."""
    api_key = os.getenv("YOUTUBE_API_KEY", "").strip()
    if not api_key:
        return None
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(
            "https://www.googleapis.com/youtube/v3/channels",
            params={"key": api_key, "forHandle": handle, "part": "id"},
        )
        if resp.status_code != 200:
            return None
        items = resp.json().get("items", [])
        return items[0]["id"] if items else None


async def _fetch_channel_metadata(channel_id: str) -> dict[str, Any]:
    """Fetch channel info for creating a source."""
    api_key = os.getenv("YOUTUBE_API_KEY", "").strip()
    if not api_key:
        raise ValueError("YOUTUBE_API_KEY is not configured.")

    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(
            "https://www.googleapis.com/youtube/v3/channels",
            params={
                "key": api_key,
                "id": channel_id,
                "part": "snippet,statistics,brandingSettings",
            },
        )
        resp.raise_for_status()
        data = resp.json()

    items = data.get("items", [])
    if not items:
        raise ValueError(f"YouTube channel not found: {channel_id}")

    item = items[0]
    snippet = item.get("snippet") or {}
    stats = item.get("statistics") or {}
    branding = (item.get("brandingSettings") or {}).get("channel") or {}

    thumbs = snippet.get("thumbnails") or {}
    thumb_url = None
    for key in ("high", "medium", "default"):
        t = thumbs.get(key)
        if isinstance(t, dict) and t.get("url"):
            thumb_url = t["url"]
            break

    # Parse keywords
    keywords: list[str] = []
    raw_kw = branding.get("keywords", "")
    if raw_kw:
        for m in _re.finditer(r'"([^"]+)"|(\S+)', raw_kw):
            kw = (m.group(1) or m.group(2) or "").strip()
            if kw:
                keywords.append(kw)

    title = snippet.get("title", channel_id)
    return {
        "title": title,
        "description": (snippet.get("description") or "").strip(),
        "thumbnail_url": thumb_url,
        "custom_url": snippet.get("customUrl"),
        "country": snippet.get("country"),
        "subscriber_count": int(stats["subscriberCount"]) if stats.get("subscriberCount") else None,
        "video_count": int(stats["videoCount"]) if stats.get("videoCount") else None,
        "view_count": int(stats["viewCount"]) if stats.get("viewCount") else None,
        "keywords": keywords,
    }


def _slugify(name: str) -> str:
    slug = _re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug or "channel"


async def create_source_from_url(
    db: Any,
    *,
    url: str,
) -> CreateSourceFromUrlResponse:
    """Resolve a YouTube channel URL/ID, fetch metadata, and create a source."""
    channel_id, handle = _extract_channel_id_from_url(url)

    if not channel_id and handle:
        channel_id = await _resolve_channel_id(handle)

    if not channel_id:
        raise ValueError(
            "Could not resolve channel. Please provide a channel URL "
            "(youtube.com/channel/UC... or youtube.com/@handle) or a channel ID."
        )

    # Check if already exists
    existing = await db.fetchrow(
        "SELECT id FROM content_sources WHERE config->>'channel_id' = $1",
        channel_id,
    )
    if existing:
        source = await db.fetchrow(
            """SELECT id, slug, track, source_type, display_name, base_url,
                      is_active, config, sync_cursor, metadata, created_at, updated_at
               FROM content_sources WHERE id = $1""",
            existing["id"],
        )
        return CreateSourceFromUrlResponse(
            ok=True,
            source=_serialize_admin_source(source),
            already_exists=True,
        )

    # Fetch channel metadata from YouTube
    meta = await _fetch_channel_metadata(channel_id)
    slug = _slugify(meta["title"])
    display_name = meta["title"]

    # Ensure unique slug
    slug_exists = await db.fetchval(
        "SELECT 1 FROM content_sources WHERE slug = $1", slug
    )
    if slug_exists:
        slug = f"{slug}-{channel_id[-6:].lower()}"

    config = json.dumps({"channel_id": channel_id, "max_results": 30})
    metadata = json.dumps({
        "thumbnail_url": meta["thumbnail_url"],
        "description": meta["description"],
        "custom_url": meta["custom_url"],
        "country": meta["country"],
        "subscriber_count": meta["subscriber_count"],
        "video_count": meta["video_count"],
        "view_count": meta["view_count"],
        "keywords": meta["keywords"],
    })

    row = await db.fetchrow(
        """
        INSERT INTO content_sources (
            id, slug, track, source_type, display_name,
            is_active, config, sync_cursor, metadata
        )
        VALUES (gen_random_uuid(), $1, 'unified', 'youtube', $2,
                TRUE, $3::jsonb, NULL, $4::jsonb)
        RETURNING id, slug, track, source_type, display_name, base_url,
                  is_active, config, sync_cursor, metadata, created_at, updated_at
        """,
        slug,
        display_name,
        config,
        metadata,
    )

    return CreateSourceFromUrlResponse(
        ok=True,
        source=_serialize_admin_source(row),
        already_exists=False,
    )


async def trigger_youtube_search(
    db: Any,
    *,
    query: str,
    max_results: int = 20,
    min_view_count: int = 5000,
    min_duration_seconds: int = 180,
) -> TriggerSearchResponse:
    """Run an ad-hoc YouTube search and create processing jobs for results."""
    api_key = os.getenv("YOUTUBE_API_KEY", "").strip()
    if not api_key:
        raise ValueError("YOUTUBE_API_KEY is not configured.")

    # Search YouTube
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(
            "https://www.googleapis.com/youtube/v3/search",
            params={
                "key": api_key,
                "q": query,
                "type": "video",
                "part": "snippet",
                "maxResults": min(max_results, 50),
                "order": "relevance",
                "relevanceLanguage": "en",
            },
        )
        resp.raise_for_status()
        search_data = resp.json()

    video_ids = [
        item["id"]["videoId"]
        for item in search_data.get("items", [])
        if isinstance(item.get("id"), dict) and item["id"].get("videoId")
    ]

    if not video_ids:
        return TriggerSearchResponse(ok=True, jobs_created=0, videos_found=0, videos_filtered=0)

    # Fetch full metadata
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(
            "https://www.googleapis.com/youtube/v3/videos",
            params={
                "key": api_key,
                "id": ",".join(video_ids),
                "part": "snippet,contentDetails,statistics",
            },
        )
        resp.raise_for_status()
        videos_data = resp.json()

    videos_found = len(videos_data.get("items", []))
    jobs_created = 0
    videos_filtered = 0

    for item in videos_data.get("items", []):
        vid = item.get("id", "")
        snippet = item.get("snippet") or {}
        stats = item.get("statistics") or {}
        content = item.get("contentDetails") or {}

        # Parse duration
        duration = 0
        dur_match = _re.fullmatch(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", content.get("duration", ""))
        if dur_match:
            h, m, s = (int(v or 0) for v in dur_match.groups())
            duration = h * 3600 + m * 60 + s

        views = int(stats.get("viewCount", 0) or 0)
        live = (snippet.get("liveBroadcastContent") or "none").lower()

        # Filter
        if duration < min_duration_seconds or live != "none" or views < min_view_count:
            videos_filtered += 1
            continue

        # Check duplicate
        exists = await db.fetchval(
            """SELECT 1 FROM processing_jobs
               WHERE input_payload->>'source_video_id' = $1 LIMIT 1""",
            vid,
        )
        if exists:
            continue

        # Pick thumbnail
        thumbs = snippet.get("thumbnails") or {}
        thumb_url = None
        for key in ("maxres", "standard", "high", "medium", "default"):
            t = thumbs.get(key)
            if isinstance(t, dict) and t.get("url"):
                thumb_url = t["url"]
                break

        meta = {
            "source": "youtube",
            "source_video_id": vid,
            "video_id": vid,
            "source_url": f"https://www.youtube.com/watch?v={vid}",
            "video_url": f"https://www.youtube.com/watch?v={vid}",
            "thumbnail_url": thumb_url,
            "title": snippet.get("title", ""),
            "description": snippet.get("description", ""),
            "channel_title": snippet.get("channelTitle"),
            "channel_id": snippet.get("channelId"),
            "published_at": snippet.get("publishedAt"),
            "duration_seconds": duration,
            "view_count": views,
        }

        payload = json.dumps({
            "track": "unified",
            "discovery_track": "unified",
            "source_slug": "manual-search",
            "source_type": "youtube_search",
            "source_item_id": vid,
            "source": "youtube",
            "source_video_id": vid,
            "url": meta["video_url"],
            "owner_id": None,
            "item": meta,
            "source_metadata": meta,
            "manual_search": True,
            "search_query": query,
        }, default=str)

        await db.execute(
            """INSERT INTO processing_jobs (track, source_id, job_type, status, input_payload)
               VALUES ('unified', NULL, 'index_video', 'pending', $1::jsonb)""",
            payload,
        )
        jobs_created += 1

    return TriggerSearchResponse(
        ok=True,
        jobs_created=jobs_created,
        videos_found=videos_found,
        videos_filtered=videos_filtered,
    )


_YT_VIDEO_ID_RE = _re.compile(
    r"(?:youtube\.com/watch\?.*v=|youtu\.be/|youtube\.com/embed/|youtube\.com/shorts/)"
    r"([A-Za-z0-9_-]{11})"
)


def _extract_youtube_video_id(url: str) -> str | None:
    """Extract video ID from various YouTube URL formats."""
    url = url.strip()
    if _re.fullmatch(r"[A-Za-z0-9_-]{11}", url):
        return url
    match = _YT_VIDEO_ID_RE.search(url)
    return match.group(1) if match else None


async def _fetch_youtube_video_metadata(video_id: str) -> dict[str, Any]:
    """Fetch video metadata from YouTube Data API v3."""
    api_key = os.getenv("YOUTUBE_API_KEY", "").strip()
    if not api_key:
        raise ValueError("YOUTUBE_API_KEY is not configured.")

    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(
            "https://www.googleapis.com/youtube/v3/videos",
            params={
                "key": api_key,
                "id": video_id,
                "part": "snippet,contentDetails,statistics",
            },
        )
        resp.raise_for_status()
        data = resp.json()

    items = data.get("items", [])
    if not items:
        raise ValueError(f"YouTube video not found: {video_id}")

    item = items[0]
    snippet = item.get("snippet") or {}
    stats = item.get("statistics") or {}
    content = item.get("contentDetails") or {}

    # Parse duration
    duration_seconds = 0
    raw_dur = content.get("duration", "")
    dur_match = _re.fullmatch(
        r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", raw_dur
    )
    if dur_match:
        h, m, s = (int(v or 0) for v in dur_match.groups())
        duration_seconds = h * 3600 + m * 60 + s

    # Pick best thumbnail
    thumbs = snippet.get("thumbnails") or {}
    thumbnail_url = None
    for key in ("maxres", "standard", "high", "medium", "default"):
        t = thumbs.get(key)
        if isinstance(t, dict) and t.get("url"):
            thumbnail_url = t["url"]
            break

    return {
        "source": "youtube",
        "source_video_id": video_id,
        "video_id": video_id,
        "source_url": f"https://www.youtube.com/watch?v={video_id}",
        "video_url": f"https://www.youtube.com/watch?v={video_id}",
        "thumbnail_url": thumbnail_url,
        "title": snippet.get("title", ""),
        "description": snippet.get("description", ""),
        "channel_title": snippet.get("channelTitle"),
        "channel_id": snippet.get("channelId"),
        "published_at": snippet.get("publishedAt"),
        "duration_seconds": duration_seconds,
        "view_count": int(stats["viewCount"]) if stats.get("viewCount") else None,
        "like_count": int(stats["likeCount"]) if stats.get("likeCount") else None,
    }


async def submit_video(db: Any, *, url: str) -> SubmitVideoResponse:
    """Submit a YouTube video URL for indexing. Creates a processing job."""
    video_id = _extract_youtube_video_id(url)
    if not video_id:
        raise ValueError(
            "Invalid YouTube URL. Supported formats: "
            "youtube.com/watch?v=..., youtu.be/..., or a bare video ID."
        )

    # Check if job already exists
    existing = await db.fetchrow(
        """
        SELECT id::text AS job_id, status
        FROM processing_jobs
        WHERE input_payload->>'source_video_id' = $1
        ORDER BY created_at DESC
        LIMIT 1
        """,
        video_id,
    )

    # Fetch metadata from YouTube
    meta = await _fetch_youtube_video_metadata(video_id)

    if existing:
        return SubmitVideoResponse(
            ok=True,
            job_id=existing["job_id"],
            video_id=video_id,
            title=meta.get("title", ""),
            thumbnail_url=meta.get("thumbnail_url"),
            duration_seconds=meta.get("duration_seconds"),
            channel_title=meta.get("channel_title"),
            already_exists=True,
        )

    # Create processing job
    payload = json.dumps({
        "track": "unified",
        "discovery_track": "unified",
        "source_slug": "manual",
        "source_type": "youtube",
        "source_item_id": video_id,
        "source": "youtube",
        "source_video_id": video_id,
        "url": meta["video_url"],
        "owner_id": None,
        "item": meta,
        "source_metadata": meta,
        "manual_submit": True,
    }, default=str)

    job_id = await db.fetchval(
        """
        INSERT INTO processing_jobs (track, source_id, job_type, status, input_payload)
        VALUES ('unified', NULL, 'index_video', 'pending', $1::jsonb)
        RETURNING id::text
        """,
        payload,
    )

    return SubmitVideoResponse(
        ok=True,
        job_id=job_id,
        video_id=video_id,
        title=meta.get("title", ""),
        thumbnail_url=meta.get("thumbnail_url"),
        duration_seconds=meta.get("duration_seconds"),
        channel_title=meta.get("channel_title"),
        already_exists=False,
    )


async def get_video_job_status(
    db: Any,
    *,
    video_id: str,
) -> list[AdminVideoJobStatus]:
    """Get processing job status for a video ID."""
    rows = await db.fetch(
        """
        SELECT
            id::text AS job_id,
            COALESCE(
                input_payload->>'source_video_id',
                input_payload->>'video_id'
            ) AS video_id,
            COALESCE(
                input_payload->'item'->>'title',
                input_payload->>'title'
            ) AS title,
            status,
            created_at,
            started_at,
            completed_at,
            error_message,
            attempts
        FROM processing_jobs
        WHERE input_payload->>'source_video_id' = $1
           OR input_payload->>'video_id' = $1
        ORDER BY created_at DESC
        LIMIT 5
        """,
        video_id,
    )

    return [
        AdminVideoJobStatus(
            job_id=str(row["job_id"]),
            video_id=str(row["video_id"] or video_id),
            title=row["title"],
            status=str(row["status"]),
            created_at=row["created_at"],
            started_at=row.get("started_at"),
            completed_at=row.get("completed_at"),
            error_message=row.get("error_message"),
            attempts=int(row.get("attempts") or 0),
        )
        for row in rows
    ]


async def sync_source(db: Any, *, source_id: str) -> SyncSourceResponse:
    """Manually trigger discovery + job creation for a single source."""
    row = await db.fetchrow(
        """SELECT id, slug, track, source_type, config, sync_cursor, metadata
           FROM content_sources WHERE id = $1""",
        source_id,
    )
    if not row:
        raise ValueError("Source not found.")

    raw_config = _coerce_json_value(row.get("config"))
    config = raw_config if isinstance(raw_config, dict) else {}
    slug = str(row["slug"])
    source_type = str(row.get("source_type") or "")

    if source_type != "youtube":
        raise ValueError(f"Manual sync only supported for YouTube sources (got {source_type}).")

    channel_id = config.get("channel_id")
    if not channel_id:
        raise ValueError("Source is missing channel_id in config.")

    max_results = int(config.get("max_results", 30))

    api_key = os.getenv("YOUTUBE_API_KEY", "").strip()
    if not api_key:
        raise ValueError("YOUTUBE_API_KEY is not configured.")

    # Step 1: Search channel videos
    all_video_ids: list[str] = []
    next_page: str | None = None
    while len(all_video_ids) < max_results:
        remaining = max_results - len(all_video_ids)
        params: dict[str, Any] = {
            "key": api_key,
            "channelId": channel_id,
            "type": "video",
            "part": "snippet",
            "order": "date",
            "maxResults": min(remaining, 50),
        }
        if next_page:
            params["pageToken"] = next_page

        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(
                "https://www.googleapis.com/youtube/v3/search", params=params,
            )
            resp.raise_for_status()
            data = resp.json()

        for item in data.get("items", []):
            vid = (item.get("id") or {}).get("videoId")
            if vid and vid not in all_video_ids:
                all_video_ids.append(vid)

        next_page = data.get("nextPageToken")
        if not next_page:
            break

    if not all_video_ids:
        return SyncSourceResponse(
            ok=True, source_id=source_id, slug=slug,
            videos_discovered=0, jobs_created=0, skipped=0,
        )

    # Step 2: Fetch full metadata
    videos_meta: list[dict[str, Any]] = []
    for i in range(0, len(all_video_ids), 50):
        batch = all_video_ids[i:i + 50]
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(
                "https://www.googleapis.com/youtube/v3/videos",
                params={
                    "key": api_key, "id": ",".join(batch),
                    "part": "snippet,contentDetails,statistics",
                },
            )
            resp.raise_for_status()
            vdata = resp.json()

        for item in vdata.get("items", []):
            vid = item.get("id", "")
            snippet = item.get("snippet") or {}
            stats = item.get("statistics") or {}
            content = item.get("contentDetails") or {}

            duration = 0
            dur_match = _re.fullmatch(
                r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?",
                content.get("duration", ""),
            )
            if dur_match:
                h, m, s = (int(v or 0) for v in dur_match.groups())
                duration = h * 3600 + m * 60 + s

            thumbs = snippet.get("thumbnails") or {}
            thumb = None
            for key in ("maxres", "standard", "high", "medium", "default"):
                t = thumbs.get(key)
                if isinstance(t, dict) and t.get("url"):
                    thumb = t["url"]
                    break

            videos_meta.append({
                "source": "youtube", "source_video_id": vid, "video_id": vid,
                "source_url": f"https://www.youtube.com/watch?v={vid}",
                "video_url": f"https://www.youtube.com/watch?v={vid}",
                "thumbnail_url": thumb,
                "title": snippet.get("title", ""),
                "description": snippet.get("description", ""),
                "channel_title": snippet.get("channelTitle"),
                "channel_id": snippet.get("channelId"),
                "published_at": snippet.get("publishedAt"),
                "duration_seconds": duration,
                "view_count": int(stats["viewCount"]) if stats.get("viewCount") else None,
                "like_count": int(stats["likeCount"]) if stats.get("likeCount") else None,
            })

    # Step 3: Create jobs, skip duplicates
    jobs_created = 0
    skipped = 0
    for meta in videos_meta:
        vid = meta["source_video_id"]
        exists = await db.fetchval(
            """SELECT 1 FROM processing_jobs
               WHERE source_id = $1 AND input_payload->>'source_item_id' = $2 LIMIT 1""",
            source_id, vid,
        )
        if exists:
            skipped += 1
            continue

        payload = json.dumps({
            "track": "unified", "discovery_track": "unified",
            "source_slug": slug, "source_type": "youtube",
            "source_item_id": vid, "source": "youtube",
            "source_video_id": vid, "url": meta["video_url"],
            "owner_id": None, "item": meta, "source_metadata": meta,
        }, default=str)

        await db.execute(
            """INSERT INTO processing_jobs (track, source_id, job_type, status, input_payload)
               VALUES ('unified', $1, 'index_video', 'pending', $2::jsonb)""",
            source_id, payload,
        )
        jobs_created += 1

    # Step 4: Update sync cursor
    if videos_meta:
        latest = max(
            (m.get("published_at") or "" for m in videos_meta), default=None,
        )
        if latest:
            await db.execute(
                "UPDATE content_sources SET sync_cursor = $1 WHERE id = $2",
                latest, source_id,
            )

    return SyncSourceResponse(
        ok=True, source_id=source_id, slug=slug,
        videos_discovered=len(videos_meta), jobs_created=jobs_created, skipped=skipped,
    )
