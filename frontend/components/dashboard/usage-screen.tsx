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

/* ── Inline icons ─────────────────────────────────────── */

function IconWallet({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path d="M21 12a2.25 2.25 0 0 0-2.25-2.25H15a3 3 0 1 1 0-6h1.5M3 12V5.25A2.25 2.25 0 0 1 5.25 3h13.5A2.25 2.25 0 0 1 21 5.25V12m-18 0v6.75A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V12M3 12h18" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} />
    </svg>
  );
}

function IconBolt({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24">
      <path d="M13.5 2.75 6.75 13.5h4.5l-.75 7.75 6.75-10.75h-4.5l.75-7.75Z" fill="currentColor" />
    </svg>
  );
}

function IconSearch({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} />
    </svg>
  );
}

function IconCreditCard({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path d="M2.25 8.25h19.5M2.25 9h19.5m-1.5 10.5V7.5a2.25 2.25 0 0 0-2.25-2.25H4.5A2.25 2.25 0 0 0 2.25 7.5v12a2.25 2.25 0 0 0 2.25 2.25h15a2.25 2.25 0 0 0 2.25-2.25Z" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} />
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

function IconChartBar({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} />
    </svg>
  );
}

function IconArrowTrendUp({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path d="M2.25 18 9 11.25l4.306 4.306a11.95 11.95 0 0 1 5.814-5.518l2.74-1.22m0 0-5.94-2.281m5.94 2.28-2.28 5.941" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} />
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

function IconGift({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path d="M21 11.25v8.25a1.5 1.5 0 0 1-1.5 1.5H4.5A1.5 1.5 0 0 1 3 19.5V11.25m18 0A1.5 1.5 0 0 0 21 9.75V8.25A2.25 2.25 0 0 0 18.75 6H18a3 3 0 0 0-3-3c-.86 0-1.637.366-2.182.952A3.001 3.001 0 0 0 10.5 3 3 3 0 0 0 7.5 6h-.75A2.25 2.25 0 0 0 4.5 8.25v1.5A1.5 1.5 0 0 0 6 11.25m15 0H6" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} />
    </svg>
  );
}

function IconClock({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} />
    </svg>
  );
}

/* ── Small reusable pieces ────────────────────────────── */

