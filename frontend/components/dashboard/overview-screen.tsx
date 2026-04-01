"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
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
      description={
        data
          ? `${getTierLabel(data.tier)} plan · ${formatBillingPeriod(data.periodStart, data.periodEnd)}`
          : undefined
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

          <section>
            <div className="mb-4 flex items-center justify-between gap-4">
              <h2 className="text-base font-semibold text-[var(--foreground)]">API Keys</h2>
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
              <div className="surface-elevated dashboard-card overflow-hidden rounded-[30px]">
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

          <section className="surface-elevated dashboard-card overflow-hidden rounded-[30px] px-6 py-6">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--foreground-tertiary)]">
                  Current plan
                </p>
                <p className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-[var(--foreground)]">
                  {getTierLabel(data.tier)}
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
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
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <div className="rounded-full border border-[rgba(97,125,233,0.16)] bg-[rgba(97,125,233,0.08)] px-4 py-3">
                <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-[rgb(72,98,198)]">
                  Free today
                </p>
                <p className="mt-1 text-base font-semibold text-[var(--foreground)]">
                  {formatNumber(data.dailyFreeRemaining)} / {formatNumber(data.dailyFreeLimit)}
                </p>
              </div>
              <div className="rounded-full border border-[var(--border)] bg-white/72 px-4 py-3">
                <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                  Billing window
                </p>
                <p className="mt-1 text-sm font-medium text-[var(--foreground)]">
                  {formatBillingPeriod(data.periodStart, data.periodEnd)}
                </p>
              </div>
            </div>

            <div className="mt-5 rounded-[20px] border border-[var(--border)] bg-white/76 px-5 py-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm font-medium text-[var(--foreground)]">Included credits this period</p>
                <p className="text-sm text-[var(--foreground-secondary)]">
                  0 / {formatNumber(data.creditsLimit)} included credits used
                </p>
              </div>
              {data.creditBreakdown.paidRemaining + data.creditBreakdown.bonusRemaining > 0 ? (
                <p className="mt-2 text-xs text-[var(--foreground-tertiary)]">
                  Spendable balance also includes {formatNumber(data.creditBreakdown.paidRemaining + data.creditBreakdown.bonusRemaining)} bonus or purchased credits.
                </p>
              ) : null}
              <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-[rgba(36,29,21,0.08)]">
                <div
                  className="animate-progress-fill h-full rounded-full bg-[linear-gradient(90deg,var(--brand),var(--accent))]"
                  style={{
                    width: `${Math.max(
                      4,
                      Math.min(100, (data.creditsUsed / Math.max(1, data.creditsLimit)) * 100),
                    )}%`,
                  }}
                />
              </div>
            </div>

            {/* Key stats */}
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="dashboard-card rounded-[16px] border border-[var(--border)] bg-white/68 px-4 py-3">
                <p className="text-sm text-[var(--foreground-secondary)]">Credits remaining</p>
                <p className="mt-1 text-2xl font-semibold text-[var(--foreground)]">
                  {formatNumber(data.walletBalance)}
                </p>
              </div>
              <div className="dashboard-card rounded-[16px] border border-[var(--border)] bg-white/68 px-4 py-3">
                <p className="text-sm text-[var(--foreground-secondary)]">Credits used</p>
                <p className="mt-1 text-2xl font-semibold text-[var(--foreground)]">
                  {formatNumber(data.creditsUsed)}
                </p>
                <p className="mt-1 text-xs text-[var(--foreground-tertiary)]">
                  This billing period
                </p>
              </div>
              <div className="dashboard-card rounded-[16px] border border-[var(--border)] bg-white/68 px-4 py-3">
                <p className="text-sm text-[var(--foreground-secondary)]">Active keys</p>
                <p className="mt-1 text-2xl font-semibold text-[var(--foreground)]">
                  {formatNumber(data.apiKeysActive)}
                </p>
              </div>
            </div>
          </section>
        </>
      ) : null}
    </DashboardLayout>
  );
}
