"use client";

import Link from "next/link";
import { useState } from "react";
import { admin, type AdminRange } from "@/lib/admin-api";
import { toAdminChartData } from "@/lib/admin-console";
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
          <Link className="button-secondary" href="/dashboard/pipelines">
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
            description="This mirrors the same system-level flow the Cerul API skill depends on: if requests and credit burn move unexpectedly, the operator should know before the product team feels it."
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
