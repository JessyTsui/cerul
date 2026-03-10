"use client";

import Link from "next/link";
import { useState } from "react";
import { billing, getApiErrorMessage } from "@/lib/api";
import { getTierLabel } from "@/lib/dashboard";
import { DashboardLayout } from "./dashboard-layout";
import {
  DashboardNotice,
  DashboardSkeleton,
  DashboardState,
} from "./dashboard-state";
import { useMonthlyUsage } from "./use-monthly-usage";

const planDescriptions: Record<string, string> = {
  free: "Best for evaluating the public API surface and the operator workflow.",
  pro: "Built for active teams that need more credits, more keys, and direct billing controls.",
  enterprise:
    "Reserved for private ingestion, security review, and negotiated usage envelopes.",
};

export function DashboardSettingsScreen() {
  const { data, error, isLoading, refresh } = useMonthlyUsage();
  const [billingAction, setBillingAction] = useState<"checkout" | "portal" | null>(
    null,
  );
  const [billingError, setBillingError] = useState<string | null>(null);

  async function handleCheckout() {
    setBillingAction("checkout");
    setBillingError(null);

    try {
      const redirect = await billing.createCheckout();
      window.location.assign(redirect.url);
    } catch (nextError) {
      setBillingError(
        getApiErrorMessage(nextError, "Failed to start checkout."),
      );
      setBillingAction(null);
    }
  }

  async function handlePortal() {
    setBillingAction("portal");
    setBillingError(null);

    try {
      const redirect = await billing.createPortal();
      window.location.assign(redirect.url);
    } catch (nextError) {
      setBillingError(
        getApiErrorMessage(nextError, "Failed to open billing portal."),
      );
      setBillingAction(null);
    }
  }

  return (
    <DashboardLayout
      actions={
        <>
          <Link className="button-secondary" href="/pricing">
            Compare plans
          </Link>
          <button className="button-primary" onClick={() => void refresh()} type="button">
            Refresh plan
          </button>
        </>
      }
      currentPath="/dashboard/settings"
      description="Route upgrades and subscription management through the private billing endpoints without duplicating Stripe logic inside the frontend."
      title="Settings"
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
          title="Plan data could not be loaded"
          tone="error"
        />
      ) : data ? (
        <>
          {error ? (
            <DashboardNotice
              description={error}
              title="The settings page is showing the last successful plan snapshot."
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

          <section className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
            <article className="surface-elevated px-6 py-6">
              <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                Current plan
              </p>
              <h2 className="mt-2 text-3xl font-semibold text-white">
                {getTierLabel(data.tier)}
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--foreground-secondary)]">
                {planDescriptions[data.tier.toLowerCase()] ?? planDescriptions.free}
              </p>

              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                <div className="rounded-[18px] border border-[var(--border)] bg-[var(--surface)] px-4 py-4">
                  <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                    Credit limit
                  </p>
                  <p className="mt-2 text-xl font-semibold text-white">
                    {data.creditsLimit.toLocaleString("en-US")}
                  </p>
                </div>
                <div className="rounded-[18px] border border-[var(--border)] bg-[var(--surface)] px-4 py-4">
                  <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                    Active keys
                  </p>
                  <p className="mt-2 text-xl font-semibold text-white">
                    {data.apiKeysActive.toLocaleString("en-US")}
                  </p>
                </div>
                <div className="rounded-[18px] border border-[var(--border)] bg-[var(--surface)] px-4 py-4">
                  <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                    Requests
                  </p>
                  <p className="mt-2 text-xl font-semibold text-white">
                    {data.requestCount.toLocaleString("en-US")}
                  </p>
                </div>
              </div>
            </article>

            <article className="surface px-6 py-6">
              <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                Billing controls
              </p>
              <h2 className="mt-2 text-2xl font-semibold text-white">
                Stripe-backed actions
              </h2>
              <p className="mt-3 text-sm leading-6 text-[var(--foreground-secondary)]">
                Upgrade flows go through checkout. Existing paid accounts can jump
                straight to the billing portal to manage subscription state.
              </p>

              <div className="mt-6 flex flex-col gap-3">
                <button
                  className="button-primary w-full"
                  disabled={billingAction !== null}
                  onClick={() => void handleCheckout()}
                  type="button"
                >
                  {billingAction === "checkout" ? "Redirecting..." : "Upgrade to Pro"}
                </button>

                {["pro", "enterprise"].includes(data.tier.toLowerCase()) ? (
                  <button
                    className="button-secondary w-full"
                    disabled={billingAction !== null}
                    onClick={() => void handlePortal()}
                    type="button"
                  >
                    {billingAction === "portal"
                      ? "Opening portal..."
                      : "Manage Subscription"}
                  </button>
                ) : null}
              </div>
            </article>
          </section>
        </>
      ) : (
        <DashboardState
          action={
            <button className="button-primary" onClick={() => void refresh()} type="button">
              Retry request
            </button>
          }
          description="The dashboard API returned no plan payload."
          title="No plan data available"
        />
      )}
    </DashboardLayout>
  );
}
