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
      description="Track how much searchable supply Cerul actually has, where it is growing, and which sources are getting stale."
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
              Retry request
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
              title="Showing the last successful content snapshot."
              description={error}
              tone="error"
            />
          ) : null}

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <AdminMetricCard
              label="B-roll assets"
              metric={data.metrics.brollAssetsTotal}
              note="Current asset inventory available to the public search API."
            />
            <AdminMetricCard
              label="Knowledge videos"
              metric={data.metrics.knowledgeVideosTotal}
              note="Source videos currently indexed into the knowledge track."
            />
            <AdminMetricCard
              label="Knowledge segments"
              metric={data.metrics.knowledgeSegmentsTotal}
              note="Searchable segment units across all indexed videos."
            />
            <AdminMetricCard
              label="Active sources"
              metric={data.metrics.activeSourcesTotal}
              note="Configured content sources that are currently active."
            />
          </section>

          <section className="grid gap-4 md:grid-cols-3">
            <AdminMetricCard
              label="B-roll added"
              metric={data.metrics.brollAssetsAdded}
              note="Assets added during the selected window."
            />
            <AdminMetricCard
              label="Videos added"
              metric={data.metrics.knowledgeVideosAdded}
              note="Knowledge videos added during the selected window."
            />
            <AdminMetricCard
              label="Segments added"
              metric={data.metrics.knowledgeSegmentsAdded}
              note="Knowledge segments generated during the selected window."
            />
          </section>

          <AdminTrendChart
            title="Knowledge segment growth"
            description="This is the clearest indicator that your subtitle-first knowledge ingestion is actually producing searchable units rather than just queued jobs."
            data={toAdminChartData(data.dailySeries, "knowledgeSegmentsAdded")}
            metricLabel="Segments added"
            secondaryLabel="Requests"
          />

          <section className="grid gap-5 xl:grid-cols-2">
            <article className="surface-elevated overflow-hidden px-6 py-6">
              <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                Source growth
              </p>
              <h2 className="mt-2 text-2xl font-semibold text-white">
                Additions by source
              </h2>
              <div className="mt-5 overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="text-[var(--foreground-tertiary)]">
                    <tr>
                      <th className="pb-3 pr-4 font-medium">Track</th>
                      <th className="pb-3 pr-4 font-medium">Source</th>
                      <th className="pb-3 font-medium">Additions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-[var(--foreground-secondary)]">
                    {data.perSourceGrowth.map((source) => (
                      <tr key={`${source.track}-${source.sourceKey}`}>
                        <td className="py-3 pr-4">{source.track}</td>
                        <td className="py-3 pr-4 text-white">{source.sourceKey}</td>
                        <td className="py-3">{source.additions}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>

            <article className="surface-elevated overflow-hidden px-6 py-6">
              <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                Freshness
              </p>
              <h2 className="mt-2 text-2xl font-semibold text-white">
                Stale source watchlist
              </h2>
              <div className="mt-5 overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="text-[var(--foreground-tertiary)]">
                    <tr>
                      <th className="pb-3 pr-4 font-medium">Source</th>
                      <th className="pb-3 pr-4 font-medium">Track</th>
                      <th className="pb-3 pr-4 font-medium">Jobs in range</th>
                      <th className="pb-3 font-medium">Last job</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-[var(--foreground-secondary)]">
                    {data.staleSources.map((source) => (
                      <tr key={source.sourceId}>
                        <td className="py-3 pr-4 text-white">
                          {source.displayName}
                          {source.isStale ? (
                            <span className="ml-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-100">
                              stale
                            </span>
                          ) : null}
                        </td>
                        <td className="py-3 pr-4">{source.track}</td>
                        <td className="py-3 pr-4">{source.jobsInRange}</td>
                        <td className="py-3">{formatAdminDateTime(source.lastJobAt)}</td>
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
          description="The admin API returned no content payload."
          title="No content data available"
        />
      )}
    </AdminLayout>
  );
}
