"use client";

import type { Route } from "next";
import Link from "next/link";
import { useState } from "react";
import { admin, type AdminRange } from "@/lib/admin-api";
import { formatAdminMetricValue, toAdminChartData } from "@/lib/admin-console";
import { AdminLayout } from "./admin-layout";
import { AdminMetricCard } from "./admin-metric-card";
import { AdminRangePicker } from "./admin-range-picker";
import { AdminTrendChart } from "./admin-trend-chart";
import { DashboardNotice, DashboardSkeleton, DashboardState } from "@/components/dashboard/dashboard-state";
import { useAdminResource } from "./use-admin-resource";

export function AdminOverviewScreen() {
  const [range, setRange] = useState<AdminRange>("7d");
  const { data, error, isLoading, refresh } = useAdminResource({
    range,
    loader: admin.getSummary,
    errorMessage: "Failed to load the admin overview.",
  });

  return (
    <AdminLayout
      currentPath="/admin"
      title="Site overview"
      description="Track Cerul at the system level: who is using it, how requests are behaving, whether content is growing, and whether ingestion is healthy enough to trust."
      actions={
        <>
          <AdminRangePicker value={range} onChange={setRange} />
          <Link className="button-secondary" href="/admin/pipelines">
            Open pipelines
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
          title="Admin overview could not be loaded"
          tone="error"
        />
      ) : data ? (
        <>
          {error ? (
            <DashboardNotice
              title="Showing the last successful admin snapshot."
              description={error}
              tone="error"
            />
          ) : null}

          {data.notices.map((notice) => (
            <DashboardNotice
              key={`${notice.tone}-${notice.title}`}
              title={notice.title}
              description={notice.description}
              tone={notice.tone === "error" ? "error" : "default"}
            />
          ))}

          <section className="grid gap-6 xl:grid-cols-[1.12fr_0.88fr]">
            <article className="surface-elevated relative overflow-hidden rounded-[36px] px-6 py-6 sm:px-7">
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(103,232,249,0.14),transparent_34%),radial-gradient(circle_at_86%_18%,rgba(249,115,22,0.1),transparent_28%)]" />
              <div className="relative">
                <div className="flex flex-wrap gap-2">
                  {[
                    `${range.toUpperCase()} window`,
                    `${formatAdminMetricValue(data.metrics.activeUsers.current)} active users`,
                    `${formatAdminMetricValue(data.metrics.failedJobs.current)} failed jobs`,
                    `${formatAdminMetricValue(data.metrics.zeroResultRate.current, {
                      kind: "percent",
                    })} zero-result rate`,
                  ].map((item) => (
                    <span
                      key={item}
                      className="inline-flex items-center rounded-full border border-[var(--border)] bg-[rgba(255,255,255,0.04)] px-3 py-1.5 text-sm text-[var(--foreground-secondary)]"
                    >
                      {item}
                    </span>
                  ))}
                </div>

                <div className="mt-6 grid gap-6 xl:grid-cols-[0.94fr_1.06fr]">
                  <div>
                    <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--brand-bright)]">
                      Operator brief
                    </p>
                    <h2 className="mt-4 text-4xl font-semibold tracking-[-0.06em] text-white sm:text-5xl">
                      Keep the shared platform stable before product surfaces feel it.
                    </h2>
                    <p className="mt-4 max-w-xl text-base leading-8 text-[var(--foreground-secondary)]">
                      This view is the admin command deck. It ties growth, request
                      quality, content freshness, and worker health into one place
                      so you can see drift before it becomes a support problem.
                    </p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    {[
                      {
                        title: "Requests",
                        body: "Inspect latency, zero-result patterns, and high-volume prompts.",
                        href: "/admin/requests" as Route,
                      },
                      {
                        title: "Users",
                        body: "Check which accounts are actually activating the platform.",
                        href: "/admin/users" as Route,
                      },
                      {
                        title: "Content",
                        body: "Review searchable supply, growth, and stale sources.",
                        href: "/admin/content" as Route,
                      },
                      {
                        title: "Ingestion",
                        body: "Watch backlog, failure posture, and processing health.",
                        href: "/admin/ingestion" as Route,
                      },
                      {
                        title: "Pipelines",
                        body: "Jump into job-level telemetry when a source starts drifting.",
                        href: "/admin/pipelines" as Route,
                      },
                      {
                        title: "Targets",
                        body: "Tune operating thresholds so the console speaks in intent, not raw numbers.",
                        href: "/admin/settings" as Route,
                      },
                    ].map((item) => (
                      <Link
                        key={item.title}
                        href={item.href}
                        className="rounded-[24px] border border-[var(--border)] bg-[rgba(255,255,255,0.04)] px-4 py-4 transition hover:border-[var(--border-brand)] hover:bg-[rgba(34,211,238,0.08)]"
                      >
                        <p className="text-base font-semibold text-white">{item.title}</p>
                        <p className="mt-2 text-sm leading-6 text-[var(--foreground-secondary)]">
                          {item.body}
                        </p>
                      </Link>
                    ))}
                  </div>
                </div>
              </div>
            </article>

            <article className="surface-elevated rounded-[32px] px-6 py-6">
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--foreground-tertiary)]">
                What needs attention
              </p>
              <div className="mt-5 space-y-3">
                {[
                  {
                    label: "Request pressure",
                    value: formatAdminMetricValue(data.metrics.requests.current),
                    note: "Total successful requests recorded in the current window.",
                  },
                  {
                    label: "Credit burn",
                    value: formatAdminMetricValue(data.metrics.creditsUsed.current),
                    note: "Use this with request traffic to spot unusually expensive workloads.",
                  },
                  {
                    label: "Backlog posture",
                    value: formatAdminMetricValue(data.metrics.pendingJobs.current),
                    note: "Pending jobs should stay low if freshness and scheduler cadence are healthy.",
                  },
                  {
                    label: "Search misses",
                    value: formatAdminMetricValue(data.metrics.zeroResultRate.current, {
                      kind: "percent",
                    }),
                    note: "A climbing miss rate usually means retrieval coverage is falling behind demand.",
                  },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="rounded-[22px] border border-[var(--border)] bg-[rgba(255,255,255,0.03)] px-4 py-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm text-[var(--foreground-secondary)]">{item.label}</p>
                      <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--brand-bright)]">
                        Live
                      </span>
                    </div>
                    <p className="mt-3 text-2xl font-semibold text-white">{item.value}</p>
                    <p className="mt-2 text-sm leading-6 text-[var(--foreground-tertiary)]">
                      {item.note}
                    </p>
                  </div>
                ))}
              </div>
            </article>
          </section>

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <AdminMetricCard
              label="Total users"
              metric={data.metrics.totalUsers}
              note="All accounts currently present in Cerul."
            />
            <AdminMetricCard
              label="New users"
              metric={data.metrics.newUsers}
              note="Accounts created during the selected window."
            />
            <AdminMetricCard
              label="Requests"
              metric={data.metrics.requests}
              note="Successful API requests recorded in usage events."
            />
            <AdminMetricCard
              label="Credits used"
              metric={data.metrics.creditsUsed}
              note="Credits consumed by public API traffic."
            />
            <AdminMetricCard
              label="Zero-result rate"
              metric={data.metrics.zeroResultRate}
              note="Share of recent searches that returned no results."
              kind="percent"
            />
          </section>

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <AdminMetricCard
              label="Active users"
              metric={data.metrics.activeUsers}
              note="Distinct users with request activity."
            />
            <AdminMetricCard
              label="Indexed assets"
              metric={data.metrics.indexedAssets}
              note="Current B-roll inventory available for search."
            />
            <AdminMetricCard
              label="Indexed segments"
              metric={data.metrics.indexedSegments}
              note="Knowledge segments currently searchable."
            />
            <AdminMetricCard
              label="Pending backlog"
              metric={data.metrics.pendingJobs}
              note="Jobs still waiting for workers or retries."
            />
            <AdminMetricCard
              label="Failed jobs"
              metric={data.metrics.failedJobs}
              note="Failures updated during the selected window."
            />
          </section>

          <AdminTrendChart
            title="Request volume"
            description="This mirrors the same system-level flow the Cerul API skill depends on: if requests and credit burn move unexpectedly, the admin should know before the product team feels it."
            data={toAdminChartData(data.requestSeries, "requests")}
            metricLabel="Requests"
            secondaryLabel="Credits"
          />

          <section className="grid gap-5 xl:grid-cols-2">
            <AdminTrendChart
              title="Content additions"
              description="Daily growth across indexed content. This is the clearest indicator that cold-start seeding and daily scheduler ingestion are both doing their job."
              data={toAdminChartData(data.contentSeries, "knowledgeSegmentsAdded")}
              metricLabel="Knowledge segments"
              secondaryLabel="Requests"
            />
            <AdminTrendChart
              title="Ingestion failures"
              description="Keep recent failure spikes visible so the admin console stays operational rather than aspirational."
              data={toAdminChartData(data.ingestionSeries, "jobsFailed")}
              metricLabel="Failed jobs"
              secondaryLabel="Requests"
            />
          </section>
        </>
      ) : (
        <DashboardState
          action={
            <button className="button-primary" onClick={() => void refresh()} type="button">
              Retry request
            </button>
          }
          description="The admin API returned no summary payload."
          title="No admin data available"
        />
      )}
    </AdminLayout>
  );
}
