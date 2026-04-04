import type { DatabaseClient } from "../db/client";
import type { SearchSurface } from "../types";

export type AdminAnalyticsRange = "today" | "7d" | "30d";

export interface AnalyticsTimeWindow {
  rangeKey: AdminAnalyticsRange;
  currentStart: Date;
  currentEnd: Date;
  previousStart: Date;
  previousEnd: Date;
}

export interface AdminAnalyticsQueryOptions {
  rangeKey: AdminAnalyticsRange;
  searchSurface?: SearchSurface | null;
}

export interface AnalyticsPrimitiveSummary {
  rangeKey: AdminAnalyticsRange;
  searchSurface: SearchSurface | null;
  searches: number;
  searchesWithResults: number;
  searchesWithAnswer: number;
  impressions: number;
  uniqueOutboundClicks: number;
  uniqueDetailPageViews: number;
  overallCtr: number;
  detailAssistRate: number;
  detailToOutboundRate: number;
}

export interface AnalyticsRankBaselineRow {
  resultRank: number;
  impressions: number;
  uniqueOutboundClicks: number;
  ctr: number;
}

export interface AnalyticsQueryPerformanceRow {
  normalizedQueryText: string;
  exampleQueryText: string;
  searches: number;
  impressions: number;
  uniqueOutboundClicks: number;
  ctr: number;
}

const ANALYTICS_RANGE_KEYS = new Set<AdminAnalyticsRange>(["today", "7d", "30d"]);
const SEARCH_SURFACE_KEYS = new Set<SearchSurface>(["api", "playground", "mcp"]);
const FALLBACK_SHORT_ID_SQL =
  "SUBSTRING(" +
  "ENCODE(" +
  "DIGEST(CONCAT_WS(':', ru.video_id::text, ru.unit_type, ru.unit_index::text), 'sha256')," +
  "'hex'" +
  ")" +
  " FROM 1 FOR 12" +
  ")";
const NORMALIZED_QUERY_SQL = "LOWER(REGEXP_REPLACE(BTRIM(COALESCE(%s, '')), '\\s+', ' ', 'g'))";
const DEFAULT_TABLE_LIMIT = 10;
const DEFAULT_QUERY_LIMIT = 8;
const DEFAULT_MIN_IMPRESSIONS = 30;
const DEFAULT_RESULT_MIN_IMPRESSIONS = 20;
const DEFAULT_QUERY_MIN_IMPRESSIONS = 20;

type AnalyticsMetricPayload = {
  current: number;
  previous: number;
  delta: number;
  delta_ratio: number | null;
  target: null;
  target_gap: null;
  attainment_ratio: null;
  comparison_mode: null;
};

