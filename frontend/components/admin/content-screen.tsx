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
        <AdminRangePicker value={range} onChange={setRange} />
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
            <article className="surface-elevated overflow-hidden rounded-[30px] px-5 py-5">
              <p className="text-sm font-semibold text-[var(--foreground)]">Source growth</p>
              <p className="mt-1 text-xs leading-6 text-[var(--foreground-tertiary)]">
                Which sources are contributing the most newly indexed content in this window.
              </p>
              <table className="admin-table mt-4">
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Track</th>
                    <th>Added</th>
                  </tr>
                </thead>
                <tbody>
                  {data.perSourceGrowth.map((source) => (
                    <tr key={`${source.track}-${source.sourceKey}`}>
                      <td className="admin-table-primary">{source.sourceKey}</td>
                      <td>{source.track}</td>
                      <td>{source.additions}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </article>

            <article className="surface-elevated overflow-hidden rounded-[30px] px-5 py-5">
              <p className="text-sm font-semibold text-[var(--foreground)]">Stale sources</p>
              <p className="mt-1 text-xs leading-6 text-[var(--foreground-tertiary)]">
                Sources that look quiet or under-synced relative to the rest of the catalog.
              </p>
              <table className="admin-table mt-4">
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Track</th>
                    <th>Jobs</th>
                    <th>Last job</th>
                  </tr>
                </thead>
                <tbody>
                  {data.staleSources.map((source) => (
                    <tr key={source.sourceId}>
                      <td className="admin-table-primary">
                        {source.displayName}
                        {source.isStale ? (
                          <span className="ml-1.5 rounded-full border border-[rgba(212,156,105,0.22)] bg-[rgba(212,156,105,0.12)] px-1.5 py-0.5 text-[10px] text-[var(--accent-bright)]">
                            stale
                          </span>
                        ) : null}
                      </td>
                      <td>{source.track}</td>
                      <td>{source.jobsInRange}</td>
                      <td>{formatAdminDateTime(source.lastJobAt)}</td>
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
