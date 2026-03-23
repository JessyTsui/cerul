from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

AdminRangeKey = Literal["today", "7d", "30d"]
TargetScopeType = Literal["global", "track", "source"]
TargetComparisonMode = Literal["at_least", "at_most"]


class AdminWindow(BaseModel):
    model_config = ConfigDict(extra="forbid")

    range_key: AdminRangeKey
    current_start: datetime
    current_end: datetime
    previous_start: datetime
    previous_end: datetime


class AdminMetricValue(BaseModel):
    model_config = ConfigDict(extra="forbid")

    current: float
    previous: float
    delta: float
    delta_ratio: float | None = None
    target: float | None = None
    target_gap: float | None = None
    attainment_ratio: float | None = None
    comparison_mode: TargetComparisonMode | None = None


class AdminNamedCount(BaseModel):
    model_config = ConfigDict(extra="forbid")

    key: str
    label: str
    count: int


class AdminSummaryPoint(BaseModel):
    model_config = ConfigDict(extra="forbid")

    date: date
    requests: int = 0
    credits_used: int = 0
    zero_result_queries: int = 0
    broll_assets_added: int = 0
    knowledge_videos_added: int = 0
    knowledge_segments_added: int = 0
    jobs_completed: int = 0
    jobs_failed: int = 0
    latency_p95_ms: float | None = None


