"use client";

import type { Route } from "next";
import Link from "next/link";
import { useEffect, useState } from "react";
import { apiKeys, billing, getApiErrorMessage, type DashboardApiKey } from "@/lib/api";
import {
  formatBillingPeriod,
  formatNumber,
  getTierLabel,
  resolveDashboardBillingAction,
} from "@/lib/dashboard";
import { useConsoleViewer } from "@/components/console/console-viewer-context";
import { DashboardLayout } from "./dashboard-layout";
import {
  DashboardNotice,
  DashboardSkeleton,
  DashboardState,
} from "./dashboard-state";
import { useMonthlyUsage } from "./use-monthly-usage";

const requestExamples = {
  curl: `curl "https://api.cerul.ai/v1/search" \\
  -H "Authorization: Bearer YOUR_CERUL_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "query": "analyze this demo scene",
    "search_type": "knowledge",
    "include_answer": true
  }'`,
  python: `import requests

response = requests.post(
    "https://api.cerul.ai/v1/search",
    headers={"Authorization": "Bearer YOUR_CERUL_API_KEY"},
    json={
        "query": "analyze this demo scene",
        "search_type": "knowledge",
        "include_answer": True,
    },
)
print(response.json())`,
  node: `const response = await fetch("https://api.cerul.ai/v1/search", {
  method: "POST",
  headers: {
    "Authorization": "Bearer YOUR_CERUL_API_KEY",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    query: "analyze this demo scene",
    search_type: "knowledge",
    include_answer: true,
  }),
});`,
} as const;

type ExampleTab = keyof typeof requestExamples;

