from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from typing import Any

from .models import (
    AdminActiveUser,
    AdminContentSummaryResponse,
    AdminFailedJob,
    AdminFailedStep,
    AdminIngestionMetrics,
    AdminIngestionSummaryResponse,
    AdminInventoryMetrics,
    AdminJobStatusCounts,
    AdminLatencyMetrics,
    AdminMetricTarget,
    AdminMetricTargetUpsert,
    AdminMetricValue,
    AdminNamedCount,
    AdminNotice,
    AdminOverviewMetrics,
    AdminRecentUser,
    AdminRequestsMetrics,
    AdminRequestsSummaryResponse,
    AdminSourceFreshness,
    AdminSourceGrowth,
    AdminSourceHealth,
    AdminSummaryPoint,
    AdminSummaryResponse,
    AdminTargetsResponse,
    AdminUsersMetrics,
    AdminUsersSummaryResponse,
    AdminWindow,
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
                    FROM broll_assets
                    WHERE created_at >= $1
                      AND created_at < $2
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
                    FROM broll_assets
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
                    FROM knowledge_videos
                    WHERE created_at >= $1
                      AND created_at < $2
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
                    FROM knowledge_videos
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
                    FROM knowledge_segments
                    WHERE created_at >= $1
                      AND created_at < $2
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
                    FROM knowledge_segments AS ks
                    JOIN knowledge_videos AS kv
                      ON kv.id = ks.video_id
                    WHERE ks.created_at >= $1
                      AND ks.created_at < $2
                      AND LOWER(kv.source) = $3
                    """,
                    window.current_start,
                    window.current_end,
                    normalized_scope_key,
                )
            )
        return None

    if metric_name in {"jobs_completed", "jobs_failed"}:
        job_status = "completed" if metric_name == "jobs_completed" else "failed"
        if normalized_scope_type == "global":
            return _as_float(
                await db.fetchval(
                    """
                    SELECT COUNT(*)
                    FROM processing_jobs
                    WHERE status = $1
                      AND updated_at >= $2
                      AND updated_at < $3
                    """,
                    job_status,
                    window.current_start,
                    window.current_end,
                )
            )
        if normalized_scope_type == "track":
            return _as_float(
                await db.fetchval(
                    """
                    SELECT COUNT(*)
                    FROM processing_jobs
                    WHERE status = $1
                      AND updated_at >= $2
                      AND updated_at < $3
                      AND track = $4
                    """,
                    job_status,
                    window.current_start,
                    window.current_end,
                    normalized_scope_key,
                )
            )
        if normalized_scope_type == "source":
            return _as_float(
                await db.fetchval(
                    """
                    SELECT COUNT(*)
                    FROM processing_jobs AS pj
                    LEFT JOIN content_sources AS cs
                      ON cs.id = pj.source_id
                    WHERE pj.status = $1
                      AND pj.updated_at >= $2
                      AND pj.updated_at < $3
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
        """
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
            (SELECT COUNT(*) FROM broll_assets) AS indexed_assets_current,
            (SELECT COUNT(*) FROM broll_assets WHERE created_at < $3) AS indexed_assets_previous,
            (SELECT COUNT(*) FROM knowledge_segments) AS indexed_segments_current,
            (SELECT COUNT(*) FROM knowledge_segments WHERE created_at < $3) AS indexed_segments_previous,
            (SELECT COUNT(*) FROM processing_jobs WHERE status IN ('pending', 'running', 'retrying')) AS pending_jobs_current,
            (SELECT COUNT(*) FROM processing_jobs
              WHERE status IN ('pending', 'running', 'retrying')
                AND updated_at < $3) AS pending_jobs_previous,
            (SELECT COUNT(*) FROM processing_jobs WHERE status = 'failed' AND updated_at >= $1 AND updated_at < $2) AS failed_jobs_current,
            (SELECT COUNT(*) FROM processing_jobs WHERE status = 'failed' AND updated_at >= $3 AND updated_at < $4) AS failed_jobs_previous
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
        """
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
            FROM broll_assets
            WHERE created_at >= $3
              AND created_at < $4
            GROUP BY DATE(created_at)
        ),
        knowledge_video_growth AS (
            SELECT DATE(created_at) AS bucket_date, COUNT(*) AS additions
            FROM knowledge_videos
            WHERE created_at >= $3
              AND created_at < $4
            GROUP BY DATE(created_at)
        ),
        knowledge_segment_growth AS (
            SELECT DATE(created_at) AS bucket_date, COUNT(*) AS additions
            FROM knowledge_segments
            WHERE created_at >= $3
              AND created_at < $4
            GROUP BY DATE(created_at)
        ),
        job_stats AS (
            SELECT
                DATE(updated_at) AS bucket_date,
                COUNT(*) FILTER (WHERE status = 'completed') AS jobs_completed,
                COUNT(*) FILTER (WHERE status = 'failed') AS jobs_failed
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
    search_type_rows = await db.fetch(
        """
        SELECT search_type AS key, search_type AS label, COUNT(*) AS count
        FROM usage_events
        WHERE occurred_at >= $1
          AND occurred_at < $2
        GROUP BY search_type
        ORDER BY count DESC, search_type ASC
        """,
        window.current_start,
        window.current_end,
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
        search_type_mix=[
            AdminNamedCount(
                key=str(row["key"]),
                label=str(row["label"]).title(),
                count=_as_int(row["count"]),
            )
            for row in search_type_rows
        ],
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
            (SELECT COUNT(*) FROM broll_assets) AS broll_assets_total_current,
            (SELECT COUNT(*) FROM broll_assets WHERE created_at < $3) AS broll_assets_total_previous,
            (SELECT COUNT(*) FROM knowledge_videos) AS knowledge_videos_total_current,
            (SELECT COUNT(*) FROM knowledge_videos WHERE created_at < $3) AS knowledge_videos_total_previous,
            (SELECT COUNT(*) FROM knowledge_segments) AS knowledge_segments_total_current,
            (SELECT COUNT(*) FROM knowledge_segments WHERE created_at < $3) AS knowledge_segments_total_previous,
            (SELECT COUNT(*) FROM content_sources WHERE is_active = TRUE) AS active_sources_total_current,
            (SELECT COUNT(*) FROM content_sources WHERE is_active = TRUE AND created_at < $3) AS active_sources_total_previous,
            (SELECT COUNT(*) FROM broll_assets WHERE created_at >= $1 AND created_at < $2) AS broll_assets_added_current,
            (SELECT COUNT(*) FROM broll_assets WHERE created_at >= $3 AND created_at < $4) AS broll_assets_added_previous,
            (SELECT COUNT(*) FROM knowledge_videos WHERE created_at >= $1 AND created_at < $2) AS knowledge_videos_added_current,
            (SELECT COUNT(*) FROM knowledge_videos WHERE created_at >= $3 AND created_at < $4) AS knowledge_videos_added_previous,
            (SELECT COUNT(*) FROM knowledge_segments WHERE created_at >= $1 AND created_at < $2) AS knowledge_segments_added_current,
            (SELECT COUNT(*) FROM knowledge_segments WHERE created_at >= $3 AND created_at < $4) AS knowledge_segments_added_previous
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
            FROM broll_assets
            WHERE created_at >= $1
              AND created_at < $2
            GROUP BY source
            UNION ALL
            SELECT 'knowledge'::text AS track, source AS source_key, COUNT(*) AS additions
            FROM knowledge_videos
            WHERE created_at >= $1
              AND created_at < $2
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
        """
        SELECT
            (SELECT COUNT(*) FROM processing_jobs WHERE created_at >= $1 AND created_at < $2) AS jobs_created_current,
            (SELECT COUNT(*) FROM processing_jobs WHERE created_at >= $3 AND created_at < $4) AS jobs_created_previous,
            (SELECT COUNT(*) FROM processing_jobs WHERE status = 'completed' AND updated_at >= $1 AND updated_at < $2) AS jobs_completed_current,
            (SELECT COUNT(*) FROM processing_jobs WHERE status = 'completed' AND updated_at >= $3 AND updated_at < $4) AS jobs_completed_previous,
            (SELECT COUNT(*) FROM processing_jobs WHERE status = 'failed' AND updated_at >= $1 AND updated_at < $2) AS jobs_failed_current,
            (SELECT COUNT(*) FROM processing_jobs WHERE status = 'failed' AND updated_at >= $3 AND updated_at < $4) AS jobs_failed_previous,
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
        """
        SELECT
            COUNT(*) FILTER (WHERE status = 'pending') AS pending,
            COUNT(*) FILTER (WHERE status = 'running') AS running,
            COUNT(*) FILTER (WHERE status = 'retrying') AS retrying,
            COUNT(*) FILTER (WHERE status = 'completed') AS completed,
            COUNT(*) FILTER (WHERE status = 'failed') AS failed
        FROM processing_jobs
        """
    )
    source_rows = await db.fetch(
        """
        SELECT
            cs.id::text AS source_id,
            cs.slug,
            cs.display_name,
            cs.track,
            cs.is_active,
            COUNT(pj.id) FILTER (WHERE pj.created_at >= $1 AND pj.created_at < $2) AS jobs_created,
            COUNT(pj.id) FILTER (WHERE pj.status = 'completed' AND pj.updated_at >= $1 AND pj.updated_at < $2) AS jobs_completed,
            COUNT(pj.id) FILTER (WHERE pj.status = 'failed' AND pj.updated_at >= $1 AND pj.updated_at < $2) AS jobs_failed,
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
        """
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
          AND updated_at >= $1
          AND updated_at < $2
        ORDER BY updated_at DESC
        LIMIT 10
        """,
        window.current_start,
        window.current_end,
    )
    failed_step_rows = await db.fetch(
        """
        SELECT
            step_name,
            COUNT(*) AS failure_count,
            MAX(updated_at) AS last_failed_at
        FROM processing_job_steps
        WHERE status = 'failed'
          AND updated_at >= $1
          AND updated_at < $2
        GROUP BY step_name
        ORDER BY failure_count DESC, step_name ASC
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
