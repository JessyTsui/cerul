"use client";

import {
  buildUsageChartData,
  formatBillingPeriod,
  formatNumber,
  getIncludedCreditsUsed,
  getTierLabel,
} from "@/lib/dashboard";
import { CreditUsageBar } from "./credit-usage-bar";
import { DashboardLayout } from "./dashboard-layout";
import { DashboardNotice, DashboardSkeleton, DashboardState } from "./dashboard-state";
import { UsageChart } from "./usage-chart";
import { useMonthlyUsage } from "./use-monthly-usage";

/* ── Icons ────────────────────────────────────────────── */

function IconWallet({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path d="M21 12a2.25 2.25 0 0 0-2.25-2.25H15a3 3 0 1 1 0-6h1.5M3 12V5.25A2.25 2.25 0 0 1 5.25 3h13.5A2.25 2.25 0 0 1 21 5.25V12m-18 0v6.75A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V12M3 12h18" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} />
    </svg>
  );
}

function IconGift({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path d="M21 11.25v8.25a1.5 1.5 0 0 1-1.5 1.5H4.5A1.5 1.5 0 0 1 3 19.5V11.25m18 0A1.5 1.5 0 0 0 21 9.75V8.25A2.25 2.25 0 0 0 18.75 6H18a3 3 0 0 0-3-3c-.86 0-1.637.366-2.182.952A3.001 3.001 0 0 0 10.5 3 3 3 0 0 0 7.5 6h-.75A2.25 2.25 0 0 0 4.5 8.25v1.5A1.5 1.5 0 0 0 6 11.25m15 0H6" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} />
    </svg>
  );
}

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