interface AnalyticsDatasetQuery {
  params: unknown[];
  queryText: string;
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

function formatNormalizedQuerySql(expression: string): string {
  return NORMALIZED_QUERY_SQL.replace("%s", expression);
}

function toInt(value: unknown): number {
  return value == null ? 0 : Math.trunc(Number(value));
}

function toFloat(value: unknown): number {
  return value == null ? 0 : Number(value);
}

function divide(numerator: number, denominator: number): number {
  if (denominator <= 0) {
    return 0;
  }
  return numerator / denominator;
}

function deltaRatio(current: number, previous: number): number | null {
  if (previous === 0) {
    return null;
  }
  return (current - previous) / previous;
}

function buildMetricPayload(current: number, previous: number): AnalyticsMetricPayload {
  return {
    current,
    previous,
    delta: current - previous,
    delta_ratio: deltaRatio(current, previous),
    target: null,
    target_gap: null,
    attainment_ratio: null,
    comparison_mode: null
  };
}

function serializeAnalyticsWindow(window: AnalyticsTimeWindow): Record<string, unknown> {
  return {
    range_key: window.rangeKey,
    current_start: window.currentStart,
    current_end: window.currentEnd,
    previous_start: window.previousStart,
    previous_end: window.previousEnd
  };
}

function clampLimit(input: number | undefined, fallback: number, max = 25): number {
  if (!Number.isFinite(input)) {
    return fallback;
  }
  return Math.min(Math.max(Math.trunc(Number(input)), 1), max);
}

function buildMinImpressionsClause(
  params: unknown[],
  minImpressions?: number | null,
  aggregateSql = "COUNT(*)"
): string {
  if (minImpressions == null || minImpressions <= 0) {
    return "";
  }
  params.push(minImpressions);
  return `HAVING ${aggregateSql} >= $${params.length}`;
}

function createAnalyticsDatasetQueryForBounds(input: {
  startAt: Date;
  endAt: Date;
  searchSurface?: SearchSurface | null;
}): AnalyticsDatasetQuery {
  const params: unknown[] = [input.startAt, input.endAt];
  let searchSurfaceClause = "";

  if (input.searchSurface) {
    params.push(input.searchSurface);
    searchSurfaceClause = `AND ql.search_surface = $${params.length}`;
  }

  const fallbackShortIdFromUrlSql = "NULLIF(SUBSTRING(ri.target_url FROM '/v/([^/?#]+)'), '')";

  return {
    params,
    queryText: `
      WITH query_scope AS (
        SELECT
            ql.request_id,
            ql.search_type,
            ql.search_surface,
            ql.query_text,
            ql.include_answer,
            ql.result_count,
            ql.latency_ms,
            ql.results_preview,
            ql.created_at
        FROM query_logs AS ql
        WHERE ql.created_at >= $1
          AND ql.created_at < $2
          ${searchSurfaceClause}
      ),
      impression_inputs AS (
        SELECT
            qs.request_id,
            qs.search_type,
            qs.search_surface,
            qs.query_text,
            qs.include_answer,
            qs.result_count,
            qs.latency_ms,
            qs.created_at,
            preview.item AS preview_item,
            preview.ordinality
        FROM query_scope AS qs
        CROSS JOIN LATERAL jsonb_array_elements(qs.results_preview) WITH ORDINALITY AS preview(item, ordinality)
      ),
      result_impressions AS (
        SELECT
            ii.request_id,
            ii.search_type,
            ii.search_surface,
            ii.query_text,
            ${formatNormalizedQuerySql("ii.query_text")} AS normalized_query_text,
            ii.include_answer,
            ii.result_count,
            ii.latency_ms,
            ii.created_at,
            COALESCE(NULLIF(ii.preview_item->>'rank', '')::integer, ii.ordinality::integer - 1) AS result_rank,
            NULLIF(ii.preview_item->>'result_id', '') AS preview_unit_id,
            NULLIF(ii.preview_item->>'short_id', '') AS preview_short_id,
            NULLIF(ii.preview_item->>'video_id', '') AS preview_video_id,
            NULLIF(ii.preview_item->>'url', '') AS target_url,
            NULLIF(ii.preview_item->>'title', '') AS preview_title,
            NULLIF(ii.preview_item->>'source', '') AS preview_source,
            CASE
              WHEN ii.preview_item ? 'score' AND NULLIF(ii.preview_item->>'score', '') IS NOT NULL
                THEN (ii.preview_item->>'score')::double precision
              ELSE NULL
            END AS score
        FROM impression_inputs AS ii
      ),
      impressions AS (
        SELECT
            ri.request_id,
            ri.search_type,
            ri.search_surface,
            ri.query_text,
            ri.normalized_query_text,
            ri.include_answer,
            ri.result_count,
            ri.latency_ms,
            ri.created_at,
            ri.result_rank,
            COALESCE(ri.preview_short_id, ru_match.short_id, ${fallbackShortIdFromUrlSql}) AS short_id,
            COALESCE(ru_match.unit_id, ri.preview_unit_id) AS unit_id,
            COALESCE(ri.preview_video_id, ru_match.video_id) AS video_id,
            ru_match.unit_type,
            ru_match.timestamp_start,
            ru_match.timestamp_end,
            COALESCE(v.title, ri.preview_title) AS title,
            COALESCE(v.source, ri.preview_source) AS source,
            v.creator,
            v.metadata->>'channel_id' AS channel_id,
            ri.target_url,
            ri.score,
            CASE
              WHEN COALESCE(ri.preview_short_id, ru_match.short_id, ${fallbackShortIdFromUrlSql}) IS NOT NULL
                THEN CONCAT('short|', COALESCE(ri.preview_short_id, ru_match.short_id, ${fallbackShortIdFromUrlSql}))
              ELSE CONCAT(
                'legacy|',
                COALESCE(COALESCE(ru_match.unit_id, ri.preview_unit_id), ''),
                '|',
                COALESCE(COALESCE(ri.preview_video_id, ru_match.video_id), ''),
                '|',
                COALESCE(ri.result_rank::text, '')
              )
            END AS result_key
        FROM result_impressions AS ri
        LEFT JOIN LATERAL (
          SELECT
              ru.id::text AS unit_id,
              COALESCE(ru.short_id, ${FALLBACK_SHORT_ID_SQL}) AS short_id,
              ru.video_id::text AS video_id,
              ru.unit_type,
              ru.timestamp_start,
              ru.timestamp_end
          FROM retrieval_units AS ru
          WHERE (
            ri.preview_unit_id IS NOT NULL
            AND ru.id::text = ri.preview_unit_id
          ) OR (
            ri.preview_unit_id IS NULL
            AND COALESCE(ru.short_id, ${FALLBACK_SHORT_ID_SQL}) = COALESCE(ri.preview_short_id, ${fallbackShortIdFromUrlSql})
          )
          ORDER BY CASE WHEN ri.preview_unit_id IS NOT NULL AND ru.id::text = ri.preview_unit_id THEN 0 ELSE 1 END
          LIMIT 1
        ) AS ru_match
          ON TRUE
        LEFT JOIN videos AS v
          ON v.id::text = COALESCE(ri.preview_video_id, ru_match.video_id)
      ),
      tracking_scope AS (
        SELECT
            te.id,
            te.short_id,
            te.event_type,
            te.request_id,
            te.result_rank,
            te.unit_id::text AS unit_id,
            te.video_id::text AS video_id,
            te.occurred_at,
            CASE
              WHEN NULLIF(te.short_id, '') IS NOT NULL
                THEN CONCAT('short|', te.short_id)
              ELSE CONCAT(
                'legacy|',
                COALESCE(te.unit_id::text, ''),
                '|',
                COALESCE(te.video_id::text, ''),
                '|',
                COALESCE(te.result_rank::text, '')
              )
            END AS result_key
        FROM tracking_events AS te
        INNER JOIN query_scope AS qs
          ON qs.request_id = te.request_id
      ),
      unique_outbound_clicks AS (
        SELECT
            ranked.request_id,
            ranked.short_id,
            ranked.result_rank,
            ranked.unit_id,
            ranked.video_id,
            ranked.result_key,
            ranked.occurred_at
        FROM (
          SELECT
              ts.*,
              ROW_NUMBER() OVER (
                PARTITION BY COALESCE(ts.request_id, ''), ts.result_key
                ORDER BY ts.occurred_at ASC, ts.id ASC
              ) AS dedupe_rank
          FROM tracking_scope AS ts
          WHERE ts.event_type IN ('redirect', 'outbound_click')
        ) AS ranked
        WHERE ranked.dedupe_rank = 1
      ),
      unique_page_views AS (
        SELECT
            ranked.request_id,
            ranked.short_id,
            ranked.result_rank,
            ranked.unit_id,
            ranked.video_id,
            ranked.result_key,
            ranked.occurred_at
        FROM (
          SELECT
              ts.*,
              ROW_NUMBER() OVER (
                PARTITION BY COALESCE(ts.request_id, ''), ts.result_key
                ORDER BY ts.occurred_at ASC, ts.id ASC
              ) AS dedupe_rank
          FROM tracking_scope AS ts
          WHERE ts.event_type = 'page_view'
        ) AS ranked
        WHERE ranked.dedupe_rank = 1
      )
    `
  };
}

function createAnalyticsDatasetQuery(options: AdminAnalyticsQueryOptions): AnalyticsDatasetQuery {
  const window = resolveAnalyticsTimeWindow(options.rangeKey);
  return createAnalyticsDatasetQueryForBounds({
    startAt: window.currentStart,
    endAt: window.currentEnd,
    searchSurface: options.searchSurface ?? null
  });
}

export function resolveAnalyticsTimeWindow(rangeKey: string): AnalyticsTimeWindow {
  const normalizedRangeKey = ANALYTICS_RANGE_KEYS.has(rangeKey as AdminAnalyticsRange)
    ? (rangeKey as AdminAnalyticsRange)
    : "7d";
  const now = utcNow();
  const start = todayStart(now);

  let currentStart = start;
  if (normalizedRangeKey === "30d") {
    currentStart = addDays(start, -29);
  } else if (normalizedRangeKey === "7d") {
    currentStart = addDays(start, -6);
  }

  const currentEnd = now;
  const durationMs = currentEnd.getTime() - currentStart.getTime();
  const previousEnd = currentStart;
  const previousStart = new Date(previousEnd.getTime() - durationMs);

  return {
    rangeKey: normalizedRangeKey,
    currentStart,
    currentEnd,
    previousStart,
    previousEnd
  };
}

export function normalizeAnalyticsSearchSurface(value: string | null | undefined): SearchSurface | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (!SEARCH_SURFACE_KEYS.has(normalized as SearchSurface)) {
    throw new Error("search_surface must be one of: api, mcp, playground.");
  }
  return normalized as SearchSurface;
}

