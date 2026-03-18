"use client";

import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { billing, getApiErrorMessage } from "@/lib/api";
import { useConsoleViewer } from "@/components/console/console-viewer-context";
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
import { CreditUsageBar } from "./credit-usage-bar";
import { useMonthlyUsage } from "./use-monthly-usage";

const planDescriptions: Record<string, string> = {
  free: "Best for evaluating the public API surface and the workspace workflow.",
  builder:
    "Built for teams that need predictable usage, more active keys, and a cleaner console surface.",
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

type BootstrapAdminStatus =
  | "loading"
  | "available"
  | "already_admin"
  | "disabled"
  | "managed_by_emails"
  | "admin_exists"
  | "unavailable";

export function DashboardSettingsScreen() {
  const router = useRouter();
  const viewer = useConsoleViewer();
  const { data, error, isLoading, refresh } = useMonthlyUsage();
  const [billingAction, setBillingAction] = useState<"checkout" | "portal" | null>(
    null,
  );
  const [billingError, setBillingError] = useState<string | null>(null);
  const [bootstrapSecret, setBootstrapSecret] = useState("");
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [isPromotingAdmin, setIsPromotingAdmin] = useState(false);
  const [bootstrapStatus, setBootstrapStatus] = useState<BootstrapAdminStatus>(
    () => (viewer.isAdmin ? "already_admin" : "loading"),
  );
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

  useEffect(() => {
    if (viewer.isAdmin) {
      setBootstrapStatus("already_admin");
      return;
    }

    let cancelled = false;

    void fetch("/api/console/bootstrap-admin/status", {
      credentials: "include",
      cache: "no-store",
    })
      .then(async (response) => {
        if (cancelled) {
          return;
        }

        if (!response.ok) {
          setBootstrapStatus("unavailable");
          return;
        }

        const payload = await response.json() as {
          eligible?: boolean;
          reason?: BootstrapAdminStatus;
        };

        if (payload.eligible === true) {
          setBootstrapStatus("available");
          return;
        }

        setBootstrapStatus(payload.reason ?? "unavailable");
      })
      .catch(() => {
        if (!cancelled) {
          setBootstrapStatus("unavailable");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [viewer.isAdmin]);

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

  async function handleBootstrapAdmin() {
    const trimmedSecret = bootstrapSecret.trim();

    if (!trimmedSecret) {
      setBootstrapError("Bootstrap admin secret is required.");
      return;
    }

    setIsPromotingAdmin(true);
    setBootstrapError(null);

    try {
      const response = await fetch("/api/console/bootstrap-admin", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ secret: trimmedSecret }),
      });

      const payload = await response.json().catch(() => null) as { detail?: string } | null;

      if (!response.ok) {
        setBootstrapError(payload?.detail ?? "Unable to promote this account to administrator.");
        return;
      }

      router.replace("/admin");
      router.refresh();
    } catch {
      setBootstrapError("Unable to promote this account to administrator.");
    } finally {
      setIsPromotingAdmin(false);
    }
  }

  const bootstrapPanel = viewer.isAdmin ? null : bootstrapStatus === "available" ? (
    <section>
      <article className="surface-elevated rounded-[32px] px-6 py-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl">
            <p className="eyebrow">Bootstrap admin</p>
            <h2 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-white">
              Promote this logged-in account to administrator
            </h2>
            <p className="mt-3 text-sm leading-7 text-[var(--foreground-secondary)]">
              This is a one-time bootstrap path for the first admin. Sign in with the
              account you want to elevate, then enter the secret from
              <span className="font-mono text-white"> BOOTSTRAP_ADMIN_SECRET</span>.
            </p>
          </div>
          <span className="inline-flex items-center rounded-full border border-[var(--border-brand)] bg-[var(--brand-subtle)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--brand-bright)]">
            No admin exists yet
          </span>
        </div>

        <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
          <label className="space-y-2 text-sm text-[var(--foreground-secondary)]">
            <span className="block font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
              Bootstrap secret
            </span>
            <input
              type="password"
              value={bootstrapSecret}
              onChange={(event) => setBootstrapSecret(event.target.value)}
              placeholder="Enter bootstrap admin secret"
              className="h-12 w-full rounded-[14px] border border-[var(--border)] bg-[var(--surface)] px-4 text-white outline-none transition focus:border-[var(--brand)]"
              autoComplete="off"
            />
          </label>

          <div className="space-y-3">
            <button
              className="button-primary w-full"
              type="button"
              disabled={isPromotingAdmin}
              onClick={() => void handleBootstrapAdmin()}
            >
              {isPromotingAdmin ? "Promoting..." : "Promote current account"}
            </button>
            <p className="text-xs leading-6 text-[var(--foreground-tertiary)]">
              After success, this account will be redirected into the admin console.
            </p>
          </div>
        </div>

        {bootstrapError ? (
          <div className="mt-4 rounded-[18px] border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {bootstrapError}
          </div>
        ) : null}
      </article>
    </section>
  ) : bootstrapStatus === "loading" ? (
    <section>
      <article className="surface rounded-[28px] px-6 py-5">
        <p className="text-sm text-[var(--foreground-tertiary)]">
          Checking admin bootstrap status...
        </p>
      </article>
    </section>
  ) : bootstrapStatus === "disabled" ? (
    <section>
      <article className="surface rounded-[28px] px-6 py-5">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
          Admin bootstrap unavailable
        </p>
        <p className="mt-3 text-sm leading-7 text-[var(--foreground-secondary)]">
          Set <span className="font-mono text-white">BOOTSTRAP_ADMIN_SECRET</span> in
          <span className="font-mono text-white"> .env</span> if you want the first logged-in
          account to be able to self-promote to admin.
        </p>
      </article>
    </section>
  ) : bootstrapStatus === "managed_by_emails" ? (
    <section>
      <article className="surface rounded-[28px] px-6 py-5">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
          Admin access managed by email
        </p>
        <p className="mt-3 text-sm leading-7 text-[var(--foreground-secondary)]">
          This workspace is using <span className="font-mono text-white">ADMIN_CONSOLE_EMAILS</span>,
          so bootstrap promotion is intentionally disabled.
        </p>
      </article>
    </section>
  ) : bootstrapStatus === "admin_exists" ? (
    <section>
      <article className="surface rounded-[28px] px-6 py-5">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
          Administrator already exists
        </p>
        <p className="mt-3 text-sm leading-7 text-[var(--foreground-secondary)]">
          Bootstrap promotion is only available for the first administrator. This
          workspace already has an admin account, so access must be granted by an
          existing administrator instead.
        </p>
      </article>
    </section>
  ) : bootstrapStatus === "unavailable" ? (
    <section>
      <article className="surface rounded-[28px] px-6 py-5">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
          Admin bootstrap status unavailable
        </p>
        <p className="mt-3 text-sm leading-7 text-[var(--foreground-secondary)]">
          The console could not confirm bootstrap eligibility for this session.
          Refresh the page and verify the current environment configuration.
        </p>
      </article>
    </section>
  ) : null;

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
        <>
          {bootstrapPanel}
          <DashboardSkeleton />
        </>
      ) : error && !data ? (
        <>
          {bootstrapPanel}
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
        </>
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
          {bootstrapPanel}

          <section className="grid gap-6 xl:grid-cols-[1.12fr_0.88fr]">
            <article className="surface-elevated relative overflow-hidden rounded-[36px] px-6 py-6 sm:px-7">
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(103,232,249,0.16),transparent_34%),radial-gradient(circle_at_84%_18%,rgba(249,115,22,0.12),transparent_28%)]" />
              <div className="relative">
                <div className="flex flex-wrap gap-2">
                  {[
                    tierLabel,
                    billingRouteLabel,
                    supportLane,
                    rateLimitLabel,
                  ].map((item) => (
                    <span
                      key={item}
                      className="inline-flex items-center rounded-full border border-[var(--border)] bg-[rgba(255,255,255,0.04)] px-3 py-1.5 text-sm text-[var(--foreground-secondary)]"
                    >
                      {item}
                    </span>
                  ))}
                </div>

                <div className="mt-6 grid gap-6 xl:grid-cols-[0.92fr_1.08fr]">
                  <div>
                    <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--brand-bright)]">
                      Billing posture
                    </p>
                    <h2 className="mt-4 text-4xl font-semibold tracking-[-0.06em] text-white sm:text-5xl">
                      Keep usage, quota, and upgrade path visible in one workspace ledger.
                    </h2>
                    <p className="mt-4 max-w-xl text-base leading-8 text-[var(--foreground-secondary)]">
                      {currentPlanDescription} The plan surface should explain how
                      the workspace is allowed to grow, not force you to cross-check
                      Stripe, docs, and quota numbers in three separate places.
                    </p>

                    <div className="mt-6 grid gap-3 sm:grid-cols-2">
                      {[
                        {
                          label: "Billing window",
                          value: formatBillingPeriod(data.periodStart, data.periodEnd),
                        },
                        {
                          label: "Workspace status",
                          value: usesManualBilling ? "Managed account" : "Self-serve active",
                        },
                        {
                          label: "Requests this period",
                          value: formatNumber(data.requestCount),
                        },
                        {
                          label: "Active API keys",
                          value: formatNumber(data.apiKeysActive),
                        },
                      ].map((item) => (
                        <div
                          key={item.label}
                          className="rounded-[22px] border border-[var(--border)] bg-[rgba(255,255,255,0.03)] px-4 py-4"
                        >
                          <p className="text-sm text-[var(--foreground-secondary)]">{item.label}</p>
                          <p className="mt-2 text-xl font-semibold text-white">{item.value}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-4">
                    <CreditUsageBar
                      label="Current credit envelope"
                      used={data.creditsUsed}
                      limit={data.creditsLimit}
                      remaining={data.creditsRemaining}
                    />
                    <div className="grid gap-3 sm:grid-cols-3">
                      {currentPlanFeatures.map((feature) => (
                        <div
                          key={feature}
                          className="rounded-[20px] border border-[var(--border)] bg-[rgba(255,255,255,0.03)] px-4 py-4"
                        >
                          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--brand-bright)]">
                            Included
                          </span>
                          <p className="mt-3 text-sm leading-6 text-white">{feature}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </article>

            <div className="space-y-6">
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
                      label: "Rate policy",
                      value: rateLimitLabel,
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

              <article className="surface-elevated rounded-[32px] px-6 py-6">
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--foreground-tertiary)]">
                  Account note
                </p>
                <div className="mt-5 space-y-3">
                  {[
                    "Usage, API keys, and billing all resolve against one workspace envelope.",
                    "Stripe actions do not replace key rotation. Treat them as separate admin controls.",
                    "When the backend does not expose a concrete rate policy, the dashboard says so explicitly.",
                  ].map((item) => (
                    <div
                      key={item}
                      className="rounded-[20px] border border-[var(--border)] bg-[rgba(255,255,255,0.03)] px-4 py-4 text-sm leading-6 text-[var(--foreground-secondary)]"
                    >
                      {item}
                    </div>
                  ))}
                </div>
              </article>
            </div>
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
            </div>
          </section>
        </>
      ) : (
        <>
          {bootstrapPanel}
          <DashboardState
            action={
              <button className="button-primary" onClick={() => void refresh()} type="button">
                Retry request
              </button>
            }
            description="The dashboard API returned no plan payload."
            title="No plan data available"
          />
        </>
      )}
    </DashboardLayout>
  );
}
