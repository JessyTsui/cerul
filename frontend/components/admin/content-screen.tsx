"use client";

import { useState } from "react";
import { admin, type AdminRange } from "@/lib/admin-api";
import { formatAdminDateTime, toAdminChartData } from "@/lib/admin-console";
import { AdminLayout } from "./admin-layout";
import { AdminMetricCard } from "./admin-metric-card";
import { AdminRangePicker } from "./admin-range-picker";
import { AdminTrendChart } from "./admin-trend-chart";
import { DashboardNotice, DashboardSkeleton, DashboardState } from "@/components/dashboard/dashboard-state";
import { useAdminResource } from "./use-admin-resource";

export function AdminContentScreen() {
  const [range, setRange] = useState<AdminRange>("7d");
  const { data, error, isLoading, refresh } = useAdminResource({
    range,
    loader: admin.getContent,
    errorMessage: "Failed to load admin content metrics.",
  });

  return (
    <AdminLayout
      currentPath="/admin/content"
      title="Content"
      description="Indexed supply, growth, and source freshness."
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
          title="Content metrics could not be loaded"
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

          {/* Inventory totals */}
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <AdminMetricCard label="B-roll assets" metric={data.metrics.brollAssetsTotal} />
            <AdminMetricCard label="Knowledge videos" metric={data.metrics.knowledgeVideosTotal} />
            <AdminMetricCard label="Knowledge segments" metric={data.metrics.knowledgeSegmentsTotal} />
            <AdminMetricCard label="Active sources" metric={data.metrics.activeSourcesTotal} />
          </section>

          {/* Growth this window */}
          <section className="grid gap-3 md:grid-cols-3">
            <AdminMetricCard label="B-roll added" metric={data.metrics.brollAssetsAdded} />
            <AdminMetricCard label="Videos added" metric={data.metrics.knowledgeVideosAdded} />
            <AdminMetricCard label="Segments added" metric={data.metrics.knowledgeSegmentsAdded} />
          </section>

          <AdminTrendChart
            title="Segment growth"
            data={toAdminChartData(data.dailySeries, "knowledgeSegmentsAdded")}
            metricLabel="Segments added"
          />

          <div className="grid gap-3 xl:grid-cols-2">
            <article className="surface-elevated overflow-hidden px-5 py-5">
              <p className="mb-4 text-sm font-semibold text-white">Source growth</p>
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-[var(--foreground-tertiary)]">
                    <th className="pb-2 pr-3 font-medium">Source</th>
                    <th className="pb-2 pr-3 font-medium">Track</th>
                    <th className="pb-2 font-medium">Added</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {data.perSourceGrowth.map((source) => (
                    <tr key={`${source.track}-${source.sourceKey}`}>
                      <td className="py-2 pr-3 text-white">{source.sourceKey}</td>
                      <td className="py-2 pr-3 text-[var(--foreground-secondary)]">{source.track}</td>
                      <td className="py-2 text-[var(--foreground-secondary)]">{source.additions}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </article>

            <article className="surface-elevated overflow-hidden px-5 py-5">
              <p className="mb-4 text-sm font-semibold text-white">Stale sources</p>
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-[var(--foreground-tertiary)]">
                    <th className="pb-2 pr-3 font-medium">Source</th>
                    <th className="pb-2 pr-3 font-medium">Track</th>
                    <th className="pb-2 pr-3 font-medium">Jobs</th>
                    <th className="pb-2 font-medium">Last job</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {data.staleSources.map((source) => (
                    <tr key={source.sourceId}>
                      <td className="py-2 pr-3 text-white">
                        {source.displayName}
                        {source.isStale ? (
                          <span className="ml-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-200">
                            stale
                          </span>
                        ) : null}
                      </td>
                      <td className="py-2 pr-3 text-[var(--foreground-secondary)]">{source.track}</td>
                      <td className="py-2 pr-3 text-[var(--foreground-secondary)]">{source.jobsInRange}</td>
                      <td className="py-2 text-[var(--foreground-secondary)]">{formatAdminDateTime(source.lastJobAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
          description="No content payload returned."
          title="No data available"
        />
      )}
    </AdminLayout>
  );
}