class AdminNotice(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tone: Literal["default", "warning", "error"] = "default"
    title: str
    description: str


class AdminOverviewMetrics(BaseModel):
    model_config = ConfigDict(extra="forbid")

    total_users: AdminMetricValue
    new_users: AdminMetricValue
    active_users: AdminMetricValue
    requests: AdminMetricValue
    credits_used: AdminMetricValue
    zero_result_rate: AdminMetricValue
    indexed_assets: AdminMetricValue
    indexed_segments: AdminMetricValue
    pending_jobs: AdminMetricValue
    failed_jobs: AdminMetricValue


class AdminSummaryResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    generated_at: datetime
    window: AdminWindow
    metrics: AdminOverviewMetrics
    request_series: list[AdminSummaryPoint]
    content_series: list[AdminSummaryPoint]
    ingestion_series: list[AdminSummaryPoint]
    notices: list[AdminNotice]


class AdminRecentUser(BaseModel):
    model_config = ConfigDict(extra="forbid")

    user_id: str
    email: str | None = None
    tier: str
    console_role: str
    created_at: datetime
    active_api_keys: int
    last_request_at: datetime | None = None


class AdminActiveUser(BaseModel):
    model_config = ConfigDict(extra="forbid")

    user_id: str
    email: str | None = None
    tier: str
    request_count: int
    credits_used: int
    last_request_at: datetime | None = None


class AdminUsersMetrics(BaseModel):
    model_config = ConfigDict(extra="forbid")

    total_users: AdminMetricValue
    new_users: AdminMetricValue
    active_users: AdminMetricValue
    active_api_keys: AdminMetricValue


class AdminUsersSummaryResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    generated_at: datetime
    window: AdminWindow
    metrics: AdminUsersMetrics
    daily_signups: list[AdminNamedCount]
    tiers: list[AdminNamedCount]
    console_roles: list[AdminNamedCount]
    recent_users: list[AdminRecentUser]
    most_active_users: list[AdminActiveUser]


class AdminLatencyMetrics(BaseModel):
    model_config = ConfigDict(extra="forbid")

    p50_ms: AdminMetricValue
    p95_ms: AdminMetricValue
    p99_ms: AdminMetricValue


class AdminQueryBucket(BaseModel):
    model_config = ConfigDict(extra="forbid")

    query_text: str
    request_count: int
    zero_result_count: int = 0
    answer_count: int = 0
    avg_latency_ms: float | None = None


class AdminRequestsMetrics(BaseModel):
    model_config = ConfigDict(extra="forbid")

    total_requests: AdminMetricValue
    credits_used: AdminMetricValue
    active_users: AdminMetricValue
    average_credits_per_request: AdminMetricValue
    zero_result_rate: AdminMetricValue
    answer_usage_rate: AdminMetricValue
    latency: AdminLatencyMetrics


class AdminRequestsSummaryResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    generated_at: datetime
    window: AdminWindow
    metrics: AdminRequestsMetrics
    daily_series: list[AdminSummaryPoint]
    top_queries: list[AdminQueryBucket]
    zero_result_queries: list[AdminQueryBucket]


class AdminInventoryMetrics(BaseModel):
    model_config = ConfigDict(extra="forbid")

    broll_assets_total: AdminMetricValue
    knowledge_videos_total: AdminMetricValue
    knowledge_segments_total: AdminMetricValue
    active_sources_total: AdminMetricValue
    broll_assets_added: AdminMetricValue
    knowledge_videos_added: AdminMetricValue
    knowledge_segments_added: AdminMetricValue


class AdminSourceGrowth(BaseModel):
    model_config = ConfigDict(extra="forbid")

    track: str
    source_key: str
    additions: int


class AdminSourceFreshness(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_id: str
    slug: str
    display_name: str
    track: str
    is_active: bool
    last_job_at: datetime | None = None
    jobs_in_range: int
    is_stale: bool


class AdminContentSummaryResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    generated_at: datetime
    window: AdminWindow
    metrics: AdminInventoryMetrics
    daily_series: list[AdminSummaryPoint]
    per_source_growth: list[AdminSourceGrowth]
    stale_sources: list[AdminSourceFreshness]


class AdminIngestionMetrics(BaseModel):
    model_config = ConfigDict(extra="forbid")

    jobs_created: AdminMetricValue
    jobs_completed: AdminMetricValue
    jobs_failed: AdminMetricValue
    completion_rate: AdminMetricValue
    failure_rate: AdminMetricValue
    pending_backlog: AdminMetricValue
    average_processing_ms: AdminMetricValue


class AdminJobStatusCounts(BaseModel):
    model_config = ConfigDict(extra="forbid")

    pending: int
    running: int
    retrying: int
    completed: int
    failed: int


class AdminSourceHealth(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_id: str
    slug: str
    display_name: str
    track: str
    is_active: bool
    jobs_created: int
    jobs_completed: int
    jobs_failed: int
    backlog: int
    last_job_at: datetime | None = None


class AdminFailedJob(BaseModel):
    model_config = ConfigDict(extra="forbid")

    job_id: str
    track: str
    job_type: str
    source_id: str | None = None
    error_message: str | None = None
    attempts: int
    max_attempts: int
    updated_at: datetime


class AdminFailedStep(BaseModel):
    model_config = ConfigDict(extra="forbid")

    step_name: str
    failure_count: int
    last_failed_at: datetime | None = None


class AdminIngestionSummaryResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    generated_at: datetime
    window: AdminWindow
    metrics: AdminIngestionMetrics
    status_counts: AdminJobStatusCounts
    daily_series: list[AdminSummaryPoint]
    source_health: list[AdminSourceHealth]
    recent_failed_jobs: list[AdminFailedJob]
    failed_steps: list[AdminFailedStep]


class AdminWorkerStep(BaseModel):
    model_config = ConfigDict(extra="forbid")

    step_name: str
    status: str  # "pending" | "running" | "completed" | "failed"
    artifacts: Any = Field(default_factory=dict)
    started_at: datetime | None = None
    completed_at: datetime | None = None
    updated_at: datetime | None = None
    duration_ms: int | None = None
    guidance: str | None = None
    logs: list[dict[str, Any]] = Field(default_factory=list)
    error_message: str | None = None


class AdminWorkerJob(BaseModel):
    model_config = ConfigDict(extra="forbid")

    job_id: str
    track: str
    status: str
    source: str | None = None
    video_id: str | None = None
    title: str | None = None
    started_at: datetime | None = None
    created_at: datetime
    last_activity_at: datetime | None = None
    attempts: int = 0
    max_attempts: int = 0
    total_duration_ms: int | None = None
    error_message: str | None = None
    steps: list[AdminWorkerStep] = Field(default_factory=list)


class AdminWorkerCompletedJob(BaseModel):
    model_config = ConfigDict(extra="forbid")

    job_id: str
    video_id: str | None = None
    title: str | None = None
    segment_count: int
    completed_at: datetime | None = None
    total_duration_ms: int | None = None


class AdminWorkerQueueCounts(BaseModel):
    model_config = ConfigDict(extra="forbid")

    pending: int
    running: int
    retrying: int
    completed: int
    failed: int


class AdminWorkerLiveResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    generated_at: datetime
    queue: AdminWorkerQueueCounts
    active_jobs: list[AdminWorkerJob]
    recent_completed: list[AdminWorkerCompletedJob]
    failed_jobs: list[AdminWorkerJob] = Field(default_factory=list)
    failed_jobs_total: int = 0
    failed_jobs_limit: int = 0
    failed_jobs_offset: int = 0


class AdminIndexedVideo(BaseModel):
    model_config = ConfigDict(extra="forbid")

    video_id: str
    source: str
    source_video_id: str
    title: str
    source_url: str | None = None
    video_url: str | None = None
    speaker: str | None = None
    created_at: datetime
    updated_at: datetime
    units_created: int
    last_job_status: str | None = None
    last_job_at: datetime | None = None


class AdminIndexedVideosResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    generated_at: datetime
    videos: list[AdminIndexedVideo] = Field(default_factory=list)
    total: int = 0
    limit: int = 0
    offset: int = 0
    query: str | None = None


class AdminDeleteVideoResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ok: bool
    video_id: str
    title: str
    units_deleted: int = 0
    processing_jobs_deleted: int = 0


class AdminMetricTarget(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    metric_name: str
    scope_type: TargetScopeType
    scope_key: str
    range_key: AdminRangeKey
    comparison_mode: TargetComparisonMode
    target_value: float
    note: str | None = None
    updated_at: datetime
    actual_value: float | None = None
    attainment_ratio: float | None = None
    target_gap: float | None = None


class AdminTargetsResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    generated_at: datetime
    window: AdminWindow
    targets: list[AdminMetricTarget]


class AdminMetricTargetUpsert(BaseModel):
    model_config = ConfigDict(extra="forbid")

    metric_name: str = Field(min_length=1, max_length=120)
    scope_type: TargetScopeType = "global"
    scope_key: str = Field(default="", max_length=120)
    range_key: AdminRangeKey = "7d"
    comparison_mode: TargetComparisonMode = "at_least"
    target_value: float = Field(ge=0)
    note: str | None = Field(default=None, max_length=400)


class AdminTargetsUpsertRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    targets: list[AdminMetricTargetUpsert] = Field(default_factory=list)
