"use client";

import type { Route } from "next";
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
      title="Overview"
      description="Demand, content, and worker health at a glance."
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
          title="Overview could not be loaded"
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

          {data.notices.slice(0, 1).map((notice) => (
            <DashboardNotice
              key={`${notice.tone}-${notice.title}`}
              title={notice.title}
              description={notice.description}
              tone={notice.tone === "error" ? "error" : "default"}
            />
          ))}

          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <AdminMetricCard label="Active users" metric={data.metrics.activeUsers} />
            <AdminMetricCard label="Requests" metric={data.metrics.requests} />
            <AdminMetricCard label="Search misses" metric={data.metrics.zeroResultRate} kind="percent" />
            <AdminMetricCard label="Failed jobs" metric={data.metrics.failedJobs} />
          </section>

          <div className="grid gap-3 xl:grid-cols-2">
            <AdminTrendChart
              title="Requests"
              data={toAdminChartData(data.requestSeries, "requests")}
              metricLabel="Requests"
              secondaryLabel="Credits"
            />
            <AdminTrendChart
              title="Content growth"
              data={toAdminChartData(data.contentSeries, "knowledgeSegmentsAdded")}
              metricLabel="Segments added"
            />
          </div>

          <AdminTrendChart
            title="Ingestion failures"
            data={toAdminChartData(data.ingestionSeries, "jobsFailed")}
            metricLabel="Failed jobs"
          />

          <div className="flex flex-wrap gap-2">
            {(
              [
                { label: "Users", href: "/admin/users" as Route },
                { label: "Requests", href: "/admin/requests" as Route },
                { label: "Content", href: "/admin/content" as Route },
                { label: "Ingestion", href: "/admin/ingestion" as Route },
              ] as const
            ).map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-full border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--foreground-secondary)] transition hover:border-[var(--border-brand)] hover:text-white"
              >
                {item.label}
              </Link>
            ))}
          </div>
        </>
      ) : (
        <DashboardState
          action={
            <button className="button-primary" onClick={() => void refresh()} type="button">
              Retry
            </button>
          }
          description="No summary payload returned."
          title="No data available"
        />
      )}
    </AdminLayout>
  );
}
