import type { DatabaseClient } from "../db/client";

const ALLOWED_TARGET_METRICS = new Set([
  "new_users",
  "active_users",
  "requests_total",
  "credits_used",
  "broll_assets_added",
  "knowledge_videos_added",
  "knowledge_segments_added",
  "jobs_completed",
  "jobs_failed"
]);

const TARGET_SCOPE_RULES: Record<string, Set<string>> = {
  new_users: new Set(["global"]),
  active_users: new Set(["global", "track"]),
  requests_total: new Set(["global", "track"]),
  credits_used: new Set(["global", "track"]),
  broll_assets_added: new Set(["global", "track", "source"]),
  knowledge_videos_added: new Set(["global", "track", "source"]),
  knowledge_segments_added: new Set(["global", "track", "source"]),
  jobs_completed: new Set(["global", "track", "source"]),
  jobs_failed: new Set(["global", "track", "source"])
};

const TRACK_SCOPE_KEYS: Record<string, Set<string>> = {
  active_users: new Set(["broll", "knowledge"]),
  requests_total: new Set(["broll", "knowledge"]),
  credits_used: new Set(["broll", "knowledge"]),
  broll_assets_added: new Set(["broll"]),
  knowledge_videos_added: new Set(["knowledge"]),
  knowledge_segments_added: new Set(["knowledge"]),
  jobs_completed: new Set(["broll", "knowledge"]),
  jobs_failed: new Set(["broll", "knowledge"])
};

interface TimeWindow {
  range_key: string;
  current_start: Date;
  current_end: Date;
  previous_start: Date;
  previous_end: Date;
}

function utcNow(): Date {
  return new Date();
}

function todayStart(reference: Date): Date {
  return new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), reference.getUTCDate()));
}

function addDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}

function asFloat(value: unknown): number {
  return value == null ? 0 : Number(value);
}

function asInt(value: unknown): number {
  return value == null ? 0 : Math.trunc(Number(value));
}

function notCancelledJobCondition(alias?: string): string {
  const prefix = alias ? `${alias}.` : "";
  return `COALESCE((${prefix}input_payload->>'cancelled_by_user')::boolean, FALSE) = FALSE`;
}

function resolveTimeWindow(rangeKey: string): TimeWindow {
  const now = utcNow();
  const start = todayStart(now);
  let normalizedRangeKey = rangeKey;
  let currentStart = start;

  if (rangeKey === "today") {
    currentStart = start;
  } else if (rangeKey === "30d") {
    currentStart = addDays(start, -29);
  } else {
    normalizedRangeKey = "7d";
    currentStart = addDays(start, -6);
  }

  const currentEnd = now;
  const duration = currentEnd.getTime() - currentStart.getTime();
  const previousEnd = currentStart;
  const previousStart = new Date(previousEnd.getTime() - duration);

  return {
    range_key: normalizedRangeKey,
    current_start: currentStart,
    current_end: currentEnd,
    previous_start: previousStart,
    previous_end: previousEnd
  };
}

function serializeWindow(window: TimeWindow): Record<string, unknown> {
  return {
    range_key: window.range_key,
    current_start: window.current_start,
    current_end: window.current_end,
    previous_start: window.previous_start,
    previous_end: window.previous_end
  };
}

function normalizeTargetScope(scopeType?: string | null, scopeKey?: string | null): [string, string] {
  const normalizedScopeType = String(scopeType ?? "global").trim().toLowerCase() || "global";
  const normalizedScopeKey = String(scopeKey ?? "").trim().toLowerCase();
  if (normalizedScopeType === "global") {
    return ["global", ""];
  }
  return [normalizedScopeType, normalizedScopeKey];
}

function validateTargetScope(metricName: string, scopeType: string, scopeKey: string): void {
  const allowedScopes = TARGET_SCOPE_RULES[metricName] ?? new Set(["global"]);
  if (!allowedScopes.has(scopeType)) {
    throw new Error(`Metric '${metricName}' does not support '${scopeType}' scope.`);
  }

  if (scopeType === "global") {
    if (scopeKey) {
      throw new Error("Global admin targets cannot include a scope key.");
    }
    return;
  }

  if (!scopeKey) {
    throw new Error(`Metric '${metricName}' requires a scope key for '${scopeType}' scope.`);
  }

  if (scopeType === "track") {
    const allowedTrackKeys = TRACK_SCOPE_KEYS[metricName] ?? new Set<string>();
    if (!allowedTrackKeys.has(scopeKey)) {
      const expected = [...allowedTrackKeys].sort().join(", ");
      throw new Error(`Metric '${metricName}' expects one of [${expected}] for track scope.`);
    }
  }
}

function deltaRatio(current: number, previous: number): number | null {
  if (previous === 0) {
    return null;
  }
  return (current - previous) / previous;
}

function buildMetric(input: {
  current: number;
  previous: number;
  target?: number | null;
  comparisonMode?: string | null;
}): Record<string, unknown> {
  const current = Number(input.current);
  const previous = Number(input.previous);
  let targetGap: number | null = null;
  let attainmentRatio: number | null = null;

  if (input.target != null) {
    if (input.comparisonMode === "at_most") {
      targetGap = input.target - current;
      attainmentRatio = current <= 0 ? 1 : input.target / current;
    } else {
      targetGap = current - input.target;
      attainmentRatio = input.target > 0 ? current / input.target : null;
    }
  }

  return {
    current,
    previous,
    delta: current - previous,
    delta_ratio: deltaRatio(current, previous),
    target: input.target ?? null,
    target_gap: targetGap,
    attainment_ratio: attainmentRatio,
    comparison_mode: input.comparisonMode === "at_least" || input.comparisonMode === "at_most" ? input.comparisonMode : null
  };
}

