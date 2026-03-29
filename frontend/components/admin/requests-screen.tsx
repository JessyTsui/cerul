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

          <article className="surface-elevated rounded-[30px] px-5 py-5">
            <p className="eyebrow">Latency</p>
            <p className="mt-3 text-sm leading-7 text-[var(--foreground-secondary)]">
              Focus on tail latency first. This is usually where search quality and
              indexing load start to show up for users.
            </p>
            <div className="mt-5 grid gap-3 md:grid-cols-3">
              {[
                { label: "p50", value: data.metrics.latency.p50Ms },
                { label: "p95", value: data.metrics.latency.p95Ms },
                { label: "p99", value: data.metrics.latency.p99Ms },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-[20px] border border-[var(--border)] bg-white/68 px-4 py-4">
                  <p className="text-xs uppercase tracking-[0.14em] text-[var(--foreground-tertiary)]">
                    {label}
                  </p>
                  <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-[var(--foreground)]">
                    {formatAdminMetricValue(value.current, { kind: "milliseconds" })}
                  </p>
                  <p className="mt-1 text-[11px] text-[var(--foreground-tertiary)]">
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
            <article className="surface-elevated overflow-hidden rounded-[30px] px-5 py-5">
              <p className="text-sm font-semibold text-[var(--foreground)]">Top queries</p>
              <p className="mt-1 text-xs leading-6 text-[var(--foreground-tertiary)]">
                Queries with the highest request concentration in this window.
              </p>
              <table className="admin-table mt-4">
                <thead>
                  <tr>
                    <th>Query</th>
                    <th>Req</th>
                    <th>0-result</th>
                    <th>Latency</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topQueries.map((query) => (
                    <tr key={query.queryText}>
                      <td className="admin-table-primary">{query.queryText}</td>
                      <td>{query.requestCount}</td>
                      <td>{query.zeroResultCount}</td>
                      <td>
                        {query.avgLatencyMs === null
                          ? "—"
                          : formatAdminMetricValue(query.avgLatencyMs, { kind: "milliseconds" })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </article>

            <article className="surface-elevated overflow-hidden rounded-[30px] px-5 py-5">
              <p className="text-sm font-semibold text-[var(--foreground)]">Zero-result queries</p>
              <p className="mt-1 text-xs leading-6 text-[var(--foreground-tertiary)]">
                Queries worth checking for missing inventory, ranking issues, or answer
                fallback gaps.
              </p>
              <table className="admin-table mt-4">
                <thead>
                  <tr>
                    <th>Query</th>
                    <th>Req</th>
                    <th>w/ answer</th>
                    <th>Latency</th>
                  </tr>
                </thead>
                <tbody>
                  {data.zeroResultQueries.map((query) => (
                    <tr key={`${query.queryText}-zero`}>
                      <td className="admin-table-primary">{query.queryText}</td>
                      <td>{query.requestCount}</td>
                      <td>{query.answerCount}</td>
                      <td>
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
