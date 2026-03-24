import { ApiClientError, fetchWithAuth } from "./api";

export type AdminRange = "today" | "7d" | "30d";
export type AdminTargetScopeType = "global" | "track" | "source";
export type AdminTargetComparisonMode = "at_least" | "at_most";

export type AdminWindow = {
  rangeKey: AdminRange;
  currentStart: string;
  currentEnd: string;
  previousStart: string;
  previousEnd: string;
};

export type AdminMetricValue = {
  current: number;
  previous: number;
  delta: number;
  deltaRatio: number | null;
  target: number | null;
  targetGap: number | null;
  attainmentRatio: number | null;
  comparisonMode: AdminTargetComparisonMode | null;
};

export type AdminNamedCount = {
  key: string;
  label: string;
  count: number;
};

export type AdminSummaryPoint = {
  date: string;
  requests: number;
  creditsUsed: number;
  zeroResultQueries: number;
  brollAssetsAdded: number;
  knowledgeVideosAdded: number;
  knowledgeSegmentsAdded: number;
  jobsCompleted: number;
  jobsFailed: number;
  latencyP95Ms: number | null;
};

export type AdminNotice = {
  tone: "default" | "warning" | "error";
  title: string;
  description: string;
};

export type AdminSummary = {
  generatedAt: string;
  window: AdminWindow;
  metrics: {
    totalUsers: AdminMetricValue;
    newUsers: AdminMetricValue;
    activeUsers: AdminMetricValue;
    requests: AdminMetricValue;
    creditsUsed: AdminMetricValue;
    zeroResultRate: AdminMetricValue;
    indexedAssets: AdminMetricValue;
    indexedSegments: AdminMetricValue;
    pendingJobs: AdminMetricValue;
    failedJobs: AdminMetricValue;
  };
  requestSeries: AdminSummaryPoint[];
  contentSeries: AdminSummaryPoint[];
  ingestionSeries: AdminSummaryPoint[];
  notices: AdminNotice[];
};

export type AdminRecentUser = {
  userId: string;
  email: string | null;
  tier: string;
  consoleRole: string;
  createdAt: string;
  activeApiKeys: number;
  lastRequestAt: string | null;
};

export type AdminActiveUser = {
  userId: string;
  email: string | null;
  tier: string;
  requestCount: number;
  creditsUsed: number;
  lastRequestAt: string | null;
};

export type AdminUsersSummary = {
  generatedAt: string;
  window: AdminWindow;
  metrics: {
    totalUsers: AdminMetricValue;
    newUsers: AdminMetricValue;
    activeUsers: AdminMetricValue;
    activeApiKeys: AdminMetricValue;
  };
  dailySignups: AdminNamedCount[];
  tiers: AdminNamedCount[];
  consoleRoles: AdminNamedCount[];
  recentUsers: AdminRecentUser[];
  mostActiveUsers: AdminActiveUser[];
};

export type AdminQueryBucket = {
  queryText: string;
  requestCount: number;
  zeroResultCount: number;
  answerCount: number;
  avgLatencyMs: number | null;
};

export type AdminRequestsSummary = {
  generatedAt: string;
  window: AdminWindow;
  metrics: {
    totalRequests: AdminMetricValue;
    creditsUsed: AdminMetricValue;
    activeUsers: AdminMetricValue;
    averageCreditsPerRequest: AdminMetricValue;
    zeroResultRate: AdminMetricValue;
    answerUsageRate: AdminMetricValue;
    latency: {
      p50Ms: AdminMetricValue;
      p95Ms: AdminMetricValue;
      p99Ms: AdminMetricValue;
    };
  };
  dailySeries: AdminSummaryPoint[];
  topQueries: AdminQueryBucket[];
  zeroResultQueries: AdminQueryBucket[];
};

export type AdminSourceGrowth = {
  track: string;
  sourceKey: string;
  additions: number;
};

export type AdminSourceFreshness = {
  sourceId: string;
  slug: string;
  displayName: string;
  track: string;
  isActive: boolean;
  lastJobAt: string | null;
  jobsInRange: number;
  isStale: boolean;
};

export type AdminContentSummary = {
  generatedAt: string;
  window: AdminWindow;
  metrics: {
    brollAssetsTotal: AdminMetricValue;
    knowledgeVideosTotal: AdminMetricValue;
    knowledgeSegmentsTotal: AdminMetricValue;
    activeSourcesTotal: AdminMetricValue;
    brollAssetsAdded: AdminMetricValue;
    knowledgeVideosAdded: AdminMetricValue;
    knowledgeSegmentsAdded: AdminMetricValue;
  };
  dailySeries: AdminSummaryPoint[];
  perSourceGrowth: AdminSourceGrowth[];
  staleSources: AdminSourceFreshness[];
};

export type AdminSourceHealth = {
  sourceId: string;
  slug: string;
  displayName: string;
  track: string;
  isActive: boolean;
  jobsCreated: number;
  jobsCompleted: number;
  jobsFailed: number;
  backlog: number;
  lastJobAt: string | null;
};

export type AdminFailedJob = {
  jobId: string;
  track: string;
  jobType: string;
  sourceId: string | null;
  errorMessage: string | null;
  attempts: number;
  maxAttempts: number;
  updatedAt: string;
};