function lookupTarget(
  targets: Map<string, Record<string, unknown>>,
  metricName: string,
  scopeType = "global",
  scopeKey = ""
): [number | null, string | null] {
  const payload = targets.get(`${metricName}:${scopeType}:${scopeKey}`);
  if (!payload) {
    return [null, null];
  }
  return [asFloat(payload.target_value), String(payload.comparison_mode ?? "at_least")];
}

async function fetchTargetRows(db: DatabaseClient, rangeKey: string): Promise<Record<string, unknown>[]> {
  return db.fetch(
    `
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
    `,
    rangeKey
  );
}

async function fetchTargetMap(db: DatabaseClient, rangeKey: string): Promise<Map<string, Record<string, unknown>>> {
  const rows = await fetchTargetRows(db, rangeKey);
  return new Map(
    rows.map((row) => [
      `${String(row.metric_name)}:${String(row.scope_type ?? "global")}:${String(row.scope_key ?? "")}`,
      row
    ])
  );
}

export async function upsertTargets(db: DatabaseClient, targets: Array<Record<string, unknown>>): Promise<Record<string, unknown>[]> {
  const savedRows: Record<string, unknown>[] = [];
  await db.transaction(async (tx) => {
    for (const target of targets) {
      const metricName = String(target.metric_name ?? "").trim();
      if (!ALLOWED_TARGET_METRICS.has(metricName)) {
        throw new Error(`Unsupported target metric: ${metricName}`);
      }
      const [scopeType, scopeKey] = normalizeTargetScope(
        String(target.scope_type ?? "global"),
        String(target.scope_key ?? "")
      );
      validateTargetScope(metricName, scopeType, scopeKey);
      const row = await tx.fetchrow(
        `
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
        `,
        metricName,
        scopeType,
        scopeKey,
        String(target.range_key ?? "7d"),
        String(target.comparison_mode ?? "at_least"),
        Number(target.target_value ?? 0),
        target.note == null ? null : String(target.note)
      );
      if (row) {
        savedRows.push(row);
      }
    }
  });
  return savedRows;
}

export async function deleteTarget(db: DatabaseClient, targetId: string): Promise<boolean> {
  const row = await db.fetchrow(
    `
      DELETE FROM admin_metric_targets
      WHERE id = $1::uuid
      RETURNING id
    `,
    targetId
  );
  return row != null;
}

