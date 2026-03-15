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

  return (
    <DashboardLayout
      currentPath="/dashboard"
      title="Welcome to Cerul"
      description="Get started in 3 steps, generate credentials, make the first request, and move into the docs with the same private dashboard data powering the operator console."
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

          <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
            <div className="space-y-6">
              <div className="grid gap-6 lg:grid-cols-3">
                <article className="surface-elevated rounded-[28px] px-5 py-5">
                  <div className="flex items-center justify-between">
                    <span className="flex h-10 w-10 items-center justify-center rounded-[14px] bg-[var(--brand-subtle)] text-xl font-semibold text-[var(--brand-bright)]">
                      1
                    </span>
                    <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--foreground-tertiary)]">
                      API Key
                    </span>
                  </div>
                  <h2 className="mt-5 text-3xl font-semibold text-white">
                    Your API Key is Ready
                  </h2>
                  <div className="mt-5 rounded-[22px] border border-[var(--border)] bg-[rgba(255,255,255,0.03)] px-4 py-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-mono text-sm text-white">
                        {featuredKey?.prefix ?? "Create your first key"}
                      </p>
                      <Link href="/dashboard/keys" className="button-secondary min-w-[96px]">
                        {featuredKey ? "Manage" : "Create"}
                      </Link>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <span className="rounded-full bg-[var(--brand-subtle)] px-3 py-1 text-sm text-[var(--brand-bright)]">
                        Active
                      </span>
                      <span className="rounded-full bg-[rgba(255,255,255,0.05)] px-3 py-1 text-sm text-[var(--foreground-secondary)]">
                        {formatNumber(keys.length)} active key(s)
                      </span>
                    </div>
                    <p className="mt-4 text-sm leading-6 text-[var(--foreground-secondary)]">
                      {featuredKey
                        ? "Raw secrets are only shown at creation time. Use the keys page to rotate or generate a fresh key."
                        : "No active key yet. Create one now to test the public API surface."}
                    </p>
                  </div>
                </article>

                <article className="surface-elevated rounded-[28px] px-5 py-5 lg:col-span-2">
                  <div className="flex items-center justify-between">
                    <span className="flex h-10 w-10 items-center justify-center rounded-[14px] bg-[var(--brand-subtle)] text-xl font-semibold text-[var(--brand-bright)]">
                      2
                    </span>
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
                  <h2 className="mt-5 text-3xl font-semibold text-white">
                    Make Your First Request
                  </h2>
                  <div className="mt-5 overflow-hidden rounded-[22px] border border-[var(--border)] bg-[linear-gradient(180deg,rgba(7,12,22,0.9),rgba(7,10,18,0.98))]">
                    <div className="border-b border-[var(--border)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                      /v1/search
                    </div>
                    <pre className="overflow-x-auto px-4 py-5 font-mono text-sm leading-7 text-[#d7f7ff]">
                      <code>{requestExamples[activeTab]}</code>
                    </pre>
                  </div>
                </article>
              </div>

              <article className="surface-elevated rounded-[28px] px-5 py-5">
                <div className="flex items-center gap-4">
                  <span className="flex h-10 w-10 items-center justify-center rounded-[14px] bg-[var(--brand-subtle)] text-xl font-semibold text-[var(--brand-bright)]">
                    3
                  </span>
                  <div>
                    <h2 className="text-3xl font-semibold text-white">Explore the Docs</h2>
                    <p className="mt-1 text-sm text-[var(--foreground-secondary)]">
                      Move from first request to deeper API and usage references.
                    </p>
                  </div>
                </div>
                <div className="mt-5 grid gap-4 sm:grid-cols-3">
                  {[
                    { title: "API Reference", href: "/docs/api-reference" as Route },
                    { title: "Getting Started Guide", href: "/docs/quickstart" as Route },
                    { title: "Integration Tutorials", href: "/docs/search-api" as Route },
                  ].map((item) => (
                    <Link
                      key={item.title}
                      href={item.href}
                      className="rounded-[22px] border border-[var(--border-brand)] bg-[var(--brand-subtle)] px-5 py-5 text-2xl font-semibold text-white transition hover:-translate-y-1"
                    >
                      {item.title}
                    </Link>
                  ))}
                </div>
              </article>

              <article className="surface-elevated rounded-[28px] px-5 py-5">
                <h2 className="text-3xl font-semibold text-white">What&apos;s Next?</h2>
                <div className="mt-5 grid gap-4 sm:grid-cols-3">
                  {[
                    {
                      title: "Upload First Video",
                      description: "Prepare ingestion and indexing workflows for your own source material.",
                      href: "/docs/architecture" as Route,
                    },
                    {
                      title: "Try Knowledge Search",
                      description: "Query transcript + visual evidence in one API request.",
                      href: "/docs/search-api" as Route,
                    },
                    {
                      title: "Set Up Webhooks",
                      description: "Prepare follow-up automations for ingestion or retrieval events.",
                      href: "/docs/api-reference" as Route,
                    },
                  ].map((item) => (
                    <Link
                      key={item.title}
                      href={item.href}
                      className="rounded-[24px] border border-[var(--border)] bg-[rgba(255,255,255,0.03)] px-5 py-5 transition hover:border-[var(--border-brand)] hover:bg-[rgba(34,211,238,0.06)]"
                    >
                      <h3 className="text-2xl font-semibold text-white">{item.title}</h3>
                      <p className="mt-3 text-sm leading-7 text-[var(--foreground-secondary)]">
                        {item.description}
                      </p>
                    </Link>
                  ))}
                </div>
              </article>
            </div>

            <aside className="surface-elevated rounded-[28px] px-5 py-5">
              <h2 className="text-3xl font-semibold text-white">Quick Stats</h2>
              <div className="mt-5 space-y-4">
                {[
                  {
                    label: "Requests made",
                    value: formatNumber(data.requestCount),
                  },
                  {
                    label: "Quota available",
                    value: `${Math.max(0, 100 - Math.round((data.creditsUsed / Math.max(1, data.creditsLimit)) * 100))}%`,
                  },
                  {
                    label: "Account status",
                    value: "Active",
                  },
                  {
                    label: "Current plan",
                    value: getTierLabel(data.tier),
                  },
                  {
                    label: "Billing window",
                    value: formatBillingPeriod(data.periodStart, data.periodEnd),
                  },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="rounded-[20px] border border-[var(--border)] bg-[rgba(255,255,255,0.03)] px-4 py-4"
                  >
                    <p className="text-sm text-[var(--foreground-secondary)]">{item.label}</p>
                    <p className="mt-2 text-2xl font-semibold text-white">{item.value}</p>
                  </div>
                ))}
              </div>
            </aside>
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
