import type { AdminMetricValue, AdminNotice, AdminRange, AdminWindow } from "./admin-api";
import { ApiClientError, fetchWithAuth } from "./api";

export type AdminSearchSurfaceFilter = "all" | "api" | "mcp" | "playground";

export type AdminAnalyticsTrendPoint = {
  date: string;
  searches: number;
  impressions: number;
  uniqueOutboundClicks: number;
  uniqueDetailPageViews: number;
  ctr: number;
};

export type AdminAnalyticsAnswerMode = {
  includeAnswer: boolean;
  searches: number;
  impressions: number;
  uniqueOutboundClicks: number;
  ctr: number;
};

export type AdminAnalyticsSurfaceBreakdown = {
  searchSurface: string | null;
  searches: number;
  impressions: number;
  uniqueOutboundClicks: number;
  ctr: number;
};

export type AdminAnalyticsOverview = {
  generatedAt: string;
  window: AdminWindow;
  searchSurface: string | null;
  summary: {
    searches: number;
    searchesWithResults: number;
    searchesWithAnswer: number;
    impressions: number;
    uniqueOutboundClicks: number;
    uniqueDetailPageViews: number;
    overallCtr: number;
    detailAssistRate: number;
    detailToOutboundRate: number;
  };
  metrics: {
    searches: AdminMetricValue;
    impressions: AdminMetricValue;
    uniqueOutboundClicks: AdminMetricValue;
    overallCtr: AdminMetricValue;
    detailAssistRate: AdminMetricValue;
    answerCtrGap: AdminMetricValue;
  };
  trendSeries: AdminAnalyticsTrendPoint[];
  answerModes: AdminAnalyticsAnswerMode[];
  surfaceBreakdown: AdminAnalyticsSurfaceBreakdown[];
  notices: AdminNotice[];
};

export type AdminAnalyticsContentRow = {
  videoId: string | null;
  shortId: string | null;
  unitId: string | null;
  title: string;
  source: string;
  creator: string | null;
  channelId: string | null;
  unitType: string | null;
  timestampStart: number | null;
  timestampEnd: number | null;
  impressions: number;
  uniqueOutboundClicks: number;
  ctr: number;
  rankAdjustedCtr: number;
  avgRank: number | null;
  distinctQueriesSeen: number;
  distinctQueriesClicked: number;
};

export type AdminAnalyticsContent = {
  generatedAt: string;
  window: AdminWindow;
  searchSurface: string | null;
  minImpressions: number;
  minResultImpressions: number;
  topVideosByClicks: AdminAnalyticsContentRow[];
  topVideosByCtr: AdminAnalyticsContentRow[];
  topResultsByCtr: AdminAnalyticsContentRow[];
  highImpressionLowClickVideos: AdminAnalyticsContentRow[];
  crossQueryWinners: AdminAnalyticsContentRow[];
};

export type AdminAnalyticsCreatorRow = {
  creatorKey: string;
  creator: string;
  source: string;
  channelId: string | null;
  impressions: number;
  uniqueOutboundClicks: number;
  ctr: number;
  rankAdjustedCtr: number;
  avgRank: number | null;
  distinctVideos: number;
  distinctQueriesClicked: number;
  impressionShare: number;
  outboundShare: number;
  shareDelta: number;
};

export type AdminAnalyticsCreators = {
  generatedAt: string;
  window: AdminWindow;
  searchSurface: string | null;
  minImpressions: number;
  topCreatorsByClicks: AdminAnalyticsCreatorRow[];
  topCreatorsByCtr: AdminAnalyticsCreatorRow[];
  creatorShareLeaders: AdminAnalyticsCreatorRow[];
};

export type AdminAnalyticsQueryRow = {
  normalizedQueryText: string;
  exampleQueryText: string;
  searches: number;
  zeroResultSearches: number;
  answerSearches: number;
  avgLatencyMs: number | null;
  impressions: number;
  uniqueOutboundClicks: number;
  ctr: number;
};

export type AdminAnalyticsRankBaseline = {
  resultRank: number;
  impressions: number;
  uniqueOutboundClicks: number;
  ctr: number;
};