async function fetchTargetActual(
  db: DatabaseClient,
  window: TimeWindow,
  metricName: string,
  scopeType: string,
  scopeKey: string
): Promise<number | null> {
  const [normalizedScopeType, normalizedScopeKey] = normalizeTargetScope(scopeType, scopeKey);

  try {
    validateTargetScope(metricName, normalizedScopeType, normalizedScopeKey);
  } catch {
    return null;
  }

  if (metricName === "new_users") {
    if (normalizedScopeType !== "global") {
      return null;
    }
    return asFloat(
      await db.fetchval(
        `
          SELECT COUNT(*)
          FROM user_profiles
          WHERE created_at >= $1
            AND created_at < $2
        `,
        window.current_start,
        window.current_end
      )
    );
  }

  if (metricName === "active_users") {
    if (normalizedScopeType === "global") {
      return asFloat(
        await db.fetchval(
          `
            SELECT COUNT(DISTINCT user_id)
            FROM usage_events
            WHERE occurred_at >= $1
              AND occurred_at < $2
          `,
          window.current_start,
          window.current_end
        )
      );
    }
    if (normalizedScopeType === "track") {
      return asFloat(
        await db.fetchval(
          `
            SELECT COUNT(DISTINCT user_id)
            FROM usage_events
            WHERE occurred_at >= $1
              AND occurred_at < $2
              AND search_type = $3
          `,
          window.current_start,
          window.current_end,
          normalizedScopeKey
        )
      );
    }
    return null;
  }

  if (metricName === "requests_total") {
    if (normalizedScopeType === "global") {
      return asFloat(
        await db.fetchval(
          `
            SELECT COUNT(*)
            FROM usage_events
            WHERE occurred_at >= $1
              AND occurred_at < $2
          `,
          window.current_start,
          window.current_end
        )
      );
    }
    if (normalizedScopeType === "track") {
      return asFloat(
        await db.fetchval(
          `
            SELECT COUNT(*)
            FROM usage_events
            WHERE occurred_at >= $1
              AND occurred_at < $2
              AND search_type = $3
          `,
          window.current_start,
          window.current_end,
          normalizedScopeKey
        )
      );
    }
    return null;
  }

  if (metricName === "credits_used") {
    if (normalizedScopeType === "global") {
      return asFloat(
        await db.fetchval(
          `
            SELECT COALESCE(SUM(credits_used), 0)
            FROM usage_events
            WHERE occurred_at >= $1
              AND occurred_at < $2
          `,
          window.current_start,
          window.current_end
        )
      );
    }
    if (normalizedScopeType === "track") {
      return asFloat(
        await db.fetchval(
          `
            SELECT COALESCE(SUM(credits_used), 0)
            FROM usage_events
            WHERE occurred_at >= $1
              AND occurred_at < $2
              AND search_type = $3
          `,
          window.current_start,
          window.current_end,
          normalizedScopeKey
        )
      );
    }
    return null;
  }

  if (metricName === "broll_assets_added") {
    if (normalizedScopeType === "global" || normalizedScopeType === "track") {
      return asFloat(
        await db.fetchval(
          `
            SELECT COUNT(*)
            FROM videos
            WHERE created_at >= $1
              AND created_at < $2
              AND source <> 'youtube'
          `,
          window.current_start,
          window.current_end
        )
      );
    }
    if (normalizedScopeType === "source") {
      return asFloat(
        await db.fetchval(
          `
            SELECT COUNT(*)
            FROM videos
            WHERE created_at >= $1
              AND created_at < $2
              AND LOWER(source) = $3
          `,
          window.current_start,
          window.current_end,
          normalizedScopeKey
        )
      );
    }
    return null;
  }

  if (metricName === "knowledge_videos_added") {
    if (normalizedScopeType === "global" || normalizedScopeType === "track") {
      return asFloat(
        await db.fetchval(
          `
            SELECT COUNT(*)
            FROM videos
            WHERE created_at >= $1
              AND created_at < $2
              AND source = 'youtube'
          `,
          window.current_start,
          window.current_end
        )
      );
    }
    if (normalizedScopeType === "source") {
      return asFloat(
        await db.fetchval(
          `
            SELECT COUNT(*)
            FROM videos
            WHERE created_at >= $1
              AND created_at < $2
              AND LOWER(source) = $3
          `,
          window.current_start,
          window.current_end,
          normalizedScopeKey
        )
      );
    }
    return null;
  }

  if (metricName === "knowledge_segments_added") {
    if (normalizedScopeType === "global" || normalizedScopeType === "track") {
      return asFloat(
        await db.fetchval(
          `
            SELECT COUNT(*)
            FROM retrieval_units
            WHERE created_at >= $1
              AND created_at < $2
              AND unit_type = 'speech'
          `,
          window.current_start,
          window.current_end
        )
      );
    }
    if (normalizedScopeType === "source") {
      return asFloat(
        await db.fetchval(
          `
            SELECT COUNT(*)
            FROM retrieval_units AS ru
            JOIN videos AS v
              ON v.id = ru.video_id
            WHERE ru.created_at >= $1
              AND ru.created_at < $2
              AND ru.unit_type = 'speech'
              AND LOWER(v.source) = $3
          `,
          window.current_start,
          window.current_end,
          normalizedScopeKey
        )
      );
    }
    return null;
  }

  if (metricName === "jobs_completed" || metricName === "jobs_failed") {
    const jobStatus = metricName === "jobs_completed" ? "completed" : "failed";
    const failedClause = jobStatus === "failed" ? ` AND ${notCancelledJobCondition()}` : "";

    if (normalizedScopeType === "global") {
      return asFloat(
        await db.fetchval(
          `
            SELECT COUNT(*)
            FROM processing_jobs
            WHERE status = $1
              AND updated_at >= $2
              AND updated_at < $3
              ${failedClause}
          `,
          jobStatus,
          window.current_start,
          window.current_end
        )
      );
    }
    if (normalizedScopeType === "track") {
      return asFloat(
        await db.fetchval(
          `
            SELECT COUNT(*)
            FROM processing_jobs
            WHERE status = $1
              AND updated_at >= $2
              AND updated_at < $3
              AND track = $4
              ${failedClause}
          `,
          jobStatus,
          window.current_start,
          window.current_end,
          normalizedScopeKey
        )
      );
    }
    if (normalizedScopeType === "source") {
      const sourceFailedClause = jobStatus === "failed" ? ` AND ${notCancelledJobCondition("pj")}` : "";
      return asFloat(
        await db.fetchval(
          `
            SELECT COUNT(*)
            FROM processing_jobs AS pj
            LEFT JOIN content_sources AS cs
              ON cs.id = pj.source_id
            WHERE pj.status = $1
              AND pj.updated_at >= $2
              AND pj.updated_at < $3
              ${sourceFailedClause}
              AND (
                LOWER(COALESCE(cs.slug, '')) = $4
                OR LOWER(COALESCE(pj.source_id::text, '')) = $4
              )
          `,
          jobStatus,
          window.current_start,
          window.current_end,
          normalizedScopeKey
        )
      );
    }
  }

  return null;
}

async function fetchSummaryCounts(db: DatabaseClient, window: TimeWindow): Promise<Record<string, unknown>> {
  return (
    await db.fetchrow(
      `
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
                AND ${notCancelledJobCondition()}
                AND updated_at >= $1
                AND updated_at < $2) AS failed_jobs_current,
            (SELECT COUNT(*) FROM processing_jobs
              WHERE status = 'failed'
                AND ${notCancelledJobCondition()}
                AND updated_at >= $3
                AND updated_at < $4) AS failed_jobs_previous
      `,
      window.current_start,
      window.current_end,
      window.previous_start,
      window.previous_end
    )
  ) ?? {};
}

async function fetchDailySeries(db: DatabaseClient, window: TimeWindow): Promise<Record<string, unknown>[]> {
  return db.fetch(
    `
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
                    AND ${notCancelledJobCondition()}
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
    `,
    window.current_start.toISOString().slice(0, 10),
    window.current_end.toISOString().slice(0, 10),
    window.current_start,
    window.current_end
  );
}

