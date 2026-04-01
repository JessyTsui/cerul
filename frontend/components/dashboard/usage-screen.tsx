"use client";

import {
  buildUsageChartData,
  formatBillingPeriod,
  formatNumber,
  getTierLabel,
} from "@/lib/dashboard";
import { DashboardLayout } from "./dashboard-layout";
import { DashboardNotice, DashboardSkeleton, DashboardState } from "./dashboard-state";
import { UsageChart } from "./usage-chart";
import { useMonthlyUsage } from "./use-monthly-usage";

function IconFire({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path d="M15.362 5.214A8.252 8.252 0 0 1 12 21 8.25 8.25 0 0 1 6.038 7.047 8.287 8.287 0 0 0 9 9.601a8.983 8.983 0 0 1 3.361-6.867 8.21 8.21 0 0 0 3 2.48Z" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} />
      <path d="M12 18a3.75 3.75 0 0 0 .495-7.468 5.99 5.99 0 0 0-1.925 3.547 5.975 5.975 0 0 1-2.133-1.001A3.75 3.75 0 0 0 12 18Z" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} />
    </svg>
  );
}

function IconCalendar({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} />
    </svg>
  );
}

export function DashboardUsageScreen() {
  const { data, error, isLoading, refresh } = useMonthlyUsage();

  if (isLoading && !data) {
    return (
      <DashboardLayout currentPath="/dashboard/usage" title="Usage" description="Credit consumption for the current billing window.">
        <DashboardSkeleton />
      </DashboardLayout>
    );
  }

  if (error && !data) {
    return (
      <DashboardLayout currentPath="/dashboard/usage" title="Usage" description="Credit consumption for the current billing window.">
        <DashboardState
          title="Usage metrics could not be loaded"
          description={error}
          tone="error"
          action={<button className="button-primary" onClick={() => void refresh()} type="button">Retry</button>}
        />
      </DashboardLayout>
    );
  }

  if (!data) {
    return (
      <DashboardLayout currentPath="/dashboard/usage" title="Usage" description="Credit consumption for the current billing window.">
        <DashboardState title="No usage data available" description="The dashboard API returned no usage payload." />
      </DashboardLayout>
    );
  }

  const chartData = buildUsageChartData(data);
  const activeDays = chartData.filter((p) => p.requestCount > 0 || p.creditsUsed > 0);
  const busiestDays = [...activeDays]
    .sort((a, b) => b.creditsUsed !== a.creditsUsed ? b.creditsUsed - a.creditsUsed : b.requestCount - a.requestCount)
    .slice(0, 5);
  const recentRows = [...chartData].slice(-14).reverse();
  const totalCreditValue = Math.max(1, ...busiestDays.map((d) => d.creditsUsed));

  return (
    <DashboardLayout
      currentPath="/dashboard/usage"
      title="Usage"
      description={`${getTierLabel(data.tier)} · ${formatBillingPeriod(data.periodStart, data.periodEnd)}`}
      actions={null}
    >
      {error && (
        <DashboardNotice title="Showing last successful snapshot." description={error} tone="error" />
      )}

      {/* ── Chart ─────────────────────────────────────── */}
      <UsageChart
        title="Daily Activity"
        description="Credit consumption and request volume for the current billing window."
        data={chartData}
      />

      {/* ── Most active days ──────────────────────────── */}
      <article className="surface-elevated dashboard-card rounded-[24px] px-5 py-5">
        <div className="flex items-center gap-2.5">
          <IconFire className="h-5 w-5 text-[var(--accent-bright)]" />
          <h2 className="text-base font-semibold text-[var(--foreground)]">Most active days</h2>
        </div>
        <div className="mt-4 space-y-2.5">
          {busiestDays.length > 0 ? busiestDays.map((item, index) => (
            <div key={item.date} className="flex items-center gap-3">
              <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-white/56 text-[11px] font-semibold text-[var(--foreground-secondary)]">
                {index + 1}
              </span>
              <div className="w-24 shrink-0">
                <p className="text-sm text-[var(--foreground)]">{item.fullLabel}</p>
              </div>
              <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-[rgba(36,29,21,0.08)]">
                <div
                  className="animate-progress-fill h-full rounded-full bg-[linear-gradient(90deg,var(--brand),var(--accent))]"
                  style={{ width: `${Math.max(12, (item.creditsUsed / totalCreditValue) * 100)}%` }}
                />
              </div>
              <span className="w-16 text-right text-sm tabular-nums text-[var(--foreground-secondary)]">
                {formatNumber(item.creditsUsed)} cr
              </span>
            </div>
          )) : (
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <IconCalendar className="h-7 w-7 text-[var(--foreground-tertiary)]" />
              <p className="text-sm text-[var(--foreground-tertiary)]">No activity yet this period</p>
            </div>
          )}
        </div>
      </article>

      {/* ── Daily breakdown table ─────────────────────── */}
      <section className="surface-elevated dashboard-card overflow-hidden rounded-[24px]">
        <div className="flex items-center gap-2.5 border-b border-[var(--border)] px-5 py-3.5">
          <IconCalendar className="h-4 w-4 text-[var(--foreground-tertiary)]" />
          <h2 className="text-base font-semibold text-[var(--foreground)]">Daily Breakdown</h2>
          <span className="text-xs text-[var(--foreground-tertiary)]">Last 14 days</span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-[var(--background-elevated)] text-[var(--foreground-secondary)]">
              <tr>
                <th className="px-5 py-2.5 font-medium">Date</th>
                <th className="px-5 py-2.5 font-medium">Credits</th>
                <th className="px-5 py-2.5 font-medium">Volume</th>
                <th className="px-5 py-2.5 text-right font-medium">Share</th>
              </tr>
            </thead>
            <tbody>
              {recentRows.map((row) => {
                const creditShare = data.creditsUsed === 0 ? 0 : Math.round((row.creditsUsed / data.creditsUsed) * 100);
                const maxRowCredits = Math.max(1, ...recentRows.map((r) => r.creditsUsed));

                return (
                  <tr key={row.date} className="border-t border-[var(--border)] transition hover:bg-white/40">
                    <td className="px-5 py-2.5 font-medium text-[var(--foreground)]">{row.fullLabel}</td>
                    <td className="px-5 py-2.5 tabular-nums text-[var(--foreground-secondary)]">{formatNumber(row.creditsUsed)}</td>
                    <td className="px-5 py-2.5">
                      <div className="h-1.5 w-full max-w-[100px] overflow-hidden rounded-full bg-[rgba(36,29,21,0.06)]">
                        <div
                          className="h-full rounded-full bg-[var(--brand)]"
                          style={{ width: `${Math.max(2, (row.creditsUsed / maxRowCredits) * 100)}%` }}
                        />
                      </div>
                    </td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-[var(--foreground-tertiary)]">{creditShare}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </DashboardLayout>
  );
}
