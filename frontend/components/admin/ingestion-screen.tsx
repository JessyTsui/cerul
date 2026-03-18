"use client";

import Link from "next/link";
import { useState } from "react";
import { admin, type AdminRange } from "@/lib/admin-api";
import { formatAdminDateTime, toAdminChartData } from "@/lib/admin-console";
import { AdminLayout } from "./admin-layout";
import { AdminMetricCard } from "./admin-metric-card";
import { AdminRangePicker } from "./admin-range-picker";
import { AdminTrendChart } from "./admin-trend-chart";
import { DashboardNotice, DashboardSkeleton, DashboardState } from "@/components/dashboard/dashboard-state";
import { useAdminResource } from "./use-admin-resource";

export function AdminIngestionScreen() {
  const [range, setRange] = useState<AdminRange>("7d");
  const { data, error, isLoading, refresh } = useAdminResource({
    range,
    loader: admin.getIngestion,
    errorMessage: "Failed to load admin ingestion metrics.",
  });

  return (
    <AdminLayout
      currentPath="/admin/ingestion"
      title="Ingestion"
      description="Track backlog, completion rate, source health, and failure posture across the worker system."
      actions={
        <>
          <AdminRangePicker value={range} onChange={setRange} />
          <Link className="button-secondary" href="/admin/pipelines">
            Pipeline detail
          </Link>
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
              Retry request
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
              title="Showing the last successful ingestion snapshot."
              description={error}
              tone="error"
            />
          ) : null}

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <AdminMetricCard
              label="Jobs created"
              metric={data.metrics.jobsCreated}
              note="Processing jobs opened during the selected window."
            />
            <AdminMetricCard
              label="Jobs completed"
              metric={data.metrics.jobsCompleted}
              note="Jobs finishing successfully in the same window."
            />
            <AdminMetricCard
              label="Jobs failed"
              metric={data.metrics.jobsFailed}
              note="Failures updated inside the selected window."
            />
            <AdminMetricCard
              label="Pending backlog"
              metric={data.metrics.pendingBacklog}
              note="Current queue depth across pending and in-flight jobs."
            />
          </section>

          <section className="grid gap-4 md:grid-cols-3">
            <AdminMetricCard
              label="Completion rate"
              metric={data.metrics.completionRate}
              note="Completed / (completed + failed)."
              kind="percent"
            />
            <AdminMetricCard
              label="Failure rate"
              metric={data.metrics.failureRate}
              note="Failed / (completed + failed)."
              kind="percent"
            />
            <AdminMetricCard
              label="Avg processing time"
              metric={data.metrics.averageProcessingMs}
              note="Mean runtime for completed jobs."
              kind="milliseconds"
            />
          </section>

          <AdminTrendChart
            title="Job outcomes"
            description="If the failure bars rise faster than completions, the scheduler and worker surface may still look alive while the product quietly loses freshness."
            data={toAdminChartData(data.dailySeries, "jobsCompleted")}
            metricLabel="Jobs completed"
            secondaryLabel="Requests"
          />

          <section className="grid gap-5 xl:grid-cols-2">
            <article className="surface-elevated px-6 py-6">
              <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                Status counts
              </p>
              <h2 className="mt-2 text-2xl font-semibold text-white">
                Queue posture
              </h2>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {Object.entries(data.statusCounts).map(([key, value]) => (
                  <div
                    key={key}
                    className="rounded-[18px] border border-[var(--border)] bg-[var(--surface)] px-4 py-4"
                  >
                    <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                      {key}
                    </p>
                    <p className="mt-2 text-xl font-semibold text-white">{value}</p>
                  </div>
                ))}
              </div>
            </article>

            <article className="surface-elevated overflow-hidden px-6 py-6">
              <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                Failed steps
              </p>
              <h2 className="mt-2 text-2xl font-semibold text-white">
                Common breakpoints
              </h2>
              <div className="mt-5 overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="text-[var(--foreground-tertiary)]">
                    <tr>
                      <th className="pb-3 pr-4 font-medium">Step</th>
                      <th className="pb-3 pr-4 font-medium">Failures</th>
                      <th className="pb-3 font-medium">Last seen</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-[var(--foreground-secondary)]">
                    {data.failedSteps.map((step) => (
                      <tr key={step.stepName}>
                        <td className="py-3 pr-4 text-white">{step.stepName}</td>
                        <td className="py-3 pr-4">{step.failureCount}</td>
                        <td className="py-3">{formatAdminDateTime(step.lastFailedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          </section>

          <section className="grid gap-5 xl:grid-cols-2">
            <article className="surface-elevated overflow-hidden px-6 py-6">
              <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                Source health
              </p>
              <h2 className="mt-2 text-2xl font-semibold text-white">
                Scheduler coverage by source
              </h2>
              <div className="mt-5 overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="text-[var(--foreground-tertiary)]">
                    <tr>
                      <th className="pb-3 pr-4 font-medium">Source</th>
                      <th className="pb-3 pr-4 font-medium">Created</th>
                      <th className="pb-3 pr-4 font-medium">Completed</th>
                      <th className="pb-3 pr-4 font-medium">Failed</th>
                      <th className="pb-3 font-medium">Backlog</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-[var(--foreground-secondary)]">
                    {data.sourceHealth.map((source) => (
                      <tr key={source.sourceId}>
                        <td className="py-3 pr-4 text-white">{source.displayName}</td>
                        <td className="py-3 pr-4">{source.jobsCreated}</td>
                        <td className="py-3 pr-4">{source.jobsCompleted}</td>
                        <td className="py-3 pr-4">{source.jobsFailed}</td>
                        <td className="py-3">{source.backlog}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>

            <article className="surface-elevated overflow-hidden px-6 py-6">
              <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                Recent failed jobs
              </p>
              <h2 className="mt-2 text-2xl font-semibold text-white">
                Latest failures
              </h2>
              <div className="mt-5 overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="text-[var(--foreground-tertiary)]">
                    <tr>
                      <th className="pb-3 pr-4 font-medium">Job</th>
                      <th className="pb-3 pr-4 font-medium">Track</th>
                      <th className="pb-3 pr-4 font-medium">Attempts</th>
                      <th className="pb-3 font-medium">Updated</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-[var(--foreground-secondary)]">
                    {data.recentFailedJobs.map((job) => (
                      <tr key={job.jobId}>
                        <td className="py-3 pr-4 text-white">{job.jobType}</td>
                        <td className="py-3 pr-4">{job.track}</td>
                        <td className="py-3 pr-4">
                          {job.attempts}/{job.maxAttempts}
                        </td>
                        <td className="py-3">{formatAdminDateTime(job.updatedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          </section>
        </>
      ) : (
        <DashboardState
          action={
            <button className="button-primary" onClick={() => void refresh()} type="button">
              Retry request
            </button>
          }
          description="The admin API returned no ingestion payload."
          title="No ingestion data available"
        />
      )}
    </AdminLayout>
  );
}