export async function fetchAdminSummary(db: DatabaseClient, rangeKey: string): Promise<Record<string, unknown>> {
  const window = resolveTimeWindow(rangeKey);
  const targets = await fetchTargetMap(db, window.range_key);
  const counts = await fetchSummaryCounts(db, window);
  const dailyRows = await fetchDailySeries(db, window);

  const currentZeroRate = asFloat(counts.zero_results_current) / Math.max(asFloat(counts.queries_current), 1);
  const previousZeroRate = asFloat(counts.zero_results_previous) / Math.max(asFloat(counts.queries_previous), 1);
  const [requestsTarget, requestsMode] = lookupTarget(targets, "requests_total");
  const [activeUsersTarget, activeUsersMode] = lookupTarget(targets, "active_users");
  const [creditsTarget, creditsMode] = lookupTarget(targets, "credits_used");
  const [failedJobsTarget, failedJobsMode] = lookupTarget(targets, "jobs_failed");
  const [newUsersTarget, newUsersMode] = lookupTarget(targets, "new_users");

  const metrics = {
    total_users: buildMetric({
      current: asFloat(counts.total_users),
      previous: asFloat(counts.total_users) - asFloat(counts.new_users_current)
    }),
    new_users: buildMetric({
      current: asFloat(counts.new_users_current),
      previous: asFloat(counts.new_users_previous),
      target: newUsersTarget,
      comparisonMode: newUsersMode
    }),
    active_users: buildMetric({
      current: asFloat(counts.active_users_current),
      previous: asFloat(counts.active_users_previous),
      target: activeUsersTarget,
      comparisonMode: activeUsersMode
    }),
    requests: buildMetric({
      current: asFloat(counts.requests_current),
      previous: asFloat(counts.requests_previous),
      target: requestsTarget,
      comparisonMode: requestsMode
    }),
    credits_used: buildMetric({
      current: asFloat(counts.credits_current),
      previous: asFloat(counts.credits_previous),
      target: creditsTarget,
      comparisonMode: creditsMode
    }),
    zero_result_rate: buildMetric({
      current: currentZeroRate,
      previous: previousZeroRate
    }),
    indexed_assets: buildMetric({
      current: asFloat(counts.indexed_assets_current),
      previous: asFloat(counts.indexed_assets_previous)
    }),
    indexed_segments: buildMetric({
      current: asFloat(counts.indexed_segments_current),
      previous: asFloat(counts.indexed_segments_previous)
    }),
    pending_jobs: buildMetric({
      current: asFloat(counts.pending_jobs_current),
      previous: asFloat(counts.pending_jobs_previous)
    }),
    failed_jobs: buildMetric({
      current: asFloat(counts.failed_jobs_current),
      previous: asFloat(counts.failed_jobs_previous),
      target: failedJobsTarget,
      comparisonMode: failedJobsMode
    })
  };

  const notices: Record<string, unknown>[] = [];
  if (Number((metrics.zero_result_rate as any).current) > 0.2) {
    notices.push({
      tone: "warning",
      title: "Zero-result rate is elevated",
      description: "More than 20% of recent queries returned no results. Review indexing freshness and query quality."
    });
  }
  if (Number((metrics.failed_jobs as any).current) > 0) {
    notices.push({
      tone: "error",
      title: "Recent ingestion failures detected",
      description: `${Math.trunc(Number((metrics.failed_jobs as any).current))} job(s) failed in the selected window.`
    });
  }

  const series = dailyRows.map((row) => ({
    date: row.date,
    requests: asInt(row.requests),
    credits_used: asInt(row.credits_used),
    zero_result_queries: asInt(row.zero_result_queries),
    broll_assets_added: asInt(row.broll_assets_added),
    knowledge_videos_added: asInt(row.knowledge_videos_added),
    knowledge_segments_added: asInt(row.knowledge_segments_added),
    jobs_completed: asInt(row.jobs_completed),
    jobs_failed: asInt(row.jobs_failed),
    latency_p95_ms: row.latency_p95_ms == null ? null : asFloat(row.latency_p95_ms)
  }));

  return {
    generated_at: utcNow(),
    window: serializeWindow(window),
    metrics,
    request_series: series,
    content_series: series,
    ingestion_series: series,
    notices
  };
}