async function fetchAnalyticsPrimitiveSummaryForBounds(
  db: DatabaseClient,
  input: {
    startAt: Date;
    endAt: Date;
    rangeKey: AdminAnalyticsRange;
    searchSurface?: SearchSurface | null;
  }
): Promise<AnalyticsPrimitiveSummary> {
  const dataset = createAnalyticsDatasetQueryForBounds(input);
  const row = await db.fetchrow<{
    searches: number | null;
    searches_with_results: number | null;
    searches_with_answer: number | null;
    impressions: number | null;
    unique_outbound_clicks: number | null;
    unique_detail_page_views: number | null;
  }>(
    `
      ${dataset.queryText}
      SELECT
          (SELECT COUNT(*)::int FROM query_scope) AS searches,
          (SELECT COUNT(*)::int FROM query_scope WHERE result_count > 0) AS searches_with_results,
          (SELECT COUNT(*)::int FROM query_scope WHERE include_answer = TRUE) AS searches_with_answer,
          (SELECT COUNT(*)::int FROM impressions) AS impressions,
          (SELECT COUNT(*)::int FROM unique_outbound_clicks) AS unique_outbound_clicks,
          (SELECT COUNT(*)::int FROM unique_page_views) AS unique_detail_page_views
    `,
    ...(dataset.params as any[])
  );

  const searches = toInt(row?.searches);
  const searchesWithResults = toInt(row?.searches_with_results);
  const searchesWithAnswer = toInt(row?.searches_with_answer);
  const impressions = toInt(row?.impressions);
  const uniqueOutboundClicks = toInt(row?.unique_outbound_clicks);
  const uniqueDetailPageViews = toInt(row?.unique_detail_page_views);

  return {
    rangeKey: input.rangeKey,
    searchSurface: input.searchSurface ?? null,
    searches,
    searchesWithResults,
    searchesWithAnswer,
    impressions,
    uniqueOutboundClicks,
    uniqueDetailPageViews,
    overallCtr: divide(uniqueOutboundClicks, impressions),
    detailAssistRate: divide(uniqueDetailPageViews, impressions),
    detailToOutboundRate: divide(uniqueOutboundClicks, uniqueDetailPageViews)
  };
}

export async function fetchAnalyticsPrimitiveSummary(
  db: DatabaseClient,
  options: AdminAnalyticsQueryOptions
): Promise<AnalyticsPrimitiveSummary> {
  const window = resolveAnalyticsTimeWindow(options.rangeKey);
  return fetchAnalyticsPrimitiveSummaryForBounds(db, {
    startAt: window.currentStart,
    endAt: window.currentEnd,
    rangeKey: window.rangeKey,
    searchSurface: options.searchSurface ?? null
  });
}

export async function fetchAnalyticsRankBaselines(
  db: DatabaseClient,
  options: AdminAnalyticsQueryOptions
): Promise<AnalyticsRankBaselineRow[]> {
  const dataset = createAnalyticsDatasetQuery(options);
  const rows = await db.fetch<{
    result_rank: number | null;
    impressions: number | null;
    unique_outbound_clicks: number | null;
  }>(
    `
      ${dataset.queryText}
      SELECT
          i.result_rank,
          COUNT(*)::int AS impressions,
          COUNT(uoc.result_key)::int AS unique_outbound_clicks
      FROM impressions AS i
      LEFT JOIN unique_outbound_clicks AS uoc
        ON uoc.request_id = i.request_id
       AND uoc.result_key = i.result_key
      GROUP BY i.result_rank
      ORDER BY i.result_rank ASC
    `,
    ...(dataset.params as any[])
  );

  return rows.map((row) => {
    const impressions = toInt(row.impressions);
    const uniqueOutboundClicks = toInt(row.unique_outbound_clicks);
    return {
      resultRank: toInt(row.result_rank),
      impressions,
      uniqueOutboundClicks,
      ctr: divide(uniqueOutboundClicks, impressions)
    };
  });
}

export async function fetchAnalyticsQueryPerformance(
  db: DatabaseClient,
  options: AdminAnalyticsQueryOptions & {
    limit?: number;
    minImpressions?: number | null;
  }
): Promise<AnalyticsQueryPerformanceRow[]> {
  const dataset = createAnalyticsDatasetQuery(options);
  const params = [...dataset.params];
  const havingClause = buildMinImpressionsClause(params, options.minImpressions);
  params.push(clampLimit(options.limit, 25, 100));

  const rows = await db.fetch<{
    normalized_query_text: string | null;
    example_query_text: string | null;
    searches: number | null;
    impressions: number | null;
    unique_outbound_clicks: number | null;
  }>(
    `
      ${dataset.queryText}
      SELECT
          i.normalized_query_text,
          MIN(i.query_text) FILTER (WHERE BTRIM(COALESCE(i.query_text, '')) <> '') AS example_query_text,
          COUNT(DISTINCT i.request_id)::int AS searches,
          COUNT(*)::int AS impressions,
          COUNT(uoc.result_key)::int AS unique_outbound_clicks
      FROM impressions AS i
      LEFT JOIN unique_outbound_clicks AS uoc
        ON uoc.request_id = i.request_id
       AND uoc.result_key = i.result_key
      WHERE i.normalized_query_text <> ''
      GROUP BY i.normalized_query_text
      ${havingClause}
      ORDER BY impressions DESC, unique_outbound_clicks DESC, i.normalized_query_text ASC
      LIMIT $${params.length}
    `,
    ...(params as any[])
  );

  return rows.map((row) => {
    const impressions = toInt(row.impressions);
    const uniqueOutboundClicks = toInt(row.unique_outbound_clicks);
    return {
      normalizedQueryText: String(row.normalized_query_text ?? ""),
      exampleQueryText: String(row.example_query_text ?? row.normalized_query_text ?? ""),
      searches: toInt(row.searches),
      impressions,
      uniqueOutboundClicks,
      ctr: divide(uniqueOutboundClicks, impressions)
    };
  });
}

