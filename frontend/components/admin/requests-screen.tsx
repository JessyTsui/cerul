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
      description="Inspect API demand, latency, search quality, and which queries are proving or disproving the current retrieval stack."
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
          title="Request metrics could not be loaded"
          tone="error"
        />
      ) : data ? (
        <>
          {error ? (
            <DashboardNotice
              title="Showing the last successful request snapshot."
              description={error}
              tone="error"
            />
          ) : null}

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
            <AdminMetricCard
              label="Requests"
              metric={data.metrics.totalRequests}
              note="Successful requests recorded in usage events."
            />
            <AdminMetricCard
              label="Credits"
              metric={data.metrics.creditsUsed}
              note="Credits consumed by those requests."
            />
            <AdminMetricCard
              label="Active users"
              metric={data.metrics.activeUsers}
              note="Distinct accounts issuing requests."
            />
            <AdminMetricCard
              label="Avg credits/request"
              metric={data.metrics.averageCreditsPerRequest}
              note="Useful for spotting answer-heavy workloads."
            />
            <AdminMetricCard
              label="Zero-result rate"
              metric={data.metrics.zeroResultRate}
              note="Searches that returned no candidates."
              kind="percent"
            />
            <AdminMetricCard
              label="Answer usage"
              metric={data.metrics.answerUsageRate}
              note="Share of searches asking for answer synthesis."
              kind="percent"
            />
          </section>

          <section className="grid gap-4 md:grid-cols-3">
            <AdminMetricCard
              label="Latency p50"
              metric={data.metrics.latency.p50Ms}
              note="Median end-to-end search latency."
              kind="milliseconds"
            />
            <AdminMetricCard
              label="Latency p95"
              metric={data.metrics.latency.p95Ms}
              note="Tail latency for the majority of real requests."
              kind="milliseconds"
            />
            <AdminMetricCard
              label="Latency p99"
              metric={data.metrics.latency.p99Ms}
              note="Worst tail segment in the selected window."
              kind="milliseconds"
            />
          </section>

          <AdminTrendChart
            title="Request traffic"
            description="This is the admin-side mirror of the Cerul API skill. If request volume, credit burn, or latency drifts, the product surface and the skill surface will both feel it."
            data={toAdminChartData(data.dailySeries, "requests")}
            metricLabel="Requests"
            secondaryLabel="Credits"
          />

          <section className="grid gap-5 xl:grid-cols-2">
            <article className="surface-elevated px-6 py-6">
              <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                Search mix
              </p>
              <h2 className="mt-2 text-2xl font-semibold text-white">
                Track distribution
              </h2>
              <div className="mt-5 space-y-3">
                {data.searchTypeMix.map((item) => (
                  <div
                    key={item.key}
                    className="flex items-center justify-between rounded-[18px] border border-[var(--border)] bg-[var(--surface)] px-4 py-3"
                  >
                    <span className="text-sm text-white">{item.label}</span>
                    <span className="font-mono text-sm text-[var(--foreground-secondary)]">
                      {item.count}
                    </span>
                  </div>
                ))}
              </div>
            </article>

            <article className="surface-elevated overflow-hidden px-6 py-6">
              <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                Top queries
              </p>
              <h2 className="mt-2 text-2xl font-semibold text-white">
                Highest-volume prompts
              </h2>
              <div className="mt-5 overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="text-[var(--foreground-tertiary)]">
                    <tr>
                      <th className="pb-3 pr-4 font-medium">Query</th>
                      <th className="pb-3 pr-4 font-medium">Requests</th>
                      <th className="pb-3 pr-4 font-medium">Zero results</th>
                      <th className="pb-3 font-medium">Avg latency</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-[var(--foreground-secondary)]">
                    {data.topQueries.map((query) => (
                      <tr key={query.queryText}>
                        <td className="py-3 pr-4 text-white">{query.queryText}</td>
                        <td className="py-3 pr-4">{query.requestCount}</td>
                        <td className="py-3 pr-4">{query.zeroResultCount}</td>
                        <td className="py-3">
                          {query.avgLatencyMs === null
                            ? "N/A"
                            : formatAdminMetricValue(query.avgLatencyMs, {
                                kind: "milliseconds",
                              })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          </section>

          <article className="surface-elevated overflow-hidden px-6 py-6">
            <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
              Zero-result queries
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-white">
              Queries to inspect next
            </h2>
            <div className="mt-5 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="text-[var(--foreground-tertiary)]">
                  <tr>
                    <th className="pb-3 pr-4 font-medium">Query</th>
                    <th className="pb-3 pr-4 font-medium">Requests</th>
                    <th className="pb-3 pr-4 font-medium">Answer usage</th>
                    <th className="pb-3 font-medium">Avg latency</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-[var(--foreground-secondary)]">
                  {data.zeroResultQueries.map((query) => (
                    <tr key={`${query.queryText}-zero`}>
                      <td className="py-3 pr-4 text-white">{query.queryText}</td>
                      <td className="py-3 pr-4">{query.requestCount}</td>
                      <td className="py-3 pr-4">{query.answerCount}</td>
                      <td className="py-3">
                        {query.avgLatencyMs === null
                          ? "N/A"
                          : formatAdminMetricValue(query.avgLatencyMs, {
                              kind: "milliseconds",
                            })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        </>
      ) : (
        <DashboardState
          action={
            <button className="button-primary" onClick={() => void refresh()} type="button">
              Retry request
            </button>
          }
          description="The admin API returned no request payload."
          title="No request data available"
        />
      )}
    </AdminLayout>
  );
}