export async function fetchUsersSummary(db: DatabaseClient, rangeKey: string): Promise<Record<string, unknown>> {
  const window = resolveTimeWindow(rangeKey);
  const targets = await fetchTargetMap(db, window.range_key);
  const counts = (
    await db.fetchrow(
      `
        SELECT
            (SELECT COUNT(*) FROM user_profiles) AS total_users,
            (SELECT COUNT(*) FROM user_profiles WHERE created_at >= $1 AND created_at < $2) AS new_users_current,
            (SELECT COUNT(*) FROM user_profiles WHERE created_at >= $3 AND created_at < $4) AS new_users_previous,
            (SELECT COUNT(DISTINCT user_id) FROM usage_events WHERE occurred_at >= $1 AND occurred_at < $2) AS active_users_current,
            (SELECT COUNT(DISTINCT user_id) FROM usage_events WHERE occurred_at >= $3 AND occurred_at < $4) AS active_users_previous,
            (SELECT COUNT(*) FROM api_keys WHERE is_active = TRUE) AS active_api_keys_current,
            (SELECT COUNT(*) FROM api_keys WHERE is_active = TRUE AND created_at < $3) AS active_api_keys_previous
      `,
      window.current_start,
      window.current_end,
      window.previous_start,
      window.previous_end
    )
  ) ?? {};

  const tierRows = await db.fetch(
    `
      SELECT tier AS key, tier AS label, COUNT(*) AS count
      FROM user_profiles
      GROUP BY tier
      ORDER BY count DESC, tier ASC
    `
  );
  const roleRows = await db.fetch(
    `
      SELECT console_role AS key, console_role AS label, COUNT(*) AS count
      FROM user_profiles
      GROUP BY console_role
      ORDER BY count DESC, console_role ASC
    `
  );
  const signupRows = await db.fetch(
    `
      SELECT
          DATE(created_at) AS key,
          TO_CHAR(DATE(created_at), 'YYYY-MM-DD') AS label,
          COUNT(*) AS count
      FROM user_profiles
      WHERE created_at >= $1
        AND created_at < $2
      GROUP BY DATE(created_at)
      ORDER BY key ASC
    `,
    window.current_start,
    window.current_end
  );
  const recentRows = await db.fetch(
    `
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
    `
  );
  const activeRows = await db.fetch(
    `
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
    `,
    window.current_start,
    window.current_end
  );

  return {
    generated_at: utcNow(),
    window: serializeWindow(window),
    metrics: {
      total_users: buildMetric({
        current: asFloat(counts.total_users),
        previous: asFloat(counts.total_users) - asFloat(counts.new_users_current)
      }),
      new_users: buildMetric({
        current: asFloat(counts.new_users_current),
        previous: asFloat(counts.new_users_previous),
        target: lookupTarget(targets, "new_users")[0],
        comparisonMode: lookupTarget(targets, "new_users")[1]
      }),
      active_users: buildMetric({
        current: asFloat(counts.active_users_current),
        previous: asFloat(counts.active_users_previous),
        target: lookupTarget(targets, "active_users")[0],
        comparisonMode: lookupTarget(targets, "active_users")[1]
      }),
      active_api_keys: buildMetric({
        current: asFloat(counts.active_api_keys_current),
        previous: asFloat(counts.active_api_keys_previous)
      })
    },
    daily_signups: signupRows.map((row) => ({
      key: String(row.key),
      label: String(row.label),
      count: asInt(row.count)
    })),
    tiers: tierRows.map((row) => ({
      key: String(row.key),
      label: String(row.label).replace(/\b\w/g, (match) => match.toUpperCase()),
      count: asInt(row.count)
    })),
    console_roles: roleRows.map((row) => ({
      key: String(row.key),
      label: String(row.label).replace(/\b\w/g, (match) => match.toUpperCase()),
      count: asInt(row.count)
    })),
    recent_users: recentRows.map((row) => ({
      user_id: String(row.user_id),
      email: row.email == null ? null : String(row.email),
      tier: String(row.tier),
      console_role: String(row.console_role),
      created_at: row.created_at,
      active_api_keys: asInt(row.active_api_keys),
      last_request_at: row.last_request_at ?? null
    })),
    most_active_users: activeRows.map((row) => ({
      user_id: String(row.user_id),
      email: row.email == null ? null : String(row.email),
      tier: String(row.tier),
      request_count: asInt(row.request_count),
      credits_used: asInt(row.credits_used),
      last_request_at: row.last_request_at ?? null
    }))
  };
}

