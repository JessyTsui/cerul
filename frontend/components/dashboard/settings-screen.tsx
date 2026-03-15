"use client";

import type { Route } from "next";
import Link from "next/link";
import { useState } from "react";
import { billing, getApiErrorMessage } from "@/lib/api";
import {
  formatBillingPeriod,
  formatNumber,
  getTierLabel,
  resolveDashboardBillingAction,
} from "@/lib/dashboard";
import { DashboardLayout } from "./dashboard-layout";
import {
  DashboardNotice,
  DashboardSkeleton,
  DashboardState,
} from "./dashboard-state";
import { useMonthlyUsage } from "./use-monthly-usage";

const planDescriptions: Record<string, string> = {
  free: "Best for evaluating the public API surface and the operator workflow.",
  builder:
    "Built for teams that need predictable usage, more active keys, and a cleaner operator surface.",
  pro: "Built for active teams that need more credits, more keys, and direct billing controls.",
  enterprise:
    "Reserved for private ingestion, security review, and negotiated usage envelopes.",
};

const planFeatures: Record<string, string[]> = {
  free: [
    "Evaluate the public API surface with one active key.",
    "Inspect billing posture before moving into production.",
    "Good fit for early demos and internal validation.",
  ],
  builder: [
    "Predictable monthly credits and more active API keys.",
    "Self-serve billing controls for fast iteration.",
    "Cleaner runway for shipping agent integrations.",
  ],
  pro: [
    "Legacy paid tier with expanded quota and billing controls.",
    "Handled as Builder in the public-facing product language.",
    "Kept here only for compatibility with older accounts.",
  ],
  enterprise: [
    "Negotiated credit envelope and private ingestion workflows.",
    "Manual billing coordination and security review.",
    "Operational support tuned for production deployment.",
  ],
};

