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
    <div className="card-border-gradient relative flex flex-col justify-between overflow-hidden p-5">
      {/* left accent bar */}
      <div className={`absolute bottom-0 left-0 top-0 w-1 ${accentColor}`} />
      <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">{label}</span>
      <div className="mb-3 mt-2 text-3xl font-bold text-white">{formatCount(value)}</div>
      {children}
      {/* glow blob */}
      <div className={`pointer-events-none absolute -bottom-4 -right-4 h-24 w-24 rounded-full ${glowColor} blur-xl`} />
    </div>
  );
}

/* ---------- Progress Bar ---------- */

function SourceProgressBar({ completed, total }: { completed: number; total: number }) {
  if (total === 0) return <span className="text-xs text-slate-500">-</span>;
  const pct = Math.round((completed / total) * 100);
  return (
    <div className="flex items-center gap-3">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800">
        <div className="glow-cyan h-full rounded-full bg-cyan-400" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-white">{pct}%</span>
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
      title="System Admin"
      description="Ingestion Engine"
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

          {/* ===== Section header with range picker (1.html style) ===== */}
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-white">Ingestion Dashboard</h2>
            <AdminRangePicker value={range} onChange={setRange} />
          </div>

          {/* ===== Stat Cards (1.html style, 4-col grid) ===== */}
          <section className="grid grid-cols-4 gap-4">
            <StatCard
              label="Jobs Completed"
              value={data.metrics.jobsCompleted.current}
              accentColor="bg-cyan-400 shadow-[0_0_10px_#06b6d4]"
              glowColor="bg-cyan-500/10"
            >
              {data.metrics.jobsCompleted.delta !== 0 ? (
                <div className={`flex items-center text-xs ${data.metrics.jobsCompleted.delta > 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {data.metrics.jobsCompleted.delta > 0 ? (
                    <svg className="mr-1 h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M7 11l5-5m0 0l5 5m-5-5v12" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} /></svg>
                  ) : (
                    <svg className="mr-1 h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M17 13l-5 5m0 0l-5-5m5 5V6" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} /></svg>
                  )}
                  {data.metrics.jobsCompleted.delta > 0 ? "+" : ""}{formatCount(data.metrics.jobsCompleted.delta)} from prev
                </div>
              ) : (
                <div className="text-xs text-slate-500">No change</div>
              )}
            </StatCard>

            <StatCard
              label="Pending Backlog"
              value={data.metrics.pendingBacklog.current}
              accentColor="bg-blue-500"
              glowColor="bg-blue-500/10"
            >
              <div className="text-xs text-blue-400">Awaiting available worker</div>
            </StatCard>

            <StatCard
              label="Active Processing"
              value={data.statusCounts.running}
              accentColor="bg-orange-500"
              glowColor="bg-orange-500/10"
            >
              <div className="flex items-center text-xs text-orange-400">
                {data.statusCounts.running > 0 ? (
                  <>
                    <span className="mr-2 h-1.5 w-1.5 animate-pulse rounded-full bg-orange-400" />
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
              accentColor="bg-red-500"
              glowColor="bg-red-500/10"
            >
              {data.metrics.jobsFailed.current > 0 ? (
                <div className="text-xs text-red-400">View details below</div>
              ) : (
                <div className="text-xs text-slate-500">All clear</div>
              )}
            </StatCard>
          </section>

          {/* ===== Worker Fleet (1.html style) ===== */}
          <section>
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-semibold text-white">Worker Fleet</h2>
                <span className="rounded border border-slate-700 bg-[#151c2c] px-2 py-0.5 text-[10px] font-semibold text-slate-300">
                  {data.statusCounts.running} RUNNING / {data.statusCounts.pending} PENDING
                </span>
              </div>
            </div>
            <WorkerLivePanel />
          </section>

          {/* ===== Content Sources (1.html style table) ===== */}
          {sourceProgress ? (
            <section>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-xl font-semibold text-white">Content Sources</h2>
                <div className="flex items-center gap-2">
                  <span className="rounded border border-slate-700 bg-[#151c2c] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-300">
                    {formatCount(sourceProgress.rows.length)} sources
                  </span>
                  <span className="rounded border border-cyan-900 bg-cyan-900/20 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-cyan-400">
                    {formatCount(sourceProgress.activeSources)} active
                  </span>
                  {sourceProgress.overallCompletion !== null ? (
                    <span className="rounded border border-slate-700 bg-[#151c2c] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-300">
                      {sourceProgress.overallCompletion}% complete
                    </span>
                  ) : null}
                </div>
              </div>

              {sourceProgress.rows.length === 0 ? (
                <p className="text-sm text-slate-500">No sources available for this window yet.</p>
              ) : (
                <div className="card-border-gradient overflow-hidden">
                  <table className="w-full border-collapse text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-800 text-xs font-semibold uppercase tracking-wider text-slate-400">
                        <th className="px-4 py-3 font-medium">Source Name</th>
                        <th className="px-4 py-3 font-medium">Type</th>
                        <th className="px-4 py-3 font-medium">Stats</th>
                        <th className="w-48 px-4 py-3 font-medium">Progress</th>
                        <th className="px-4 py-3 font-medium">Last Sync</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="text-sm">
                      {sourceProgress.rows.map((source) => (
                        <tr key={source.sourceId} className="transition-colors hover:bg-slate-800/20">
                          <td className="px-4 py-4">
                            <div>
                              <span className="font-medium text-white">
                                {source.displayName || source.slug || source.sourceId}
                              </span>
                              {source.slug && source.displayName ? (
                                <p className="mt-0.5 text-[10px] text-slate-500">{source.slug}</p>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-4 py-4">
                            <span className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-[10px] text-slate-300">
                              {source.track || "-"}
                            </span>
                          </td>
                          <td className="px-4 py-4">
                            <div className="flex gap-4 text-xs">
                              <div>
                                <span className="block font-semibold text-white">{formatCount(source.jobsCompleted)}</span>
                                <span className="text-[9px] uppercase tracking-wide text-slate-500">DONE</span>
                              </div>
                              <div>
                                <span className="block font-semibold text-blue-400">{formatCount(source.backlog)}</span>
                                <span className="text-[9px] uppercase tracking-wide text-slate-500">QUEUED</span>
                              </div>
                              <div>
                                <span className={`block font-semibold ${source.jobsFailed > 0 ? "text-red-400" : "text-slate-400"}`}>
                                  {formatCount(source.jobsFailed)}
                                </span>
                                <span className="text-[9px] uppercase tracking-wide text-slate-500">FAIL</span>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-4">
                            <SourceProgressBar completed={source.jobsCompleted} total={source.progressTotal} />
                          </td>
                          <td className="px-4 py-4 text-slate-400">
                            {formatAdminDateTime(source.lastJobAt)}
                          </td>
                          <td className="px-4 py-4">
                            <span className="flex items-center gap-2 text-xs text-slate-400">
                              <span
                                className={`h-2 w-2 rounded-full ${
                                  source.isActive
                                    ? "bg-emerald-400 shadow-[0_0_5px_#34d399]"
                                    : "bg-white/20"
                                }`}
                              />
                              {source.isActive ? "Active" : "Inactive"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="border-t border-slate-800 bg-[rgba(255,255,255,0.02)]">
                      <tr>
                        <td className="px-4 py-3 font-semibold text-white">Total</td>
                        <td className="px-4 py-3 text-slate-500">-</td>
                        <td className="px-4 py-3">
                          <div className="flex gap-4 text-xs">
                            <div>
                              <span className="block font-semibold text-white">{formatCount(sourceProgress.totals.completed)}</span>
                              <span className="text-[9px] uppercase tracking-wide text-slate-500">DONE</span>
                            </div>
                            <div>
                              <span className="block font-semibold text-blue-400">{formatCount(sourceProgress.totals.backlog)}</span>
                              <span className="text-[9px] uppercase tracking-wide text-slate-500">QUEUED</span>
                            </div>
                            <div>
                              <span className="block font-semibold text-red-400">{formatCount(sourceProgress.totals.failed)}</span>
                              <span className="text-[9px] uppercase tracking-wide text-slate-500">FAIL</span>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-slate-500">-</td>
                        <td className="px-4 py-3 text-slate-500">-</td>
                        <td className="px-4 py-3 text-slate-500">-</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </section>
          ) : null}

          {/* ===== Recent Failures ===== */}
          <section>
            <h2 className="mb-4 text-xl font-semibold text-white">Recent Failures</h2>
            <div className="card-border-gradient overflow-hidden">
              {data.recentFailedJobs.length === 0 ? (
                <p className="px-5 py-6 text-sm text-slate-500">No failures in this window.</p>
              ) : (
                <table className="w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-800 text-xs font-semibold uppercase tracking-wider text-slate-400">
                      <th className="px-4 py-3 font-medium">Job Type</th>
                      <th className="px-4 py-3 font-medium">Source</th>
                      <th className="px-4 py-3 font-medium">Error</th>
                      <th className="px-4 py-3 font-medium">Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50">
                    {data.recentFailedJobs.map((job) => {
                      const isExpanded = expandedJob === job.jobId;
                      return (
                        <tr
                          key={job.jobId}
                          className="cursor-pointer transition-colors hover:bg-slate-800/20"
                          onClick={() => setExpandedJob(isExpanded ? null : job.jobId)}
                        >
                          <td className="px-4 py-3">
                            <span className="font-medium text-white">{job.jobType}</span>
                          </td>
                          <td className="px-4 py-3 text-slate-400">
                            {job.sourceId ? job.sourceId.slice(0, 8) : "-"}
                          </td>
                          <td className="px-4 py-3">
                            <div>
                              <p className="truncate text-red-400" style={{ maxWidth: "24rem" }}>
                                {job.errorMessage ? job.errorMessage.split("\n")[0]?.slice(0, 80) : "Unknown error"}
                              </p>
                              {isExpanded && job.errorMessage ? (
                                <pre className="mt-2 max-w-xl overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-red-950/30 p-3 text-[10px] leading-5 text-red-300">
                                  {job.errorMessage}
                                </pre>
                              ) : null}
                            </div>
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-slate-400">
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

          {/* ===== Video Library ===== */}
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