export async function fetchRequestsSummary(db: DatabaseClient, rangeKey: string): Promise<Record<string, unknown>> {
  const window = resolveTimeWindow(rangeKey);
  const targets = await fetchTargetMap(db, window.range_key);

  const usageCounts = (
    await db.fetchrow(
      `
        SELECT
            COUNT(*) FILTER (WHERE occurred_at >= $1 AND occurred_at < $2) AS requests_current,
            COUNT(*) FILTER (WHERE occurred_at >= $3 AND occurred_at < $4) AS requests_previous,
            COALESCE(SUM(credits_used) FILTER (WHERE occurred_at >= $1 AND occurred_at < $2), 0) AS credits_current,
            COALESCE(SUM(credits_used) FILTER (WHERE occurred_at >= $3 AND occurred_at < $4), 0) AS credits_previous,
            COUNT(DISTINCT user_id) FILTER (WHERE occurred_at >= $1 AND occurred_at < $2) AS active_users_current,
            COUNT(DISTINCT user_id) FILTER (WHERE occurred_at >= $3 AND occurred_at < $4) AS active_users_previous
        FROM usage_events
      `,
      window.current_start,
      window.current_end,
      window.previous_start,
      window.previous_end
    )
  ) ?? {};
  const queryCounts = (
    await db.fetchrow(
      `
        SELECT
            COUNT(*) FILTER (WHERE created_at >= $1 AND created_at < $2) AS queries_current,
            COUNT(*) FILTER (WHERE created_at >= $3 AND created_at < $4) AS queries_previous,
            COUNT(*) FILTER (WHERE created_at >= $1 AND created_at < $2 AND result_count = 0) AS zero_results_current,
            COUNT(*) FILTER (WHERE created_at >= $3 AND created_at < $4 AND result_count = 0) AS zero_results_previous,
            COUNT(*) FILTER (WHERE created_at >= $1 AND created_at < $2 AND include_answer = TRUE) AS answers_current,
            COUNT(*) FILTER (WHERE created_at >= $3 AND created_at < $4 AND include_answer = TRUE) AS answers_previous
        FROM query_logs
      `,
      window.current_start,
      window.current_end,
      window.previous_start,
      window.previous_end
    )
  ) ?? {};
  const latencyCounts = (
    await db.fetchrow(
      `
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
      `,
      window.current_start,
      window.current_end,
      window.previous_start,
      window.previous_end
    )
  ) ?? {};

  const topQueryRows = await db.fetch(
    `
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
    `,
    window.current_start,
    window.current_end
  );
  const zeroResultRows = await db.fetch(
    `
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
    `,
    window.current_start,
    window.current_end
  );
  const dailySeries = await fetchDailySeries(db, window);

  const currentRequestCount = asFloat(usageCounts.requests_current);
  const previousRequestCount = asFloat(usageCounts.requests_previous);
  const currentQueryCount = asFloat(queryCounts.queries_current);
  const previousQueryCount = asFloat(queryCounts.queries_previous);

  return {
    generated_at: utcNow(),
    window: serializeWindow(window),
    metrics: {
      total_requests: buildMetric({
        current: currentRequestCount,
        previous: previousRequestCount,
        target: lookupTarget(targets, "requests_total")[0],
        comparisonMode: lookupTarget(targets, "requests_total")[1]
      }),
      credits_used: buildMetric({
        current: asFloat(usageCounts.credits_current),
        previous: asFloat(usageCounts.credits_previous),
        target: lookupTarget(targets, "credits_used")[0],
        comparisonMode: lookupTarget(targets, "credits_used")[1]
      }),
      active_users: buildMetric({
        current: asFloat(usageCounts.active_users_current),
        previous: asFloat(usageCounts.active_users_previous),
        target: lookupTarget(targets, "active_users")[0],
        comparisonMode: lookupTarget(targets, "active_users")[1]
      }),
      average_credits_per_request: buildMetric({
        current: asFloat(usageCounts.credits_current) / Math.max(currentRequestCount, 1),
        previous: asFloat(usageCounts.credits_previous) / Math.max(previousRequestCount, 1)
      }),
      zero_result_rate: buildMetric({
        current: asFloat(queryCounts.zero_results_current) / Math.max(currentQueryCount, 1),
        previous: asFloat(queryCounts.zero_results_previous) / Math.max(previousQueryCount, 1)
      }),
      answer_usage_rate: buildMetric({
        current: asFloat(queryCounts.answers_current) / Math.max(currentQueryCount, 1),
        previous: asFloat(queryCounts.answers_previous) / Math.max(previousQueryCount, 1)
      }),
      latency: {
        p50_ms: buildMetric({
          current: asFloat(latencyCounts.p50_current),
          previous: asFloat(latencyCounts.p50_previous)
        }),
        p95_ms: buildMetric({
          current: asFloat(latencyCounts.p95_current),
          previous: asFloat(latencyCounts.p95_previous)
        }),
        p99_ms: buildMetric({
          current: asFloat(latencyCounts.p99_current),
          previous: asFloat(latencyCounts.p99_previous)
        })
      }
    },
    daily_series: dailySeries.map((row) => ({
      date: row.date,
      requests: asInt(row.requests),
      credits_used: asInt(row.credits_used),
      zero_result_queries: asInt(row.zero_result_queries),
      latency_p95_ms: row.latency_p95_ms == null ? null : asFloat(row.latency_p95_ms)
    })),
    top_queries: topQueryRows.map((row) => ({
      query_text: String(row.query_text),
      request_count: asInt(row.request_count),
      zero_result_count: asInt(row.zero_result_count),
      answer_count: asInt(row.answer_count),
      avg_latency_ms: row.avg_latency_ms == null ? null : asFloat(row.avg_latency_ms)
    })),
    zero_result_queries: zeroResultRows.map((row) => ({
      query_text: String(row.query_text),
      request_count: asInt(row.request_count),
      zero_result_count: asInt(row.zero_result_count),
      answer_count: asInt(row.answer_count),
      avg_latency_ms: row.avg_latency_ms == null ? null : asFloat(row.avg_latency_ms)
    }))
  };
}