export function DashboardSettingsScreen() {
  const { data, error, isLoading, refresh } = useMonthlyUsage();
  const [billingAction, setBillingAction] = useState<"checkout" | "portal" | null>(
    null,
  );
  const [billingError, setBillingError] = useState<string | null>(null);
  const normalizedTier = data?.tier.toLowerCase() ?? "free";
  const availableBillingAction = data
    ? resolveDashboardBillingAction(data.tier, data.hasStripeCustomer)
    : null;
  const canUpgrade = availableBillingAction === "checkout";
  const canManageSubscription = availableBillingAction === "portal";
  const usesManualBilling =
    data !== null && availableBillingAction === null && normalizedTier !== "free";
  const tierLabel = data ? getTierLabel(data.tier) : "Free";
  const currentPlanDescription =
    planDescriptions[normalizedTier] ?? planDescriptions.free;
  const currentPlanFeatures =
    planFeatures[normalizedTier] ?? planFeatures.free;
  const billingRouteLabel = usesManualBilling
    ? "Manual billing"
    : canManageSubscription
      ? "Stripe portal"
      : canUpgrade
        ? "Self-serve checkout"
        : "Evaluation tier";
  const supportLane =
    normalizedTier === "enterprise"
      ? "Dedicated onboarding"
      : normalizedTier === "free"
        ? "Community and email"
        : "Priority email";
  const rateLimitLabel =
    data?.rateLimitPerSec === null || data?.rateLimitPerSec === undefined
      ? "Private / not exposed"
      : `${formatNumber(data.rateLimitPerSec)} req/s`;

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

          <section className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
            <article className="surface-elevated rounded-[32px] px-6 py-6">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                <div className="max-w-2xl">
                  <p className="eyebrow">Workspace plan</p>
                  <h2 className="mt-4 text-4xl font-semibold tracking-[-0.05em] text-white sm:text-5xl">
                    {tierLabel}
                  </h2>
                  <p className="mt-4 text-base leading-8 text-[var(--foreground-secondary)]">
                    {currentPlanDescription}
                  </p>
                </div>
                <span
                  className={`label ${
                    normalizedTier === "enterprise"
                      ? "label-accent"
                      : normalizedTier === "free"
                        ? ""
                        : "label-brand"
                  }`}
                >
                  {usesManualBilling ? "Managed account" : "Active plan"}
                </span>
              </div>

              <div className="mt-8 grid gap-4 md:grid-cols-3">
                {[
                  {
                    label: "Billing window",
                    value: formatBillingPeriod(data.periodStart, data.periodEnd),
                    note: "Current active ledger period",
                  },
                  {
                    label: "Credit envelope",
                    value: `${formatNumber(data.creditsUsed)} / ${formatNumber(data.creditsLimit)}`,
                    note: `${formatNumber(data.creditsRemaining)} credits remaining`,
                  },
                  {
                    label: "Billing route",
                    value: billingRouteLabel,
                    note: usesManualBilling
                      ? "Changes route through Cerul support"
                      : "Available from this console",
                  },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="rounded-[20px] border border-[var(--border)] bg-[rgba(255,255,255,0.03)] px-4 py-4"
                  >
                    <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                      {item.label}
                    </p>
                    <p className="mt-3 text-xl font-semibold text-white">{item.value}</p>
                    <p className="mt-2 text-sm leading-6 text-[var(--foreground-secondary)]">
                      {item.note}
                    </p>
                  </div>
                ))}
              </div>

              <div className="mt-8 grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
                <div className="surface-gradient rounded-[24px] px-5 py-5">
                  <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--brand-bright)]">
                    Current posture
                  </p>
                  <p className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-white">
                    {formatNumber(data.requestCount)} requests
                  </p>
                  <p className="mt-2 text-sm leading-6 text-[var(--foreground-secondary)]">
                    Requests, keys, and quota all resolve against the same workspace envelope.
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  {currentPlanFeatures.map((feature) => (
                    <div
                      key={feature}
                      className="rounded-[18px] border border-[var(--border)] bg-[var(--surface)] px-4 py-4"
                    >
                      <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--brand-bright)]">
                        Included
                      </span>
                      <p className="mt-3 text-sm leading-6 text-white">{feature}</p>
                    </div>
                  ))}
                </div>
              </div>
            </article>

            <article className="surface-elevated rounded-[32px] px-6 py-6">
              <p className="eyebrow">Billing controls</p>
              <h2 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-white">
                Manage subscription state
              </h2>
              <p className="mt-3 text-sm leading-7 text-[var(--foreground-secondary)]">
                Checkout is only used when moving from free evaluation into a paid workspace.
                Existing self-serve customers jump straight into Stripe portal management.
              </p>

              <div className="mt-6 space-y-3">
                {[
                  {
                    label: "Billing route",
                    value: billingRouteLabel,
                  },
                  {
                    label: "Support lane",
                    value: supportLane,
                  },
                  {
                    label: "Workspace status",
                    value: "Active",
                  },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="rounded-[18px] border border-[var(--border)] bg-[var(--surface)] px-4 py-4"
                  >
                    <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                      {item.label}
                    </p>
                    <p className="mt-2 text-base font-semibold text-white">{item.value}</p>
                  </div>
                ))}
              </div>

              <div className="mt-6 flex flex-col gap-3">
                {canUpgrade ? (
                  <button
                    className="button-primary w-full"
                    disabled={billingAction !== null}
                    onClick={() => void handleCheckout()}
                    type="button"
                  >
                    {billingAction === "checkout"
                      ? "Redirecting..."
                      : "Upgrade to Builder"}
                  </button>
                ) : null}

                {canManageSubscription ? (
                  <button
                    className="button-secondary w-full"
                    disabled={billingAction !== null}
                    onClick={() => void handlePortal()}
                    type="button"
                  >
                    {billingAction === "portal"
                      ? "Opening portal..."
                      : "Open billing portal"}
                  </button>
                ) : null}

                {usesManualBilling ? (
                  <div className="rounded-[18px] border border-[var(--border-brand)] bg-[var(--brand-subtle)] px-4 py-4">
                    <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--brand-bright)]">
                      Manual coordination
                    </p>
                    <p className="mt-2 text-sm leading-6 text-white">
                      This workspace is handled outside self-serve Stripe flows. Contact Cerul if
                      invoicing, seats, or contract terms need to change.
                    </p>
                  </div>
                ) : null}
              </div>
            </article>
          </section>

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {[
              {
                label: "Credit limit",
                value: formatNumber(data.creditsLimit),
                note: "Maximum credits available in the active billing window.",
              },
              {
                label: "Credits remaining",
                value: formatNumber(data.creditsRemaining),
                note: "Available to spend before the current window resets.",
              },
              {
                label: "Requests this period",
                value: formatNumber(data.requestCount),
                note: "Dashboard-side request total for the current billing ledger.",
              },
              {
                label: "Active API keys",
                value: formatNumber(data.apiKeysActive),
                note: "Keys currently accepted by the public API surface.",
              },
              {
                label: "Rate limit",
                value: rateLimitLabel,
                note: "Only shown when the backend exposes a concrete rate policy.",
              },
              {
                label: "Period reset",
                value: formatBillingPeriod(data.periodStart, data.periodEnd),
                note: "Use this to align spend monitoring with support and finance reviews.",
              },
            ].map((item) => (
              <article key={item.label} className="surface rounded-[24px] px-5 py-5">
                <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                  {item.label}
                </p>
                <p className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-white">
                  {item.value}
                </p>
                <p className="mt-2 text-sm leading-6 text-[var(--foreground-secondary)]">
                  {item.note}
                </p>
              </article>
            ))}
          </section>

          <section className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
            <article className="surface-elevated rounded-[32px] px-6 py-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="eyebrow">Plan ladder</p>
                  <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-white">
                    Move between evaluation, builder, and enterprise
                  </h2>
                </div>
                <Link className="button-secondary" href="/pricing">
                  Compare plan details
                </Link>
              </div>

              <div className="mt-6 grid gap-4 lg:grid-cols-3">
                {[
                  {
                    key: "free",
                    title: "Free",
                    tone: "",
                    note: "Evaluation and initial integration testing.",
                  },
                  {
                    key: "builder",
                    title: "Builder",
                    tone: "label-brand",
                    note: "Predictable self-serve plan for active builders.",
                  },
                  {
                    key: "enterprise",
                    title: "Enterprise",
                    tone: "label-accent",
                    note: "Custom billing and operational review.",
                  },
                ].map((plan) => {
                  const isCurrent =
                    (plan.key === "builder" && normalizedTier === "pro") ||
                    plan.key === normalizedTier;

                  return (
                    <div
                      key={plan.key}
                      className={`rounded-[22px] border px-5 py-5 ${
                        isCurrent
                          ? "border-[var(--border-brand)] bg-[rgba(34,211,238,0.08)]"
                          : "border-[var(--border)] bg-[var(--surface)]"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className={`label ${plan.tone}`}>{plan.title}</span>
                        {isCurrent ? (
                          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--brand-bright)]">
                            Current
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-4 text-sm leading-6 text-[var(--foreground-secondary)]">
                        {plan.note}
                      </p>
                      <ul className="mt-4 space-y-3">
                        {(planFeatures[plan.key] ?? []).map((feature) => (
                          <li
                            key={feature}
                            className="rounded-[16px] border border-[var(--border)] bg-[rgba(255,255,255,0.02)] px-3 py-3 text-sm leading-6 text-white"
                          >
                            {feature}
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </article>

            <div className="space-y-5">
              <article className="surface-elevated rounded-[32px] px-6 py-6">
                <p className="eyebrow">Workspace controls</p>
                <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-white">
                  Keep billing, keys, and usage aligned
                </h2>
                <div className="mt-6 grid gap-3">
                  {[
                    {
                      title: "Rotate API credentials",
                      description:
                        "Use the keys page to revoke stale credentials and issue fresh ones for each environment.",
                      href: "/dashboard/keys",
                    },
                    {
                      title: "Inspect usage accounting",
                      description:
                        "Review request volume and billing drawdown before changing plan posture.",
                      href: "/dashboard/usage",
                    },
                    {
                      title: "Read billing semantics",
                      description:
                        "Public usage semantics stay documented separately from private Stripe implementation details.",
                      href: "/docs/usage-api",
                    },
                  ].map((item) => (
                    <Link
                      key={item.title}
                      className="rounded-[18px] border border-[var(--border)] bg-[var(--surface)] px-4 py-4 transition hover:border-[var(--border-brand)] hover:bg-[rgba(34,211,238,0.06)]"
                      href={item.href as Route}
                    >
                      <p className="text-base font-semibold text-white">{item.title}</p>
                      <p className="mt-2 text-sm leading-6 text-[var(--foreground-secondary)]">
                        {item.description}
                      </p>
                    </Link>
                  ))}
                </div>
              </article>

              <article className="surface rounded-[28px] px-6 py-6">
                <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                  Account note
                </p>
                <p className="mt-3 text-sm leading-7 text-[var(--foreground-secondary)]">
                  Raw API key secrets are only revealed at creation time. Billing controls do not
                  duplicate API credential state, so the safest operating pattern is still per-env
                  key rotation plus periodic usage review.
                </p>
              </article>
            </div>
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