/* ── Main screen ──────────────────────────────────────── */

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
  const includedCreditsUsed = getIncludedCreditsUsed(data);
  const activeDays = chartData.filter((p) => p.requestCount > 0 || p.creditsUsed > 0);
  const busiestDays = [...activeDays]
    .sort((a, b) => b.requestCount !== a.requestCount ? b.requestCount - a.requestCount : b.creditsUsed - a.creditsUsed)
    .slice(0, 5);
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

      {/* ── 1. Hero: balance + stats ──────────────────── */}
      <article className="surface-elevated dashboard-card overflow-hidden rounded-[32px]">
        <div className="relative px-6 py-6">
          {/* Decorative gradient blob */}
          <div
            className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full opacity-40 blur-[72px]"
            style={{ background: "radial-gradient(circle, var(--brand-glow), transparent 70%)" }}
          />

          <div className="relative flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
            <div className="flex items-start gap-4">
              <span className="mt-1 inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] border border-[var(--border-brand)] bg-[var(--brand-subtle)]">
                <IconWallet className="h-6 w-6 text-[var(--brand-bright)]" />
              </span>
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                  Credits remaining
                </p>
                <h2 className="mt-1 text-5xl font-semibold tracking-[-0.04em] text-[var(--foreground)]">
                  {formatNumber(data.walletBalance)}
                </h2>
              </div>
            </div>

            <div className="flex items-center gap-3 rounded-[18px] border border-[var(--border-brand)] bg-[var(--brand-subtle)] px-4 py-3">
              <IconGift className="h-5 w-5 text-[var(--brand-bright)]" />
              <div>
                <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--brand-bright)]">
                  Free today
                </p>
                <p className="mt-0.5 text-lg font-semibold text-[var(--foreground)]">
                  {formatNumber(data.dailyFreeRemaining)}
                  <span className="text-sm font-normal text-[var(--foreground-secondary)]"> / {formatNumber(data.dailyFreeLimit)}</span>
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Inline stats row */}
        <div className="grid grid-cols-2 gap-px border-t border-[var(--border)] bg-[var(--border)]">
          <div className="bg-[var(--background-elevated)] px-5 py-4">
            <p className="text-xs text-[var(--foreground-tertiary)]">Credits used</p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-[var(--foreground)]">{formatNumber(data.creditsUsed)}</p>
          </div>
          <div className="bg-[var(--background-elevated)] px-5 py-4">
            <p className="text-xs text-[var(--foreground-tertiary)]">Billing period</p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-[var(--foreground)]">{formatBillingPeriod(data.periodStart, data.periodEnd)}</p>
          </div>
        </div>

        {/* Credit usage bar */}
        <div className="border-t border-[var(--border)] px-6 py-5">
          <CreditUsageBar
            label="Included credits this period"
            limit={data.creditsLimit}
            remaining={data.creditBreakdown.includedRemaining}
            used={includedCreditsUsed}
          />
          <p className="mt-2 px-1 text-sm leading-6 text-[var(--foreground-secondary)]">
            {formatNumber(includedCreditsUsed)} / {formatNumber(data.creditsLimit)} included credits used
            {data.creditBreakdown.paidRemaining > 0 || data.creditBreakdown.bonusRemaining > 0 ? (
              <> · plus {formatNumber(data.creditBreakdown.paidRemaining + data.creditBreakdown.bonusRemaining)} bonus/purchased</>
            ) : null}
          </p>
        </div>
      </article>

      {/* ── 2. Chart ──────────────────────────────────── */}
      <UsageChart
        title="Daily Activity"
        description="Request volume and credit consumption for the current billing window."
        data={chartData}
      />

      {/* ── 3. Most active days ───────────────────────── */}
      <article className="surface-elevated dashboard-card rounded-[28px] px-5 py-5">
        <div className="flex items-center gap-2.5">
          <IconFire className="h-5 w-5 text-[var(--accent-bright)]" />
          <h2 className="text-lg font-semibold text-[var(--foreground)]">Most active days</h2>
        </div>
        <div className="mt-5 space-y-3">
          {busiestDays.length > 0 ? busiestDays.map((item, index) => (
            <div key={item.date} className="flex items-center gap-3">
              <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-white/56 text-xs font-semibold text-[var(--foreground-secondary)]">
                {index + 1}
              </span>
              <div className="min-w-[100px]">
                <p className="text-sm font-medium text-[var(--foreground)]">{item.fullLabel}</p>
                <p className="text-xs text-[var(--foreground-tertiary)]">
                  {formatNumber(item.creditsUsed)} credits
                </p>
              </div>
              <div className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[rgba(36,29,21,0.08)]">
                <div
                  className="animate-progress-fill h-full rounded-full bg-[linear-gradient(90deg,var(--brand),var(--accent))]"
                  style={{ width: `${Math.max(12, (item.requestCount / totalRequestValue) * 100)}%` }}
                />
              </div>
              <span className="w-14 text-right text-sm font-semibold tabular-nums text-[var(--foreground)]">
                {formatNumber(item.requestCount)}
              </span>
            </div>
          )) : (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <IconCalendar className="h-8 w-8 text-[var(--foreground-tertiary)]" />
              <p className="text-sm text-[var(--foreground-tertiary)]">No activity yet this period</p>
            </div>
          )}
        </div>
      </article>

      {/* ── 4. Daily breakdown table ──────────────────── */}
      <section className="surface-elevated dashboard-card overflow-hidden rounded-[28px]">
        <div className="flex items-center gap-2.5 border-b border-[var(--border)] px-5 py-4">
          <IconCalendar className="h-5 w-5 text-[var(--foreground-tertiary)]" />
          <div>
            <h2 className="text-lg font-semibold text-[var(--foreground)]">Daily Breakdown</h2>
            <p className="text-xs text-[var(--foreground-tertiary)]">Last 14 days</p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-[var(--background-elevated)] text-[var(--foreground-secondary)]">
              <tr>
                <th className="px-5 py-3 font-medium">Date</th>
                <th className="px-5 py-3 font-medium">Requests</th>
                <th className="px-5 py-3 font-medium">Credits</th>
                <th className="px-5 py-3 font-medium">Volume</th>
                <th className="px-5 py-3 text-right font-medium">Share</th>
              </tr>
            </thead>
            <tbody>
              {recentRows.map((row) => {
                const requestShare = data.requestCount === 0
                  ? 0
                  : Math.round((row.requestCount / data.requestCount) * 100);
                const maxRowRequests = Math.max(1, ...recentRows.map((r) => r.requestCount));

                return (
                  <tr key={row.date} className="border-t border-[var(--border)] transition hover:bg-white/40">
                    <td className="px-5 py-3 font-medium text-[var(--foreground)]">{row.fullLabel}</td>
                    <td className="px-5 py-3 tabular-nums text-[var(--brand-bright)]">{formatNumber(row.requestCount)}</td>
                    <td className="px-5 py-3 tabular-nums text-[var(--foreground-secondary)]">{formatNumber(row.creditsUsed)}</td>
                    <td className="px-5 py-3">
                      <div className="h-1.5 w-full max-w-[120px] overflow-hidden rounded-full bg-[rgba(36,29,21,0.06)]">
                        <div
                          className="h-full rounded-full bg-[var(--brand)]"
                          style={{ width: `${Math.max(2, (row.requestCount / maxRowRequests) * 100)}%` }}
                        />
                      </div>
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-[var(--foreground-tertiary)]">
                      {requestShare}%
                    </td>
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