export async function fetchContentSummary(db: DatabaseClient, rangeKey: string): Promise<Record<string, unknown>> {
  const window = resolveTimeWindow(rangeKey);
  const targets = await fetchTargetMap(db, window.range_key);
  const counts = (
    await db.fetchrow(
      `
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
      `,
      window.current_start,
      window.current_end,
      window.previous_start,
      window.previous_end
    )
  ) ?? {};
  const perSourceRows = await db.fetch(
    `
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
    `,
    window.current_start,
    window.current_end
  );
  const staleRows = await db.fetch(
    `
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
    `,
    window.current_start,
    window.current_end
  );
  const dailyRows = await fetchDailySeries(db, window);
  const staleCutoff = addDays(utcNow(), -7);

  return {
    generated_at: utcNow(),
    window: serializeWindow(window),
    metrics: {
      broll_assets_total: buildMetric({
        current: asFloat(counts.broll_assets_total_current),
        previous: asFloat(counts.broll_assets_total_previous)
      }),
      knowledge_videos_total: buildMetric({
        current: asFloat(counts.knowledge_videos_total_current),
        previous: asFloat(counts.knowledge_videos_total_previous)
      }),
      knowledge_segments_total: buildMetric({
        current: asFloat(counts.knowledge_segments_total_current),
        previous: asFloat(counts.knowledge_segments_total_previous)
      }),
      active_sources_total: buildMetric({
        current: asFloat(counts.active_sources_total_current),
        previous: asFloat(counts.active_sources_total_previous)
      }),
      broll_assets_added: buildMetric({
        current: asFloat(counts.broll_assets_added_current),
        previous: asFloat(counts.broll_assets_added_previous),
        target: lookupTarget(targets, "broll_assets_added")[0],
        comparisonMode: lookupTarget(targets, "broll_assets_added")[1]
      }),
      knowledge_videos_added: buildMetric({
        current: asFloat(counts.knowledge_videos_added_current),
        previous: asFloat(counts.knowledge_videos_added_previous),
        target: lookupTarget(targets, "knowledge_videos_added")[0],
        comparisonMode: lookupTarget(targets, "knowledge_videos_added")[1]
      }),
      knowledge_segments_added: buildMetric({
        current: asFloat(counts.knowledge_segments_added_current),
        previous: asFloat(counts.knowledge_segments_added_previous),
        target: lookupTarget(targets, "knowledge_segments_added")[0],
        comparisonMode: lookupTarget(targets, "knowledge_segments_added")[1]
      })
    },
    daily_series: dailyRows.map((row) => ({
      date: row.date,
      broll_assets_added: asInt(row.broll_assets_added),
      knowledge_videos_added: asInt(row.knowledge_videos_added),
      knowledge_segments_added: asInt(row.knowledge_segments_added)
    })),
    per_source_growth: perSourceRows.map((row) => ({
      track: String(row.track),
      source_key: String(row.source_key),
      additions: asInt(row.additions)
    })),
    stale_sources: staleRows.map((row) => ({
      source_id: String(row.source_id),
      slug: String(row.slug),
      display_name: String(row.display_name),
      track: String(row.track),
      is_active: Boolean(row.is_active),
      last_job_at: row.last_job_at ?? null,
      jobs_in_range: asInt(row.jobs_in_range),
      is_stale: row.last_job_at == null || new Date(String(row.last_job_at)).getTime() < staleCutoff.getTime()
    }))
  };
}