export function DashboardOverviewScreen() {
  const viewer = useConsoleViewer();
  const { data, error, isLoading, refresh } = useMonthlyUsage();
  const [billingError, setBillingError] = useState<string | null>(null);
  const [billingAction, setBillingAction] = useState<"checkout" | "portal" | null>(
    null,
  );
  const [activeTab, setActiveTab] = useState<ExampleTab>("curl");
  const [keys, setKeys] = useState<DashboardApiKey[]>([]);
  const [keysError, setKeysError] = useState<string | null>(null);

  useEffect(() => {
    async function loadKeys() {
      try {
        const items = await apiKeys.list();
        setKeys(items.filter((item) => item.isActive));
      } catch (nextError) {
        setKeysError(getApiErrorMessage(nextError, "Failed to load API keys."));
      }
    }

    void loadKeys();
  }, []);

  const availableBillingAction = data
    ? resolveDashboardBillingAction(data.tier, data.hasStripeCustomer)
    : null;

  async function handleBillingAction() {
    if (!data || !availableBillingAction) {
      return;
    }

    setBillingAction(availableBillingAction);
    setBillingError(null);

    try {
      const redirect =
        availableBillingAction === "portal"
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

  const featuredKey = keys[0] ?? null;
  const viewerLabel = viewer.displayName?.split(/\s+/)[0] ?? "Workspace";

  return (
    <DashboardLayout
      currentPath="/dashboard"
      title="Workspace Overview"
      description="Run the first grounded query, keep quota visible, and move from setup into real usage without leaving the control surface."
      actions={
        <>
          <Link href="/docs/api-reference" className="button-secondary">
            API Reference
          </Link>
          <button
            className="button-primary"
            disabled={billingAction !== null || !data || availableBillingAction === null}
            onClick={() => void handleBillingAction()}
            type="button"
          >
            {billingAction === "checkout"
              ? "Redirecting..."
              : billingAction === "portal"
                ? "Opening portal..."
                : availableBillingAction === "portal"
                  ? "Manage Plan"
                  : "Upgrade Plan"}
          </button>
        </>
      }
    >
      {isLoading && !data ? (
        <DashboardSkeleton />
      ) : error && !data ? (
        <DashboardState
          title="Usage data could not be loaded"
          description={error}
          tone="error"
          action={
            <button className="button-primary" onClick={() => void refresh()} type="button">
              Retry request
            </button>
          }
        />
      ) : data ? (
        <>
          {error ? (
            <DashboardNotice
              title="Showing the last successful usage snapshot."
              description={error}
              tone="error"
            />
          ) : null}

          {billingError ? (
            <DashboardNotice
              title="Billing action failed"
              description={billingError}
              tone="error"
            />
          ) : null}

          {keysError ? (
            <DashboardNotice
              title="Key inventory is unavailable"
              description={keysError}
              tone="error"
            />
          ) : null}

          {!viewer.isAdmin ? (
            <section>
              <article className="surface rounded-[28px] px-6 py-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="max-w-2xl">
                    <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                      Admin access
                    </p>
                    <p className="mt-3 text-sm leading-7 text-[var(--foreground-secondary)]">
                      If you are bootstrapping the first administrator, open
                      settings to use the one-time promotion flow. If an admin
                      already exists, ask them to grant access instead.
                    </p>
                  </div>
                  <Link className="button-secondary" href="/dashboard/settings">
                    Open Settings
                  </Link>
                </div>
              </article>
            </section>
          ) : null}

          <section className="grid gap-6 xl:grid-cols-[1.18fr_0.82fr]">
            <article className="surface-elevated relative overflow-hidden rounded-[36px] px-6 py-6 sm:px-7">
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(103,232,249,0.16),transparent_34%),radial-gradient(circle_at_85%_18%,rgba(249,115,22,0.12),transparent_26%)]" />
              <div className="relative">
                <div className="flex flex-wrap gap-2">
                  {[
                    getTierLabel(data.tier),
                    formatBillingPeriod(data.periodStart, data.periodEnd),
                    `${formatNumber(keys.length)} active key${keys.length === 1 ? "" : "s"}`,
                    viewer.isAdmin ? "Admin-enabled workspace" : "Private workspace",
                  ].map((item) => (
                    <span
                      key={item}
                      className="inline-flex items-center rounded-full border border-[var(--border)] bg-[rgba(255,255,255,0.04)] px-3 py-1.5 text-sm text-[var(--foreground-secondary)]"
                    >
                      {item}
                    </span>
                  ))}
                </div>

                <div className="mt-6 grid gap-6 xl:grid-cols-[0.96fr_1.04fr]">
                  <div>
                    <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--brand-bright)]">
                      Launch board
                    </p>
                    <h2 className="mt-4 text-4xl font-semibold tracking-[-0.06em] text-white sm:text-5xl">
                      {viewerLabel}, ship the first grounded query.
                    </h2>
                    <p className="mt-4 max-w-xl text-base leading-8 text-[var(--foreground-secondary)]">
                      This workspace is already wired to billing, usage, and key
                      inventory. Use it like a workspace console: create a key,
                      run a real request, and keep the ledger visible while you
                      move from evaluation into production.
                    </p>

                    <div className="mt-6 grid gap-3 sm:grid-cols-3">
                      {[
                        {
                          title: featuredKey ? "Manage keys" : "Create first key",
                          body: featuredKey ? featuredKey.prefix : "No active key yet",
                          href: "/dashboard/keys" as Route,
                        },
                        {
                          title: "Inspect usage",
                          body: `${formatNumber(data.creditsUsed)} credits used`,
                          href: "/dashboard/usage" as Route,
                        },
                        {
                          title: "Read docs",
                          body: "Quickstart, API reference, examples",
                          href: "/docs/quickstart" as Route,
                        },
                      ].map((item) => (
                        <Link
                          key={item.title}
                          href={item.href}
                          className="rounded-[24px] border border-[var(--border)] bg-[rgba(255,255,255,0.04)] px-4 py-4 transition hover:border-[var(--border-brand)] hover:bg-[rgba(34,211,238,0.08)]"
                        >
                          <p className="text-sm text-[var(--foreground-tertiary)]">{item.title}</p>
                          <p className="mt-3 text-lg font-semibold text-white">{item.body}</p>
                        </Link>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-[28px] border border-[var(--border)] bg-[linear-gradient(180deg,rgba(7,12,22,0.9),rgba(7,10,18,0.98))]">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-4">
                      <div>
                        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                          First request
                        </p>
                        <p className="mt-2 text-lg font-semibold text-white">Use the live public contract</p>
                      </div>
                      <div className="flex gap-2">
                        {(["curl", "python", "node"] as ExampleTab[]).map((tab) => (
                          <button
                            key={tab}
                            type="button"
                            onClick={() => setActiveTab(tab)}
                            className={`rounded-full px-3 py-1.5 text-sm transition ${
                              activeTab === tab
                                ? "bg-[var(--brand-subtle)] text-[var(--brand-bright)]"
                                : "text-[var(--foreground-secondary)] hover:text-white"
                            }`}
                          >
                            {tab === "node" ? "Node.js" : tab === "curl" ? "cURL" : "Python"}
                          </button>
                        ))}
                      </div>
                    </div>
                    <pre className="overflow-x-auto px-4 py-5 font-mono text-sm leading-7 text-[#d7f7ff]">
                      <code>{requestExamples[activeTab]}</code>
                    </pre>
                  </div>
                </div>
              </div>
            </article>

            <div className="space-y-6">
              <article className="surface-elevated rounded-[32px] px-5 py-5">
                <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                  Workspace state
                </p>
                <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
                  {[
                    {
                      label: "Requests made",
                      value: formatNumber(data.requestCount),
                    },
                    {
                      label: "Credit headroom",
                      value: `${Math.max(0, 100 - Math.round((data.creditsUsed / Math.max(1, data.creditsLimit)) * 100))}%`,
                    },
                    {
                      label: "Current plan",
                      value: getTierLabel(data.tier),
                    },
                    {
                      label: "Billing control",
                      value: availableBillingAction === "portal"
                        ? "Self-serve portal"
                        : availableBillingAction === "checkout"
                          ? "Upgrade available"
                          : "Manual / stable",
                    },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className="rounded-[22px] border border-[var(--border)] bg-[rgba(255,255,255,0.03)] px-4 py-4"
                    >
                      <p className="text-sm text-[var(--foreground-secondary)]">{item.label}</p>
                      <p className="mt-2 text-2xl font-semibold text-white">{item.value}</p>
                    </div>
                  ))}
                </div>
              </article>

              <article className="surface-elevated rounded-[32px] px-5 py-5">
                <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                  Next moves
                </p>
                <div className="mt-5 space-y-3">
                  {[
                    {
                      step: "01",
                      title: featuredKey ? "Rotate or issue a scoped key" : "Create a scoped key",
                      description: featuredKey
                        ? "Treat the dashboard key inventory as your source of truth for environments."
                        : "The console only reveals raw secrets once, so create the key from the keys page before wiring any client.",
                      href: "/dashboard/keys" as Route,
                    },
                    {
                      step: "02",
                      title: "Move into usage visibility",
                      description: "Watch credits, request counts, and the billing window from the same private surface.",
                      href: "/dashboard/usage" as Route,
                    },
                    {
                      step: "03",
                      title: "Deepen the integration path",
                      description: "Use docs and examples to move from manual requests into a real app or skill.",
                      href: "/docs/api-reference" as Route,
                    },
                  ].map((item) => (
                    <Link
                      key={item.step}
                      href={item.href}
                      className="flex gap-4 rounded-[24px] border border-[var(--border)] bg-[rgba(255,255,255,0.03)] px-4 py-4 transition hover:border-[var(--border-brand)] hover:bg-[rgba(34,211,238,0.06)]"
                    >
                      <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--brand-bright)]">
                        {item.step}
                      </span>
                      <div>
                        <p className="text-lg font-semibold text-white">{item.title}</p>
                        <p className="mt-2 text-sm leading-7 text-[var(--foreground-secondary)]">
                          {item.description}
                        </p>
                      </div>
                    </Link>
                  ))}
                </div>
              </article>
            </div>
          </section>

          <section className="grid gap-6 xl:grid-cols-[1.08fr_0.92fr]">
            <article className="surface-elevated rounded-[32px] px-5 py-5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                    Docs runway
                  </p>
                  <h2 className="mt-2 text-3xl font-semibold text-white">Use the shortest path to working requests</h2>
                </div>
              </div>
              <div className="mt-5 grid gap-4 sm:grid-cols-3">
                {[
                  { title: "API Reference", href: "/docs/api-reference" as Route, body: "Exact request and response shapes." },
                  { title: "Quickstart", href: "/docs/quickstart" as Route, body: "Fastest route from zero to the first result." },
                  { title: "Search Guide", href: "/docs/search-api" as Route, body: "Ground transcript and visual evidence together." },
                ].map((item) => (
                  <Link
                    key={item.title}
                    href={item.href}
                    className="rounded-[24px] border border-[var(--border)] bg-[rgba(255,255,255,0.03)] px-5 py-5 transition hover:border-[var(--border-brand)] hover:bg-[rgba(34,211,238,0.06)]"
                  >
                    <p className="text-xl font-semibold text-white">{item.title}</p>
                    <p className="mt-3 text-sm leading-7 text-[var(--foreground-secondary)]">
                      {item.body}
                    </p>
                  </Link>
                ))}
              </div>
            </article>

            <article className="surface-elevated rounded-[32px] px-5 py-5">
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                Operational posture
              </p>
              <div className="mt-5 space-y-4">
                {[
                  {
                    title: "Featured key",
                    value: featuredKey?.prefix ?? "No active key yet",
                    note: featuredKey
                      ? "Use the keys page to rotate, revoke, or issue an environment-specific replacement."
                      : "Create a key before wiring any integration.",
                  },
                  {
                    title: "Billing window",
                    value: formatBillingPeriod(data.periodStart, data.periodEnd),
                    note: `${formatNumber(data.creditsRemaining)} credits remain in the current ledger.`,
                  },
                  {
                    title: "Upgrade state",
                    value: availableBillingAction === "portal"
                      ? "Plan can be managed from this console"
                      : availableBillingAction === "checkout"
                        ? "Upgrade path is available now"
                        : "No self-serve upgrade action",
                    note: "Billing state is read from the same private usage payload as the rest of the dashboard.",
                  },
                ].map((item) => (
                  <div
                    key={item.title}
                    className="rounded-[24px] border border-[var(--border)] bg-[rgba(255,255,255,0.03)] px-4 py-4"
                  >
                    <p className="text-sm text-[var(--foreground-secondary)]">{item.title}</p>
                    <p className="mt-2 text-xl font-semibold text-white">{item.value}</p>
                    <p className="mt-2 text-sm leading-7 text-[var(--foreground-tertiary)]">
                      {item.note}
                    </p>
                  </div>
                ))}
              </div>
            </article>
          </section>
        </>
      ) : (
        <DashboardState
          title="No usage data available"
          description="The dashboard API returned no usage payload."
          action={
            <button className="button-primary" onClick={() => void refresh()} type="button">
              Retry request
            </button>
          }
        />
      )}
    </DashboardLayout>
  );
}