async function fetchOverviewTrendSeries(
  db: DatabaseClient,
  options: AdminAnalyticsQueryOptions
): Promise<Record<string, unknown>[]> {
  const dataset = createAnalyticsDatasetQuery(options);
  const rows = await db.fetch<{
    date: string | null;
    searches: number | null;
    impressions: number | null;
    unique_outbound_clicks: number | null;
    unique_detail_page_views: number | null;
  }>(
    `
      ${dataset.queryText}
      , request_rollups AS (
        SELECT
            qs.request_id,
            DATE_TRUNC('day', qs.created_at AT TIME ZONE 'UTC')::date AS bucket_date,
            COUNT(i.result_key)::int AS impressions,
            COUNT(uoc.result_key)::int AS unique_outbound_clicks,
            COUNT(upv.result_key)::int AS unique_detail_page_views
        FROM query_scope AS qs
        LEFT JOIN impressions AS i
          ON i.request_id = qs.request_id
        LEFT JOIN unique_outbound_clicks AS uoc
          ON uoc.request_id = i.request_id
         AND uoc.result_key = i.result_key
        LEFT JOIN unique_page_views AS upv
          ON upv.request_id = i.request_id
         AND upv.result_key = i.result_key
        GROUP BY qs.request_id, bucket_date
      )
      SELECT
          TO_CHAR(bucket_date, 'YYYY-MM-DD') AS date,
          COUNT(*)::int AS searches,
          COALESCE(SUM(impressions), 0)::int AS impressions,
          COALESCE(SUM(unique_outbound_clicks), 0)::int AS unique_outbound_clicks,
          COALESCE(SUM(unique_detail_page_views), 0)::int AS unique_detail_page_views
      FROM request_rollups
      GROUP BY bucket_date
      ORDER BY bucket_date ASC
    `,
    ...(dataset.params as any[])
  );

  return rows.map((row) => {
    const impressions = toInt(row.impressions);
    const uniqueOutboundClicks = toInt(row.unique_outbound_clicks);
    return {
      date: String(row.date ?? ""),
      searches: toInt(row.searches),
      impressions,
      unique_outbound_clicks: uniqueOutboundClicks,
      unique_detail_page_views: toInt(row.unique_detail_page_views),
      ctr: divide(uniqueOutboundClicks, impressions)
    };
  });
}

async function fetchAnswerModeBreakdown(
  db: DatabaseClient,
  options: AdminAnalyticsQueryOptions
): Promise<Record<string, unknown>[]> {
  const dataset = createAnalyticsDatasetQuery(options);
  const rows = await db.fetch<{
    include_answer: boolean | null;
    searches: number | null;
    impressions: number | null;
    unique_outbound_clicks: number | null;
  }>(
    `
      ${dataset.queryText}
      , request_rollups AS (
        SELECT
            qs.request_id,
            qs.include_answer,
            COUNT(i.result_key)::int AS impressions,
            COUNT(uoc.result_key)::int AS unique_outbound_clicks
        FROM query_scope AS qs
        LEFT JOIN impressions AS i
          ON i.request_id = qs.request_id
        LEFT JOIN unique_outbound_clicks AS uoc
          ON uoc.request_id = i.request_id
         AND uoc.result_key = i.result_key
        GROUP BY qs.request_id, qs.include_answer
      )
      SELECT
          include_answer,
          COUNT(*)::int AS searches,
          COALESCE(SUM(impressions), 0)::int AS impressions,
          COALESCE(SUM(unique_outbound_clicks), 0)::int AS unique_outbound_clicks
      FROM request_rollups
      GROUP BY include_answer
      ORDER BY include_answer DESC
    `,
    ...(dataset.params as any[])
  );

  return rows.map((row) => {
    const impressions = toInt(row.impressions);
    const uniqueOutboundClicks = toInt(row.unique_outbound_clicks);
    return {
      include_answer: row.include_answer === true,
      searches: toInt(row.searches),
      impressions,
      unique_outbound_clicks: uniqueOutboundClicks,
      ctr: divide(uniqueOutboundClicks, impressions)
    };
  });
}

async function fetchSurfaceBreakdown(
  db: DatabaseClient,
  options: AdminAnalyticsQueryOptions
): Promise<Record<string, unknown>[]> {
  const dataset = createAnalyticsDatasetQuery(options);
  const rows = await db.fetch<{
    search_surface: string | null;
    searches: number | null;
    impressions: number | null;
    unique_outbound_clicks: number | null;
  }>(
    `
      ${dataset.queryText}
      , request_rollups AS (
        SELECT
            qs.request_id,
            qs.search_surface,
            COUNT(i.result_key)::int AS impressions,
            COUNT(uoc.result_key)::int AS unique_outbound_clicks
        FROM query_scope AS qs
        LEFT JOIN impressions AS i
          ON i.request_id = qs.request_id
        LEFT JOIN unique_outbound_clicks AS uoc
          ON uoc.request_id = i.request_id
         AND uoc.result_key = i.result_key
        GROUP BY qs.request_id, qs.search_surface
      )
      SELECT
          search_surface,
          COUNT(*)::int AS searches,
          COALESCE(SUM(impressions), 0)::int AS impressions,
          COALESCE(SUM(unique_outbound_clicks), 0)::int AS unique_outbound_clicks
      FROM request_rollups
      GROUP BY search_surface
      ORDER BY search_surface ASC NULLS LAST
    `,
    ...(dataset.params as any[])
  );

  return rows.map((row) => {
    const impressions = toInt(row.impressions);
    const uniqueOutboundClicks = toInt(row.unique_outbound_clicks);
    return {
      search_surface: row.search_surface,
      searches: toInt(row.searches),
      impressions,
      unique_outbound_clicks: uniqueOutboundClicks,
      ctr: divide(uniqueOutboundClicks, impressions)
    };
  });
}