function StatCard({
  icon,
  label,
  value,
  note,
  accentColor,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  note?: string;
  accentColor?: string;
}) {
  return (
    <div className="dashboard-card rounded-[20px] border border-[var(--border)] bg-[var(--background-elevated)] px-4 py-4">
      <div className="flex items-center gap-2.5">
        <span
          className="inline-flex h-8 w-8 items-center justify-center rounded-[10px]"
          style={{
            background: accentColor
              ? `${accentColor}14`
              : "rgba(136,165,242,0.12)",
          }}
        >
          {icon}
        </span>
        <p className="text-sm text-[var(--foreground-secondary)]">{label}</p>
      </div>
      <p className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-[var(--foreground)]">
        {value}
      </p>
      {note ? (
        <p className="mt-1.5 text-xs text-[var(--foreground-tertiary)]">{note}</p>
      ) : null}
    </div>
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

  const freeSearchesUsedToday = data.dailyFreeLimit - data.dailyFreeRemaining;
  const paidSearches = Math.max(0, data.requestCount - freeSearchesUsedToday);

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

      {/* ── Hero: credit balance ──────────────────────── */}
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
                <p className="mt-2 text-sm text-[var(--foreground-secondary)]">
                  Available for your next search
                </p>
              </div>
            </div>

            {/* Free-today pill */}
            <div className="flex items-center gap-3 rounded-[18px] border border-[var(--border-brand)] bg-[var(--brand-subtle)] px-4 py-3">
              <IconGift className="h-5 w-5 text-[var(--brand-bright)]" />
              <div>
                <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--brand-bright)]">
                  Free today
                </p>
                <p className="mt-0.5 text-lg font-semibold text-[var(--foreground)]">
                  {formatNumber(data.dailyFreeRemaining)} <span className="text-sm font-normal text-[var(--foreground-secondary)]">/ {formatNumber(data.dailyFreeLimit)}</span>
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Credit usage bar — flush inside hero card */}
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
              <>
                {" "}· plus {formatNumber(data.creditBreakdown.paidRemaining + data.creditBreakdown.bonusRemaining)} bonus/purchased credits
              </>
            ) : null}
          </p>
        </div>
      </article>

      {/* ── At-a-glance stat row ──────────────────────── */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={<IconSearch className="h-4 w-4 text-[var(--brand-bright)]" />}
          label="Total requests"
          value={formatNumber(data.requestCount)}
          note="This billing period"
          accentColor="rgb(136,165,242)"
        />
        <StatCard
          icon={<IconCreditCard className="h-4 w-4 text-[var(--accent-bright)]" />}
          label="Credits used"
          value={formatNumber(data.creditsUsed)}
          note="Charged this period"
          accentColor="rgb(212,156,105)"
        />
        <StatCard
          icon={<IconCalendar className="h-4 w-4 text-[var(--success)]" />}
          label="Active days"
          value={formatNumber(activeDays.length)}
          note={`of ${formatNumber(chartData.length)} total days`}
          accentColor="rgb(31,141,74)"
        />
        <StatCard
          icon={<IconArrowTrendUp className="h-4 w-4 text-[rgb(168,120,200)]" />}
          label="Avg / day"
          value={formatNumber(averageDailyRequests)}
          note={`${creditsPerRequest === 0 ? "0" : creditsPerRequest.toFixed(1)} credits per request`}
          accentColor="rgb(168,120,200)"
        />
      </section>

      {/* ── Request breakdown: free vs paid ───────────── */}
      <section className="grid gap-5 xl:grid-cols-2">
        <article className="surface-elevated dashboard-card rounded-[32px] px-6 py-6">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-[12px] bg-[rgba(136,165,242,0.12)]">
              <IconGift className="h-[18px] w-[18px] text-[var(--brand-bright)]" />
            </span>
            <div>
              <p className="text-sm font-medium text-[var(--foreground)]">Free searches today</p>
              <p className="text-xs text-[var(--foreground-tertiary)]">0 credits deducted</p>
            </div>
          </div>
          <p className="mt-4 text-4xl font-semibold tracking-[-0.04em] text-[var(--foreground)]">
            {formatNumber(Math.min(freeSearchesUsedToday, data.dailyFreeLimit))}
          </p>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-[rgba(36,29,21,0.08)]">
            <div
              className="animate-progress-fill h-full rounded-full bg-[var(--brand)]"
              style={{
                width: `${Math.max(4, Math.min(100, (freeSearchesUsedToday / Math.max(1, data.dailyFreeLimit)) * 100))}%`,
              }}
            />
          </div>
          <p className="mt-2 text-xs text-[var(--foreground-tertiary)]">
            {formatNumber(data.dailyFreeRemaining)} of {formatNumber(data.dailyFreeLimit)} remaining · resets at midnight UTC
          </p>
        </article>

        <article className="surface-elevated dashboard-card rounded-[32px] px-6 py-6">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-[12px] bg-[rgba(212,156,105,0.12)]">
              <IconCreditCard className="h-[18px] w-[18px] text-[var(--accent-bright)]" />
            </span>
            <div>
              <p className="text-sm font-medium text-[var(--foreground)]">Paid searches</p>
              <p className="text-xs text-[var(--foreground-tertiary)]">Credits consumed from wallet</p>
            </div>
          </div>
          <p className="mt-4 text-4xl font-semibold tracking-[-0.04em] text-[var(--foreground)]">
            {formatNumber(paidSearches)}
          </p>
          <div className="mt-4 flex items-center gap-3 rounded-[14px] border border-[var(--border)] bg-white/56 px-4 py-3">
            <IconBolt className="h-4 w-4 shrink-0 text-[var(--accent-bright)]" />
            <p className="text-sm text-[var(--foreground-secondary)]">
              {formatNumber(data.creditsUsed)} credits consumed this period
            </p>
          </div>
        </article>
      </section>

      {/* ── Chart ─────────────────────────────────────── */}
      <UsageChart
        title="Daily Activity"
        description="Request volume and credit consumption for the current billing window."
        data={chartData}
      />

      {/* ── Highlights + most active days ─────────────── */}
      <section className="grid gap-5 xl:grid-cols-2">
        <article className="surface-elevated dashboard-card rounded-[28px] px-5 py-5">
          <div className="flex items-center gap-2.5">
            <IconChartBar className="h-5 w-5 text-[var(--brand-bright)]" />
            <h2 className="text-lg font-semibold text-[var(--foreground)]">Highlights</h2>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {[
              {
                icon: <IconFire className="h-4 w-4 text-[var(--error)]" />,
                label: "Peak request day",
                value: topRequestsDay ? formatNumber(topRequestsDay.requestCount) : "—",
                note: topRequestsDay?.fullLabel ?? "No data",
                color: "rgb(239,68,68)",
              },
              {
                icon: <IconBolt className="h-4 w-4 text-[var(--accent-bright)]" />,
                label: "Peak credit day",
                value: topCreditsDay ? formatNumber(topCreditsDay.creditsUsed) : "—",
                note: topCreditsDay?.fullLabel ?? "No data",
                color: "rgb(212,156,105)",
              },
              {
                icon: <IconClock className="h-4 w-4 text-[var(--brand-bright)]" />,
                label: "Avg requests / day",
                value: formatNumber(averageDailyRequests),
                note: `Across ${formatNumber(chartData.length)} days`,
                color: "rgb(136,165,242)",
              },
              {
                icon: <IconArrowTrendUp className="h-4 w-4 text-[var(--success)]" />,
                label: "Credits / request",
                value: creditsPerRequest === 0 ? "0" : creditsPerRequest.toFixed(2),
                note: "Average cost per search",
                color: "rgb(31,141,74)",
              },
            ].map((item) => (
              <div
                key={item.label}
                className="rounded-[18px] border border-[var(--border)] bg-[var(--background-elevated)] px-4 py-4"
              >
                <div className="flex items-center gap-2">
                  <span
                    className="inline-flex h-7 w-7 items-center justify-center rounded-[8px]"
                    style={{ background: `${item.color}14` }}
                  >
                    {item.icon}
                  </span>
                  <p className="text-xs text-[var(--foreground-secondary)]">{item.label}</p>
                </div>
                <p className="mt-2.5 text-xl font-semibold text-[var(--foreground)]">
                  {item.value}
                </p>
                <p className="mt-1 text-xs text-[var(--foreground-tertiary)]">{item.note}</p>
              </div>
            ))}
          </div>
        </article>

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
      </section>

      {/* ── Daily breakdown table ─────────────────────── */}
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
