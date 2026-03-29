"use client";

import { useState } from "react";
import { admin, type AdminIngestionSummary, type AdminRange } from "@/lib/admin-api";
import { formatAdminDateTime } from "@/lib/admin-console";
import { AdminLayout } from "./admin-layout";
import { AdminRangePicker } from "./admin-range-picker";
import { WorkerLivePanel } from "./worker-live-panel";
import { VideoLibraryPanel } from "./video-library-panel";
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
  jobsFailed: number;
  backlog: number;
  lastJobAt: string | null;
  progressTotal: number;
};

type SourceProgressTotals = {
  completed: number;
  backlog: number;
  failed: number;
};

function formatCount(value: number) {
  return INTEGER_FORMATTER.format(value);
}

function buildSourceProgressModel(data: AdminIngestionSummary) {
  const sortedSources = [...data.sourceHealth].sort(
    (left, right) =>
      right.jobsCompleted - left.jobsCompleted ||
      right.backlog - left.backlog ||
      left.displayName.localeCompare(right.displayName),
  );

  const rows: SourceProgressRow[] = sortedSources.map((source) => ({
    ...source,
    progressTotal: source.jobsCompleted + source.backlog + source.jobsFailed,
  }));

  const totals = rows.reduce<SourceProgressTotals>(
    (result, row) => {
      result.completed += row.jobsCompleted;
      result.backlog += row.backlog;
      result.failed += row.jobsFailed;
      return result;
    },
    { completed: 0, backlog: 0, failed: 0 },
  );

  const overallTotal = totals.completed + totals.backlog + totals.failed;
  const overallCompletion = overallTotal === 0 ? null : Math.round((totals.completed / overallTotal) * 100);

  return { rows, totals, overallCompletion, activeSources: rows.filter((row) => row.isActive).length };
}

/* ---------- Stat Card (1.html style) ---------- */

type StatCardProps = {
  label: string;
  value: number;
  accentColor: string; // tailwind color class for left bar, e.g. "bg-cyan-400"
  glowColor: string; // tailwind bg color for the glow blob
  children?: React.ReactNode; // subtitle line
};

function StatCard({ label, value, accentColor, glowColor, children }: StatCardProps) {
  return (
    <div className="surface-elevated relative flex h-full flex-col justify-between rounded-[28px] p-5">
      {/* left accent bar */}
      <div className={`absolute bottom-0 left-0 top-0 w-1 ${accentColor}`} />
      <span className="text-xs font-semibold uppercase tracking-wider text-[var(--foreground-tertiary)]">{label}</span>
      <div className="mb-3 mt-2 text-3xl font-bold text-[var(--foreground)]">{formatCount(value)}</div>
      {children}
      {/* glow blob */}
      <div className={`pointer-events-none absolute -bottom-4 -right-4 h-24 w-24 rounded-full ${glowColor} blur-xl`} />
    </div>
  );
}

/* ---------- Progress Bar ---------- */

function SourceProgressBar({ completed, total }: { completed: number; total: number }) {
  if (total === 0) return <span className="text-xs text-[var(--foreground-tertiary)]">-</span>;
  const pct = Math.round((completed / total) * 100);
  return (
    <div className="flex items-center gap-3">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[rgba(36,29,21,0.08)]">
        <div
          className="h-full rounded-full bg-[linear-gradient(90deg,var(--foreground),var(--brand-bright),var(--accent-bright))]"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-[var(--foreground)]">{pct}%</span>
    </div>
  );
}

