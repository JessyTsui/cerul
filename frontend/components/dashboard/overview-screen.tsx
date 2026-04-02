"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { Route } from "next";
import Link from "next/link";
import { apiKeys, billing, getApiErrorMessage, type DashboardApiKey } from "@/lib/api";
import {
  formatNumber,
  getTierLabel,
  resolveDashboardBillingAction,
} from "@/lib/dashboard";
import { ApiKeyRow } from "./api-key-row";
import { CreateKeyDialog } from "./create-key-dialog";
import { DashboardLayout } from "./dashboard-layout";
import { DashboardNotice, DashboardSkeleton, DashboardState } from "./dashboard-state";
import { useMonthlyUsage } from "./use-monthly-usage";

function IconBolt({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24">
      <path d="M13.5 2.75 6.75 13.5h4.5l-.75 7.75 6.75-10.75h-4.5l.75-7.75Z" fill="currentColor" />
    </svg>
  );
}

function IconKey({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} />
    </svg>
  );
}

export function DashboardOverviewScreen() {
  const searchParams = useSearchParams();
  const { data, error, isLoading, refresh } = useMonthlyUsage();
  const [billingAction, setBillingAction] = useState<"checkout" | "portal" | null>(null);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [checkoutNotice, setCheckoutNotice] = useState<string | null>(null);
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

  useEffect(() => {
    const checkoutState = searchParams.get("checkout");
    const checkoutSessionId = searchParams.get("session_id");

    if (checkoutState !== "success") {
      return;
    }

    const clearCheckoutParams = () => {
      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.delete("checkout");
      nextUrl.searchParams.delete("session_id");
      nextUrl.searchParams.delete("type");
      const query = nextUrl.searchParams.toString();
      window.history.replaceState({}, "", `${nextUrl.pathname}${query ? `?${query}` : ""}`);
    };

    if (!checkoutSessionId) {
      setCheckoutNotice("Payment completed. Refresh the dashboard in a moment if the plan does not update immediately.");
      clearCheckoutParams();
      return;
    }

    let cancelled = false;
    void billing.reconcileCheckout(checkoutSessionId)
      .then(async (result) => {
        if (cancelled) {
          return;
        }
        await Promise.all([refresh(), loadKeys({ preserveData: true })]);
        setCheckoutNotice(
          result.mode === "subscription"
            ? "Pro subscription synced successfully."
            : "Payment synced successfully.",
        );
        clearCheckoutParams();
      })
      .catch((nextError) => {
        if (cancelled) {
          return;
        }
        setCheckoutNotice(getApiErrorMessage(nextError, "Payment completed, but dashboard sync still needs a manual refresh."));
      });

    return () => {
      cancelled = true;
    };
  }, [refresh, searchParams]);

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

  return (
    <DashboardLayout
      currentPath="/dashboard"
      title="Overview"
      description={data ? `${getTierLabel(data.tier)} plan` : undefined}
      actions={null}
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
      {checkoutNotice ? (
        <DashboardNotice title="Billing updated" description={checkoutNotice} tone="success" />
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

          {/* ── Balance + plan row ─────────────────────── */}
          <section className="grid gap-5 lg:grid-cols-[1fr_auto]">
            <div className="surface-elevated dashboard-card flex items-center gap-5 rounded-[28px] px-6 py-5">
              <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] border border-[var(--border-brand)] bg-[var(--brand-subtle)]">
                <IconBolt className="h-6 w-6 text-[var(--brand-bright)]" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-[var(--foreground-tertiary)]">Spendable credits</p>
                <p className="mt-0.5 text-3xl font-semibold tracking-[-0.04em] text-[var(--foreground)]">
                  {formatNumber(data.walletBalance)}
                </p>
                <p className="mt-1 text-xs text-[var(--foreground-tertiary)]">
                  Free today: {formatNumber(data.dailyFreeRemaining)} / {formatNumber(data.dailyFreeLimit)}
                </p>
              </div>
              <div className="hidden items-center gap-5 border-l border-[var(--border)] pl-5 sm:flex">
                <div>
                  <p className="text-xs text-[var(--foreground-tertiary)]">Used this period</p>
                  <p className="mt-0.5 text-lg font-semibold tabular-nums text-[var(--foreground)]">{formatNumber(data.creditsUsed)}</p>
                </div>
              </div>
            </div>

            <div className="surface-elevated dashboard-card flex items-center gap-4 rounded-[28px] px-6 py-5">
              <div>
                <p className="text-xs text-[var(--foreground-tertiary)]">{getTierLabel(data.tier)} plan</p>
                <p className="mt-0.5 text-lg font-semibold text-[var(--foreground)]">
                  {data.creditsLimit > 0 ? `${formatNumber(data.creditsLimit)} credits/mo` : "Pay as you go"}
                </p>
              </div>
              {availableBillingAction ? (
                <button
                  className="button-primary shrink-0"
                  disabled={billingAction !== null}
                  onClick={() => void handleBillingAction()}
                  type="button"
                >
                  {billingAction ? "Redirecting..." : availableBillingAction === "portal" ? "Manage" : "Upgrade"}
                </button>
              ) : null}
            </div>
          </section>

          {/* ── API Keys ──────────────────────────────── */}
          <section>
            <div className="mb-4 flex items-center gap-3">
              <IconKey className="h-5 w-5 text-[var(--foreground-tertiary)]" />
              <h2 className="flex-1 text-base font-semibold text-[var(--foreground)]">API Keys</h2>
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
              <div className="surface-elevated dashboard-card overflow-hidden rounded-[24px]">
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="border-b border-[var(--border)] bg-[var(--background-elevated)] text-[var(--foreground-secondary)]">
                      <tr>
                        <th className="px-5 py-3.5 font-medium">Name</th>
                        <th className="px-5 py-3.5 font-medium">Key</th>
                        <th className="px-5 py-3.5 font-medium">Created</th>
                        <th className="px-5 py-3.5 font-medium">Last used</th>
                        <th className="px-5 py-3.5 font-medium">Status</th>
                        <th className="px-5 py-3.5 text-right font-medium">Actions</th>
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

          {/* Quick links */}
          <section className="flex flex-wrap gap-3">
            <Link href={"/dashboard/usage" as Route} className="button-secondary">
              View usage analytics
            </Link>
            <Link href={"/dashboard/billing" as Route} className="button-secondary">
              Manage billing
            </Link>
          </section>
        </>
      ) : null}
    </DashboardLayout>
  );
}
