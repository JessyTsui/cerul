"use client";

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

          <section className="surface-elevated overflow-hidden rounded-[30px] px-6 py-6">
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

            <div className="mt-5 rounded-[20px] border border-[var(--border)] bg-white/76 px-5 py-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm font-medium text-[var(--foreground)]">API usage</p>
                <p className="text-sm text-[var(--foreground-secondary)]">
                  {formatNumber(data.creditsUsed)} / {formatNumber(data.creditsLimit)} credits used
                </p>
              </div>
              <div className="mt-3 h-2.5 rounded-full bg-[rgba(36,29,21,0.08)]">
                <div
                  className="h-full rounded-full bg-[linear-gradient(90deg,var(--brand),var(--accent))]"
                  style={{
                    width: `${Math.max(
                      4,
                      Math.min(100, (data.creditsUsed / Math.max(1, data.creditsLimit)) * 100),
                    )}%`,
                  }}
                />
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-[16px] border border-[var(--border)] bg-white/68 px-4 py-3">
                <p className="text-sm text-[var(--foreground-secondary)]">Requests</p>
                <p className="mt-1 text-2xl font-semibold text-[var(--foreground)]">
                  {formatNumber(data.requestCount)}
                </p>
              </div>
              <div className="rounded-[16px] border border-[var(--border)] bg-white/68 px-4 py-3">
                <p className="text-sm text-[var(--foreground-secondary)]">Spendable balance</p>
                <p className="mt-1 text-2xl font-semibold text-[var(--foreground)]">
                  {formatNumber(data.walletBalance)}
                </p>
              </div>
              <div className="rounded-[16px] border border-[var(--border)] bg-white/68 px-4 py-3">
                <p className="text-sm text-[var(--foreground-secondary)]">Active keys</p>
                <p className="mt-1 text-2xl font-semibold text-[var(--foreground)]">
                  {formatNumber(activeKeyCount)}
                </p>
              </div>
            </div>
          </section>
        </>
      ) : null}
    </DashboardLayout>
  );
}