async function fetchVideoPerformanceRows(
  db: DatabaseClient,
  options: AdminAnalyticsQueryOptions,
  input: {
    orderBySql: string;
    minImpressions?: number | null;
    limit?: number;
  }
): Promise<Record<string, unknown>[]> {
  const dataset = createAnalyticsDatasetQuery(options);
  const params = [...dataset.params];
  const havingClause = buildMinImpressionsClause(params, input.minImpressions);
  params.push(clampLimit(input.limit, DEFAULT_TABLE_LIMIT));

  return db.fetch(
    `
      ${dataset.queryText}
      , rank_baselines AS (
        SELECT
            i.result_rank,
            COUNT(uoc.result_key)::double precision / NULLIF(COUNT(*), 0) AS ctr
        FROM impressions AS i
        LEFT JOIN unique_outbound_clicks AS uoc
          ON uoc.request_id = i.request_id
         AND uoc.result_key = i.result_key
        GROUP BY i.result_rank
      )
      SELECT
          i.video_id,
          MIN(i.short_id) FILTER (WHERE i.short_id IS NOT NULL) AS short_id,
          NULL::text AS unit_id,
          MIN(i.title) AS title,
          MIN(i.source) AS source,
          MIN(i.creator) AS creator,
          MIN(i.channel_id) AS channel_id,
          NULL::text AS unit_type,
          NULL::double precision AS timestamp_start,
          NULL::double precision AS timestamp_end,
          COUNT(*)::int AS impressions,
          COUNT(uoc.result_key)::int AS unique_outbound_clicks,
          (COUNT(uoc.result_key)::double precision / NULLIF(COUNT(*), 0)) AS ctr,
          (
            (COUNT(uoc.result_key)::double precision / NULLIF(COUNT(*), 0))
            - COALESCE(AVG(rb.ctr), 0)
          ) AS rank_adjusted_ctr,
          AVG((i.result_rank + 1)::double precision) AS avg_rank,
          COUNT(DISTINCT CASE WHEN i.normalized_query_text <> '' THEN i.normalized_query_text END)::int AS distinct_queries_seen,
          COUNT(DISTINCT CASE WHEN uoc.result_key IS NOT NULL AND i.normalized_query_text <> '' THEN i.normalized_query_text END)::int AS distinct_queries_clicked
      FROM impressions AS i
      LEFT JOIN unique_outbound_clicks AS uoc
        ON uoc.request_id = i.request_id
       AND uoc.result_key = i.result_key
      LEFT JOIN rank_baselines AS rb
        ON rb.result_rank = i.result_rank
      WHERE i.video_id IS NOT NULL
      GROUP BY i.video_id
      ${havingClause}
      ORDER BY ${input.orderBySql}
      LIMIT $${params.length}
    `,
    ...(params as any[])
  );
}

async function fetchResultPerformanceRows(
  db: DatabaseClient,
  options: AdminAnalyticsQueryOptions,
  input: {
    orderBySql: string;
    minImpressions?: number | null;
    limit?: number;
  }
): Promise<Record<string, unknown>[]> {
  const dataset = createAnalyticsDatasetQuery(options);
  const params = [...dataset.params];
  const havingClause = buildMinImpressionsClause(params, input.minImpressions);
  params.push(clampLimit(input.limit, DEFAULT_TABLE_LIMIT));

  return db.fetch(
    `
      ${dataset.queryText}
      , rank_baselines AS (
        SELECT
            i.result_rank,
            COUNT(uoc.result_key)::double precision / NULLIF(COUNT(*), 0) AS ctr
        FROM impressions AS i
        LEFT JOIN unique_outbound_clicks AS uoc
          ON uoc.request_id = i.request_id
         AND uoc.result_key = i.result_key
        GROUP BY i.result_rank
      )
      SELECT
          i.video_id,
          MIN(i.short_id) FILTER (WHERE i.short_id IS NOT NULL) AS short_id,
          MIN(i.unit_id) FILTER (WHERE i.unit_id IS NOT NULL) AS unit_id,
          MIN(i.title) AS title,
          MIN(i.source) AS source,
          MIN(i.creator) AS creator,
          MIN(i.channel_id) AS channel_id,
          MIN(i.unit_type) AS unit_type,
          MIN(i.timestamp_start) AS timestamp_start,
          MIN(i.timestamp_end) AS timestamp_end,
          COUNT(*)::int AS impressions,
          COUNT(uoc.result_key)::int AS unique_outbound_clicks,
          (COUNT(uoc.result_key)::double precision / NULLIF(COUNT(*), 0)) AS ctr,
          (
            (COUNT(uoc.result_key)::double precision / NULLIF(COUNT(*), 0))
            - COALESCE(AVG(rb.ctr), 0)
          ) AS rank_adjusted_ctr,
          AVG((i.result_rank + 1)::double precision) AS avg_rank,
          COUNT(DISTINCT CASE WHEN i.normalized_query_text <> '' THEN i.normalized_query_text END)::int AS distinct_queries_seen,
          COUNT(DISTINCT CASE WHEN uoc.result_key IS NOT NULL AND i.normalized_query_text <> '' THEN i.normalized_query_text END)::int AS distinct_queries_clicked
      FROM impressions AS i
      LEFT JOIN unique_outbound_clicks AS uoc
        ON uoc.request_id = i.request_id
       AND uoc.result_key = i.result_key
      LEFT JOIN rank_baselines AS rb
        ON rb.result_rank = i.result_rank
      WHERE i.result_key <> ''
      GROUP BY i.result_key
      ${havingClause}
      ORDER BY ${input.orderBySql}
      LIMIT $${params.length}
    `,
    ...(params as any[])
  );
}