export async function fetchIngestionSummary(db: DatabaseClient, rangeKey: string): Promise<Record<string, unknown>> {
  const window = resolveTimeWindow(rangeKey);
  const targets = await fetchTargetMap(db, window.range_key);
  const metrics = (
    await db.fetchrow(
      `
        SELECT
            (SELECT COUNT(*) FROM processing_jobs WHERE created_at >= $1 AND created_at < $2) AS jobs_created_current,
            (SELECT COUNT(*) FROM processing_jobs WHERE created_at >= $3 AND created_at < $4) AS jobs_created_previous,
            (SELECT COUNT(*) FROM processing_jobs WHERE status = 'completed' AND updated_at >= $1 AND updated_at < $2) AS jobs_completed_current,
            (SELECT COUNT(*) FROM processing_jobs WHERE status = 'completed' AND updated_at >= $3 AND updated_at < $4) AS jobs_completed_previous,
            (SELECT COUNT(*) FROM processing_jobs
              WHERE status = 'failed'
                AND ${notCancelledJobCondition()}
                AND updated_at >= $1
                AND updated_at < $2) AS jobs_failed_current,
            (SELECT COUNT(*) FROM processing_jobs
              WHERE status = 'failed'
                AND ${notCancelledJobCondition()}
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
      `,
      window.current_start,
      window.current_end,
      window.previous_start,
      window.previous_end
    )
  ) ?? {};
  const statusCounts = (
    await db.fetchrow(
      `
        SELECT
            COUNT(*) FILTER (WHERE status = 'pending') AS pending,
            COUNT(*) FILTER (WHERE status = 'running') AS running,
            COUNT(*) FILTER (WHERE status = 'retrying') AS retrying,
            COUNT(*) FILTER (WHERE status = 'completed') AS completed,
            COUNT(*) FILTER (
                WHERE status = 'failed'
                  AND ${notCancelledJobCondition()}
            ) AS failed
        FROM processing_jobs
      `
    )
  ) ?? {};
  const sourceRows = await db.fetch(
    `
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
                AND ${notCancelledJobCondition("pj")}
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
    `,
    window.current_start,
    window.current_end
  );
  const failedJobRows = await db.fetch(
    `
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
        AND ${notCancelledJobCondition()}
        AND updated_at >= $1
        AND updated_at < $2
      ORDER BY updated_at DESC
      LIMIT 10
    `,
    window.current_start,
    window.current_end
  );
  const failedStepRows = await db.fetch(
    `
      SELECT
          pjs.step_name,
          COUNT(*) AS failure_count,
          MAX(pjs.updated_at) AS last_failed_at
      FROM processing_job_steps AS pjs
      JOIN processing_jobs AS pj
        ON pj.id = pjs.job_id
      WHERE pjs.status = 'failed'
        AND ${notCancelledJobCondition("pj")}
        AND pjs.updated_at >= $1
        AND pjs.updated_at < $2
      GROUP BY pjs.step_name
      ORDER BY failure_count DESC, pjs.step_name ASC
      LIMIT 10
    `,
    window.current_start,
    window.current_end
  );
  const dailyRows = await fetchDailySeries(db, window);
  const jobsCompletedCurrent = asFloat(metrics.jobs_completed_current);
  const jobsFailedCurrent = asFloat(metrics.jobs_failed_current);
  const jobsCompletedPrevious = asFloat(metrics.jobs_completed_previous);
  const jobsFailedPrevious = asFloat(metrics.jobs_failed_previous);

  return {
    generated_at: utcNow(),
    window: serializeWindow(window),
    metrics: {
      jobs_created: buildMetric({
        current: asFloat(metrics.jobs_created_current),
        previous: asFloat(metrics.jobs_created_previous)
      }),
      jobs_completed: buildMetric({
        current: jobsCompletedCurrent,
        previous: jobsCompletedPrevious,
        target: lookupTarget(targets, "jobs_completed")[0],
        comparisonMode: lookupTarget(targets, "jobs_completed")[1]
      }),
      jobs_failed: buildMetric({
        current: jobsFailedCurrent,
        previous: jobsFailedPrevious,
        target: lookupTarget(targets, "jobs_failed")[0],
        comparisonMode: lookupTarget(targets, "jobs_failed")[1]
      }),
      completion_rate: buildMetric({
        current: jobsCompletedCurrent / Math.max(jobsCompletedCurrent + jobsFailedCurrent, 1),
        previous: jobsCompletedPrevious / Math.max(jobsCompletedPrevious + jobsFailedPrevious, 1)
      }),
      failure_rate: buildMetric({
        current: jobsFailedCurrent / Math.max(jobsCompletedCurrent + jobsFailedCurrent, 1),
        previous: jobsFailedPrevious / Math.max(jobsCompletedPrevious + jobsFailedPrevious, 1)
      }),
      pending_backlog: buildMetric({
        current: asFloat(metrics.pending_backlog_current),
        previous: asFloat(metrics.pending_backlog_previous)
      }),
      average_processing_ms: buildMetric({
        current: asFloat(metrics.avg_processing_current),
        previous: asFloat(metrics.avg_processing_previous)
      })
    },
    status_counts: {
      pending: asInt(statusCounts.pending),
      running: asInt(statusCounts.running),
      retrying: asInt(statusCounts.retrying),
      completed: asInt(statusCounts.completed),
      failed: asInt(statusCounts.failed)
    },
    daily_series: dailyRows.map((row) => ({
      date: row.date,
      jobs_completed: asInt(row.jobs_completed),
      jobs_failed: asInt(row.jobs_failed)
    })),
    source_health: sourceRows.map((row) => ({
      source_id: String(row.source_id),
      slug: String(row.slug),
      display_name: String(row.display_name),
      track: String(row.track),
      is_active: Boolean(row.is_active),
      jobs_created: asInt(row.jobs_created),
      jobs_completed: asInt(row.jobs_completed),
      jobs_failed: asInt(row.jobs_failed),
      backlog: asInt(row.backlog),
      last_job_at: row.last_job_at ?? null
    })),
    recent_failed_jobs: failedJobRows.map((row) => ({
      job_id: String(row.job_id),
      track: String(row.track),
      job_type: String(row.job_type),
      source_id: row.source_id == null ? null : String(row.source_id),
      error_message: row.error_message == null ? null : String(row.error_message),
      attempts: asInt(row.attempts),
      max_attempts: asInt(row.max_attempts),
      updated_at: row.updated_at
    })),
    failed_steps: failedStepRows.map((row) => ({
      step_name: String(row.step_name),
      failure_count: asInt(row.failure_count),
      last_failed_at: row.last_failed_at ?? null
    }))
  };
}

export async function fetchTargetsSummary(db: DatabaseClient, rangeKey: string): Promise<Record<string, unknown>> {
  const window = resolveTimeWindow(rangeKey);
  const targetRows = await fetchTargetRows(db, window.range_key);
  const targets = [];

  for (const row of targetRows) {
    const metricName = String(row.metric_name);
    const [scopeType, scopeKey] = normalizeTargetScope(String(row.scope_type ?? "global"), String(row.scope_key ?? ""));
    const actualValue = await fetchTargetActual(db, window, metricName, scopeType, scopeKey);
    const targetValue = asFloat(row.target_value);
    const comparisonMode = String(row.comparison_mode ?? "at_least");

    let attainmentRatio: number | null = null;
    let targetGap: number | null = null;
    if (actualValue != null) {
      if (comparisonMode === "at_most") {
        targetGap = targetValue - actualValue;
        attainmentRatio = actualValue <= 0 ? 1 : targetValue / actualValue;
      } else {
        targetGap = actualValue - targetValue;
        attainmentRatio = targetValue <= 0 ? null : actualValue / targetValue;
      }
    }

    targets.push({
      id: String(row.id),
      metric_name: metricName,
      scope_type: scopeType,
      scope_key: scopeKey,
      range_key: row.range_key,
      comparison_mode: row.comparison_mode,
      target_value: targetValue,
      note: row.note == null ? null : String(row.note),
      updated_at: row.updated_at,
      actual_value: actualValue,
      attainment_ratio: attainmentRatio,
      target_gap: targetGap
    });
  }

  return {
    generated_at: utcNow(),
    window: serializeWindow(window),
    targets
  };
}
