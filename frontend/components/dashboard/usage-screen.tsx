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
  const activeDays = chartData.filter((point) => point.requestCount > 0 || point.creditsUsed > 0);
  const averageDailyRequests = chartData.length === 0
    ? 0
    : Math.round(data.requestCount / chartData.length);
  const creditsPerRequest = data.requestCount === 0
    ? 0
    : Number((data.creditsUsed / data.requestCount).toFixed(2));
  const busiestDays = [...activeDays]
    .sort((left, right) => {
      if (right.requestCount !== left.requestCount) {
        return right.requestCount - left.requestCount;
      }

      return right.creditsUsed - left.creditsUsed;
    })
    .slice(0, 5);
  const topCreditsDay = [...activeDays]
    .sort((left, right) => right.creditsUsed - left.creditsUsed)[0] ?? null;
  const topRequestsDay = busiestDays[0] ?? null;
  const recentRows = [...chartData].slice(-14).reverse();
  const totalRequestValue = Math.max(1, ...busiestDays.map((item) => item.requestCount));

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

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Total Requests", value: formatNumber(data.requestCount), note: "Current billing window" },
          { label: "Credits Used", value: formatNumber(data.creditsUsed), note: `${formatNumber(data.creditsLimit)} available this period` },
          { label: "Credits Remaining", value: formatNumber(data.creditsRemaining), note: "Server-reported balance" },
          { label: "Active Days", value: formatNumber(activeDays.length), note: `${formatNumber(chartData.length)} tracked days` },
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
        description="Daily credits and request counts reported by the dashboard usage API for the current billing window."
        data={chartData}
      />

      <section className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
        <article className="surface-elevated rounded-[28px] px-5 py-5">
          <h2 className="text-2xl font-semibold text-white">Most Active Days</h2>
          <div className="mt-5 space-y-4">
            {busiestDays.length > 0 ? busiestDays.map((item) => (
              <div key={item.date} className="grid gap-2 sm:grid-cols-[120px_minmax(0,1fr)_92px] sm:items-center">
                <div>
                  <span className="text-sm text-white">{item.fullLabel}</span>
                  <p className="text-xs text-[var(--foreground-tertiary)]">
                    {formatNumber(item.creditsUsed)} credits
                  </p>
                </div>
                <div className="h-4 rounded-full bg-[rgba(255,255,255,0.06)]">
                  <div
                    className="h-full rounded-full bg-[linear-gradient(90deg,var(--brand),var(--brand-deep))]"
                    style={{ width: `${Math.max(16, (item.requestCount / totalRequestValue) * 100)}%` }}
                  />
                </div>
                <span className="text-right text-sm text-white">{formatNumber(item.requestCount)}</span>
              </div>
            )) : (
              <DashboardState
                title="No active days yet"
                description="Requests and credit consumption will appear here once usage is recorded in the current billing window."
              />
            )}
          </div>
        </article>

        <article className="surface-elevated rounded-[28px] px-5 py-5">
          <h2 className="text-2xl font-semibold text-white">Usage Snapshot</h2>
          <div className="mt-5 grid gap-4">
            {[
              {
                label: "Peak request day",
                value: topRequestsDay ? `${topRequestsDay.fullLabel} · ${formatNumber(topRequestsDay.requestCount)} requests` : "No requests yet",
              },
              {
                label: "Peak credit day",
                value: topCreditsDay ? `${topCreditsDay.fullLabel} · ${formatNumber(topCreditsDay.creditsUsed)} credits` : "No credit usage yet",
              },
              {
                label: "Average requests / day",
                value: formatNumber(averageDailyRequests),
              },
              {
                label: "Credits / request",
                value: creditsPerRequest === 0 ? "0" : creditsPerRequest.toFixed(2),
              },
            ].map((item) => (
              <div
                key={item.label}
                className="rounded-[20px] border border-[var(--border)] bg-[rgba(255,255,255,0.03)] px-4 py-4"
              >
                <p className="text-sm text-[var(--foreground-secondary)]">{item.label}</p>
                <p className="mt-2 text-lg font-semibold text-white">{item.value}</p>
              </div>
            ))}
            <div className="rounded-[20px] border border-[var(--border)] bg-[rgba(255,255,255,0.03)] px-4 py-4">
              <p className="text-sm text-[var(--foreground-secondary)]">Data coverage</p>
              <p className="mt-2 text-lg font-semibold text-white">
                {formatNumber(activeDays.length)} active days, {formatNumber(Math.max(chartData.length - activeDays.length, 0))} idle days
              </p>
              <p className="mt-2 text-sm text-[var(--foreground-tertiary)]">
                This view only uses values returned by the dashboard usage API. Endpoint-level breakdowns are hidden until the backend exposes them.
              </p>
            </div>
          </div>
        </article>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
        <article className="surface-elevated rounded-[28px] px-5 py-5">
          <h2 className="text-2xl font-semibold text-white">Recent Daily Breakdown</h2>
          <div className="mt-5 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-[var(--foreground-secondary)]">
                <tr>
                  <th className="pb-3 font-medium">Date</th>
                  <th className="pb-3 font-medium">Requests</th>
                  <th className="pb-3 font-medium">Credits Used</th>
                  <th className="pb-3 font-medium">Request Share</th>
                  <th className="pb-3 font-medium">Credit Share</th>
                </tr>
              </thead>
              <tbody>
                {recentRows.map((row) => (
                  <tr key={row.date} className="border-t border-[var(--border)] text-[var(--foreground-secondary)]">
                    <td className="py-3 text-white">{row.fullLabel}</td>
                    <td className="py-3 text-[var(--brand-bright)]">{formatNumber(row.requestCount)}</td>
                    <td className="py-3">{formatNumber(row.creditsUsed)}</td>
                    <td className="py-3">
                      {data.requestCount === 0 ? "0%" : `${Math.round((row.requestCount / data.requestCount) * 100)}%`}
                    </td>
                    <td className="py-3">
                      {data.creditsUsed === 0 ? "0%" : `${Math.round((row.creditsUsed / data.creditsUsed) * 100)}%`}
                    </td>
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