async function fetchCreatorPerformanceRows(
  db: DatabaseClient,
  options: AdminAnalyticsQueryOptions,
  input: {
    orderBySql: string;
    minImpressions?: number | null;
    limit?: number;
  }
): Promise<Record<string, unknown>[]> {
  const dataset = createAnalyticsDatasetQuery(options);
  const params = [...dataset.params];
  const havingClause = buildMinImpressionsClause(params, input.minImpressions);
  params.push(clampLimit(input.limit, DEFAULT_TABLE_LIMIT));

  return db.fetch(
    `
      ${dataset.queryText}
      , rank_baselines AS (
        SELECT
            i.result_rank,
            COUNT(uoc.result_key)::double precision / NULLIF(COUNT(*), 0) AS ctr
        FROM impressions AS i
        LEFT JOIN unique_outbound_clicks AS uoc
          ON uoc.request_id = i.request_id
         AND uoc.result_key = i.result_key
        GROUP BY i.result_rank
      ),
      totals AS (
        SELECT
            COUNT(*)::double precision AS impressions_total,
            COUNT(uoc.result_key)::double precision AS outbound_total
        FROM impressions AS i
        LEFT JOIN unique_outbound_clicks AS uoc
          ON uoc.request_id = i.request_id
         AND uoc.result_key = i.result_key
      )
      SELECT
          CASE
            WHEN NULLIF(MIN(i.channel_id), '') IS NOT NULL THEN CONCAT('channel:', MIN(i.channel_id))
            WHEN NULLIF(MIN(i.creator), '') IS NOT NULL THEN CONCAT('creator:', MIN(i.creator))
            ELSE CONCAT('unknown:', MIN(COALESCE(i.source, 'unknown')))
          END AS creator_key,
          COALESCE(NULLIF(MIN(i.creator), ''), 'Unknown creator') AS creator,
          MIN(i.source) AS source,
          MIN(i.channel_id) AS channel_id,
          COUNT(*)::int AS impressions,
          COUNT(uoc.result_key)::int AS unique_outbound_clicks,
          (COUNT(uoc.result_key)::double precision / NULLIF(COUNT(*), 0)) AS ctr,
          (
            (COUNT(uoc.result_key)::double precision / NULLIF(COUNT(*), 0))
            - COALESCE(AVG(rb.ctr), 0)
          ) AS rank_adjusted_ctr,
          AVG((i.result_rank + 1)::double precision) AS avg_rank,
          COUNT(DISTINCT i.video_id)::int AS distinct_videos,
          COUNT(DISTINCT CASE WHEN uoc.result_key IS NOT NULL AND i.normalized_query_text <> '' THEN i.normalized_query_text END)::int AS distinct_queries_clicked,
          COUNT(*)::double precision / NULLIF((SELECT impressions_total FROM totals), 0) AS impression_share,
          COUNT(uoc.result_key)::double precision / NULLIF((SELECT outbound_total FROM totals), 0) AS outbound_share,
          (
            COUNT(uoc.result_key)::double precision / NULLIF((SELECT outbound_total FROM totals), 0)
            - COUNT(*)::double precision / NULLIF((SELECT impressions_total FROM totals), 0)
          ) AS share_delta
      FROM impressions AS i
      LEFT JOIN unique_outbound_clicks AS uoc
        ON uoc.request_id = i.request_id
       AND uoc.result_key = i.result_key
      LEFT JOIN rank_baselines AS rb
        ON rb.result_rank = i.result_rank
      GROUP BY COALESCE(NULLIF(i.channel_id, ''), NULLIF(i.creator, ''), COALESCE(i.source, 'unknown'))
      ${havingClause}
      ORDER BY ${input.orderBySql}
      LIMIT $${params.length}
    `,
    ...(params as any[])
  );
}

async function fetchQueryDemandRows(
  db: DatabaseClient,
  options: AdminAnalyticsQueryOptions,
  input: {
    orderBySql: string;
    limit?: number;
    minImpressions?: number | null;
    requireZeroResults?: boolean;
  }
): Promise<Record<string, unknown>[]> {
  const dataset = createAnalyticsDatasetQuery(options);
  const params = [...dataset.params];
  const havingClause = buildMinImpressionsClause(params, input.minImpressions, "SUM(impressions)");
  const zeroResultWhere = input.requireZeroResults ? "AND zero_result_searches > 0" : "";
  params.push(clampLimit(input.limit, DEFAULT_QUERY_LIMIT));

  return db.fetch(
    `
      ${dataset.queryText}
      , query_request_rollups AS (
        SELECT
            qs.request_id,
            ${formatNormalizedQuerySql("qs.query_text")} AS normalized_query_text,
            qs.query_text,
            qs.include_answer,
            qs.result_count,
            qs.latency_ms,
            COUNT(i.result_key)::int AS impressions,
            COUNT(uoc.result_key)::int AS unique_outbound_clicks
        FROM query_scope AS qs
        LEFT JOIN impressions AS i
          ON i.request_id = qs.request_id
        LEFT JOIN unique_outbound_clicks AS uoc
          ON uoc.request_id = i.request_id
         AND uoc.result_key = i.result_key
        GROUP BY qs.request_id, normalized_query_text, qs.query_text, qs.include_answer, qs.result_count, qs.latency_ms
      )
      SELECT
          normalized_query_text,
          MIN(query_text) FILTER (WHERE BTRIM(COALESCE(query_text, '')) <> '') AS example_query_text,
          COUNT(*)::int AS searches,
          SUM(CASE WHEN result_count = 0 THEN 1 ELSE 0 END)::int AS zero_result_searches,
          SUM(CASE WHEN include_answer = TRUE THEN 1 ELSE 0 END)::int AS answer_searches,
          AVG(latency_ms)::double precision AS avg_latency_ms,
          COALESCE(SUM(impressions), 0)::int AS impressions,
          COALESCE(SUM(unique_outbound_clicks), 0)::int AS unique_outbound_clicks,
          COALESCE(SUM(unique_outbound_clicks), 0)::double precision / NULLIF(COALESCE(SUM(impressions), 0), 0) AS ctr
      FROM query_request_rollups
      WHERE normalized_query_text <> ''
      GROUP BY normalized_query_text
      ${havingClause}
      ${zeroResultWhere}
      ORDER BY ${input.orderBySql}
      LIMIT $${params.length}
    `,
    ...(params as any[])
  );
}

async function fetchFeedbackSummary(
  db: DatabaseClient,
  window: AnalyticsTimeWindow
): Promise<Record<string, unknown>> {
  const row = await db.fetchrow<{
    total_feedback: number | null;
    likes: number | null;
    dislikes: number | null;
    unique_users: number | null;
  }>(
    `
      SELECT
          COUNT(*)::int AS total_feedback,
          COUNT(*) FILTER (WHERE rating = 1)::int AS likes,
          COUNT(*) FILTER (WHERE rating = -1)::int AS dislikes,
          COUNT(DISTINCT user_id)::int AS unique_users
      FROM playground_feedback
      WHERE created_at >= $1
        AND created_at < $2
    `,
    window.currentStart,
    window.currentEnd
  );

  const likes = toInt(row?.likes);
  const dislikes = toInt(row?.dislikes);
  return {
    total_feedback: toInt(row?.total_feedback),
    likes,
    dislikes,
    unique_users: toInt(row?.unique_users),
    like_rate: divide(likes, likes + dislikes),
    net_score: likes - dislikes
  };
}