export type AdminFailedStep = {
  stepName: string;
  failureCount: number;
  lastFailedAt: string | null;
};

export type AdminIngestionSummary = {
  generatedAt: string;
  window: AdminWindow;
  metrics: {
    jobsCreated: AdminMetricValue;
    jobsCompleted: AdminMetricValue;
    jobsFailed: AdminMetricValue;
    completionRate: AdminMetricValue;
    failureRate: AdminMetricValue;
    pendingBacklog: AdminMetricValue;
    averageProcessingMs: AdminMetricValue;
  };
  statusCounts: {
    pending: number;
    running: number;
    retrying: number;
    completed: number;
    failed: number;
  };
  dailySeries: AdminSummaryPoint[];
  sourceHealth: AdminSourceHealth[];
  recentFailedJobs: AdminFailedJob[];
  failedSteps: AdminFailedStep[];
};

export type AdminMetricTarget = {
  id: string;
  metricName: string;
  scopeType: AdminTargetScopeType;
  scopeKey: string;
  rangeKey: AdminRange;
  comparisonMode: AdminTargetComparisonMode;
  targetValue: number;
  note: string | null;
  updatedAt: string;
  actualValue: number | null;
  attainmentRatio: number | null;
  targetGap: number | null;
};

export type AdminTargetsResponse = {
  generatedAt: string;
  window: AdminWindow;
  targets: AdminMetricTarget[];
};

export type AdminMetricTargetInput = {
  metricName: string;
  scopeType: AdminTargetScopeType;
  scopeKey: string;
  rangeKey: AdminRange;
  comparisonMode: AdminTargetComparisonMode;
  targetValue: number;
  note: string | null;
};

export type AdminWorkerStep = {
  stepName: string;
  status: string;
  artifacts: unknown;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string | null;
  durationMs: number | null;
  guidance: string | null;
  logs: Array<{
    at: string | null;
    level: string;
    message: string;
    details: Record<string, unknown> | null;
  }>;
  errorMessage: string | null;
};

export type AdminWorkerJob = {
  jobId: string;
  track: string;
  status: string;
  source: string | null;
  videoId: string | null;
  title: string | null;
  startedAt: string | null;
  createdAt: string;
  lastActivityAt: string | null;
  attempts: number;
  maxAttempts: number;
  totalDurationMs: number | null;
  errorMessage: string | null;
  steps: AdminWorkerStep[];
};

export type AdminWorkerCompletedJob = {
  jobId: string;
  videoId: string | null;
  title: string | null;
  segmentCount: number;
  completedAt: string | null;
  totalDurationMs: number | null;
};

export type AdminWorkerLive = {
  generatedAt: string;
  queue: {
    pending: number;
    running: number;
    retrying: number;
    completed: number;
    failed: number;
  };
  activeJobs: AdminWorkerJob[];
  recentCompleted: AdminWorkerCompletedJob[];
  failedJobs: AdminWorkerJob[];
  failedJobsTotal: number;
  failedJobsLimit: number;
  failedJobsOffset: number;
};

export type AdminIndexedVideo = {
  videoId: string;
  source: string;
  sourceVideoId: string;
  title: string;
  sourceUrl: string | null;
  videoUrl: string | null;
  speaker: string | null;
  createdAt: string;
  updatedAt: string;
  unitsCreated: number;
  lastJobStatus: string | null;
  lastJobAt: string | null;
};

export type AdminIndexedVideosResponse = {
  generatedAt: string;
  videos: AdminIndexedVideo[];
  total: number;
  limit: number;
  offset: number;
  query: string | null;
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
  const raw = ensureObject(payload, "Invalid admin metric payload.");

  return {
    current: isFiniteNumber(raw.current) ? raw.current : 0,
    previous: isFiniteNumber(raw.previous) ? raw.previous : 0,
    delta: isFiniteNumber(raw.delta) ? raw.delta : 0,
    deltaRatio: isFiniteNumber(raw.delta_ratio) ? raw.delta_ratio : null,
    target: isFiniteNumber(raw.target) ? raw.target : null,
    targetGap: isFiniteNumber(raw.target_gap) ? raw.target_gap : null,
    attainmentRatio: isFiniteNumber(raw.attainment_ratio)
      ? raw.attainment_ratio
      : null,
    comparisonMode:
      raw.comparison_mode === "at_most" || raw.comparison_mode === "at_least"
        ? raw.comparison_mode
        : null,
  };
}

