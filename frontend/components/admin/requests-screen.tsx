"use client";

import { useState } from "react";
import { admin, type AdminRange } from "@/lib/admin-api";
import { formatAdminMetricValue, toAdminChartData } from "@/lib/admin-console";
import { AdminLayout } from "./admin-layout";
import { AdminMetricCard } from "./admin-metric-card";
import { AdminRangePicker } from "./admin-range-picker";
import { AdminTrendChart } from "./admin-trend-chart";
import { DashboardNotice, DashboardSkeleton, DashboardState } from "@/components/dashboard/dashboard-state";
import { useAdminResource } from "./use-admin-resource";

export function AdminRequestsScreen() {
  const [range, setRange] = useState<AdminRange>("7d");
  const { data, error, isLoading, refresh } = useAdminResource({
    range,
    loader: admin.getRequests,
    errorMessage: "Failed to load admin request metrics.",
  });

  return (
    <AdminLayout
      currentPath="/admin/requests"
      title="Requests"
      description="API demand, latency, and search quality."
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
          title="Request metrics could not be loaded"
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

          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <AdminMetricCard label="Requests" metric={data.metrics.totalRequests} />
            <AdminMetricCard label="Credits" metric={data.metrics.creditsUsed} />
            <AdminMetricCard label="Zero-result rate" metric={data.metrics.zeroResultRate} kind="percent" />
            <AdminMetricCard label="Answer usage" metric={data.metrics.answerUsageRate} kind="percent" />
          </section>

          {/* Latency row */}
          <article className="surface-elevated px-5 py-4">
            <p className="mb-3 text-xs text-[var(--foreground-tertiary)]">Latency</p>
            <div className="grid grid-cols-3 divide-x divide-[var(--border)]">
              {[
                { label: "p50", value: data.metrics.latency.p50Ms },
                { label: "p95", value: data.metrics.latency.p95Ms },
                { label: "p99", value: data.metrics.latency.p99Ms },
              ].map(({ label, value }) => (
                <div key={label} className="px-4 first:pl-0 last:pr-0">
                  <p className="text-xs text-[var(--foreground-tertiary)]">{label}</p>
                  <p className="mt-1 text-lg font-semibold text-white">
                    {formatAdminMetricValue(value.current, { kind: "milliseconds" })}
                  </p>
                  <p className="mt-0.5 text-[10px] text-[var(--foreground-tertiary)]">
                    prev {formatAdminMetricValue(value.previous, { kind: "milliseconds" })}
                  </p>
                </div>
              ))}
            </div>
          </article>

          <AdminTrendChart
            title="Traffic"
            data={toAdminChartData(data.dailySeries, "requests")}
            metricLabel="Requests"
            secondaryLabel="Credits"
          />

          <div className="grid gap-3 xl:grid-cols-2">
            <article className="surface-elevated overflow-hidden px-5 py-5">
              <p className="mb-4 text-sm font-semibold text-white">Top queries</p>
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-[var(--foreground-tertiary)]">
                    <th className="pb-2 pr-3 font-medium">Query</th>
                    <th className="pb-2 pr-3 font-medium">Req</th>
                    <th className="pb-2 pr-3 font-medium">0-result</th>
                    <th className="pb-2 font-medium">Latency</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {data.topQueries.map((query) => (
                    <tr key={query.queryText}>
                      <td className="py-2 pr-3 text-white">{query.queryText}</td>
                      <td className="py-2 pr-3 text-[var(--foreground-secondary)]">{query.requestCount}</td>
                      <td className="py-2 pr-3 text-[var(--foreground-secondary)]">{query.zeroResultCount}</td>
                      <td className="py-2 text-[var(--foreground-secondary)]">
                        {query.avgLatencyMs === null
                          ? "—"
                          : formatAdminMetricValue(query.avgLatencyMs, { kind: "milliseconds" })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </article>

            <article className="surface-elevated overflow-hidden px-5 py-5">
              <p className="mb-4 text-sm font-semibold text-white">Zero-result queries</p>
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-[var(--foreground-tertiary)]">
                    <th className="pb-2 pr-3 font-medium">Query</th>
                    <th className="pb-2 pr-3 font-medium">Req</th>
                    <th className="pb-2 pr-3 font-medium">w/ answer</th>
                    <th className="pb-2 font-medium">Latency</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {data.zeroResultQueries.map((query) => (
                    <tr key={`${query.queryText}-zero`}>
                      <td className="py-2 pr-3 text-white">{query.queryText}</td>
                      <td className="py-2 pr-3 text-[var(--foreground-secondary)]">{query.requestCount}</td>
                      <td className="py-2 pr-3 text-[var(--foreground-secondary)]">{query.answerCount}</td>
                      <td className="py-2 text-[var(--foreground-secondary)]">
                        {query.avgLatencyMs === null
                          ? "—"
                          : formatAdminMetricValue(query.avgLatencyMs, { kind: "milliseconds" })}
                      </td>
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
          description="No request payload returned."
          title="No data available"
        />
      )}
    </AdminLayout>
  );
}