async function fetchFeedbackVideoRows(
  db: DatabaseClient,
  window: AnalyticsTimeWindow
): Promise<Record<string, unknown>[]> {
  return db.fetch(
    `
      SELECT
          v.id::text AS video_id,
          v.title,
          v.source,
          v.creator,
          v.metadata->>'channel_id' AS channel_id,
          COUNT(*) FILTER (WHERE pf.rating = 1)::int AS likes,
          COUNT(*) FILTER (WHERE pf.rating = -1)::int AS dislikes,
          (
            COUNT(*) FILTER (WHERE pf.rating = 1)
            - COUNT(*) FILTER (WHERE pf.rating = -1)
          )::int AS net_score
      FROM playground_feedback AS pf
      JOIN retrieval_units AS ru
        ON ru.id::text = pf.result_id
      JOIN videos AS v
        ON v.id = ru.video_id
      WHERE pf.created_at >= $1
        AND pf.created_at < $2
      GROUP BY v.id
      ORDER BY likes DESC, net_score DESC, v.title ASC
      LIMIT 8
    `,
    window.currentStart,
    window.currentEnd
  );
}

async function fetchFeedbackResultRows(
  db: DatabaseClient,
  window: AnalyticsTimeWindow,
  orderBySql: string
): Promise<Record<string, unknown>[]> {
  return db.fetch(
    `
      SELECT
          ru.id::text AS unit_id,
          COALESCE(
            ru.short_id,
            SUBSTRING(
              ENCODE(DIGEST(CONCAT_WS(':', ru.video_id::text, ru.unit_type, ru.unit_index::text), 'sha256'), 'hex')
              FROM 1 FOR 12
            )
          ) AS short_id,
          v.id::text AS video_id,
          v.title,
          v.source,
          v.creator,
          v.metadata->>'channel_id' AS channel_id,
          ru.unit_type,
          ru.timestamp_start,
          ru.timestamp_end,
          COUNT(*) FILTER (WHERE pf.rating = 1)::int AS likes,
          COUNT(*) FILTER (WHERE pf.rating = -1)::int AS dislikes,
          (
            COUNT(*) FILTER (WHERE pf.rating = 1)
            - COUNT(*) FILTER (WHERE pf.rating = -1)
          )::int AS net_score
      FROM playground_feedback AS pf
      JOIN retrieval_units AS ru
        ON ru.id::text = pf.result_id
      JOIN videos AS v
        ON v.id = ru.video_id
      WHERE pf.created_at >= $1
        AND pf.created_at < $2
      GROUP BY ru.id, v.id
      ORDER BY ${orderBySql}
      LIMIT 8
    `,
    window.currentStart,
    window.currentEnd
  );
}

export async function fetchAdminAnalyticsOverview(
  db: DatabaseClient,
  options: AdminAnalyticsQueryOptions
): Promise<Record<string, unknown>> {
  const window = resolveAnalyticsTimeWindow(options.rangeKey);
  const [currentSummary, previousSummary, trendSeries, answerModes, surfaceBreakdown] = await Promise.all([
    fetchAnalyticsPrimitiveSummaryForBounds(db, {
      startAt: window.currentStart,
      endAt: window.currentEnd,
      rangeKey: window.rangeKey,
      searchSurface: options.searchSurface ?? null
    }),
    fetchAnalyticsPrimitiveSummaryForBounds(db, {
      startAt: window.previousStart,
      endAt: window.previousEnd,
      rangeKey: window.rangeKey,
      searchSurface: options.searchSurface ?? null
    }),
    fetchOverviewTrendSeries(db, options),
    fetchAnswerModeBreakdown(db, options),
    fetchSurfaceBreakdown(db, options)
  ]);

  const answerWith = answerModes.find((row) => row.include_answer === true) ?? {
    include_answer: true,
    searches: 0,
    impressions: 0,
    unique_outbound_clicks: 0,
    ctr: 0
  };
  const answerWithout = answerModes.find((row) => row.include_answer === false) ?? {
    include_answer: false,
    searches: 0,
    impressions: 0,
    unique_outbound_clicks: 0,
    ctr: 0
  };
  const legacySurfaceRows = surfaceBreakdown.filter((row) => row.search_surface == null).length;

  return {
    generated_at: new Date().toISOString(),
    window: serializeAnalyticsWindow(window),
    search_surface: options.searchSurface ?? null,
    summary: {
      searches: currentSummary.searches,
      searches_with_results: currentSummary.searchesWithResults,
      searches_with_answer: currentSummary.searchesWithAnswer,
      impressions: currentSummary.impressions,
      unique_outbound_clicks: currentSummary.uniqueOutboundClicks,
      unique_detail_page_views: currentSummary.uniqueDetailPageViews,
      overall_ctr: currentSummary.overallCtr,
      detail_assist_rate: currentSummary.detailAssistRate,
      detail_to_outbound_rate: currentSummary.detailToOutboundRate
    },
    metrics: {
      searches: buildMetricPayload(currentSummary.searches, previousSummary.searches),
      impressions: buildMetricPayload(currentSummary.impressions, previousSummary.impressions),
      unique_outbound_clicks: buildMetricPayload(currentSummary.uniqueOutboundClicks, previousSummary.uniqueOutboundClicks),
      overall_ctr: buildMetricPayload(currentSummary.overallCtr, previousSummary.overallCtr),
      detail_assist_rate: buildMetricPayload(currentSummary.detailAssistRate, previousSummary.detailAssistRate),
      answer_ctr_gap: buildMetricPayload(
        toFloat(answerWith.ctr) - toFloat(answerWithout.ctr),
        0
      )
    },
    trend_series: trendSeries,
    answer_modes: answerModes,
    surface_breakdown: surfaceBreakdown,
    notices: legacySurfaceRows > 0
      ? [
          {
            tone: "warning",
            title: "Legacy rows detected",
            description: "Some searches in this window were logged before search_surface attribution was added."
          }
        ]
      : []
  };
}

