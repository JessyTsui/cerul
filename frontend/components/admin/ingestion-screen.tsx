"use client";

import { useState } from "react";
import { admin, type AdminRange } from "@/lib/admin-api";
import { formatAdminDateTime } from "@/lib/admin-console";
import { AdminLayout } from "./admin-layout";
import { AdminMetricCard } from "./admin-metric-card";
import { AdminRangePicker } from "./admin-range-picker";
import { VideoLibraryPanel } from "./video-library-panel";
import { WorkerLivePanel } from "./worker-live-panel";
import { DashboardNotice, DashboardSkeleton, DashboardState } from "@/components/dashboard/dashboard-state";
import { useAdminResource } from "./use-admin-resource";

export function AdminIngestionScreen() {
  const [range, setRange] = useState<AdminRange>("7d");
  const [expandedJob, setExpandedJob] = useState<string | null>(null);
  const { data, error, isLoading, refresh } = useAdminResource({
    range,
    loader: admin.getIngestion,
    errorMessage: "Failed to load admin ingestion metrics.",
  });

  return (
    <AdminLayout
      currentPath="/admin/ingestion"
      title="Ingestion"
      description="Worker queue, source health, and failure log."
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

          <div className="grid gap-3 xl:grid-cols-2">
            {/* Source health */}
            <article className="surface-elevated overflow-hidden px-5 py-5">
              <p className="mb-4 text-sm font-semibold text-white">Source health</p>
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-[var(--foreground-tertiary)]">
                    <th className="pb-2 pr-3 font-medium">Source</th>
                    <th className="pb-2 pr-3 font-medium">Track</th>
                    <th className="pb-2 pr-3 font-medium">Backlog</th>
                    <th className="pb-2 pr-3 font-medium">Failed</th>
                    <th className="pb-2 font-medium">Last job</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {data.sourceHealth.map((source) => (
                    <tr key={source.sourceId}>
                      <td className="py-2 pr-3 text-white">{source.displayName}</td>
                      <td className="py-2 pr-3 text-[var(--foreground-secondary)]">{source.track}</td>
                      <td className="py-2 pr-3 text-[var(--foreground-secondary)]">{source.backlog}</td>
                      <td className="py-2 pr-3">
                        <span className={source.jobsFailed > 0 ? "text-red-400" : "text-[var(--foreground-secondary)]"}>
                          {source.jobsFailed}
                        </span>
                      </td>
                      <td className="py-2 text-[var(--foreground-secondary)]">{formatAdminDateTime(source.lastJobAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </article>

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
          </div>
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