/* ---------- Main Screen ---------- */

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
      description="Worker fleet health, backlog, failures, and source sync progress."
      actions={<AdminRangePicker value={range} onChange={setRange} />}
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
        <div className="space-y-6">
          {error ? (
            <DashboardNotice title="Showing last successful snapshot." description={error} tone="error" />
          ) : null}

          <section className="surface-elevated rounded-[32px] px-6 py-6">
            <p className="eyebrow">Operator View</p>
            <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-2xl">
                <h2 className="text-2xl font-semibold tracking-[-0.04em] text-[var(--foreground)]">
                  Watch backlog, worker activity, and source reliability from one place.
                </h2>
                <p className="mt-3 text-sm leading-7 text-[var(--foreground-secondary)]">
                  This page is intentionally compact: live work, source throughput,
                  failures, and indexed video cleanup each get one dedicated surface.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className="admin-chip admin-chip-brand">
                  {data.statusCounts.running} running
                </span>
                <span className="admin-chip">
                  {data.statusCounts.pending} pending
                </span>
                <span className="admin-chip admin-chip-warning">
                  {data.metrics.pendingBacklog.current} backlog
                </span>
              </div>
            </div>
          </section>

          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Jobs Completed"
              value={data.metrics.jobsCompleted.current}
              accentColor="bg-[var(--brand-bright)]"
              glowColor="bg-[rgba(136,165,242,0.18)]"
            >
              {data.metrics.jobsCompleted.delta !== 0 ? (
                <div className={`flex items-center text-xs ${data.metrics.jobsCompleted.delta > 0 ? "text-[var(--success)]" : "text-[var(--error)]"}`}>
                  {data.metrics.jobsCompleted.delta > 0 ? (
                    <svg className="mr-1 h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M7 11l5-5m0 0l5 5m-5-5v12" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} /></svg>
                  ) : (
                    <svg className="mr-1 h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M17 13l-5 5m0 0l-5-5m5 5V6" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} /></svg>
                  )}
                  {data.metrics.jobsCompleted.delta > 0 ? "+" : ""}{formatCount(data.metrics.jobsCompleted.delta)} from prev
                </div>
              ) : (
                <div className="text-xs text-[var(--foreground-tertiary)]">No change</div>
              )}
            </StatCard>

            <StatCard
              label="Pending Backlog"
              value={data.metrics.pendingBacklog.current}
              accentColor="bg-[var(--accent-bright)]"
              glowColor="bg-[rgba(212,156,105,0.18)]"
            >
              <div className="text-xs text-[var(--accent-bright)]">Awaiting available worker</div>
            </StatCard>

            <StatCard
              label="Active Processing"
              value={data.statusCounts.running}
              accentColor="bg-[var(--foreground)]"
              glowColor="bg-[rgba(36,29,21,0.12)]"
            >
              <div className="flex items-center text-xs text-[var(--foreground-secondary)]">
                {data.statusCounts.running > 0 ? (
                  <>
                    <span className="mr-2 h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--foreground)]" />
                    Live processing
                  </>
                ) : (
                  "Idle"
                )}
              </div>
            </StatCard>

            <StatCard
              label="Failed Jobs"
              value={data.metrics.jobsFailed.current}
              accentColor="bg-[var(--error)]"
              glowColor="bg-[rgba(191,91,70,0.14)]"
            >
              {data.metrics.jobsFailed.current > 0 ? (
                <div className="text-xs text-[var(--error)]">View details below</div>
              ) : (
                <div className="text-xs text-[var(--foreground-tertiary)]">All clear</div>
              )}
            </StatCard>
          </section>

          <section>
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-semibold text-[var(--foreground)]">Worker Fleet</h2>
                <span className="admin-chip admin-chip-brand">
                  {data.statusCounts.running} RUNNING / {data.statusCounts.pending} PENDING
                </span>
              </div>
            </div>
            <WorkerLivePanel />
          </section>

          {sourceProgress ? (
            <section>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-xl font-semibold text-[var(--foreground)]">Content Sources</h2>
                <div className="flex items-center gap-2">
                  <span className="admin-chip">
                    {formatCount(sourceProgress.rows.length)} sources
                  </span>
                  <span className="admin-chip admin-chip-success">
                    {formatCount(sourceProgress.activeSources)} active
                  </span>
                  {sourceProgress.overallCompletion !== null ? (
                    <span className="admin-chip">
                      {sourceProgress.overallCompletion}% complete
                    </span>
                  ) : null}
                </div>
              </div>

              {sourceProgress.rows.length === 0 ? (
                <p className="text-sm text-[var(--foreground-tertiary)]">No sources available for this window yet.</p>
              ) : (
                <div className="surface-elevated overflow-hidden rounded-[30px] px-5 py-5">
                  <table className="admin-table text-sm">
                    <thead>
                      <tr>
                        <th>Source Name</th>
                        <th>Type</th>
                        <th>Stats</th>
                        <th className="w-48">Progress</th>
                        <th>Last Sync</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody className="text-sm">
                      {sourceProgress.rows.map((source) => (
                        <tr key={source.sourceId}>
                          <td>
                            <div>
                              <span className="font-medium text-[var(--foreground)]">
                                {source.displayName || source.slug || source.sourceId}
                              </span>
                              {source.slug && source.displayName ? (
                                <p className="mt-0.5 text-[10px] text-[var(--foreground-tertiary)]">{source.slug}</p>
                              ) : null}
                            </div>
                          </td>
                          <td>
                            <span className="rounded-full border border-[var(--border)] bg-white/68 px-2 py-1 text-[10px] text-[var(--foreground-secondary)]">
                              {source.track || "-"}
                            </span>
                          </td>
                          <td>
                            <div className="flex gap-4 text-xs">
                              <div>
                                <span className="block font-semibold text-[var(--foreground)]">{formatCount(source.jobsCompleted)}</span>
                                <span className="text-[9px] uppercase tracking-wide text-[var(--foreground-tertiary)]">DONE</span>
                              </div>
                              <div>
                                <span className="block font-semibold text-[var(--accent-bright)]">{formatCount(source.backlog)}</span>
                                <span className="text-[9px] uppercase tracking-wide text-[var(--foreground-tertiary)]">QUEUED</span>
                              </div>
                              <div>
                                <span className={`block font-semibold ${source.jobsFailed > 0 ? "text-[var(--error)]" : "text-[var(--foreground-tertiary)]"}`}>
                                  {formatCount(source.jobsFailed)}
                                </span>
                                <span className="text-[9px] uppercase tracking-wide text-[var(--foreground-tertiary)]">FAIL</span>
                              </div>
                            </div>
                          </td>
                          <td>
                            <SourceProgressBar completed={source.jobsCompleted} total={source.progressTotal} />
                          </td>
                          <td>
                            {formatAdminDateTime(source.lastJobAt)}
                          </td>
                          <td>
                            <span className="flex items-center gap-2 text-xs text-[var(--foreground-secondary)]">
                              <span
                                className={`h-2 w-2 rounded-full ${
                                  source.isActive
                                    ? "bg-[var(--success)]"
                                    : "bg-[rgba(36,29,21,0.18)]"
                                }`}
                              />
                              {source.isActive ? "Active" : "Inactive"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td className="font-semibold text-[var(--foreground)]">Total</td>
                        <td>-</td>
                        <td>
                          <div className="flex gap-4 text-xs">
                            <div>
                              <span className="block font-semibold text-[var(--foreground)]">{formatCount(sourceProgress.totals.completed)}</span>
                              <span className="text-[9px] uppercase tracking-wide text-[var(--foreground-tertiary)]">DONE</span>
                            </div>
                            <div>
                              <span className="block font-semibold text-[var(--accent-bright)]">{formatCount(sourceProgress.totals.backlog)}</span>
                              <span className="text-[9px] uppercase tracking-wide text-[var(--foreground-tertiary)]">QUEUED</span>
                            </div>
                            <div>
                              <span className="block font-semibold text-[var(--error)]">{formatCount(sourceProgress.totals.failed)}</span>
                              <span className="text-[9px] uppercase tracking-wide text-[var(--foreground-tertiary)]">FAIL</span>
                            </div>
                          </div>
                        </td>
                        <td>-</td>
                        <td>-</td>
                        <td>-</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </section>
          ) : null}

          <section>
            <h2 className="mb-4 text-xl font-semibold text-[var(--foreground)]">Recent Failures</h2>
            <div className="surface-elevated overflow-hidden rounded-[30px] px-5 py-5">
              {data.recentFailedJobs.length === 0 ? (
                <p className="py-6 text-sm text-[var(--foreground-tertiary)]">No failures in this window.</p>
              ) : (
                <table className="admin-table text-sm">
                  <thead>
                    <tr>
                      <th>Job Type</th>
                      <th>Source</th>
                      <th>Error</th>
                      <th>Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentFailedJobs.map((job) => {
                      const isExpanded = expandedJob === job.jobId;
                      return (
                        <tr
                          key={job.jobId}
                          className="cursor-pointer"
                          onClick={() => setExpandedJob(isExpanded ? null : job.jobId)}
                        >
                          <td className="admin-table-primary">{job.jobType}</td>
                          <td>
                            {job.sourceId ? job.sourceId.slice(0, 8) : "-"}
                          </td>
                          <td>
                            <div>
                              <p className="truncate text-[var(--error)]" style={{ maxWidth: "24rem" }}>
                                {job.errorMessage ? job.errorMessage.split("\n")[0]?.slice(0, 80) : "Unknown error"}
                              </p>
                              {isExpanded && job.errorMessage ? (
                                <pre className="mt-2 max-w-xl overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-[rgba(191,91,70,0.18)] bg-[rgba(191,91,70,0.1)] p-3 text-[10px] leading-5 text-[var(--error)]">
                                  {job.errorMessage}
                                </pre>
                              ) : null}
                            </div>
                          </td>
                          <td className="whitespace-nowrap">
                            {formatAdminDateTime(job.updatedAt)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </section>

          <VideoLibraryPanel />
        </div>
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