export async function fetchAdminAnalyticsContent(
  db: DatabaseClient,
  options: AdminAnalyticsQueryOptions
): Promise<Record<string, unknown>> {
  const window = resolveAnalyticsTimeWindow(options.rangeKey);
  const [topVideosByClicks, topVideosByCtr, topResultsByCtr, highImpressionLowClickVideos, crossQueryWinners] = await Promise.all([
    fetchVideoPerformanceRows(db, options, {
      orderBySql: "unique_outbound_clicks DESC, impressions DESC, title ASC"
    }),
    fetchVideoPerformanceRows(db, options, {
      orderBySql: "ctr DESC, unique_outbound_clicks DESC, impressions DESC, title ASC",
      minImpressions: DEFAULT_MIN_IMPRESSIONS
    }),
    fetchResultPerformanceRows(db, options, {
      orderBySql: "ctr DESC, unique_outbound_clicks DESC, impressions DESC, title ASC",
      minImpressions: DEFAULT_RESULT_MIN_IMPRESSIONS
    }),
    fetchVideoPerformanceRows(db, options, {
      orderBySql: "impressions DESC, ctr ASC, unique_outbound_clicks ASC, title ASC",
      minImpressions: DEFAULT_MIN_IMPRESSIONS
    }),
    fetchVideoPerformanceRows(db, options, {
      orderBySql: "distinct_queries_clicked DESC, unique_outbound_clicks DESC, impressions DESC, title ASC"
    })
  ]);

  return {
    generated_at: new Date().toISOString(),
    window: serializeAnalyticsWindow(window),
    search_surface: options.searchSurface ?? null,
    min_impressions: DEFAULT_MIN_IMPRESSIONS,
    min_result_impressions: DEFAULT_RESULT_MIN_IMPRESSIONS,
    top_videos_by_clicks: topVideosByClicks,
    top_videos_by_ctr: topVideosByCtr,
    top_results_by_ctr: topResultsByCtr,
    high_impression_low_click_videos: highImpressionLowClickVideos,
    cross_query_winners: crossQueryWinners
  };
}

export async function fetchAdminAnalyticsCreators(
  db: DatabaseClient,
  options: AdminAnalyticsQueryOptions
): Promise<Record<string, unknown>> {
  const window = resolveAnalyticsTimeWindow(options.rangeKey);
  const [topCreatorsByClicks, topCreatorsByCtr, creatorShareLeaders] = await Promise.all([
    fetchCreatorPerformanceRows(db, options, {
      orderBySql: "unique_outbound_clicks DESC, impressions DESC, creator ASC"
    }),
    fetchCreatorPerformanceRows(db, options, {
      orderBySql: "ctr DESC, unique_outbound_clicks DESC, impressions DESC, creator ASC",
      minImpressions: DEFAULT_MIN_IMPRESSIONS
    }),
    fetchCreatorPerformanceRows(db, options, {
      orderBySql: "share_delta DESC, unique_outbound_clicks DESC, impressions DESC, creator ASC",
      minImpressions: DEFAULT_MIN_IMPRESSIONS
    })
  ]);

  return {
    generated_at: new Date().toISOString(),
    window: serializeAnalyticsWindow(window),
    search_surface: options.searchSurface ?? null,
    min_impressions: DEFAULT_MIN_IMPRESSIONS,
    top_creators_by_clicks: topCreatorsByClicks,
    top_creators_by_ctr: topCreatorsByCtr,
    creator_share_leaders: creatorShareLeaders
  };
}

export async function fetchAdminAnalyticsSearchQuality(
  db: DatabaseClient,
  options: AdminAnalyticsQueryOptions
): Promise<Record<string, unknown>> {
  const window = resolveAnalyticsTimeWindow(options.rangeKey);
  const [topQueries, zeroResultQueries, highImpressionLowClickQueries, strongestQueries, rankBaselines] = await Promise.all([
    fetchQueryDemandRows(db, options, {
      orderBySql: "searches DESC, impressions DESC, unique_outbound_clicks DESC, normalized_query_text ASC"
    }),
    fetchQueryDemandRows(db, options, {
      orderBySql: "zero_result_searches DESC, searches DESC, normalized_query_text ASC",
      requireZeroResults: true
    }),
    fetchQueryDemandRows(db, options, {
      orderBySql: "impressions DESC, ctr ASC, unique_outbound_clicks ASC, normalized_query_text ASC",
      minImpressions: DEFAULT_QUERY_MIN_IMPRESSIONS
    }),
    fetchQueryDemandRows(db, options, {
      orderBySql: "ctr DESC, unique_outbound_clicks DESC, impressions DESC, normalized_query_text ASC",
      minImpressions: DEFAULT_QUERY_MIN_IMPRESSIONS
    }),
    fetchAnalyticsRankBaselines(db, options)
  ]);

  return {
    generated_at: new Date().toISOString(),
    window: serializeAnalyticsWindow(window),
    search_surface: options.searchSurface ?? null,
    min_query_impressions: DEFAULT_QUERY_MIN_IMPRESSIONS,
    top_queries: topQueries,
    zero_result_queries: zeroResultQueries,
    high_impression_low_click_queries: highImpressionLowClickQueries,
    strongest_queries: strongestQueries,
    rank_baselines: rankBaselines.map((row) => ({
      result_rank: row.resultRank,
      impressions: row.impressions,
      unique_outbound_clicks: row.uniqueOutboundClicks,
      ctr: row.ctr
    }))
  };
}

export async function fetchAdminAnalyticsFeedback(
  db: DatabaseClient,
  options: AdminAnalyticsQueryOptions
): Promise<Record<string, unknown>> {
  const window = resolveAnalyticsTimeWindow(options.rangeKey);
  const [summary, topVideosByLikes, topResultsByLikes, topResultsByDislikes] = await Promise.all([
    fetchFeedbackSummary(db, window),
    fetchFeedbackVideoRows(db, window),
    fetchFeedbackResultRows(db, window, "likes DESC, net_score DESC, v.title ASC"),
    fetchFeedbackResultRows(db, window, "dislikes DESC, net_score ASC, v.title ASC")
  ]);

  return {
    generated_at: new Date().toISOString(),
    window: serializeAnalyticsWindow(window),
    search_surface: "playground",
    summary,
    top_videos_by_likes: topVideosByLikes,
    top_results_by_likes: topResultsByLikes,
    top_results_by_dislikes: topResultsByDislikes,
    notice: {
      tone: "warning",
      title: "Playground-only feedback",
      description: "This section only reflects explicit thumbs-up and thumbs-down actions from the dashboard playground."
    }
  };
}
