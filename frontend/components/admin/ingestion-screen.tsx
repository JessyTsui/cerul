"use client";

import { useState } from "react";
import { admin, type AdminIngestionSummary, type AdminRange } from "@/lib/admin-api";
import { formatAdminDateTime } from "@/lib/admin-console";
import { AdminLayout } from "./admin-layout";
import { AdminMetricCard } from "./admin-metric-card";
import { AdminRangePicker } from "./admin-range-picker";
import { VideoLibraryPanel } from "./video-library-panel";
import { WorkerLivePanel } from "./worker-live-panel";
import { DashboardNotice, DashboardSkeleton, DashboardState } from "@/components/dashboard/dashboard-state";
import { useAdminResource } from "./use-admin-resource";

const INTEGER_FORMATTER = new Intl.NumberFormat("en-US");

type SourceProgressRow = {
  sourceId: string;
  slug: string;
  displayName: string;
  track: string;
  isActive: boolean;
  jobsCompleted: number;
  running: number;
  pending: number;
  jobsFailed: number;
  backlog: number;
  lastJobAt: string | null;
  progressTotal: number;
};

type SourceProgressTotals = {
  completed: number;
  running: number;
  pending: number;
  failed: number;
};

function formatCount(value: number) {
  return INTEGER_FORMATTER.format(value);
}

function ProgressBar({ completed, total }: { completed: number; total: number }) {
  if (total === 0) {
    return <span className="text-xs text-[var(--foreground-tertiary)]">—</span>;
  }

  const percentage = Math.round((completed / total) * 100);

  return (
    <div className="flex min-w-[9.5rem] items-center gap-3">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/8">
        <div
          className="h-full rounded-full bg-emerald-400 shadow-[0_0_18px_rgba(52,211,153,0.35)]"
          style={{ width: `${percentage}%` }}
        />
      </div>
      <span className="min-w-[2.5rem] text-right font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--foreground-secondary)]">
        {percentage}%
      </span>
    </div>
  );
}

function allocateRunningCounts(backlogs: number[], runningTotal: number) {
  const totalBacklog = backlogs.reduce((sum, value) => sum + value, 0);

  if (totalBacklog === 0 || runningTotal <= 0) {
    return backlogs.map(() => 0);
  }

  const cappedRunning = Math.min(runningTotal, totalBacklog);
  const allocations = backlogs.map((backlog) =>
    Math.floor((backlog / totalBacklog) * cappedRunning),
  );
  let assigned = allocations.reduce((sum, value) => sum + value, 0);

  const remainders = backlogs
    .map((backlog, index) => ({
      index,
      backlog,
      remainder: (backlog / totalBacklog) * cappedRunning - allocations[index],
    }))
    .sort(
      (left, right) =>
        right.remainder - left.remainder ||
        right.backlog - left.backlog ||
        left.index - right.index,
    );

  for (const item of remainders) {
    if (assigned >= cappedRunning) {
      break;
    }

    if (allocations[item.index] >= item.backlog) {
      continue;
    }

    allocations[item.index] += 1;
    assigned += 1;
  }

  return allocations;
}

function buildSourceProgressModel(data: AdminIngestionSummary) {
  const sortedSources = [...data.sourceHealth].sort(
    (left, right) =>
      right.jobsCompleted - left.jobsCompleted ||
      right.backlog - left.backlog ||
      left.displayName.localeCompare(right.displayName),
  );
  const runningPool = Math.max(0, data.statusCounts.running + data.statusCounts.retrying);
  const runningCounts = allocateRunningCounts(
    sortedSources.map((source) => source.backlog),
    runningPool,
  );

  const rows: SourceProgressRow[] = sortedSources.map((source, index) => {
    const running = Math.min(source.backlog, runningCounts[index] ?? 0);
    const pending = Math.max(source.backlog - running, 0);

    return {
      ...source,
      running,
      pending,
      progressTotal: source.jobsCompleted + source.backlog + source.jobsFailed,
    };
  });

  const totals = rows.reduce<SourceProgressTotals>(
    (result, row) => {
      result.completed += row.jobsCompleted;
      result.running += row.running;
      result.pending += row.pending;
      result.failed += row.jobsFailed;
      return result;
    },
    {
      completed: 0,
      running: 0,
      pending: 0,
      failed: 0,
    },
  );

  const overallTotal = totals.completed + totals.running + totals.pending + totals.failed;
  const overallCompletion = overallTotal === 0 ? null : Math.round((totals.completed / overallTotal) * 100);

  return {
    rows,
    totals,
    overallCompletion,
    activeSources: rows.filter((row) => row.isActive).length,
  };
}