export type AdminAnalyticsSearchQuality = {
  generatedAt: string;
  window: AdminWindow;
  searchSurface: string | null;
  minQueryImpressions: number;
  topQueries: AdminAnalyticsQueryRow[];
  zeroResultQueries: AdminAnalyticsQueryRow[];
  highImpressionLowClickQueries: AdminAnalyticsQueryRow[];
  strongestQueries: AdminAnalyticsQueryRow[];
  rankBaselines: AdminAnalyticsRankBaseline[];
};

export type AdminAnalyticsFeedbackSummary = {
  totalFeedback: number;
  likes: number;
  dislikes: number;
  uniqueUsers: number;
  likeRate: number;
  netScore: number;
};

export type AdminAnalyticsFeedbackVideoRow = {
  videoId: string;
  title: string;
  source: string;
  creator: string | null;
  channelId: string | null;
  likes: number;
  dislikes: number;
  netScore: number;
};

export type AdminAnalyticsFeedbackResultRow = {
  unitId: string;
  shortId: string | null;
  videoId: string | null;
  title: string;
  source: string;
  creator: string | null;
  channelId: string | null;
  unitType: string | null;
  timestampStart: number | null;
  timestampEnd: number | null;
  likes: number;
  dislikes: number;
  netScore: number;
};

export type AdminAnalyticsFeedback = {
  generatedAt: string;
  window: AdminWindow;
  searchSurface: string | null;
  summary: AdminAnalyticsFeedbackSummary;
  topVideosByLikes: AdminAnalyticsFeedbackVideoRow[];
  topResultsByLikes: AdminAnalyticsFeedbackResultRow[];
  topResultsByDislikes: AdminAnalyticsFeedbackResultRow[];
  notice: AdminNotice | null;
};