function normalizeWindow(payload: unknown): AdminWindow {
  const raw = ensureObject(payload, "Invalid admin window payload.");

  if (
    (raw.range_key !== "today" && raw.range_key !== "7d" && raw.range_key !== "30d") ||
    typeof raw.current_start !== "string" ||
    typeof raw.current_end !== "string" ||
    typeof raw.previous_start !== "string" ||
    typeof raw.previous_end !== "string"
  ) {
    throw new ApiClientError("Admin response is missing the active window.", {
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

function normalizeNamedCount(payload: unknown): AdminNamedCount {
  const raw = ensureObject(payload, "Invalid admin count payload.");

  return {
    key: typeof raw.key === "string" ? raw.key : "",
    label: typeof raw.label === "string" ? raw.label : "",
    count: isFiniteNumber(raw.count) ? raw.count : 0,
  };
}

function normalizeSummaryPoint(payload: unknown): AdminSummaryPoint {
  const raw = ensureObject(payload, "Invalid admin series point.");

  return {
    date: typeof raw.date === "string" ? raw.date : "",
    requests: isFiniteNumber(raw.requests) ? raw.requests : 0,
    creditsUsed: isFiniteNumber(raw.credits_used) ? raw.credits_used : 0,
    zeroResultQueries: isFiniteNumber(raw.zero_result_queries)
      ? raw.zero_result_queries
      : 0,
    brollAssetsAdded: isFiniteNumber(raw.broll_assets_added)
      ? raw.broll_assets_added
      : 0,
    knowledgeVideosAdded: isFiniteNumber(raw.knowledge_videos_added)
      ? raw.knowledge_videos_added
      : 0,
    knowledgeSegmentsAdded: isFiniteNumber(raw.knowledge_segments_added)
      ? raw.knowledge_segments_added
      : 0,
    jobsCompleted: isFiniteNumber(raw.jobs_completed) ? raw.jobs_completed : 0,
    jobsFailed: isFiniteNumber(raw.jobs_failed) ? raw.jobs_failed : 0,
    latencyP95Ms: isFiniteNumber(raw.latency_p95_ms) ? raw.latency_p95_ms : null,
  };
}

function normalizeSummaryPoints(payload: unknown): AdminSummaryPoint[] {
  return Array.isArray(payload) ? payload.map((item) => normalizeSummaryPoint(item)) : [];
}

function normalizeNamedCounts(payload: unknown): AdminNamedCount[] {
  return Array.isArray(payload) ? payload.map((item) => normalizeNamedCount(item)) : [];
}

function normalizeNotice(payload: unknown): AdminNotice {
  const raw = ensureObject(payload, "Invalid admin notice payload.");

  return {
    tone:
      raw.tone === "warning" || raw.tone === "error" || raw.tone === "default"
        ? raw.tone
        : "default",
    title: typeof raw.title === "string" ? raw.title : "",
    description: typeof raw.description === "string" ? raw.description : "",
  };
}

function normalizeQueryBucket(payload: unknown): AdminQueryBucket {
  const raw = ensureObject(payload, "Invalid query bucket payload.");

  return {
    queryText: typeof raw.query_text === "string" ? raw.query_text : "",
    requestCount: isFiniteNumber(raw.request_count) ? raw.request_count : 0,
    zeroResultCount: isFiniteNumber(raw.zero_result_count)
      ? raw.zero_result_count
      : 0,
    answerCount: isFiniteNumber(raw.answer_count) ? raw.answer_count : 0,
    avgLatencyMs: isFiniteNumber(raw.avg_latency_ms) ? raw.avg_latency_ms : null,
  };
}

function normalizeQueryBuckets(payload: unknown): AdminQueryBucket[] {
  return Array.isArray(payload) ? payload.map((item) => normalizeQueryBucket(item)) : [];
}

function buildRangeQuery(range: AdminRange): string {
  return `?range=${encodeURIComponent(range)}`;
}

export function normalizeAdminSummary(payload: unknown): AdminSummary {
  const raw = ensureObject(payload, "Invalid admin summary response.");
  const metrics = ensureObject(raw.metrics, "Admin summary is missing metrics.");

  return {
    generatedAt: typeof raw.generated_at === "string" ? raw.generated_at : "",
    window: normalizeWindow(raw.window),
    metrics: {
      totalUsers: normalizeMetricValue(metrics.total_users),
      newUsers: normalizeMetricValue(metrics.new_users),
      activeUsers: normalizeMetricValue(metrics.active_users),
      requests: normalizeMetricValue(metrics.requests),
      creditsUsed: normalizeMetricValue(metrics.credits_used),
      zeroResultRate: normalizeMetricValue(metrics.zero_result_rate),
      indexedAssets: normalizeMetricValue(metrics.indexed_assets),
      indexedSegments: normalizeMetricValue(metrics.indexed_segments),
      pendingJobs: normalizeMetricValue(metrics.pending_jobs),
      failedJobs: normalizeMetricValue(metrics.failed_jobs),
    },
    requestSeries: normalizeSummaryPoints(raw.request_series),
    contentSeries: normalizeSummaryPoints(raw.content_series),
    ingestionSeries: normalizeSummaryPoints(raw.ingestion_series),
    notices: Array.isArray(raw.notices) ? raw.notices.map((item) => normalizeNotice(item)) : [],
  };
}

export function normalizeAdminUsersSummary(payload: unknown): AdminUsersSummary {
  const raw = ensureObject(payload, "Invalid admin users response.");
  const metrics = ensureObject(raw.metrics, "Admin users summary is missing metrics.");

  return {
    generatedAt: typeof raw.generated_at === "string" ? raw.generated_at : "",
    window: normalizeWindow(raw.window),
    metrics: {
      totalUsers: normalizeMetricValue(metrics.total_users),
      newUsers: normalizeMetricValue(metrics.new_users),
      activeUsers: normalizeMetricValue(metrics.active_users),
      activeApiKeys: normalizeMetricValue(metrics.active_api_keys),
    },
    dailySignups: normalizeNamedCounts(raw.daily_signups),
    tiers: normalizeNamedCounts(raw.tiers),
    consoleRoles: normalizeNamedCounts(raw.console_roles),
    recentUsers: Array.isArray(raw.recent_users)
      ? raw.recent_users.map((item) => {
          const user = ensureObject(item, "Invalid recent user payload.");
          return {
            userId: typeof user.user_id === "string" ? user.user_id : "",
            email: typeof user.email === "string" ? user.email : null,
            tier: typeof user.tier === "string" ? user.tier : "free",
            consoleRole:
              typeof user.console_role === "string" ? user.console_role : "user",
            createdAt: typeof user.created_at === "string" ? user.created_at : "",
            activeApiKeys: isFiniteNumber(user.active_api_keys)
              ? user.active_api_keys
              : 0,
            lastRequestAt:
              typeof user.last_request_at === "string" ? user.last_request_at : null,
          };
        })
      : [],
    mostActiveUsers: Array.isArray(raw.most_active_users)
      ? raw.most_active_users.map((item) => {
          const user = ensureObject(item, "Invalid active user payload.");
          return {
            userId: typeof user.user_id === "string" ? user.user_id : "",
            email: typeof user.email === "string" ? user.email : null,
            tier: typeof user.tier === "string" ? user.tier : "free",
            requestCount: isFiniteNumber(user.request_count) ? user.request_count : 0,
            creditsUsed: isFiniteNumber(user.credits_used) ? user.credits_used : 0,
            lastRequestAt:
              typeof user.last_request_at === "string" ? user.last_request_at : null,
          };
        })
      : [],
  };
}

export function normalizeAdminRequestsSummary(payload: unknown): AdminRequestsSummary {
  const raw = ensureObject(payload, "Invalid admin requests response.");
  const metrics = ensureObject(raw.metrics, "Admin requests summary is missing metrics.");
  const latency = ensureObject(metrics.latency, "Admin requests latency metrics are missing.");

  return {
    generatedAt: typeof raw.generated_at === "string" ? raw.generated_at : "",
    window: normalizeWindow(raw.window),
    metrics: {
      totalRequests: normalizeMetricValue(metrics.total_requests),
      creditsUsed: normalizeMetricValue(metrics.credits_used),
      activeUsers: normalizeMetricValue(metrics.active_users),
      averageCreditsPerRequest: normalizeMetricValue(metrics.average_credits_per_request),
      zeroResultRate: normalizeMetricValue(metrics.zero_result_rate),
      answerUsageRate: normalizeMetricValue(metrics.answer_usage_rate),
      latency: {
        p50Ms: normalizeMetricValue(latency.p50_ms),
        p95Ms: normalizeMetricValue(latency.p95_ms),
        p99Ms: normalizeMetricValue(latency.p99_ms),
      },
    },
    dailySeries: normalizeSummaryPoints(raw.daily_series),
    topQueries: normalizeQueryBuckets(raw.top_queries),
    zeroResultQueries: normalizeQueryBuckets(raw.zero_result_queries),
  };
}

export function normalizeAdminContentSummary(payload: unknown): AdminContentSummary {
  const raw = ensureObject(payload, "Invalid admin content response.");
  const metrics = ensureObject(raw.metrics, "Admin content summary is missing metrics.");

  return {
    generatedAt: typeof raw.generated_at === "string" ? raw.generated_at : "",
    window: normalizeWindow(raw.window),
    metrics: {
      brollAssetsTotal: normalizeMetricValue(metrics.broll_assets_total),
      knowledgeVideosTotal: normalizeMetricValue(metrics.knowledge_videos_total),
      knowledgeSegmentsTotal: normalizeMetricValue(metrics.knowledge_segments_total),
      activeSourcesTotal: normalizeMetricValue(metrics.active_sources_total),
      brollAssetsAdded: normalizeMetricValue(metrics.broll_assets_added),
      knowledgeVideosAdded: normalizeMetricValue(metrics.knowledge_videos_added),
      knowledgeSegmentsAdded: normalizeMetricValue(metrics.knowledge_segments_added),
    },
    dailySeries: normalizeSummaryPoints(raw.daily_series),
    perSourceGrowth: Array.isArray(raw.per_source_growth)
      ? raw.per_source_growth.map((item) => {
          const value = ensureObject(item, "Invalid source growth payload.");
          return {
            track: typeof value.track === "string" ? value.track : "",
            sourceKey: typeof value.source_key === "string" ? value.source_key : "",
            additions: isFiniteNumber(value.additions) ? value.additions : 0,
          };
        })
      : [],
    staleSources: Array.isArray(raw.stale_sources)
      ? raw.stale_sources.map((item) => {
          const value = ensureObject(item, "Invalid source freshness payload.");
          return {
            sourceId: typeof value.source_id === "string" ? value.source_id : "",
            slug: typeof value.slug === "string" ? value.slug : "",
            displayName:
              typeof value.display_name === "string" ? value.display_name : "",
            track: typeof value.track === "string" ? value.track : "",
            isActive: value.is_active === true,
            lastJobAt:
              typeof value.last_job_at === "string" ? value.last_job_at : null,
            jobsInRange: isFiniteNumber(value.jobs_in_range)
              ? value.jobs_in_range
              : 0,
            isStale: value.is_stale === true,
          };
        })
      : [],
  };
}

export function normalizeAdminIngestionSummary(payload: unknown): AdminIngestionSummary {
  const raw = ensureObject(payload, "Invalid admin ingestion response.");
  const metrics = ensureObject(raw.metrics, "Admin ingestion summary is missing metrics.");
  const statusCounts = ensureObject(raw.status_counts, "Admin ingestion status counts are missing.");

  return {
    generatedAt: typeof raw.generated_at === "string" ? raw.generated_at : "",
    window: normalizeWindow(raw.window),
    metrics: {
      jobsCreated: normalizeMetricValue(metrics.jobs_created),
      jobsCompleted: normalizeMetricValue(metrics.jobs_completed),
      jobsFailed: normalizeMetricValue(metrics.jobs_failed),
      completionRate: normalizeMetricValue(metrics.completion_rate),
      failureRate: normalizeMetricValue(metrics.failure_rate),
      pendingBacklog: normalizeMetricValue(metrics.pending_backlog),
      averageProcessingMs: normalizeMetricValue(metrics.average_processing_ms),
    },
    statusCounts: {
      pending: isFiniteNumber(statusCounts.pending) ? statusCounts.pending : 0,
      running: isFiniteNumber(statusCounts.running) ? statusCounts.running : 0,
      retrying: isFiniteNumber(statusCounts.retrying) ? statusCounts.retrying : 0,
      completed: isFiniteNumber(statusCounts.completed) ? statusCounts.completed : 0,
      failed: isFiniteNumber(statusCounts.failed) ? statusCounts.failed : 0,
    },
    dailySeries: normalizeSummaryPoints(raw.daily_series),
    sourceHealth: Array.isArray(raw.source_health)
      ? raw.source_health.map((item) => {
          const value = ensureObject(item, "Invalid source health payload.");
          return {
            sourceId: typeof value.source_id === "string" ? value.source_id : "",
            slug: typeof value.slug === "string" ? value.slug : "",
            displayName:
              typeof value.display_name === "string" ? value.display_name : "",
            track: typeof value.track === "string" ? value.track : "",
            isActive: value.is_active === true,
            jobsCreated: isFiniteNumber(value.jobs_created) ? value.jobs_created : 0,
            jobsCompleted: isFiniteNumber(value.jobs_completed)
              ? value.jobs_completed
              : 0,
            jobsFailed: isFiniteNumber(value.jobs_failed) ? value.jobs_failed : 0,
            backlog: isFiniteNumber(value.backlog) ? value.backlog : 0,
            lastJobAt:
              typeof value.last_job_at === "string" ? value.last_job_at : null,
          };
        })
      : [],
    recentFailedJobs: Array.isArray(raw.recent_failed_jobs)
      ? raw.recent_failed_jobs.map((item) => {
          const value = ensureObject(item, "Invalid failed job payload.");
          return {
            jobId: typeof value.job_id === "string" ? value.job_id : "",
            track: typeof value.track === "string" ? value.track : "",
            jobType: typeof value.job_type === "string" ? value.job_type : "",
            sourceId:
              typeof value.source_id === "string" ? value.source_id : null,
            errorMessage:
              typeof value.error_message === "string" ? value.error_message : null,
            attempts: isFiniteNumber(value.attempts) ? value.attempts : 0,
            maxAttempts: isFiniteNumber(value.max_attempts) ? value.max_attempts : 0,
            updatedAt: typeof value.updated_at === "string" ? value.updated_at : "",
          };
        })
      : [],
    failedSteps: Array.isArray(raw.failed_steps)
      ? raw.failed_steps.map((item) => {
          const value = ensureObject(item, "Invalid failed step payload.");
          return {
            stepName: typeof value.step_name === "string" ? value.step_name : "",
            failureCount: isFiniteNumber(value.failure_count)
              ? value.failure_count
              : 0,
            lastFailedAt:
              typeof value.last_failed_at === "string" ? value.last_failed_at : null,
          };
        })
      : [],
  };
}

export function normalizeAdminWorkerLive(payload: unknown): AdminWorkerLive {
  const raw = ensureObject(payload, "Invalid admin worker live response.");
  const queue = ensureObject(raw.queue, "Admin worker live is missing queue counts.");

  return {
    generatedAt: typeof raw.generated_at === "string" ? raw.generated_at : "",
    queue: {
      pending: isFiniteNumber(queue.pending) ? queue.pending : 0,
      running: isFiniteNumber(queue.running) ? queue.running : 0,
      retrying: isFiniteNumber(queue.retrying) ? queue.retrying : 0,
      completed: isFiniteNumber(queue.completed) ? queue.completed : 0,
      failed: isFiniteNumber(queue.failed) ? queue.failed : 0,
    },
    activeJobs: Array.isArray(raw.active_jobs)
      ? raw.active_jobs.map((item) => {
          const job = ensureObject(item, "Invalid worker job payload.");
          return {
            jobId: typeof job.job_id === "string" ? job.job_id : "",
            track: typeof job.track === "string" ? job.track : "",
            status: typeof job.status === "string" ? job.status : "",
            source: typeof job.source === "string" ? job.source : null,
            videoId: typeof job.video_id === "string" ? job.video_id : null,
            title: typeof job.title === "string" ? job.title : null,
            startedAt: typeof job.started_at === "string" ? job.started_at : null,
            createdAt: typeof job.created_at === "string" ? job.created_at : "",
            lastActivityAt:
              typeof job.last_activity_at === "string" ? job.last_activity_at : null,
            attempts: isFiniteNumber(job.attempts) ? job.attempts : 0,
            maxAttempts: isFiniteNumber(job.max_attempts) ? job.max_attempts : 0,
            totalDurationMs:
              isFiniteNumber(job.total_duration_ms) ? job.total_duration_ms : null,
            errorMessage:
              typeof job.error_message === "string" ? job.error_message : null,
            steps: Array.isArray(job.steps)
              ? job.steps.map((s) => {
                  const step = ensureObject(s, "Invalid worker step payload.");
                  return {
                    stepName: typeof step.step_name === "string" ? step.step_name : "",
                    status: typeof step.status === "string" ? step.status : "",
                    artifacts: step.artifacts ?? {},
                    startedAt: typeof step.started_at === "string" ? step.started_at : null,
                    completedAt:
                      typeof step.completed_at === "string" ? step.completed_at : null,
                    updatedAt: typeof step.updated_at === "string" ? step.updated_at : null,
                    durationMs:
                      isFiniteNumber(step.duration_ms) ? step.duration_ms : null,
                    guidance:
                      typeof step.guidance === "string" ? step.guidance : null,
                    logs: Array.isArray(step.logs)
                      ? step.logs
                          .map((entry) => {
                            const value = ensureObject(entry, "Invalid worker step log payload.");
                            const message =
                              typeof value.message === "string" ? value.message : "";
                            if (!message) {
                              return null;
                            }
                            return {
                              at: typeof value.at === "string" ? value.at : null,
                              level:
                                typeof value.level === "string" ? value.level : "info",
                              message,
                              details: isPlainObject(value.details)
                                ? value.details
                                : null,
                            };
                          })
                          .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
                      : [],
                    errorMessage:
                      typeof step.error_message === "string" ? step.error_message : null,
                  };
                })
              : [],
          };
        })
      : [],
    recentCompleted: Array.isArray(raw.recent_completed)
      ? raw.recent_completed.map((item) => {
          const job = ensureObject(item, "Invalid completed job payload.");
          return {
            jobId: typeof job.job_id === "string" ? job.job_id : "",
            videoId: typeof job.video_id === "string" ? job.video_id : null,
            title: typeof job.title === "string" ? job.title : null,
            segmentCount: isFiniteNumber(job.segment_count) ? job.segment_count : 0,
            completedAt: typeof job.completed_at === "string" ? job.completed_at : null,
            totalDurationMs:
              isFiniteNumber(job.total_duration_ms) ? job.total_duration_ms : null,
          };
        })
      : [],
    failedJobs: Array.isArray(raw.failed_jobs)
      ? raw.failed_jobs.map((item) => {
          const job = ensureObject(item, "Invalid failed worker job payload.");
          return {
            jobId: typeof job.job_id === "string" ? job.job_id : "",
            track: typeof job.track === "string" ? job.track : "",
            status: typeof job.status === "string" ? job.status : "",
            source: typeof job.source === "string" ? job.source : null,
            videoId: typeof job.video_id === "string" ? job.video_id : null,
            title: typeof job.title === "string" ? job.title : null,
            startedAt: typeof job.started_at === "string" ? job.started_at : null,
            createdAt: typeof job.created_at === "string" ? job.created_at : "",
            lastActivityAt:
              typeof job.last_activity_at === "string" ? job.last_activity_at : null,
            attempts: isFiniteNumber(job.attempts) ? job.attempts : 0,
            maxAttempts: isFiniteNumber(job.max_attempts) ? job.max_attempts : 0,
            totalDurationMs:
              isFiniteNumber(job.total_duration_ms) ? job.total_duration_ms : null,
            errorMessage:
              typeof job.error_message === "string" ? job.error_message : null,
            steps: Array.isArray(job.steps)
              ? job.steps.map((s) => {
                  const step = ensureObject(s, "Invalid worker step payload.");
                  return {
                    stepName: typeof step.step_name === "string" ? step.step_name : "",
                    status: typeof step.status === "string" ? step.status : "",
                    artifacts: step.artifacts ?? {},
                    startedAt: typeof step.started_at === "string" ? step.started_at : null,
                    completedAt:
                      typeof step.completed_at === "string" ? step.completed_at : null,
                    updatedAt: typeof step.updated_at === "string" ? step.updated_at : null,
                    durationMs:
                      isFiniteNumber(step.duration_ms) ? step.duration_ms : null,
                    guidance:
                      typeof step.guidance === "string" ? step.guidance : null,
                    logs: Array.isArray(step.logs)
                      ? step.logs
                          .map((entry) => {
                            const value = ensureObject(entry, "Invalid worker step log payload.");
                            const message =
                              typeof value.message === "string" ? value.message : "";
                            if (!message) {
                              return null;
                            }
                            return {
                              at: typeof value.at === "string" ? value.at : null,
                              level:
                                typeof value.level === "string" ? value.level : "info",
                              message,
                              details: isPlainObject(value.details)
                                ? value.details
                                : null,
                            };
                          })
                          .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
                      : [],
                    errorMessage:
                      typeof step.error_message === "string" ? step.error_message : null,
                  };
                })
              : [],
          };
        })
      : [],
    failedJobsTotal: isFiniteNumber(raw.failed_jobs_total) ? raw.failed_jobs_total : 0,
    failedJobsLimit: isFiniteNumber(raw.failed_jobs_limit) ? raw.failed_jobs_limit : 0,
    failedJobsOffset: isFiniteNumber(raw.failed_jobs_offset) ? raw.failed_jobs_offset : 0,
  };
}

export function normalizeAdminIndexedVideos(payload: unknown): AdminIndexedVideosResponse {
  const raw = ensureObject(payload, "Invalid admin indexed videos response.");
  const rawVideos = Array.isArray(raw.videos) ? raw.videos : [];

  return {
    generatedAt: typeof raw.generated_at === "string" ? raw.generated_at : "",
    videos: rawVideos.map((item) => {
      const video = ensureObject(item, "Invalid admin indexed video entry.");
      return {
        videoId: typeof video.video_id === "string" ? video.video_id : "",
        source: typeof video.source === "string" ? video.source : "",
        sourceVideoId: typeof video.source_video_id === "string" ? video.source_video_id : "",
        title: typeof video.title === "string" ? video.title : "",
        sourceUrl: typeof video.source_url === "string" ? video.source_url : null,
        videoUrl: typeof video.video_url === "string" ? video.video_url : null,
        speaker: typeof video.speaker === "string" ? video.speaker : null,
        createdAt: typeof video.created_at === "string" ? video.created_at : "",
        updatedAt: typeof video.updated_at === "string" ? video.updated_at : "",
        unitsCreated: isFiniteNumber(video.units_created) ? video.units_created : 0,
        lastJobStatus: typeof video.last_job_status === "string" ? video.last_job_status : null,
        lastJobAt: typeof video.last_job_at === "string" ? video.last_job_at : null,
      };
    }),
    total: isFiniteNumber(raw.total) ? raw.total : 0,
    limit: isFiniteNumber(raw.limit) ? raw.limit : 0,
    offset: isFiniteNumber(raw.offset) ? raw.offset : 0,
    query: typeof raw.query === "string" ? raw.query : null,
  };
}

export function normalizeAdminTargetsResponse(payload: unknown): AdminTargetsResponse {
  const raw = ensureObject(payload, "Invalid admin targets response.");

  return {
    generatedAt: typeof raw.generated_at === "string" ? raw.generated_at : "",
    window: normalizeWindow(raw.window),
    targets: Array.isArray(raw.targets)
      ? raw.targets.map((item) => {
          const value = ensureObject(item, "Invalid admin target payload.");
          return {
            id: typeof value.id === "string" ? value.id : "",
            metricName:
              typeof value.metric_name === "string" ? value.metric_name : "",
            scopeType:
              value.scope_type === "track" || value.scope_type === "source"
                ? value.scope_type
                : "global",
            scopeKey: typeof value.scope_key === "string" ? value.scope_key : "",
            rangeKey:
              value.range_key === "today" || value.range_key === "30d"
                ? value.range_key
                : "7d",
            comparisonMode:
              value.comparison_mode === "at_most" ? "at_most" : "at_least",
            targetValue: isFiniteNumber(value.target_value) ? value.target_value : 0,
            note: typeof value.note === "string" ? value.note : null,
            updatedAt:
              typeof value.updated_at === "string" ? value.updated_at : "",
            actualValue: isFiniteNumber(value.actual_value) ? value.actual_value : null,
            attainmentRatio: isFiniteNumber(value.attainment_ratio)
              ? value.attainment_ratio
              : null,
            targetGap: isFiniteNumber(value.target_gap) ? value.target_gap : null,
          };
        })
      : [],
  };
}

export const admin = {
  async getSummary(range: AdminRange): Promise<AdminSummary> {
    const payload = await fetchWithAuth<unknown>(`/admin/summary${buildRangeQuery(range)}`, {
      method: "GET",
      cache: "no-store",
    });

    return normalizeAdminSummary(payload);
  },

  async getUsers(range: AdminRange): Promise<AdminUsersSummary> {
    const payload = await fetchWithAuth<unknown>(
      `/admin/users/summary${buildRangeQuery(range)}`,
      {
        method: "GET",
        cache: "no-store",
      },
    );

    return normalizeAdminUsersSummary(payload);
  },

  async getRequests(range: AdminRange): Promise<AdminRequestsSummary> {
    const payload = await fetchWithAuth<unknown>(
      `/admin/requests/summary${buildRangeQuery(range)}`,
      {
        method: "GET",
        cache: "no-store",
      },
    );

    return normalizeAdminRequestsSummary(payload);
  },

  async getContent(range: AdminRange): Promise<AdminContentSummary> {
    const payload = await fetchWithAuth<unknown>(
      `/admin/content/summary${buildRangeQuery(range)}`,
      {
        method: "GET",
        cache: "no-store",
      },
    );

    return normalizeAdminContentSummary(payload);
  },

  async getIngestion(range: AdminRange): Promise<AdminIngestionSummary> {
    const payload = await fetchWithAuth<unknown>(
      `/admin/ingestion/summary${buildRangeQuery(range)}`,
      {
        method: "GET",
        cache: "no-store",
      },
    );

    return normalizeAdminIngestionSummary(payload);
  },

  async getTargets(range: AdminRange): Promise<AdminTargetsResponse> {
    const payload = await fetchWithAuth<unknown>(`/admin/targets${buildRangeQuery(range)}`, {
      method: "GET",
      cache: "no-store",
    });

    return normalizeAdminTargetsResponse(payload);
  },

  async updateTargets(
    range: AdminRange,
    targets: AdminMetricTargetInput[],
  ): Promise<AdminTargetsResponse> {
    const payload = await fetchWithAuth<unknown>(`/admin/targets${buildRangeQuery(range)}`, {
      method: "PUT",
      body: {
        targets: targets.map((target) => ({
          metric_name: target.metricName,
          scope_type: target.scopeType,
          scope_key: target.scopeKey,
          range_key: target.rangeKey,
          comparison_mode: target.comparisonMode,
          target_value: target.targetValue,
          note: target.note,
        })),
      },
    });

    return normalizeAdminTargetsResponse(payload);
  },

  async deleteTarget(targetId: string): Promise<void> {
    await fetchWithAuth<null>(`/admin/targets/${targetId}`, {
      method: "DELETE",
    });
  },

  async getWorkerLive(params?: {
    failedLimit?: number;
    failedOffset?: number;
  }): Promise<AdminWorkerLive> {
    const searchParams = new URLSearchParams();
    if (typeof params?.failedLimit === "number") {
      searchParams.set("failed_limit", String(params.failedLimit));
    }
    if (typeof params?.failedOffset === "number") {
      searchParams.set("failed_offset", String(params.failedOffset));
    }
    const query = searchParams.toString();
    const payload = await fetchWithAuth<unknown>(`/admin/worker/live${query ? `?${query}` : ""}`, {
      method: "GET",
      cache: "no-store",
    });

    return normalizeAdminWorkerLive(payload);
  },

  async retryJob(jobId: string): Promise<{ ok: boolean; jobId: string }> {
    const payload = await fetchWithAuth<unknown>(`/admin/jobs/${jobId}/retry`, {
      method: "POST",
      cache: "no-store",
    });
    const raw = ensureObject(payload, "Invalid retry job response.");
    return {
      ok: raw.ok === true,
      jobId: typeof raw.job_id === "string" ? raw.job_id : "",
    };
  },

  async killJob(jobId: string): Promise<{ ok: boolean; jobId: string }> {
    const payload = await fetchWithAuth<unknown>(`/admin/jobs/${jobId}/kill`, {
      method: "POST",
      cache: "no-store",
    });
    const raw = ensureObject(payload, "Invalid kill job response.");
    return {
      ok: raw.ok === true,
      jobId: typeof raw.job_id === "string" ? raw.job_id : "",
    };
  },

  async getIndexedVideos(params?: {
    query?: string;
    limit?: number;
    offset?: number;
  }): Promise<AdminIndexedVideosResponse> {
    const searchParams = new URLSearchParams();
    if (params?.query && params.query.trim()) {
      searchParams.set("query", params.query.trim());
    }
    if (typeof params?.limit === "number") {
      searchParams.set("limit", String(params.limit));
    }
    if (typeof params?.offset === "number") {
      searchParams.set("offset", String(params.offset));
    }
    const query = searchParams.toString();
    const payload = await fetchWithAuth<unknown>(`/admin/videos${query ? `?${query}` : ""}`, {
      method: "GET",
      cache: "no-store",
    });
    return normalizeAdminIndexedVideos(payload);
  },

  async deleteIndexedVideo(videoId: string): Promise<{
    ok: boolean;
    videoId: string;
    title: string;
    unitsDeleted: number;
    processingJobsDeleted: number;
  }> {
    const payload = await fetchWithAuth<unknown>(`/admin/videos/${videoId}`, {
      method: "DELETE",
      cache: "no-store",
    });
    const raw = ensureObject(payload, "Invalid delete indexed video response.");
    return {
      ok: raw.ok === true,
      videoId: typeof raw.video_id === "string" ? raw.video_id : "",
      title: typeof raw.title === "string" ? raw.title : "",
      unitsDeleted: isFiniteNumber(raw.units_deleted) ? raw.units_deleted : 0,
      processingJobsDeleted: isFiniteNumber(raw.processing_jobs_deleted)
        ? raw.processing_jobs_deleted
        : 0,
    };
  },
};
