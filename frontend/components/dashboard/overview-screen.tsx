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
import { ApiKeyRow } from "./api-key-row";
import { CreateKeyDialog } from "./create-key-dialog";
import { DashboardLayout } from "./dashboard-layout";
import { DashboardNotice, DashboardSkeleton, DashboardState } from "./dashboard-state";
import { useMonthlyUsage } from "./use-monthly-usage";

export function DashboardOverviewScreen() {
  const { data, error, isLoading, refresh } = useMonthlyUsage();
  const [billingAction, setBillingAction] = useState<"checkout" | "portal" | null>(null);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [keys, setKeys] = useState<DashboardApiKey[]>([]);
  const [keysLoading, setKeysLoading] = useState(true);
  const [keysError, setKeysError] = useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [pendingKeyId, setPendingKeyId] = useState<string | null>(null);

  async function loadKeys(options?: { preserveData?: boolean }) {
    if (!options?.preserveData) setKeysLoading(true);
    setKeysError(null);
    try {
      const items = await apiKeys.list();
      setKeys([...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    } catch (nextError) {
      setKeysError(getApiErrorMessage(nextError, "Failed to load API keys."));
    } finally {
      setKeysLoading(false);
    }
  }

  useEffect(() => {
    void loadKeys();
  }, []);

  async function handleRevoke(apiKey: DashboardApiKey) {
    if (!apiKey.isActive) return;
    const confirmed = window.confirm(
      `Revoke "${apiKey.name}"? Existing integrations using this key will stop working immediately.`,
    );
    if (!confirmed) return;
    setPendingKeyId(apiKey.id);
    setKeysError(null);
    try {
      await apiKeys.revoke(apiKey.id);
      await Promise.all([loadKeys({ preserveData: true }), refresh()]);
    } catch (nextError) {
      setKeysError(getApiErrorMessage(nextError, "Failed to revoke API key."));
    } finally {
      setPendingKeyId(null);
    }
  }

  const availableBillingAction = data
    ? resolveDashboardBillingAction(data.tier, data.hasStripeCustomer)
    : null;

  async function handleBillingAction() {
    if (!data || !availableBillingAction) return;
    setBillingAction(availableBillingAction);
    setBillingError(null);
    try {
      const redirect =
        availableBillingAction === "portal"
          ? await billing.createPortal()
          : await billing.createCheckout();
      window.location.assign(redirect.url);
    } catch (nextError) {
      setBillingError(getApiErrorMessage(nextError, "Failed to start billing flow."));
      setBillingAction(null);
    }
  }

  const activeKeyCount = keys.filter((item) => item.isActive).length;

  return (
    <DashboardLayout
      currentPath="/dashboard"
      title="Overview"
      description={
        data
          ? `${getTierLabel(data.tier)} plan · ${formatBillingPeriod(data.periodStart, data.periodEnd)}`
          : "Review plan posture, key inventory, and the surfaces your team will touch most often."
      }
      actions={
        data ? (
          <button
            className="button-secondary"
            disabled={isLoading || keysLoading}
            onClick={() => {
              void Promise.all([refresh(), loadKeys({ preserveData: true })]);
            }}
            type="button"
          >
            Refresh
          </button>
        ) : null
      }
    >
      <CreateKeyDialog
        isOpen={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        onCreated={async () => {
          await Promise.all([loadKeys({ preserveData: true }), refresh()]);
        }}
      />

      {billingError ? (
        <DashboardNotice title="Billing action failed" description={billingError} tone="error" />
      ) : null}

      {isLoading && !data ? (
        <DashboardSkeleton />
      ) : error && !data ? (
        <DashboardState
          title="Usage data could not be loaded"
          description={error}
          tone="error"
          action={
            <button className="button-primary" onClick={() => void refresh()} type="button">
              Retry
            </button>
          }
        />
      ) : data ? (
        <>
          {error ? (
            <DashboardNotice
              title="Showing last successful snapshot."
              description={error}
              tone="error"
            />
          ) : null}

          <section className="rounded-[20px] border border-[var(--border)] bg-white/68 px-4 py-3 text-sm text-[var(--foreground-secondary)] shadow-[0_10px_24px_rgba(36,29,21,0.05)]">
            Unified search is now the default retrieval surface. Summary, speech, and visual
            evidence all come back from the same request.
          </section>

          <section className="surface-elevated relative overflow-hidden rounded-[34px] px-6 py-6 sm:px-7">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(136,165,242,0.2),transparent_24%),radial-gradient(circle_at_82%_84%,rgba(212,156,105,0.16),transparent_28%)]" />
            <div className="relative grid gap-6 xl:grid-cols-[1.16fr_0.84fr]">
              <div>
                <span className="inline-flex rounded-full border border-[var(--border)] bg-white/78 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--foreground-tertiary)]">
                  Current plan
                </span>
                <h2 className="mt-4 text-5xl font-semibold tracking-[-0.06em] text-[var(--foreground)]">
                  {getTierLabel(data.tier)}
                </h2>
                <p className="mt-3 max-w-2xl text-base leading-8 text-[var(--foreground-secondary)]">
                  Keep one clean workspace surface for API keys, billing posture, and the public
                  routes your integrations depend on most.
                </p>

                <div className="mt-6 rounded-[26px] border border-[var(--border)] bg-white/76 px-5 py-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <p className="text-sm font-medium text-[var(--foreground)]">API usage</p>
                      <p className="mt-1 text-sm text-[var(--foreground-secondary)]">
                        Monthly plan drawdown
                      </p>
                    </div>
                    <p className="text-sm text-[var(--foreground-secondary)]">
                      {formatNumber(data.creditsRemaining)} / {formatNumber(data.creditsLimit)}{" "}
                      credits remaining
                    </p>
                  </div>
                  <div className="mt-4 h-3 rounded-full bg-[rgba(36,29,21,0.08)]">
                    <div
                      className="h-full rounded-full bg-[linear-gradient(90deg,var(--brand),var(--accent))]"
                      style={{
                        width: `${Math.max(
                          6,
                          Math.min(100, (data.creditsUsed / Math.max(1, data.creditsLimit)) * 100),
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                {[
                  { label: "Requests", value: formatNumber(data.requestCount), note: "This billing period" },
                  {
                    label: "Credits remaining",
                    value: formatNumber(data.creditsRemaining),
                    note: `of ${formatNumber(data.creditsLimit)}`,
                  },
                  { label: "Plan access", value: billingRouteLabel(availableBillingAction), note: "Billing posture" },
                  {
                    label: "Active keys",
                    value: formatNumber(activeKeyCount),
                    note: "Live credentials",
                  },
                ].map((item) => (
                  <article
                    key={item.label}
                    className="rounded-[22px] border border-[var(--border)] bg-white/76 px-5 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]"
                  >
                    <p className="text-sm text-[var(--foreground-secondary)]">{item.label}</p>
                    <p className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-[var(--foreground)]">
                      {item.value}
                    </p>
                    <p className="mt-2 text-xs text-[var(--foreground-tertiary)]">{item.note}</p>
                  </article>
                ))}
              </div>
            </div>

            <div className="relative mt-6 flex flex-wrap gap-3">
              {availableBillingAction ? (
                <button
                  className="button-primary"
                  disabled={billingAction !== null}
                  onClick={() => void handleBillingAction()}
                  type="button"
                >
                  {billingAction === "checkout"
                    ? "Redirecting..."
                    : billingAction === "portal"
                      ? "Opening..."
                      : availableBillingAction === "portal"
                        ? "Manage Plan"
                        : "Upgrade Plan"}
                </button>
              ) : null}
              <Link href="/search" className="button-secondary">
                Open playground
              </Link>
              <Link href="/docs/search-api" className="button-secondary">
                Search API docs
              </Link>
            </div>
          </section>

          <section>
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-[var(--foreground)]">API Keys</h2>
                <p className="mt-1 text-sm text-[var(--foreground-secondary)]">
                  Keep credentials close to the top of the console, because they are the first real integration surface.
                </p>
              </div>
              <button type="button" className="button-primary" onClick={() => setIsDialogOpen(true)}>
                + New Key
              </button>
            </div>

            {keysError && keys.length > 0 ? (
              <DashboardNotice
                title="Key list could not be refreshed."
                description={keysError}
                tone="error"
              />
            ) : null}

            {keysLoading && keys.length === 0 ? (
              <DashboardSkeleton />
            ) : keysError && keys.length === 0 ? (
              <DashboardState
                title="API keys could not be loaded"
                description={keysError}
                tone="error"
                action={
                  <button className="button-primary" onClick={() => void loadKeys()} type="button">
                    Retry
                  </button>
                }
              />
            ) : keys.length === 0 ? (
              <DashboardState
                title="No API keys yet"
                description="Create your first key to start authenticating requests against the public API."
                action={
                  <button className="button-primary" onClick={() => setIsDialogOpen(true)} type="button">
                    Create your first key
                  </button>
                }
              />
            ) : (
              <div className="surface-elevated overflow-hidden rounded-[30px]">
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="border-b border-[var(--border)] bg-[var(--background-elevated)] text-[var(--foreground-secondary)]">
                      <tr>
                        <th className="px-5 py-4 font-medium">Name</th>
                        <th className="px-5 py-4 font-medium">Key</th>
                        <th className="px-5 py-4 font-medium">Created</th>
                        <th className="px-5 py-4 font-medium">Last used</th>
                        <th className="px-5 py-4 font-medium">Status</th>
                        <th className="px-5 py-4 text-right font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {keys.map((apiKey) => (
                        <ApiKeyRow
                          key={apiKey.id}
                          apiKey={apiKey}
                          isPending={pendingKeyId === apiKey.id}
                          onRevoke={handleRevoke}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>

          <section className="grid gap-5 xl:grid-cols-[1.08fr_0.92fr]">
            <article className="surface-elevated rounded-[30px] px-6 py-6">
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--foreground-tertiary)]">
                Defaults
              </p>
              <h2 className="mt-3 text-2xl font-semibold text-[var(--foreground)]">
                Keep the console simple enough to scan in one pass
              </h2>
              <div className="mt-5 grid gap-3">
                {[
                  "Issue one key per environment or automation instead of sharing credentials across every surface.",
                  "Check /v1/usage before scaling traffic so credit burn stays visible to the team.",
                  "Use the public docs as the source of truth for request shapes, not the UI alone.",
                ].map((item) => (
                  <div
                    key={item}
                    className="rounded-[20px] border border-[var(--border)] bg-[var(--background-elevated)] px-4 py-4 text-sm leading-7 text-[var(--foreground-secondary)]"
                  >
                    {item}
                  </div>
                ))}
              </div>
            </article>

            <article className="surface-elevated rounded-[30px] px-6 py-6">
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--foreground-tertiary)]">
                Fast paths
              </p>
              <h2 className="mt-3 text-2xl font-semibold text-[var(--foreground)]">
                Open the next surface directly
              </h2>
              <div className="mt-5 space-y-3">
                {[
                  {
                    href: "/docs/quickstart",
                    title: "Quickstart guide",
                    description: "First request, authentication, and the tracked Cerul result URL shape.",
                  },
                  {
                    href: "/docs/api-reference",
                    title: "API reference",
                    description: "Stable public routes for search, index, and usage.",
                  },
                  {
                    href: "/search",
                    title: "Playground",
                    description: "Test one query and inspect both code and response in the same view.",
                  },
                ].map((item) => (
                  <Link
                    key={item.href}
                    href={item.href as Route}
                    className="block rounded-[20px] border border-[var(--border)] bg-[var(--background-elevated)] px-4 py-4 transition hover:border-[var(--border-strong)] hover:bg-white"
                  >
                    <p className="text-base font-semibold text-[var(--foreground)]">{item.title}</p>
                    <p className="mt-2 text-sm leading-6 text-[var(--foreground-secondary)]">
                      {item.description}
                    </p>
                  </Link>
                ))}
              </div>
            </article>
          </section>
        </>
      ) : null}
    </DashboardLayout>
  );
}

function billingRouteLabel(action: "checkout" | "portal" | null): string {
  if (action === "portal") return "Self-serve";
  if (action === "checkout") return "Upgrade ready";
  return "Managed";
}
