"use client";

import {
  buildUsageChartData,
  formatBillingPeriod,
  formatNumber,
  getTierLabel,
} from "@/lib/dashboard";
import { CreditUsageBar } from "./credit-usage-bar";
import { DashboardLayout } from "./dashboard-layout";
import { DashboardNotice, DashboardSkeleton, DashboardState } from "./dashboard-state";
import { UsageChart } from "./usage-chart";
import { useMonthlyUsage } from "./use-monthly-usage";

export function DashboardUsageScreen() {
  const { data, error, isLoading, refresh } = useMonthlyUsage();

  if (isLoading && !data) {
    return (
      <DashboardLayout
        currentPath="/dashboard/usage"
        title="Usage"
        description="Volume, credits, and request cadence for the current billing window."
      >
        <DashboardSkeleton />
      </DashboardLayout>
    );
  }

  if (error && !data) {
    return (
      <DashboardLayout
        currentPath="/dashboard/usage"
        title="Usage"
        description="Volume, credits, and request cadence for the current billing window."
      >
        <DashboardState
          title="Usage metrics could not be loaded"
          description={error}
          tone="error"
          action={
            <button className="button-primary" onClick={() => void refresh()} type="button">
              Retry
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
        title="Usage"
        description="Volume, credits, and request cadence for the current billing window."
      >
        <DashboardState title="No usage data available" description="The dashboard API returned no usage payload." />
      </DashboardLayout>
    );
  }

  const chartData = buildUsageChartData(data);
  const activeDays = chartData.filter((p) => p.requestCount > 0 || p.creditsUsed > 0);
  const averageDailyRequests = chartData.length === 0
    ? 0
    : Math.round(data.requestCount / chartData.length);
  const creditsPerRequest = data.requestCount === 0
    ? 0
    : Number((data.creditsUsed / data.requestCount).toFixed(2));
  const busiestDays = [...activeDays]
    .sort((a, b) => b.requestCount !== a.requestCount ? b.requestCount - a.requestCount : b.creditsUsed - a.creditsUsed)
    .slice(0, 5);
  const topCreditsDay = [...activeDays].sort((a, b) => b.creditsUsed - a.creditsUsed)[0] ?? null;
  const topRequestsDay = busiestDays[0] ?? null;
  const recentRows = [...chartData].slice(-14).reverse();
  const totalRequestValue = Math.max(1, ...busiestDays.map((d) => d.requestCount));

  return (
    <DashboardLayout
      currentPath="/dashboard/usage"
      title="Usage"
      description={`${getTierLabel(data.tier)} · ${formatBillingPeriod(data.periodStart, data.periodEnd)}`}
      actions={
        <button className="button-secondary" onClick={() => void refresh()} type="button">
          Refresh
        </button>
      }
    >
      {error && (
        <DashboardNotice
          title="Showing last successful snapshot."
          description={error}
          tone="error"
        />
      )}

      <section className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <article className="surface-elevated rounded-[32px] px-6 py-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
            Current period
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-[var(--foreground)]">
            Watch credit burn before it becomes invisible.
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--foreground-secondary)]">
            The usage view should stay operational, not decorative. Track request volume, credit
            drawdown, and day-level spikes before you change traffic patterns or plan posture.
          </p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: "Requests", value: formatNumber(data.requestCount) },
              { label: "Credits used", value: formatNumber(data.creditsUsed) },
              { label: "Credits remaining", value: formatNumber(data.creditsRemaining) },
              { label: "Active days", value: formatNumber(activeDays.length) },
            ].map((item) => (
              <article
                key={item.label}
                className="rounded-[22px] border border-[var(--border)] bg-[var(--background-elevated)] px-4 py-4"
              >
                <p className="text-sm text-[var(--foreground-secondary)]">{item.label}</p>
                <p className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-[var(--foreground)]">
                  {item.value}
                </p>
              </article>
            ))}
          </div>
        </article>

        <CreditUsageBar
          label="Current billing period"
          limit={data.creditsLimit}
          remaining={data.creditsRemaining}
          used={data.creditsUsed}
        />
      </section>

      <UsageChart
        title="Daily Activity"
        description="Request volume and credit consumption for the current billing window."
        data={chartData}
      />

      <section className="grid gap-5 xl:grid-cols-2">
        <article className="surface-elevated rounded-[28px] px-5 py-5">
          <h2 className="text-lg font-semibold text-[var(--foreground)]">Highlights</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {[
              {
                label: "Peak request day",
                value: topRequestsDay
                  ? `${topRequestsDay.fullLabel} · ${formatNumber(topRequestsDay.requestCount)}`
                  : "—",
              },
              {
                label: "Peak credit day",
                value: topCreditsDay
                  ? `${topCreditsDay.fullLabel} · ${formatNumber(topCreditsDay.creditsUsed)}`
                  : "—",
              },
              { label: "Avg requests / day", value: formatNumber(averageDailyRequests) },
              {
                label: "Credits / request",
                value: creditsPerRequest === 0 ? "0" : creditsPerRequest.toFixed(2),
              },
            ].map((item) => (
              <div
                key={item.label}
                className="rounded-[18px] border border-[var(--border)] bg-[var(--background-elevated)] px-4 py-4"
              >
                <p className="text-xs text-[var(--foreground-secondary)]">{item.label}</p>
                <p className="mt-2 text-base font-semibold text-[var(--foreground)]">
                  {item.value}
                </p>
              </div>
            ))}
          </div>
        </article>

        <article className="surface-elevated rounded-[28px] px-5 py-5">
          <h2 className="text-lg font-semibold text-[var(--foreground)]">Most active days</h2>
          <div className="mt-5 space-y-4">
            {busiestDays.length > 0 ? busiestDays.map((item) => (
              <div key={item.date} className="grid gap-2 sm:grid-cols-[120px_minmax(0,1fr)_80px] sm:items-center">
                <div>
                  <span className="text-sm text-[var(--foreground)]">{item.fullLabel}</span>
                  <p className="text-xs text-[var(--foreground-tertiary)]">
                    {formatNumber(item.creditsUsed)} credits
                  </p>
                </div>
                <div className="h-3 rounded-full bg-[rgba(36,29,21,0.08)]">
                  <div
                    className="h-full rounded-full bg-[linear-gradient(90deg,var(--brand),var(--accent))]"
                    style={{ width: `${Math.max(12, (item.requestCount / totalRequestValue) * 100)}%` }}
                  />
                </div>
                <span className="text-right text-sm text-[var(--foreground)]">
                  {formatNumber(item.requestCount)}
                </span>
              </div>
            )) : (
              <p className="text-sm text-[var(--foreground-tertiary)]">No activity yet this period.</p>
            )}
          </div>
        </article>
      </section>

      <section className="surface-elevated overflow-hidden rounded-[28px]">
        <div className="border-b border-[var(--border)] px-5 py-4">
          <h2 className="text-lg font-semibold text-[var(--foreground)]">Daily Breakdown</h2>
          <p className="mt-1 text-sm text-[var(--foreground-secondary)]">Last 14 days</p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-[rgba(255,255,255,0.03)] text-[var(--foreground-secondary)]">
              <tr>
                <th className="px-5 py-3 font-medium">Date</th>
                <th className="px-5 py-3 font-medium">Requests</th>
                <th className="px-5 py-3 font-medium">Credits</th>
                <th className="px-5 py-3 font-medium">Request share</th>
                <th className="px-5 py-3 font-medium">Credit share</th>
              </tr>
            </thead>
            <tbody>
              {recentRows.map((row) => (
                <tr key={row.date} className="border-t border-[var(--border)]">
                  <td className="px-5 py-3 text-[var(--foreground)]">{row.fullLabel}</td>
                  <td className="px-5 py-3 text-[var(--brand-bright)]">{formatNumber(row.requestCount)}</td>
                  <td className="px-5 py-3 text-[var(--foreground-secondary)]">{formatNumber(row.creditsUsed)}</td>
                  <td className="px-5 py-3 text-[var(--foreground-secondary)]">
                    {data.requestCount === 0 ? "0%" : `${Math.round((row.requestCount / data.requestCount) * 100)}%`}
                  </td>
                  <td className="px-5 py-3 text-[var(--foreground-secondary)]">
                    {data.creditsUsed === 0 ? "0%" : `${Math.round((row.creditsUsed / data.creditsUsed) * 100)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </DashboardLayout>
  );
}
