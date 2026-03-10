"use client";

import Link from "next/link";
import {
  formatBillingPeriod,
  formatNumber,
  getAverageDailyCredits,
  getTierLabel,
  buildUsageChartData,
} from "@/lib/dashboard";
import { CreditUsageBar } from "./credit-usage-bar";
import { DashboardLayout } from "./dashboard-layout";
import {
  DashboardNotice,
  DashboardSkeleton,
  DashboardState,
} from "./dashboard-state";
import { useMonthlyUsage } from "./use-monthly-usage";
import { UsageChart } from "./usage-chart";

export function DashboardUsageScreen() {
  const { data, error, isLoading, refresh } = useMonthlyUsage();

  return (
    <DashboardLayout
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
      currentPath="/dashboard/usage"
      description="Inspect the current billing window, credit consumption, and daily request shape using the same private usage endpoint that powers the operator console."
      title="Usage"
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
          title="Usage metrics could not be loaded"
          tone="error"
        />
      ) : data ? (
        <>
          {error ? (
            <DashboardNotice
              description={error}
              title="The numbers below are the last successful usage snapshot."
              tone="error"
            />
          ) : null}

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {[
              {
                label: "Plan",
                value: getTierLabel(data.tier),
                note: `Billing window: ${formatBillingPeriod(data.periodStart, data.periodEnd)}`,
              },
              {
                label: "Credits used",
                value: formatNumber(data.creditsUsed),
                note: "Consumed within the current billing period.",
              },
              {
                label: "Credits remaining",
                value: formatNumber(data.creditsRemaining),
                note: "Remaining before the period resets.",
              },
              {
                label: "Request count",
                value: formatNumber(data.requestCount),
                note: "Aggregated from the monthly usage endpoint.",
              },
            ].map((item) => (
              <article key={item.label} className="surface px-5 py-5">
                <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                  {item.label}
                </p>
                <p className="mt-3 text-3xl font-semibold text-white">{item.value}</p>
                <p className="mt-2 text-sm leading-6 text-[var(--foreground-secondary)]">
                  {item.note}
                </p>
              </article>
            ))}
          </section>

          <section className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
            <CreditUsageBar
              label="Current billing period"
              limit={data.creditsLimit}
              remaining={data.creditsRemaining}
              used={data.creditsUsed}
            />

            <article className="surface-elevated px-6 py-6">
              <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                Period context
              </p>
              <h2 className="mt-2 text-2xl font-semibold text-white">
                Usage envelope
              </h2>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className="rounded-[18px] border border-[var(--border)] bg-[var(--surface)] px-4 py-4">
                  <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                    Active keys
                  </p>
                  <p className="mt-2 text-xl font-semibold text-white">
                    {formatNumber(data.apiKeysActive)}
                  </p>
                </div>
                <div className="rounded-[18px] border border-[var(--border)] bg-[var(--surface)] px-4 py-4">
                  <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                    Daily average
                  </p>
                  <p className="mt-2 text-xl font-semibold text-white">
                    {formatNumber(getAverageDailyCredits(data))}
                  </p>
                </div>
                <div className="rounded-[18px] border border-[var(--border)] bg-[var(--surface)] px-4 py-4 sm:col-span-2">
                  <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                    Rate limit
                  </p>
                  <p className="mt-2 text-xl font-semibold text-white">
                    {data.rateLimitPerSec === null
                      ? "Not exposed"
                      : `${formatNumber(data.rateLimitPerSec)} req/s`}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-[var(--foreground-secondary)]">
                    The usage endpoint can optionally expose rate posture alongside
                    credit accounting.
                  </p>
                </div>
              </div>
            </article>
          </section>

          <UsageChart
            data={buildUsageChartData(data)}
            description="Daily credits consumed across the full billing period. Missing days are rendered as zero to keep the timeline honest."
            title="Daily credit breakdown"
          />
        </>
      ) : (
        <DashboardState
          action={
            <button className="button-primary" onClick={() => void refresh()} type="button">
              Retry request
            </button>
          }
          description="The dashboard API returned no usage payload."
          title="No usage data available"
        />
      )}
    </DashboardLayout>
  );
}
