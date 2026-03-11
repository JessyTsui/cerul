"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";
import {
  getApiErrorMessage,
  jobs,
  type DashboardJobDetail,
  type DashboardJobSummary,
  type DashboardJobStats,
  type JobStatus,
  type JobTrack,
} from "@/lib/api";
import { formatDashboardDateTime, formatNumber } from "@/lib/dashboard";
import { DashboardLayout } from "./dashboard-layout";
import {
  DashboardNotice,
  DashboardSkeleton,
  DashboardState,
} from "./dashboard-state";
import { useJobList, useJobStats } from "./use-jobs";

type JobSort = "created_desc" | "created_asc" | "duration_desc" | "duration_asc" | "status";
type StatusFilter = JobStatus | "all";
type TrackFilter = JobTrack | "all";

const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;

const STATUS_OPTIONS: Array<{ label: string; value: StatusFilter }> = [
  { label: "All", value: "all" },
  { label: "Pending", value: "pending" },
  { label: "Running", value: "running" },
  { label: "Retrying", value: "retrying" },
  { label: "Completed", value: "completed" },
  { label: "Failed", value: "failed" },
];

const TRACK_OPTIONS: Array<{ label: string; value: TrackFilter }> = [
  { label: "All", value: "all" },
  { label: "B-roll", value: "broll" },
  { label: "Knowledge", value: "knowledge" },
];

const SORT_OPTIONS: Array<{ label: string; value: JobSort }> = [
  { label: "Newest first", value: "created_desc" },
  { label: "Oldest first", value: "created_asc" },
  { label: "Longest duration", value: "duration_desc" },
  { label: "Shortest duration", value: "duration_asc" },
  { label: "Status", value: "status" },
];

const STATUS_ORDER: Record<JobStatus, number> = {
  running: 0,
  retrying: 1,
  pending: 2,
  failed: 3,
  completed: 4,
};

