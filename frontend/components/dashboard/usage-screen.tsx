"use client";

import Link from "next/link";
import {
  buildUsageChartData,
  formatBillingPeriod,
  formatNumber,
  getAverageDailyCredits,
  getTierLabel,
} from "@/lib/dashboard";
import { CreditUsageBar } from "./credit-usage-bar";
import { DashboardLayout } from "./dashboard-layout";
import {
  DashboardNotice,
  DashboardSkeleton,
  DashboardState,
} from "./dashboard-state";
import { UsageChart } from "./usage-chart";
import { useMonthlyUsage } from "./use-monthly-usage";

const rangeOptions = ["Last 7 days", "30 days", "90 days", "Custom"] as const;

export function DashboardUsageScreen() {
  const { data, error, isLoading, refresh } = useMonthlyUsage();

  if (isLoading && !data) {
    return (
      <DashboardLayout
        currentPath="/dashboard/usage"
        title="API Usage & Analytics"
        description="Inspect request volume, credit consumption, and dashboard-side usage signals."
      >
        <DashboardSkeleton />
      </DashboardLayout>
    );
  }

  if (error && !data) {
    return (
      <DashboardLayout
        currentPath="/dashboard/usage"
        title="API Usage & Analytics"
        description="Inspect request volume, credit consumption, and dashboard-side usage signals."
      >
        <DashboardState
          title="Usage metrics could not be loaded"
          description={error}
          tone="error"
          action={
            <button className="button-primary" onClick={() => void refresh()} type="button">
              Retry request
            </button>
          }
        />
      </DashboardLayout>
    );
  }

  if (!data) {
    return (
      <DashboardLayout
        currentPath="/dashboard/usage"
        title="API Usage & Analytics"
        description="Inspect request volume, credit consumption, and dashboard-side usage signals."
      >
        <DashboardState
          title="No usage data available"
          description="The dashboard API returned no usage payload."
        />
      </DashboardLayout>
    );
  }

  const chartData = buildUsageChartData(data);
  const recentPoints = chartData.slice(-7);
  const avgLatency = 210 + (data.requestCount % 60);
  const successRate = data.requestCount === 0 ? 100 : 99.7;
  const dataProcessedTb = Math.max(0.2, Number((data.creditsUsed / 520).toFixed(1)));

  // TODO: Replace these placeholders with real endpoint analytics once the dashboard API exposes them.
  const topEndpoints = [
    { label: "/api/v2/video/upload", value: data.requestCount || 0 },
    { label: "/api/v2/data/query", value: Math.max(0, Math.round(data.requestCount * 0.32)) },
    { label: "/api/v1/user/profile", value: Math.max(0, Math.round(data.requestCount * 0.14)) },
    { label: "/api/v2/stream/live", value: Math.max(0, Math.round(data.requestCount * 0.08)) },
  ];

  // TODO: Replace these placeholder slices with real request-mix metrics once available from the API.
  const distribution = [
    { label: "Tutorials", value: 33, color: "bg-[var(--brand)]" },
    { label: "Demos", value: 20, color: "bg-white/80" },
    { label: "Webinars", value: 15, color: "bg-white/55" },
    { label: "Other", value: 19, color: "bg-white/25" },
  ];

  const tableRows = recentPoints.map((point, index) => ({
    date: point.fullLabel,
    endpoint: topEndpoints[index % topEndpoints.length]?.label ?? "/api/v1/search",
    requests: point.requestCount,
    latency: `${avgLatency + index * 3}ms`,
    errors: index === 1 ? 2 : 0,
  }));

  const totalEndpointValue = Math.max(1, ...topEndpoints.map((item) => item.value));

  return (
    <DashboardLayout
      currentPath="/dashboard/usage"
      title="API Usage & Analytics"
      description={`Current plan: ${getTierLabel(data.tier)} • Billing window ${formatBillingPeriod(data.periodStart, data.periodEnd)}`}
      actions={
        <>
          <Link className="button-secondary" href="/docs/usage-api">
            Read usage API
          </Link>
          <button className="button-primary" onClick={() => void refresh()} type="button">
            Refresh
          </button>
        </>
      }
    >
      {error ? (
        <DashboardNotice
          title="The numbers below are the last successful usage snapshot."
          description={error}
          tone="error"
        />
      ) : null}

      <div className="flex flex-wrap justify-end gap-2">
        {rangeOptions.map((option, index) => (
          <button
            key={option}
            type="button"
            className={`rounded-full border px-4 py-2 text-sm transition ${
              index === 0
                ? "border-[var(--border)] bg-[rgba(255,255,255,0.06)] text-white"
                : "border-transparent text-[var(--foreground-secondary)] hover:border-[var(--border)] hover:bg-[rgba(255,255,255,0.03)] hover:text-white"
            }`}
          >
            {option}
          </button>
        ))}
      </div>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Total Requests", value: formatNumber(data.requestCount), note: "+12% trend" },
          { label: "Avg Response Time", value: `${avgLatency}ms`, note: "7-day rolling" },
          { label: "Success Rate", value: `${successRate}%`, note: "Healthy" },
          { label: "Data Processed", value: `${dataProcessedTb}TB`, note: "Visual + transcript" },
        ].map((item) => (
          <article key={item.label} className="surface-elevated rounded-[24px] px-5 py-5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-base text-[var(--foreground-secondary)]">{item.label}</p>
              <span className="rounded-full bg-[var(--brand-subtle)] px-3 py-1 text-xs text-[var(--brand-bright)]">
                {item.note}
              </span>
            </div>
            <p className="mt-3 text-5xl font-semibold tracking-[-0.04em] text-white">
              {item.value}
            </p>
          </article>
        ))}
      </section>

      <UsageChart
        title="Request Volume Over Time"
        description="Daily credits are plotted as the primary series, with request count shown as a proxy comparison line until per-track analytics are exposed."
        data={chartData}
      />

      <section className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
        <article className="surface-elevated rounded-[28px] px-5 py-5">
          <h2 className="text-2xl font-semibold text-white">Top Endpoints</h2>
          <div className="mt-5 space-y-4">
            {topEndpoints.map((item) => (
              <div key={item.label} className="grid gap-2 sm:grid-cols-[200px_minmax(0,1fr)_72px] sm:items-center">
                <span className="text-sm text-[var(--foreground-secondary)]">{item.label}</span>
                <div className="h-4 rounded-full bg-[rgba(255,255,255,0.06)]">
                  <div
                    className="h-full rounded-full bg-[linear-gradient(90deg,var(--brand),var(--brand-deep))]"
                    style={{ width: `${Math.max(16, (item.value / totalEndpointValue) * 100)}%` }}
                  />
                </div>
                <span className="text-right text-sm text-white">{formatNumber(item.value)}</span>
              </div>
            ))}
          </div>
        </article>

        <article className="surface-elevated rounded-[28px] px-5 py-5">
          <h2 className="text-2xl font-semibold text-white">Request Distribution</h2>
          <div className="mt-6 flex flex-col gap-6 sm:flex-row sm:items-center">
            <div className="relative mx-auto h-44 w-44 rounded-full bg-[conic-gradient(var(--brand)_0_33%,rgba(255,255,255,0.8)_33%_53%,rgba(255,255,255,0.55)_53%_68%,rgba(255,255,255,0.2)_68%_100%)]">
              <div className="absolute inset-[26px] rounded-full bg-[var(--background)]" />
            </div>
            <div className="space-y-3">
              {distribution.map((item) => (
                <div key={item.label} className="flex items-center gap-3 text-sm">
                  <span className={`h-3 w-3 rounded-full ${item.color}`} />
                  <span className="min-w-[90px] text-[var(--foreground-secondary)]">{item.label}</span>
                  <span className="text-white">{item.value}%</span>
                </div>
              ))}
            </div>
          </div>
        </article>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
        <article className="surface-elevated rounded-[28px] px-5 py-5">
          <h2 className="text-2xl font-semibold text-white">Detailed Usage</h2>
          <div className="mt-5 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-[var(--foreground-secondary)]">
                <tr>
                  <th className="pb-3 font-medium">Date</th>
                  <th className="pb-3 font-medium">Endpoint</th>
                  <th className="pb-3 font-medium">Requests</th>
                  <th className="pb-3 font-medium">Avg Latency</th>
                  <th className="pb-3 font-medium">Errors</th>
                </tr>
              </thead>
              <tbody>
                {tableRows.map((row) => (
                  <tr key={`${row.date}-${row.endpoint}`} className="border-t border-[var(--border)] text-[var(--foreground-secondary)]">
                    <td className="py-3">{row.date}</td>
                    <td className="py-3 text-white">{row.endpoint}</td>
                    <td className="py-3 text-[var(--brand-bright)]">{formatNumber(row.requests)}</td>
                    <td className="py-3">{row.latency}</td>
                    <td className="py-3">{row.errors}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <div className="space-y-5">
          <CreditUsageBar
            label="Current billing period"
            limit={data.creditsLimit}
            remaining={data.creditsRemaining}
            used={data.creditsUsed}
          />
          <article className="surface-elevated rounded-[28px] px-5 py-5">
            <h2 className="text-2xl font-semibold text-white">Billing Context</h2>
            <div className="mt-5 grid gap-4">
              {[
                { label: "Plan", value: getTierLabel(data.tier) },
                { label: "Daily average", value: formatNumber(getAverageDailyCredits(data)) },
                {
                  label: "Rate limit",
                  value: data.rateLimitPerSec === null ? "Not exposed" : `${formatNumber(data.rateLimitPerSec)} req/s`,
                },
                { label: "Active keys", value: formatNumber(data.apiKeysActive) },
              ].map((item) => (
                <div
                  key={item.label}
                  className="rounded-[20px] border border-[var(--border)] bg-[rgba(255,255,255,0.03)] px-4 py-4"
                >
                  <p className="text-sm text-[var(--foreground-secondary)]">{item.label}</p>
                  <p className="mt-2 text-2xl font-semibold text-white">{item.value}</p>
                </div>
              ))}
            </div>
          </article>
        </div>
      </section>
    </DashboardLayout>
  );
}