export type AdminAnalyticsDashboard = {
  overview: AdminAnalyticsOverview;
  content: AdminAnalyticsContent;
  creators: AdminAnalyticsCreators;
  searchQuality: AdminAnalyticsSearchQuality;
  feedback: AdminAnalyticsFeedback;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function ensureObject(payload: unknown, message: string): Record<string, unknown> {
  if (!isPlainObject(payload)) {
    throw new ApiClientError(message, {
      status: 500,
      code: "invalid_payload",
      details: payload,
    });
  }

  return payload;
}

function normalizeMetricValue(payload: unknown): AdminMetricValue {
  const raw = ensureObject(payload, "Invalid analytics metric payload.");

  return {
    current: isFiniteNumber(raw.current) ? raw.current : 0,
    previous: isFiniteNumber(raw.previous) ? raw.previous : 0,
    delta: isFiniteNumber(raw.delta) ? raw.delta : 0,
    deltaRatio: isFiniteNumber(raw.delta_ratio) ? raw.delta_ratio : null,
    target: isFiniteNumber(raw.target) ? raw.target : null,
    targetGap: isFiniteNumber(raw.target_gap) ? raw.target_gap : null,
    attainmentRatio: isFiniteNumber(raw.attainment_ratio) ? raw.attainment_ratio : null,
    comparisonMode:
      raw.comparison_mode === "at_most" || raw.comparison_mode === "at_least"
        ? raw.comparison_mode
        : null,
  };
}

function normalizeWindow(payload: unknown): AdminWindow {
  const raw = ensureObject(payload, "Invalid analytics window payload.");

  if (
    (raw.range_key !== "today" && raw.range_key !== "7d" && raw.range_key !== "30d") ||
    typeof raw.current_start !== "string" ||
    typeof raw.current_end !== "string" ||
    typeof raw.previous_start !== "string" ||
    typeof raw.previous_end !== "string"
  ) {
    throw new ApiClientError("Analytics response is missing the active window.", {
      status: 500,
      code: "invalid_payload",
      details: payload,
    });
  }

  return {
    rangeKey: raw.range_key,
    currentStart: raw.current_start,
    currentEnd: raw.current_end,
    previousStart: raw.previous_start,
    previousEnd: raw.previous_end,
  };
}

function normalizeNotice(payload: unknown): AdminNotice {
  const raw = ensureObject(payload, "Invalid analytics notice payload.");

  return {
    tone:
      raw.tone === "warning" || raw.tone === "error" || raw.tone === "default"
        ? raw.tone
        : "default",
    title: typeof raw.title === "string" ? raw.title : "",
    description: typeof raw.description === "string" ? raw.description : "",
  };
}

function normalizeTrendPoint(payload: unknown): AdminAnalyticsTrendPoint {
  const raw = ensureObject(payload, "Invalid analytics trend point.");
  return {
    date: typeof raw.date === "string" ? raw.date : "",
    searches: isFiniteNumber(raw.searches) ? raw.searches : 0,
    impressions: isFiniteNumber(raw.impressions) ? raw.impressions : 0,
    uniqueOutboundClicks: isFiniteNumber(raw.unique_outbound_clicks) ? raw.unique_outbound_clicks : 0,
    uniqueDetailPageViews: isFiniteNumber(raw.unique_detail_page_views) ? raw.unique_detail_page_views : 0,
    ctr: isFiniteNumber(raw.ctr) ? raw.ctr : 0,
  };
}

function normalizeAnalyticsContentRow(payload: unknown): AdminAnalyticsContentRow {
  const raw = ensureObject(payload, "Invalid analytics content row.");
  return {
    videoId: typeof raw.video_id === "string" ? raw.video_id : null,
    shortId: typeof raw.short_id === "string" ? raw.short_id : null,
    unitId: typeof raw.unit_id === "string" ? raw.unit_id : null,
    title: typeof raw.title === "string" ? raw.title : "",
    source: typeof raw.source === "string" ? raw.source : "",
    creator: typeof raw.creator === "string" ? raw.creator : null,
    channelId: typeof raw.channel_id === "string" ? raw.channel_id : null,
    unitType: typeof raw.unit_type === "string" ? raw.unit_type : null,
    timestampStart: isFiniteNumber(raw.timestamp_start) ? raw.timestamp_start : null,
    timestampEnd: isFiniteNumber(raw.timestamp_end) ? raw.timestamp_end : null,
    impressions: isFiniteNumber(raw.impressions) ? raw.impressions : 0,
    uniqueOutboundClicks: isFiniteNumber(raw.unique_outbound_clicks) ? raw.unique_outbound_clicks : 0,
    ctr: isFiniteNumber(raw.ctr) ? raw.ctr : 0,
    rankAdjustedCtr: isFiniteNumber(raw.rank_adjusted_ctr) ? raw.rank_adjusted_ctr : 0,
    avgRank: isFiniteNumber(raw.avg_rank) ? raw.avg_rank : null,
    distinctQueriesSeen: isFiniteNumber(raw.distinct_queries_seen) ? raw.distinct_queries_seen : 0,
    distinctQueriesClicked: isFiniteNumber(raw.distinct_queries_clicked) ? raw.distinct_queries_clicked : 0,
  };
}

function normalizeAnalyticsCreatorRow(payload: unknown): AdminAnalyticsCreatorRow {
  const raw = ensureObject(payload, "Invalid analytics creator row.");
  return {
    creatorKey: typeof raw.creator_key === "string" ? raw.creator_key : "",
    creator: typeof raw.creator === "string" ? raw.creator : "",
    source: typeof raw.source === "string" ? raw.source : "",
    channelId: typeof raw.channel_id === "string" ? raw.channel_id : null,
    impressions: isFiniteNumber(raw.impressions) ? raw.impressions : 0,
    uniqueOutboundClicks: isFiniteNumber(raw.unique_outbound_clicks) ? raw.unique_outbound_clicks : 0,
    ctr: isFiniteNumber(raw.ctr) ? raw.ctr : 0,
    rankAdjustedCtr: isFiniteNumber(raw.rank_adjusted_ctr) ? raw.rank_adjusted_ctr : 0,
    avgRank: isFiniteNumber(raw.avg_rank) ? raw.avg_rank : null,
    distinctVideos: isFiniteNumber(raw.distinct_videos) ? raw.distinct_videos : 0,
    distinctQueriesClicked: isFiniteNumber(raw.distinct_queries_clicked) ? raw.distinct_queries_clicked : 0,
    impressionShare: isFiniteNumber(raw.impression_share) ? raw.impression_share : 0,
    outboundShare: isFiniteNumber(raw.outbound_share) ? raw.outbound_share : 0,
    shareDelta: isFiniteNumber(raw.share_delta) ? raw.share_delta : 0,
  };
}

function normalizeAnalyticsQueryRow(payload: unknown): AdminAnalyticsQueryRow {
  const raw = ensureObject(payload, "Invalid analytics query row.");
  return {
    normalizedQueryText: typeof raw.normalized_query_text === "string" ? raw.normalized_query_text : "",
    exampleQueryText: typeof raw.example_query_text === "string" ? raw.example_query_text : "",
    searches: isFiniteNumber(raw.searches) ? raw.searches : 0,
    zeroResultSearches: isFiniteNumber(raw.zero_result_searches) ? raw.zero_result_searches : 0,
    answerSearches: isFiniteNumber(raw.answer_searches) ? raw.answer_searches : 0,
    avgLatencyMs: isFiniteNumber(raw.avg_latency_ms) ? raw.avg_latency_ms : null,
    impressions: isFiniteNumber(raw.impressions) ? raw.impressions : 0,
    uniqueOutboundClicks: isFiniteNumber(raw.unique_outbound_clicks) ? raw.unique_outbound_clicks : 0,
    ctr: isFiniteNumber(raw.ctr) ? raw.ctr : 0,
  };
}

function normalizeRankBaseline(payload: unknown): AdminAnalyticsRankBaseline {
  const raw = ensureObject(payload, "Invalid rank baseline payload.");
  return {
    resultRank: isFiniteNumber(raw.result_rank) ? raw.result_rank : 0,
    impressions: isFiniteNumber(raw.impressions) ? raw.impressions : 0,
    uniqueOutboundClicks: isFiniteNumber(raw.unique_outbound_clicks) ? raw.unique_outbound_clicks : 0,
    ctr: isFiniteNumber(raw.ctr) ? raw.ctr : 0,
  };
}

function normalizeFeedbackVideoRow(payload: unknown): AdminAnalyticsFeedbackVideoRow {
  const raw = ensureObject(payload, "Invalid feedback video row.");
  return {
    videoId: typeof raw.video_id === "string" ? raw.video_id : "",
    title: typeof raw.title === "string" ? raw.title : "",
    source: typeof raw.source === "string" ? raw.source : "",
    creator: typeof raw.creator === "string" ? raw.creator : null,
    channelId: typeof raw.channel_id === "string" ? raw.channel_id : null,
    likes: isFiniteNumber(raw.likes) ? raw.likes : 0,
    dislikes: isFiniteNumber(raw.dislikes) ? raw.dislikes : 0,
    netScore: isFiniteNumber(raw.net_score) ? raw.net_score : 0,
  };
}

function normalizeFeedbackResultRow(payload: unknown): AdminAnalyticsFeedbackResultRow {
  const raw = ensureObject(payload, "Invalid feedback result row.");
  return {
    unitId: typeof raw.unit_id === "string" ? raw.unit_id : "",
    shortId: typeof raw.short_id === "string" ? raw.short_id : null,
    videoId: typeof raw.video_id === "string" ? raw.video_id : null,
    title: typeof raw.title === "string" ? raw.title : "",
    source: typeof raw.source === "string" ? raw.source : "",
    creator: typeof raw.creator === "string" ? raw.creator : null,
    channelId: typeof raw.channel_id === "string" ? raw.channel_id : null,
    unitType: typeof raw.unit_type === "string" ? raw.unit_type : null,
    timestampStart: isFiniteNumber(raw.timestamp_start) ? raw.timestamp_start : null,
    timestampEnd: isFiniteNumber(raw.timestamp_end) ? raw.timestamp_end : null,
    likes: isFiniteNumber(raw.likes) ? raw.likes : 0,
    dislikes: isFiniteNumber(raw.dislikes) ? raw.dislikes : 0,
    netScore: isFiniteNumber(raw.net_score) ? raw.net_score : 0,
  };
}

function buildAnalyticsQuery(range: AdminRange, surface: AdminSearchSurfaceFilter): string {
  const params = new URLSearchParams();
  params.set("range", range);
  if (surface !== "all") {
    params.set("surface", surface);
  }
  return `?${params.toString()}`;
}

export function normalizeAdminAnalyticsOverview(payload: unknown): AdminAnalyticsOverview {
  const raw = ensureObject(payload, "Invalid admin analytics overview.");
  const summary = ensureObject(raw.summary, "Analytics overview is missing summary.");
  const metrics = ensureObject(raw.metrics, "Analytics overview is missing metrics.");

  return {
    generatedAt: typeof raw.generated_at === "string" ? raw.generated_at : "",
    window: normalizeWindow(raw.window),
    searchSurface: typeof raw.search_surface === "string" ? raw.search_surface : null,
    summary: {
      searches: isFiniteNumber(summary.searches) ? summary.searches : 0,
      searchesWithResults: isFiniteNumber(summary.searches_with_results) ? summary.searches_with_results : 0,
      searchesWithAnswer: isFiniteNumber(summary.searches_with_answer) ? summary.searches_with_answer : 0,
      impressions: isFiniteNumber(summary.impressions) ? summary.impressions : 0,
      uniqueOutboundClicks: isFiniteNumber(summary.unique_outbound_clicks) ? summary.unique_outbound_clicks : 0,
      uniqueDetailPageViews: isFiniteNumber(summary.unique_detail_page_views) ? summary.unique_detail_page_views : 0,
      overallCtr: isFiniteNumber(summary.overall_ctr) ? summary.overall_ctr : 0,
      detailAssistRate: isFiniteNumber(summary.detail_assist_rate) ? summary.detail_assist_rate : 0,
      detailToOutboundRate: isFiniteNumber(summary.detail_to_outbound_rate) ? summary.detail_to_outbound_rate : 0,
    },
    metrics: {
      searches: normalizeMetricValue(metrics.searches),
      impressions: normalizeMetricValue(metrics.impressions),
      uniqueOutboundClicks: normalizeMetricValue(metrics.unique_outbound_clicks),
      overallCtr: normalizeMetricValue(metrics.overall_ctr),
      detailAssistRate: normalizeMetricValue(metrics.detail_assist_rate),
      answerCtrGap: normalizeMetricValue(metrics.answer_ctr_gap),
    },
    trendSeries: Array.isArray(raw.trend_series) ? raw.trend_series.map((item) => normalizeTrendPoint(item)) : [],
    answerModes: Array.isArray(raw.answer_modes)
      ? raw.answer_modes.map((item) => {
          const value = ensureObject(item, "Invalid answer mode payload.");
          return {
            includeAnswer: value.include_answer === true,
            searches: isFiniteNumber(value.searches) ? value.searches : 0,
            impressions: isFiniteNumber(value.impressions) ? value.impressions : 0,
            uniqueOutboundClicks: isFiniteNumber(value.unique_outbound_clicks) ? value.unique_outbound_clicks : 0,
            ctr: isFiniteNumber(value.ctr) ? value.ctr : 0,
          };
        })
      : [],
    surfaceBreakdown: Array.isArray(raw.surface_breakdown)
      ? raw.surface_breakdown.map((item) => {
          const value = ensureObject(item, "Invalid surface breakdown payload.");
          return {
            searchSurface: typeof value.search_surface === "string" ? value.search_surface : null,
            searches: isFiniteNumber(value.searches) ? value.searches : 0,
            impressions: isFiniteNumber(value.impressions) ? value.impressions : 0,
            uniqueOutboundClicks: isFiniteNumber(value.unique_outbound_clicks) ? value.unique_outbound_clicks : 0,
            ctr: isFiniteNumber(value.ctr) ? value.ctr : 0,
          };
        })
      : [],
    notices: Array.isArray(raw.notices) ? raw.notices.map((item) => normalizeNotice(item)) : [],
  };
}

export function normalizeAdminAnalyticsContent(payload: unknown): AdminAnalyticsContent {
  const raw = ensureObject(payload, "Invalid admin analytics content response.");
  return {
    generatedAt: typeof raw.generated_at === "string" ? raw.generated_at : "",
    window: normalizeWindow(raw.window),
    searchSurface: typeof raw.search_surface === "string" ? raw.search_surface : null,
    minImpressions: isFiniteNumber(raw.min_impressions) ? raw.min_impressions : 0,
    minResultImpressions: isFiniteNumber(raw.min_result_impressions) ? raw.min_result_impressions : 0,
    topVideosByClicks: Array.isArray(raw.top_videos_by_clicks) ? raw.top_videos_by_clicks.map((item) => normalizeAnalyticsContentRow(item)) : [],
    topVideosByCtr: Array.isArray(raw.top_videos_by_ctr) ? raw.top_videos_by_ctr.map((item) => normalizeAnalyticsContentRow(item)) : [],
    topResultsByCtr: Array.isArray(raw.top_results_by_ctr) ? raw.top_results_by_ctr.map((item) => normalizeAnalyticsContentRow(item)) : [],
    highImpressionLowClickVideos: Array.isArray(raw.high_impression_low_click_videos)
      ? raw.high_impression_low_click_videos.map((item) => normalizeAnalyticsContentRow(item))
      : [],
    crossQueryWinners: Array.isArray(raw.cross_query_winners)
      ? raw.cross_query_winners.map((item) => normalizeAnalyticsContentRow(item))
      : [],
  };
}

export function normalizeAdminAnalyticsCreators(payload: unknown): AdminAnalyticsCreators {
  const raw = ensureObject(payload, "Invalid admin analytics creators response.");
  return {
    generatedAt: typeof raw.generated_at === "string" ? raw.generated_at : "",
    window: normalizeWindow(raw.window),
    searchSurface: typeof raw.search_surface === "string" ? raw.search_surface : null,
    minImpressions: isFiniteNumber(raw.min_impressions) ? raw.min_impressions : 0,
    topCreatorsByClicks: Array.isArray(raw.top_creators_by_clicks) ? raw.top_creators_by_clicks.map((item) => normalizeAnalyticsCreatorRow(item)) : [],
    topCreatorsByCtr: Array.isArray(raw.top_creators_by_ctr) ? raw.top_creators_by_ctr.map((item) => normalizeAnalyticsCreatorRow(item)) : [],
    creatorShareLeaders: Array.isArray(raw.creator_share_leaders) ? raw.creator_share_leaders.map((item) => normalizeAnalyticsCreatorRow(item)) : [],
  };
}

export function normalizeAdminAnalyticsSearchQuality(payload: unknown): AdminAnalyticsSearchQuality {
  const raw = ensureObject(payload, "Invalid admin analytics search quality response.");
  return {
    generatedAt: typeof raw.generated_at === "string" ? raw.generated_at : "",
    window: normalizeWindow(raw.window),
    searchSurface: typeof raw.search_surface === "string" ? raw.search_surface : null,
    minQueryImpressions: isFiniteNumber(raw.min_query_impressions) ? raw.min_query_impressions : 0,
    topQueries: Array.isArray(raw.top_queries) ? raw.top_queries.map((item) => normalizeAnalyticsQueryRow(item)) : [],
    zeroResultQueries: Array.isArray(raw.zero_result_queries) ? raw.zero_result_queries.map((item) => normalizeAnalyticsQueryRow(item)) : [],
    highImpressionLowClickQueries: Array.isArray(raw.high_impression_low_click_queries) ? raw.high_impression_low_click_queries.map((item) => normalizeAnalyticsQueryRow(item)) : [],
    strongestQueries: Array.isArray(raw.strongest_queries) ? raw.strongest_queries.map((item) => normalizeAnalyticsQueryRow(item)) : [],
    rankBaselines: Array.isArray(raw.rank_baselines) ? raw.rank_baselines.map((item) => normalizeRankBaseline(item)) : [],
  };
}

export function normalizeAdminAnalyticsFeedback(payload: unknown): AdminAnalyticsFeedback {
  const raw = ensureObject(payload, "Invalid admin analytics feedback response.");
  const summary = ensureObject(raw.summary, "Analytics feedback is missing summary.");
  return {
    generatedAt: typeof raw.generated_at === "string" ? raw.generated_at : "",
    window: normalizeWindow(raw.window),
    searchSurface: typeof raw.search_surface === "string" ? raw.search_surface : null,
    summary: {
      totalFeedback: isFiniteNumber(summary.total_feedback) ? summary.total_feedback : 0,
      likes: isFiniteNumber(summary.likes) ? summary.likes : 0,
      dislikes: isFiniteNumber(summary.dislikes) ? summary.dislikes : 0,
      uniqueUsers: isFiniteNumber(summary.unique_users) ? summary.unique_users : 0,
      likeRate: isFiniteNumber(summary.like_rate) ? summary.like_rate : 0,
      netScore: isFiniteNumber(summary.net_score) ? summary.net_score : 0,
    },
    topVideosByLikes: Array.isArray(raw.top_videos_by_likes) ? raw.top_videos_by_likes.map((item) => normalizeFeedbackVideoRow(item)) : [],
    topResultsByLikes: Array.isArray(raw.top_results_by_likes) ? raw.top_results_by_likes.map((item) => normalizeFeedbackResultRow(item)) : [],
    topResultsByDislikes: Array.isArray(raw.top_results_by_dislikes) ? raw.top_results_by_dislikes.map((item) => normalizeFeedbackResultRow(item)) : [],
    notice: isPlainObject(raw.notice) ? normalizeNotice(raw.notice) : null,
  };
}

export const adminAnalytics = {
  async getOverview(range: AdminRange, surface: AdminSearchSurfaceFilter): Promise<AdminAnalyticsOverview> {
    const payload = await fetchWithAuth<unknown>(`/admin/analytics/overview${buildAnalyticsQuery(range, surface)}`, {
      method: "GET",
      cache: "no-store",
    });
    return normalizeAdminAnalyticsOverview(payload);
  },

  async getContent(range: AdminRange, surface: AdminSearchSurfaceFilter): Promise<AdminAnalyticsContent> {
    const payload = await fetchWithAuth<unknown>(`/admin/analytics/content${buildAnalyticsQuery(range, surface)}`, {
      method: "GET",
      cache: "no-store",
    });
    return normalizeAdminAnalyticsContent(payload);
  },

  async getCreators(range: AdminRange, surface: AdminSearchSurfaceFilter): Promise<AdminAnalyticsCreators> {
    const payload = await fetchWithAuth<unknown>(`/admin/analytics/creators${buildAnalyticsQuery(range, surface)}`, {
      method: "GET",
      cache: "no-store",
    });
    return normalizeAdminAnalyticsCreators(payload);
  },

  async getSearchQuality(range: AdminRange, surface: AdminSearchSurfaceFilter): Promise<AdminAnalyticsSearchQuality> {
    const payload = await fetchWithAuth<unknown>(`/admin/analytics/search-quality${buildAnalyticsQuery(range, surface)}`, {
      method: "GET",
      cache: "no-store",
    });
    return normalizeAdminAnalyticsSearchQuality(payload);
  },

  async getFeedback(range: AdminRange, surface: AdminSearchSurfaceFilter): Promise<AdminAnalyticsFeedback> {
    const payload = await fetchWithAuth<unknown>(`/admin/analytics/feedback${buildAnalyticsQuery(range, surface)}`, {
      method: "GET",
      cache: "no-store",
    });
    return normalizeAdminAnalyticsFeedback(payload);
  },

  async getDashboard(range: AdminRange, surface: AdminSearchSurfaceFilter): Promise<AdminAnalyticsDashboard> {
    const [overview, content, creators, searchQuality, feedback] = await Promise.all([
      adminAnalytics.getOverview(range, surface),
      adminAnalytics.getContent(range, surface),
      adminAnalytics.getCreators(range, surface),
      adminAnalytics.getSearchQuality(range, surface),
      adminAnalytics.getFeedback(range, surface),
    ]);

    return {
      overview,
      content,
      creators,
      searchQuality,
      feedback,
    };
  },
};