function toDate(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getDurationMs(job: Pick<DashboardJobSummary, "startedAt" | "completedAt" | "updatedAt">): number | null {
  const start = toDate(job.startedAt);

  if (!start) {
    return null;
  }

  const end = toDate(job.completedAt) ?? toDate(job.updatedAt);

  if (!end) {
    return null;
  }

  return Math.max(0, end.getTime() - start.getTime());
}

function formatDuration(job: Pick<DashboardJobSummary, "startedAt" | "completedAt" | "updatedAt" | "status">): string {
  const durationMs = getDurationMs(job);

  if (durationMs === null) {
    return "Not started";
  }

  const totalSeconds = Math.max(1, Math.round(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];

  if (hours > 0) {
    parts.push(`${hours}h`);
  }

  if (minutes > 0 || hours > 0) {
    parts.push(`${minutes}m`);
  }

  parts.push(`${seconds}s`);

  const formatted = parts.join(" ");
  return job.completedAt || job.status === "completed" || job.status === "failed"
    ? formatted
    : `${formatted} so far`;
}

function formatDateTime(value: string | null | undefined, fallback: string): string {
  return value ? formatDashboardDateTime(value) : fallback;
}

function getTrackLabel(track: JobTrack): string {
  return track === "broll" ? "B-roll" : "Knowledge";
}

function getStatusLabel(status: JobStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function getStatusBadgeClass(status: JobStatus): string {
  if (status === "completed") {
    return "badge-success";
  }

  if (status === "failed") {
    return "badge-error";
  }

  return "badge-warning";
}

function getStatusDotClass(status: JobStatus): string {
  if (status === "completed") {
    return "bg-emerald-400 shadow-[0_0_16px_rgba(74,222,128,0.45)]";
  }

  if (status === "failed") {
    return "bg-rose-400 shadow-[0_0_16px_rgba(248,113,113,0.45)]";
  }

  return "bg-amber-300 shadow-[0_0_16px_rgba(253,224,71,0.4)]";
}

function getStepToken(stepStatus: "completed" | "failed" | "skipped"): string {
  if (stepStatus === "completed") {
    return "OK";
  }

  if (stepStatus === "failed") {
    return "ER";
  }

  return "SK";
}

function getStepTokenClasses(stepStatus: "completed" | "failed" | "skipped"): string {
  if (stepStatus === "completed") {
    return "border-emerald-500/30 bg-emerald-500/15 text-emerald-200";
  }

  if (stepStatus === "failed") {
    return "border-rose-500/30 bg-rose-500/15 text-rose-200";
  }

  return "border-slate-500/30 bg-slate-500/15 text-slate-200";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function summarizeArtifacts(artifacts: unknown): string {
  if (Array.isArray(artifacts)) {
    return artifacts.length === 0
      ? "No artifacts recorded."
      : `${artifacts.length} artifact item(s) recorded.`;
  }

  if (isPlainObject(artifacts)) {
    const entries = Object.entries(artifacts);

    if (entries.length === 0) {
      return "No artifacts recorded.";
    }

    return entries
      .slice(0, 3)
      .map(([key, value]) => `${key}: ${String(value)}`)
      .join(" | ");
  }

  if (artifacts === null || artifacts === undefined) {
    return "No artifacts recorded.";
  }

  return String(artifacts);
}

function getPayloadSummary(payload: unknown): string {
  if (Array.isArray(payload)) {
    return `${payload.length} payload item(s)`;
  }

  if (isPlainObject(payload)) {
    const keys = Object.keys(payload);
    return keys.length === 0 ? "Empty payload" : `${keys.length} payload field(s)`;
  }

  return "Opaque payload";
}

function getTrackShare(count: number, total: number): string {
  if (total <= 0) {
    return "0%";
  }

  return `${Math.round((count / total) * 100)}%`;
}

function sortJobs(items: DashboardJobSummary[], sort: JobSort): DashboardJobSummary[] {
  const jobsBySort = [...items];

  jobsBySort.sort((jobA, jobB) => {
    if (sort === "created_asc") {
      return jobA.createdAt.localeCompare(jobB.createdAt);
    }

    if (sort === "duration_desc") {
      return (getDurationMs(jobB) ?? -1) - (getDurationMs(jobA) ?? -1);
    }

    if (sort === "duration_asc") {
      return (getDurationMs(jobA) ?? Number.MAX_SAFE_INTEGER)
        - (getDurationMs(jobB) ?? Number.MAX_SAFE_INTEGER);
    }

    if (sort === "status") {
      const statusDelta = STATUS_ORDER[jobA.status] - STATUS_ORDER[jobB.status];
      return statusDelta !== 0
        ? statusDelta
        : jobB.createdAt.localeCompare(jobA.createdAt);
    }

    return jobB.createdAt.localeCompare(jobA.createdAt);
  });

  return jobsBySort;
}

function StatOverview({
  stats,
}: {
  stats: DashboardJobStats;
}) {
  const cards = [
    {
      label: "Total jobs",
      value: stats.total,
      note: "All pipeline jobs recorded in processing_jobs.",
      dotClass: "bg-sky-400 shadow-[0_0_16px_rgba(96,165,250,0.45)]",
    },
    {
      label: "Pending",
      value: stats.pending,
      note: "Queued and waiting for a worker claim.",
      dotClass: "bg-amber-300 shadow-[0_0_16px_rgba(253,224,71,0.4)]",
    },
    {
      label: "Running",
      value: stats.running,
      note: `Retrying queue: ${formatNumber(stats.retrying)} job(s).`,
      dotClass: "bg-yellow-300 shadow-[0_0_16px_rgba(253,224,71,0.4)]",
    },
    {
      label: "Completed",
      value: stats.completed,
      note: "Finished without requiring operator intervention.",
      dotClass: "bg-emerald-400 shadow-[0_0_16px_rgba(74,222,128,0.45)]",
    },
    {
      label: "Failed",
      value: stats.failed,
      note: "Exhausted retries or hit a terminal error.",
      dotClass: "bg-rose-400 shadow-[0_0_16px_rgba(248,113,113,0.45)]",
    },
  ] as const;

  return (
    <>
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {cards.map((card) => (
          <article key={card.label} className="surface px-5 py-5">
            <div className="flex items-center justify-between gap-3">
              <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                {card.label}
              </p>
              <span className={`h-3 w-3 rounded-full ${card.dotClass}`} />
            </div>
            <p className="mt-3 font-mono text-3xl font-semibold text-white">
              {formatNumber(card.value)}
            </p>
            <p className="mt-2 text-sm leading-6 text-[var(--foreground-secondary)]">
              {card.note}
            </p>
          </article>
        ))}
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
        <article className="surface-elevated px-6 py-6">
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
            Track breakdown
          </p>
          <h2 className="mt-2 text-2xl font-semibold text-white">
            Workload split across both retrieval tracks
          </h2>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {[
              {
                label: "B-roll",
                value: stats.tracks.broll,
                share: getTrackShare(stats.tracks.broll, stats.total),
                tone: "label-accent",
              },
              {
                label: "Knowledge",
                value: stats.tracks.knowledge,
                share: getTrackShare(stats.tracks.knowledge, stats.total),
                tone: "label-brand",
              },
            ].map((track) => (
              <div
                key={track.label}
                className="rounded-[18px] border border-[var(--border)] bg-[var(--surface)] px-4 py-4"
              >
                <span className={`label ${track.tone}`}>{track.label}</span>
                <p className="mt-4 font-mono text-2xl font-semibold text-white">
                  {formatNumber(track.value)}
                </p>
                <p className="mt-2 text-sm leading-6 text-[var(--foreground-secondary)]">
                  {track.share} of all jobs observed in the current telemetry set.
                </p>
              </div>
            ))}
          </div>
        </article>

        <article className="surface-elevated px-6 py-6">
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
            Retry posture
          </p>
          <h2 className="mt-2 text-2xl font-semibold text-white">
            Active failure pressure
          </h2>
          <div className="mt-5 space-y-3">
            <div className="rounded-[18px] border border-[var(--border)] bg-[var(--surface)] px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                  Retrying
                </span>
                <span className="badge badge-warning">Backoff</span>
              </div>
              <p className="mt-3 font-mono text-2xl font-semibold text-white">
                {formatNumber(stats.retrying)}
              </p>
              <p className="mt-2 text-sm leading-6 text-[var(--foreground-secondary)]">
                Jobs currently waiting for the next retry window.
              </p>
            </div>
            <div className="rounded-[18px] border border-[var(--border)] bg-[var(--surface)] px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                  Terminal failures
                </span>
                <span className="badge badge-error">Needs review</span>
              </div>
              <p className="mt-3 font-mono text-2xl font-semibold text-white">
                {formatNumber(stats.failed)}
              </p>
              <p className="mt-2 text-sm leading-6 text-[var(--foreground-secondary)]">
                Failed jobs should correlate with expanded row error traces below.
              </p>
            </div>
          </div>
        </article>
      </section>
    </>
  );
}

function ExpandedJobDetail({
  detail,
}: {
  detail: DashboardJobDetail;
}) {
  return (
    <div className="grid gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">
      <div className="space-y-4">
        <article className="rounded-[22px] border border-[var(--border)] bg-[var(--surface)] px-5 py-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                Job context
              </p>
              <h3 className="mt-2 text-xl font-semibold text-white">
                {detail.jobType}
              </h3>
            </div>
            <span className={`badge ${getStatusBadgeClass(detail.status)}`}>
              {getStatusLabel(detail.status)}
            </span>
          </div>

          <div className="mt-5 grid gap-3">
            {[
              {
                label: "Job ID",
                value: detail.id,
              },
              {
                label: "Track",
                value: getTrackLabel(detail.track),
              },
              {
                label: "Attempts",
                value: `${detail.attempts} / ${detail.maxAttempts}`,
              },
              {
                label: "Payload",
                value: getPayloadSummary(detail.inputPayload),
              },
              {
                label: "Started",
                value: formatDateTime(detail.startedAt, "Not started"),
              },
              {
                label: "Completed",
                value: formatDateTime(detail.completedAt, "Still in progress"),
              },
              {
                label: "Next retry",
                value: formatDateTime(detail.nextRetryAt, "No retry scheduled"),
              },
              {
                label: "Source ID",
                value: detail.sourceId ?? "Not attached",
              },
            ].map((item) => (
              <div
                key={item.label}
                className="rounded-[16px] border border-[var(--border)] bg-[var(--surface-elevated)] px-4 py-3"
              >
                <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                  {item.label}
                </p>
                <p className="mt-2 break-all font-mono text-sm text-white">
                  {item.value}
                </p>
              </div>
            ))}
          </div>
        </article>

        {detail.errorMessage ? (
          <DashboardNotice
            description={detail.errorMessage}
            title="Terminal job error"
            tone="error"
          />
        ) : null}
      </div>

      <article className="rounded-[22px] border border-[var(--border)] bg-[var(--surface)] px-5 py-5">
        <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
          Pipeline timeline
        </p>
        <h3 className="mt-2 text-xl font-semibold text-white">
          Step progression
        </h3>

        {detail.steps.length === 0 ? (
          <p className="mt-5 text-sm leading-6 text-[var(--foreground-secondary)]">
            No step records have been written for this job yet.
          </p>
        ) : (
          <div className="relative mt-5 space-y-4 before:absolute before:bottom-4 before:left-[1.18rem] before:top-4 before:w-px before:bg-[var(--border)]">
            {detail.steps.map((step) => (
              <div key={step.id} className="relative pl-12">
                <span
                  className={`absolute left-0 top-1 inline-flex h-9 w-9 items-center justify-center rounded-full border font-mono text-[11px] font-semibold ${getStepTokenClasses(step.status)}`}
                >
                  {getStepToken(step.status)}
                </span>
                <div className="rounded-[18px] border border-[var(--border)] bg-[var(--surface-elevated)] px-4 py-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                        {step.stepName}
                      </p>
                      <p className="mt-2 text-sm leading-6 text-[var(--foreground-secondary)]">
                        {summarizeArtifacts(step.artifacts)}
                      </p>
                    </div>
                    <span
                      className={`badge ${
                        step.status === "completed"
                          ? "badge-success"
                          : step.status === "failed"
                            ? "badge-error"
                            : "badge-warning"
                      }`}
                    >
                      {step.status}
                    </span>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-[14px] border border-[var(--border)] bg-[var(--surface)] px-3 py-3">
                      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                        Started
                      </p>
                      <p className="mt-2 font-mono text-xs text-white">
                        {formatDateTime(step.startedAt, "Not recorded")}
                      </p>
                    </div>
                    <div className="rounded-[14px] border border-[var(--border)] bg-[var(--surface)] px-3 py-3">
                      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                        Completed
                      </p>
                      <p className="mt-2 font-mono text-xs text-white">
                        {formatDateTime(step.completedAt, "Not completed")}
                      </p>
                    </div>
                  </div>

                  {step.errorMessage ? (
                    <div className="mt-4 rounded-[14px] border border-rose-500/30 bg-rose-500/10 px-3 py-3 text-sm leading-6 text-rose-100">
                      {step.errorMessage}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </article>
    </div>
  );
}

export function DashboardPipelinesScreen() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [trackFilter, setTrackFilter] = useState<TrackFilter>("all");
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(25);
  const [offset, setOffset] = useState(0);
  const [sort, setSort] = useState<JobSort>("created_desc");
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
  const [jobDetails, setJobDetails] = useState<Record<string, DashboardJobDetail>>({});
  const [jobDetailErrors, setJobDetailErrors] = useState<Record<string, string>>({});
  const [loadingJobIds, setLoadingJobIds] = useState<Record<string, boolean>>({});

  const listParams = useMemo(
    () => ({
      status: statusFilter === "all" ? undefined : statusFilter,
      track: trackFilter === "all" ? undefined : trackFilter,
      limit: pageSize,
      offset,
    }),
    [offset, pageSize, statusFilter, trackFilter],
  );
  const {
    data: listData,
    error: listError,
    isLoading: isListLoading,
    refresh: refreshList,
  } = useJobList(listParams);
  const {
    data: statsData,
    error: statsError,
    isLoading: isStatsLoading,
    refresh: refreshStats,
  } = useJobStats();

  const sortedJobs = useMemo(
    () => sortJobs(listData?.jobs ?? [], sort),
    [listData?.jobs, sort],
  );
  const totalPages = listData ? Math.max(1, Math.ceil(listData.totalCount / pageSize)) : 1;
  const currentPage = Math.floor(offset / pageSize) + 1;
  const isInitialLoading =
    (isStatsLoading && !statsData) || (isListLoading && !listData);
  const hasFatalLoadError =
    !statsData &&
    !listData &&
    Boolean(statsError || listError) &&
    !isInitialLoading;

  useEffect(() => {
    if (expandedJobId && !sortedJobs.some((job) => job.id === expandedJobId)) {
      setExpandedJobId(null);
    }
  }, [expandedJobId, sortedJobs]);

  async function refreshAll() {
    await Promise.all([refreshStats(), refreshList()]);
  }

  async function loadJobDetail(jobId: string) {
    setLoadingJobIds((current) => ({ ...current, [jobId]: true }));
    setJobDetailErrors((current) => {
      const next = { ...current };
      delete next[jobId];
      return next;
    });

    try {
      const detail = await jobs.get(jobId);
      setJobDetails((current) => ({ ...current, [jobId]: detail }));
    } catch (error) {
      setJobDetailErrors((current) => ({
        ...current,
        [jobId]: getApiErrorMessage(error, "Failed to load job detail."),
      }));
    } finally {
      setLoadingJobIds((current) => {
        const next = { ...current };
        delete next[jobId];
        return next;
      });
    }
  }

  async function handleToggleJob(jobId: string) {
    if (expandedJobId === jobId) {
      setExpandedJobId(null);
      return;
    }

    setExpandedJobId(jobId);

    if (!jobDetails[jobId] && !loadingJobIds[jobId]) {
      await loadJobDetail(jobId);
    }
  }

  function resetFilters() {
    setStatusFilter("all");
    setTrackFilter("all");
    setPageSize(25);
    setOffset(0);
    setSort("created_desc");
  }

  return (
    <DashboardLayout
      actions={
        <>
          <Link className="button-secondary" href="/docs/architecture">
            Architecture guide
          </Link>
          <button className="button-primary" onClick={() => void refreshAll()} type="button">
            Refresh
          </button>
        </>
      }
      currentPath="/dashboard/pipelines"
      description="Inspect live processing telemetry from the private dashboard API, including retry posture, per-job execution state, and step-level artifacts written by workers."
      title="Pipelines"
    >
      {isInitialLoading ? (
        <DashboardSkeleton />
      ) : hasFatalLoadError ? (
        <DashboardState
          action={
            <button className="button-primary" onClick={() => void refreshAll()} type="button">
              Retry request
            </button>
          }
          description={statsError ?? listError ?? "Pipeline telemetry could not be loaded."}
          title="Pipeline telemetry could not be loaded"
          tone="error"
        />
      ) : (
        <>
          {statsError && statsData ? (
            <DashboardNotice
              description={statsError}
              title="Job stats could not be refreshed. The overview below shows the last successful snapshot."
              tone="error"
            />
          ) : null}

          {listError && listData ? (
            <DashboardNotice
              description={listError}
              title="The recent jobs table could not be refreshed. Showing the last successful response."
              tone="error"
            />
          ) : null}

          {statsData ? (
            <StatOverview stats={statsData} />
          ) : (
            <DashboardState
              action={
                <button className="button-primary" onClick={() => void refreshStats()} type="button">
                  Retry stats
                </button>
              }
              description={statsError ?? "Pipeline stats are unavailable right now."}
              title="Stats overview unavailable"
              tone="error"
            />
          )}

          {listData ? (
            listData.totalCount === 0 && statusFilter === "all" && trackFilter === "all" ? (
              <DashboardState
                action={
                  <Link className="button-secondary" href="/docs/architecture">
                    Read pipeline docs
                  </Link>
                }
                description="No processing jobs have been written yet. Once workers start ingesting or indexing sources, recent jobs and step timelines will appear here."
                title="No pipeline jobs yet"
              />
            ) : (
              <section className="surface-elevated overflow-hidden">
                <div className="border-b border-[var(--border)] px-6 py-5">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                    <div>
                      <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                        Job ledger
                      </p>
                      <h2 className="mt-2 text-2xl font-semibold text-white">
                        Recent processing jobs
                      </h2>
                      <p className="mt-2 text-sm leading-6 text-[var(--foreground-secondary)]">
                        Showing {formatNumber(sortedJobs.length)} job(s) from a total of{" "}
                        {formatNumber(listData.totalCount)} matching the current filters.
                      </p>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      <label className="rounded-[18px] border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
                        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                          Status
                        </span>
                        <select
                          className="mt-2 w-full rounded-[14px] border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2 text-sm text-white outline-none transition focus:border-[var(--border-brand)]"
                          onChange={(event) => {
                            setStatusFilter(event.target.value as StatusFilter);
                            setOffset(0);
                          }}
                          value={statusFilter}
                        >
                          {STATUS_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="rounded-[18px] border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
                        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                          Track
                        </span>
                        <select
                          className="mt-2 w-full rounded-[14px] border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2 text-sm text-white outline-none transition focus:border-[var(--border-brand)]"
                          onChange={(event) => {
                            setTrackFilter(event.target.value as TrackFilter);
                            setOffset(0);
                          }}
                          value={trackFilter}
                        >
                          {TRACK_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="rounded-[18px] border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
                        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                          Sort by
                        </span>
                        <select
                          className="mt-2 w-full rounded-[14px] border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2 text-sm text-white outline-none transition focus:border-[var(--border-brand)]"
                          onChange={(event) => {
                            setSort(event.target.value as JobSort);
                          }}
                          value={sort}
                        >
                          {SORT_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="rounded-[18px] border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
                        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                          Page size
                        </span>
                        <select
                          className="mt-2 w-full rounded-[14px] border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2 text-sm text-white outline-none transition focus:border-[var(--border-brand)]"
                          onChange={(event) => {
                            setPageSize(Number(event.target.value) as (typeof PAGE_SIZE_OPTIONS)[number]);
                            setOffset(0);
                          }}
                          value={pageSize}
                        >
                          {PAGE_SIZE_OPTIONS.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </div>
                </div>

                {sortedJobs.length === 0 ? (
                  <div className="px-6 py-8">
                    <DashboardState
                      action={
                        <button className="button-secondary" onClick={resetFilters} type="button">
                          Clear filters
                        </button>
                      }
                      description="No jobs match the current status and track filters. Clear the controls to return to the full recent job stream."
                      title="No matching jobs"
                    />
                  </div>
                ) : (
                  <>
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-left text-sm">
                        <thead className="bg-[var(--surface)]">
                          <tr>
                            <th className="px-4 py-3 font-medium text-[var(--foreground-secondary)]">
                              Status
                            </th>
                            <th className="px-4 py-3 font-medium text-[var(--foreground-secondary)]">
                              Track
                            </th>
                            <th className="px-4 py-3 font-medium text-[var(--foreground-secondary)]">
                              Job type
                            </th>
                            <th className="px-4 py-3 font-medium text-[var(--foreground-secondary)]">
                              Attempts
                            </th>
                            <th className="px-4 py-3 font-medium text-[var(--foreground-secondary)]">
                              Created
                            </th>
                            <th className="px-4 py-3 font-medium text-[var(--foreground-secondary)]">
                              Duration
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {sortedJobs.map((job) => {
                            const isExpanded = expandedJobId === job.id;
                            const detail = jobDetails[job.id];
                            const detailError = jobDetailErrors[job.id];
                            const isLoadingDetail = Boolean(loadingJobIds[job.id]);

                            return (
                              <Fragment key={job.id}>
                                <tr
                                  aria-expanded={isExpanded}
                                  className="cursor-pointer border-t border-[var(--border)] transition hover:bg-white/[0.03]"
                                  onClick={() => void handleToggleJob(job.id)}
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter" || event.key === " ") {
                                      event.preventDefault();
                                      void handleToggleJob(job.id);
                                    }
                                  }}
                                  role="button"
                                  tabIndex={0}
                                >
                                  <td className="px-4 py-4 align-top">
                                    <div className="flex items-center gap-3">
                                      <span className="font-mono text-xs text-[var(--foreground-tertiary)]">
                                        {isExpanded ? "[-]" : "[+]"}
                                      </span>
                                      <span className={`badge ${getStatusBadgeClass(job.status)}`}>
                                        {getStatusLabel(job.status)}
                                      </span>
                                    </div>
                                    {job.errorMessage ? (
                                      <p className="mt-2 max-w-[240px] text-xs leading-5 text-rose-200">
                                        {job.errorMessage}
                                      </p>
                                    ) : null}
                                  </td>
                                  <td className="px-4 py-4 align-top">
                                    <span
                                      className={`label ${
                                        job.track === "broll" ? "label-accent" : "label-brand"
                                      }`}
                                    >
                                      {getTrackLabel(job.track)}
                                    </span>
                                  </td>
                                  <td className="px-4 py-4 align-top">
                                    <p className="font-mono text-sm text-white">{job.jobType}</p>
                                    <p className="mt-2 font-mono text-xs uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                                      {job.id}
                                    </p>
                                  </td>
                                  <td className="px-4 py-4 align-top">
                                    <p className="font-mono text-sm text-white">
                                      {job.attempts} / {job.maxAttempts}
                                    </p>
                                    <p className="mt-2 text-xs text-[var(--foreground-tertiary)]">
                                      Updated {formatDashboardDateTime(job.updatedAt)}
                                    </p>
                                  </td>
                                  <td className="px-4 py-4 align-top">
                                    <p className="font-mono text-sm text-white">
                                      {formatDashboardDateTime(job.createdAt)}
                                    </p>
                                    <p className="mt-2 text-xs text-[var(--foreground-tertiary)]">
                                      Started {formatDateTime(job.startedAt, "not yet")}
                                    </p>
                                  </td>
                                  <td className="px-4 py-4 align-top">
                                    <div className="flex items-center gap-3">
                                      <span className={`h-2.5 w-2.5 rounded-full ${getStatusDotClass(job.status)}`} />
                                      <span className="font-mono text-sm text-white">
                                        {formatDuration(job)}
                                      </span>
                                    </div>
                                  </td>
                                </tr>

                                {isExpanded ? (
                                  <tr className="border-t border-[var(--border)] bg-white/[0.02]">
                                    <td className="px-4 py-5" colSpan={6}>
                                      {isLoadingDetail && !detail ? (
                                        <div className="rounded-[22px] border border-[var(--border)] bg-[var(--surface)] px-5 py-5">
                                          <div className="animate-pulse space-y-3">
                                            <div className="h-4 w-32 rounded-full bg-white/10" />
                                            <div className="h-8 w-56 rounded-full bg-white/10" />
                                            <div className="h-3 w-full rounded-full bg-white/10" />
                                            <div className="h-3 w-5/6 rounded-full bg-white/10" />
                                          </div>
                                        </div>
                                      ) : detailError && !detail ? (
                                        <div className="rounded-[22px] border border-[var(--border)] bg-[var(--surface)] px-5 py-5">
                                          <DashboardNotice
                                            description={detailError}
                                            title="Job detail could not be loaded"
                                            tone="error"
                                          />
                                          <div className="mt-4">
                                            <button
                                              className="button-primary"
                                              onClick={(event) => {
                                                event.stopPropagation();
                                                void loadJobDetail(job.id);
                                              }}
                                              type="button"
                                            >
                                              Retry detail
                                            </button>
                                          </div>
                                        </div>
                                      ) : detail ? (
                                        <ExpandedJobDetail detail={detail} />
                                      ) : null}
                                    </td>
                                  </tr>
                                ) : null}
                              </Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    <div className="flex flex-col gap-3 border-t border-[var(--border)] px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
                      <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                        Page {formatNumber(currentPage)} of {formatNumber(totalPages)}
                      </p>
                      <div className="flex flex-wrap gap-3">
                        <button
                          className="button-secondary disabled:cursor-not-allowed disabled:opacity-60"
                          disabled={offset === 0}
                          onClick={() => {
                            setOffset((current) => Math.max(0, current - pageSize));
                          }}
                          type="button"
                        >
                          Previous
                        </button>
                        <button
                          className="button-secondary disabled:cursor-not-allowed disabled:opacity-60"
                          disabled={offset + pageSize >= listData.totalCount}
                          onClick={() => {
                            setOffset((current) => current + pageSize);
                          }}
                          type="button"
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </section>
            )
          ) : (
            <DashboardState
              action={
                <button className="button-primary" onClick={() => void refreshList()} type="button">
                  Retry jobs
                </button>
              }
              description={listError ?? "Recent processing jobs are unavailable right now."}
              title="Job ledger unavailable"
              tone="error"
            />
          )}
        </>
      )}
    </DashboardLayout>
  );
}
