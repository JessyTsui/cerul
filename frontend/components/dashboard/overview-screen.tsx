"use client";

import Link from "next/link";
import { useState } from "react";
import { billing, getApiErrorMessage } from "@/lib/api";
import {
  formatBillingPeriod,
  formatNumber,
  getAverageDailyCredits,
  getRecentUsageChartData,
  getTierLabel,
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

export function DashboardOverviewScreen() {
  const { data, error, isLoading, refresh } = useMonthlyUsage();
  const [billingError, setBillingError] = useState<string | null>(null);
  const [billingAction, setBillingAction] = useState<"checkout" | "portal" | null>(
    null,
  );

  async function handleBillingAction() {
    if (!data) {
      return;
    }

    const tier = data.tier.toLowerCase();
    const nextAction =
      tier === "pro" || tier === "enterprise" ? "portal" : "checkout";

    setBillingAction(nextAction);
    setBillingError(null);

    try {
      const redirect =
        nextAction === "portal"
          ? await billing.createPortal()
          : await billing.createCheckout();

      window.location.assign(redirect.url);
    } catch (nextError) {
      setBillingError(
        getApiErrorMessage(nextError, "Failed to start billing flow."),
      );
      setBillingAction(null);
    }
  }

  const actions = (
    <>
      <Link className="button-secondary" href="/docs/usage-api">
        View docs
      </Link>
      <Link className="button-secondary" href="/dashboard/keys">
        Create API Key
      </Link>
      <button
        className="button-primary"
        disabled={billingAction !== null || !data}
        onClick={() => void handleBillingAction()}
        type="button"
      >
        {billingAction === "checkout"
          ? "Redirecting..."
          : billingAction === "portal"
            ? "Opening portal..."
            : data && data.tier.toLowerCase() !== "free"
              ? "Manage Plan"
              : "Upgrade Plan"}
      </button>
    </>
  );

  return (
    <DashboardLayout
      actions={actions}
      currentPath="/dashboard"
      description="Inspect real monthly usage, jump to key management, and route billing through the private dashboard API."
      title="Dashboard"
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
          title="Usage data could not be loaded"
          tone="error"
        />
      ) : data ? (
        <>
          {error ? (
            <DashboardNotice
              description={error}
              title="Showing the last successful usage snapshot."
              tone="error"
            />
          ) : null}

          {billingError ? (
            <DashboardNotice
              description={billingError}
              title="Billing action failed"
              tone="error"
            />
          ) : null}

          <section className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
            <article className="surface-elevated px-6 py-6">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                    Active plan
                  </p>
                  <h2 className="mt-2 text-3xl font-semibold text-white">
                    {getTierLabel(data.tier)}
                  </h2>
                  <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--foreground-secondary)]">
                    Billing window: {formatBillingPeriod(data.periodStart, data.periodEnd)}
                  </p>
                </div>
                <div className="rounded-[20px] border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
                  <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                    Daily average
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-white">
                    {formatNumber(getAverageDailyCredits(data))}
                  </p>
                  <p className="mt-1 text-sm text-[var(--foreground-secondary)]">
                    credits per day
                  </p>
                </div>
              </div>

              <div className="mt-6">
                <CreditUsageBar
                  label="Monthly credits"
                  limit={data.creditsLimit}
                  remaining={data.creditsRemaining}
                  used={data.creditsUsed}
                />
              </div>
            </article>

            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
              {[
                {
                  label: "Requests this period",
                  value: formatNumber(data.requestCount),
                  note: "Summed from the dashboard usage ledger.",
                },
                {
                  label: "Active API keys",
                  value: formatNumber(data.apiKeysActive),
                  note: "Session-authenticated key inventory.",
                },
                {
                  label: "Credits remaining",
                  value: formatNumber(data.creditsRemaining),
                  note: "Available before the current billing window resets.",
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
          </section>

          <UsageChart
            compact
            data={getRecentUsageChartData(data, 7)}
            description="Last seven days of real monthly usage. Each bar represents credits consumed that day."
            title="Weekly credit burn"
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