export function AdminIngestionScreen() {
  const [range, setRange] = useState<AdminRange>("7d");
  const [expandedJob, setExpandedJob] = useState<string | null>(null);
  const { data, error, isLoading, refresh } = useAdminResource({
    range,
    loader: admin.getIngestion,
    errorMessage: "Failed to load admin ingestion metrics.",
  });
  const sourceProgress = data ? buildSourceProgressModel(data) : null;

  return (
    <AdminLayout
      currentPath="/admin/ingestion"
      title="Ingestion"
      description="Worker queue, source progress, and failure log."
      actions={
        <>
          <AdminRangePicker value={range} onChange={setRange} />
          <button className="button-primary" onClick={() => void refresh()} type="button">
            Refresh
          </button>
        </>
      }
    >
      {isLoading && !data ? (
        <DashboardSkeleton />
      ) : error && !data ? (
        <DashboardState
          action={
            <button className="button-primary" onClick={() => void refresh()} type="button">
              Retry
            </button>
          }
          description={error}
          title="Ingestion metrics could not be loaded"
          tone="error"
        />
      ) : data ? (
        <>
          {error ? (
            <DashboardNotice
              title="Showing last successful snapshot."
              description={error}
              tone="error"
            />
          ) : null}

          <WorkerLivePanel />

          <VideoLibraryPanel />

          <section className="grid gap-3 md:grid-cols-3">
            <AdminMetricCard label="Jobs completed" metric={data.metrics.jobsCompleted} />
            <AdminMetricCard label="Jobs failed" metric={data.metrics.jobsFailed} />
            <AdminMetricCard label="Pending backlog" metric={data.metrics.pendingBacklog} />
          </section>

          {sourceProgress ? (
            <section className="surface-elevated overflow-hidden">
              <div className="flex flex-col gap-4 border-b border-[var(--border)] px-6 py-5 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <p className="eyebrow">Source progress</p>
                  <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-white">
                    Source Progress
                  </h2>
                  <p className="mt-2 max-w-3xl text-sm text-[var(--foreground-secondary)]">
                    Completed volume, active backlog, and queue depth across every indexed source.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center rounded-full border border-[var(--border)] bg-[rgba(255,255,255,0.03)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                    {formatCount(sourceProgress.rows.length)} sources tracked
                  </span>
                  <span className="inline-flex items-center rounded-full border border-[var(--border-brand)] bg-[var(--brand-subtle)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--brand-bright)]">
                    {formatCount(sourceProgress.activeSources)} active
                  </span>
                  <span className="inline-flex items-center rounded-full border border-[var(--border)] bg-[rgba(255,255,255,0.03)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-secondary)]">
                    {sourceProgress.overallCompletion === null
                      ? "No progress data"
                      : `${sourceProgress.overallCompletion}% complete`}
                  </span>
                </div>
              </div>

              {sourceProgress.rows.length === 0 ? (
                <p className="px-6 py-6 text-sm text-[var(--foreground-tertiary)]">
                  No sources are available for this window yet.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-[1080px] w-full text-left text-sm">
                    <thead className="bg-[rgba(255,255,255,0.03)]">
                      <tr>
                        {[
                          "Source",
                          "Type",
                          "Completed",
                          "Running",
                          "Pending",
                          "Failed",
                          "Progress",
                          "Last Job",
                          "Status",
                        ].map((label) => (
                          <th
                            key={label}
                            className="px-4 py-4 font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]"
                          >
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {sourceProgress.rows.map((source) => (
                        <tr key={source.sourceId} className="align-middle">
                          <td className="px-4 py-4">
                            <div className="min-w-[12rem]">
                              <p className="font-medium text-white">
                                {source.displayName || source.slug || source.sourceId}
                              </p>
                              {source.slug ? (
                                <p className="mt-1 text-xs text-[var(--foreground-tertiary)]">
                                  {source.slug}
                                </p>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-4 py-4">
                            <span className="inline-flex items-center rounded-full border border-[var(--border)] bg-[rgba(255,255,255,0.03)] px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--foreground-secondary)]">
                              {source.track || "—"}
                            </span>
                          </td>
                          <td className="px-4 py-4 font-mono text-sm text-emerald-300">
                            {formatCount(source.jobsCompleted)}
                          </td>
                          <td className="px-4 py-4 font-mono text-sm text-amber-200">
                            {formatCount(source.running)}
                          </td>
                          <td className="px-4 py-4 font-mono text-sm text-[var(--foreground-secondary)]">
                            {formatCount(source.pending)}
                          </td>
                          <td className="px-4 py-4 font-mono text-sm">
                            <span className={source.jobsFailed > 0 ? "text-red-400" : "text-[var(--foreground-secondary)]"}>
                              {formatCount(source.jobsFailed)}
                            </span>
                          </td>
                          <td className="px-4 py-4">
                            <ProgressBar completed={source.jobsCompleted} total={source.progressTotal} />
                          </td>
                          <td className="px-4 py-4 text-sm text-[var(--foreground-secondary)]">
                            {formatAdminDateTime(source.lastJobAt)}
                          </td>
                          <td className="px-4 py-4">
                            <span className="inline-flex items-center gap-2 text-xs text-[var(--foreground-secondary)]">
                              <span
                                className={`h-2.5 w-2.5 rounded-full ${
                                  source.isActive
                                    ? "bg-emerald-400 shadow-[0_0_14px_rgba(52,211,153,0.5)]"
                                    : "bg-white/20"
                                }`}
                              />
                              {source.isActive ? "Active" : "Inactive"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="border-t border-white/10 bg-[rgba(255,255,255,0.025)]">
                      <tr>
                        <td className="px-4 py-4 font-semibold text-white">Total</td>
                        <td className="px-4 py-4 text-[var(--foreground-tertiary)]">—</td>
                        <td className="px-4 py-4 font-mono text-sm text-emerald-300">
                          {formatCount(sourceProgress.totals.completed)}
                        </td>
                        <td className="px-4 py-4 font-mono text-sm text-amber-200">
                          {formatCount(sourceProgress.totals.running)}
                        </td>
                        <td className="px-4 py-4 font-mono text-sm text-[var(--foreground-secondary)]">
                          {formatCount(sourceProgress.totals.pending)}
                        </td>
                        <td className="px-4 py-4 font-mono text-sm text-red-400">
                          {formatCount(sourceProgress.totals.failed)}
                        </td>
                        <td className="px-4 py-4 text-[var(--foreground-tertiary)]">—</td>
                        <td className="px-4 py-4 text-[var(--foreground-tertiary)]">—</td>
                        <td className="px-4 py-4 text-[var(--foreground-tertiary)]">—</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </section>
          ) : null}

          {/* Recent failed jobs */}
          <article className="surface-elevated overflow-hidden px-5 py-5">
            <p className="mb-4 text-sm font-semibold text-white">Recent failures</p>
            <div className="divide-y divide-white/5">
              {data.recentFailedJobs.length === 0 ? (
                <p className="py-3 text-xs text-[var(--foreground-tertiary)]">No failures in this window.</p>
              ) : data.recentFailedJobs.map((job) => {
                const isExpanded = expandedJob === job.jobId;
                return (
                  <div key={job.jobId} className="py-2.5">
                    <button
                      type="button"
                      className="flex w-full items-start justify-between gap-2 text-left"
                      onClick={() => setExpandedJob(isExpanded ? null : job.jobId)}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-white">{job.jobType}</span>
                          {job.sourceId ? (
                            <span className="text-[10px] text-[var(--foreground-tertiary)]">{job.sourceId.slice(0, 8)}</span>
                          ) : null}
                        </div>
                        <p className="mt-0.5 truncate text-[11px] text-[var(--foreground-tertiary)]">
                          {job.errorMessage
                            ? job.errorMessage.split("\n")[0]?.slice(0, 80)
                            : "Unknown error"}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="text-[10px] text-[var(--foreground-tertiary)]">{formatAdminDateTime(job.updatedAt)}</span>
                        <span className="text-[10px] text-[var(--foreground-tertiary)]">{isExpanded ? "▲" : "▼"}</span>
                      </div>
                    </button>
                    {isExpanded && job.errorMessage ? (
                      <pre className="mt-2 overflow-x-auto rounded-lg bg-red-950/30 p-3 text-[10px] leading-5 text-red-300 whitespace-pre-wrap break-all">
                        {job.errorMessage}
                      </pre>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </article>
        </>
      ) : (
        <DashboardState
          action={
            <button className="button-primary" onClick={() => void refresh()} type="button">
              Retry
            </button>
          }
          description="No ingestion payload returned."
          title="No data available"
        />
      )}
    </AdminLayout>
  );
}
