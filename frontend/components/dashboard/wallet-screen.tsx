"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  billing,
  getApiErrorMessage,
  type AutoRechargeSettings,
} from "@/lib/api";
import {
  formatNumber,
  getTierLabel,
  resolveDashboardBillingAction,
} from "@/lib/dashboard";
import { DashboardLayout } from "./dashboard-layout";
import { DashboardNotice, DashboardSkeleton, DashboardState } from "./dashboard-state";
import { useMonthlyUsage } from "./use-monthly-usage";

const TOPUP_UNIT_PRICE_USD = 0.008;
const MIN_TOPUP = 1000;
const MAX_TOPUP = 100000;

function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function DashboardWalletScreen() {
  const searchParams = useSearchParams();
  const { data, error, isLoading, refresh } = useMonthlyUsage();
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [billingAction, setBillingAction] = useState<"checkout" | "portal" | null>(null);
  const [checkoutNotice, setCheckoutNotice] = useState<string | null>(null);
  const [topupQuantity, setTopupQuantity] = useState(5000);
  const [isCreatingTopup, setIsCreatingTopup] = useState(false);
  const [autoRecharge, setAutoRecharge] = useState<AutoRechargeSettings>({
    enabled: false,
    threshold: 100,
    quantity: 1000,
  });
  const [showAutoRecharge, setShowAutoRecharge] = useState(false);

  const availableBillingAction = data
    ? resolveDashboardBillingAction(data.tier, data.hasStripeCustomer)
    : null;

  async function loadCatalog() {
    try {
      await billing.getCatalog();
      setCatalogError(null);
    } catch (nextError) {
      setCatalogError(getApiErrorMessage(nextError, "Failed to load billing catalog."));
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function bootstrapCatalog() {
      try {
        await billing.getCatalog();
        if (!cancelled) {
          setCatalogError(null);
        }
      } catch (nextError) {
        if (!cancelled) {
          setCatalogError(getApiErrorMessage(nextError, "Failed to load billing catalog."));
        }
      }
    }

    void bootstrapCatalog();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const checkoutState = searchParams.get("checkout");
    const checkoutSessionId = searchParams.get("session_id");

    if (checkoutState !== "success") {
      return;
    }

    let cancelled = false;
    const clearCheckoutParams = () => {
      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.delete("checkout");
      nextUrl.searchParams.delete("session_id");
      nextUrl.searchParams.delete("type");
      window.history.replaceState({}, "", nextUrl.pathname);
    };

    async function reconcileCheckout() {
      if (!checkoutSessionId) {
        if (!cancelled) {
          setCheckoutNotice("Payment completed.");
        }
        clearCheckoutParams();
        return;
      }

      try {
        await billing.reconcileCheckout(checkoutSessionId);
        if (cancelled) {
          return;
        }
        await Promise.all([refresh(), loadCatalog()]);
        if (!cancelled) {
          setCheckoutNotice("Credits added successfully.");
        }
      } catch {
        if (!cancelled) {
          setCheckoutNotice("Payment completed, but refresh may be needed.");
        }
      } finally {
        clearCheckoutParams();
      }
    }

    void reconcileCheckout();

    return () => {
      cancelled = true;
    };
  }, [refresh, searchParams]);

  useEffect(() => {
    if (data?.hasStripeCustomer) {
      billing.getAutoRecharge()
        .then(setAutoRecharge)
        .catch(() => {});
    }
  }, [data?.hasStripeCustomer]);

  async function handleCheckout() {
    setBillingAction("checkout");
    try {
      const redirect = await billing.createCheckout();
      window.location.assign(redirect.url);
    } catch {
      setBillingAction(null);
    }
  }

  async function handlePortal() {
    setBillingAction("portal");
    try {
      const redirect = await billing.createPortal();
      window.location.assign(redirect.url);
    } catch {
      setBillingAction(null);
    }
  }

  async function handleTopup() {
    setIsCreatingTopup(true);
    try {
      const redirect = await billing.createTopup(topupQuantity);
      window.location.assign(redirect.url);
    } catch {
      setIsCreatingTopup(false);
    }
  }

  async function handleSaveAutoRecharge() {
    try {
      await billing.updateAutoRecharge(autoRecharge);
      setShowAutoRecharge(false);
    } catch {}
  }

  if (isLoading && !data) {
    return (
      <DashboardLayout currentPath="/dashboard/billing" title="Wallet">
        <DashboardSkeleton />
      </DashboardLayout>
    );
  }

  if (error && !data) {
    return (
      <DashboardLayout currentPath="/dashboard/billing" title="Wallet">
        <DashboardState
          title="Unable to load wallet"
          description={error}
          tone="error"
          action={<button className="button-primary" onClick={() => void refresh()}>Retry</button>}
        />
      </DashboardLayout>
    );
  }

  if (!data) {
    return (
      <DashboardLayout currentPath="/dashboard/billing" title="Wallet">
        <DashboardState title="No data available" description="Wallet data is not available right now." />
      </DashboardLayout>
    );
  }

  const topupPrice = topupQuantity * TOPUP_UNIT_PRICE_USD;

  return (
    <DashboardLayout
      currentPath="/dashboard/billing"
      title="Wallet"
      description={`${getTierLabel(data.tier)} plan`}
    >
      {checkoutNotice && (
        <DashboardNotice title="Success" description={checkoutNotice} tone="success" />
      )}
      {catalogError && (
        <DashboardNotice title="Error" description={catalogError} tone="error" />
      )}

      {/* Balance Hero */}
      <section className="py-8">
        <p className="text-xs uppercase tracking-wider text-[var(--foreground-tertiary)]">
          Available balance
        </p>
        <div className="mt-2 flex items-baseline gap-3">
          <span className="text-6xl font-semibold tracking-tight text-[var(--foreground)]">
            {formatNumber(data.walletBalance)}
          </span>
          <span className="text-lg text-[var(--foreground-secondary)]">credits</span>
        </div>

        {/* Credit breakdown */}
        <div className="mt-4 flex flex-wrap gap-4 text-sm">
          {data.creditBreakdown.includedRemaining > 0 && (
            <div className="flex items-center gap-1.5">
              <div className="h-2 w-2 rounded-full bg-[var(--brand)]" />
              <span className="text-[var(--foreground-secondary)]">
                {formatNumber(data.creditBreakdown.includedRemaining)} included
              </span>
            </div>
          )}
          {data.creditBreakdown.paidRemaining > 0 && (
            <div className="flex items-center gap-1.5">
              <div className="h-2 w-2 rounded-full bg-[var(--accent)]" />
              <span className="text-[var(--foreground-secondary)]">
                {formatNumber(data.creditBreakdown.paidRemaining)} purchased
              </span>
            </div>
          )}
          {data.creditBreakdown.bonusRemaining > 0 && (
            <div className="flex items-center gap-1.5">
              <div className="h-2 w-2 rounded-full bg-[var(--success)]" />
              <span className="text-[var(--foreground-secondary)]">
                {formatNumber(data.creditBreakdown.bonusRemaining)} bonus
              </span>
            </div>
          )}
        </div>
      </section>

      <div className="h-px bg-[var(--border)]" />

      {/* Top Up Section */}
      <section className="py-6">
        <h2 className="text-sm font-medium text-[var(--foreground)]">Add credits</h2>

        {/* Slider */}
        <div className="mt-4">
          <input
            type="range"
            min={MIN_TOPUP}
            max={MAX_TOPUP}
            step={1000}
            value={topupQuantity}
            onChange={(e) => setTopupQuantity(Number(e.target.value))}
            className="h-1 w-full cursor-pointer appearance-none rounded-full bg-[var(--background-elevated)] accent-[var(--brand)]"
          />
          <div className="mt-3 flex items-center justify-between">
            <span className="text-2xl font-semibold text-[var(--foreground)]">
              {formatNumber(topupQuantity)}
            </span>
            <span className="text-lg text-[var(--foreground-secondary)]">
              {formatUsd(topupPrice)}
            </span>
          </div>
        </div>

        {/* Quick amounts */}
        <div className="mt-3 flex gap-2">
          {[1000, 5000, 10000, 50000].map((amount) => (
            <button
              key={amount}
              onClick={() => setTopupQuantity(amount)}
              className={`rounded-lg px-3 py-1.5 text-sm transition ${
                topupQuantity === amount
                  ? "bg-[var(--brand)] text-white"
                  : "bg-[var(--background-elevated)] text-[var(--foreground-secondary)] hover:text-[var(--foreground)]"
              }`}
            >
              {formatNumber(amount)}
            </button>
          ))}
        </div>

        <button
          onClick={() => void handleTopup()}
          disabled={isCreatingTopup}
          className="button-primary mt-5"
        >
          {isCreatingTopup ? "Processing..." : `Purchase ${formatNumber(topupQuantity)} credits`}
        </button>
      </section>

      <div className="h-px bg-[var(--border)]" />

      {/* Subscription */}
      <section className="py-6">
        <h2 className="text-sm font-medium text-[var(--foreground)]">Subscription</h2>

        <div className="mt-3 flex items-center justify-between rounded-xl border border-[var(--border)] p-4">
          <div>
            <p className="font-medium text-[var(--foreground)]">
              {getTierLabel(data.tier)}
            </p>
            <p className="text-xs text-[var(--foreground-tertiary)] mt-0.5">
              {data.tier === "pro" ? "5,000 credits/month" : "10 free searches/day"}
            </p>
          </div>
          {availableBillingAction === "checkout" ? (
            <button
              onClick={() => void handleCheckout()}
              disabled={billingAction === "checkout"}
              className="button-primary text-sm"
            >
              {billingAction === "checkout" ? "..." : "Upgrade"}
            </button>
          ) : availableBillingAction === "portal" ? (
            <button
              onClick={() => void handlePortal()}
              disabled={billingAction === "portal"}
              className="button-secondary text-sm"
            >
              {billingAction === "portal" ? "..." : "Manage"}
            </button>
          ) : (
            <span className="text-xs text-[var(--foreground-tertiary)]">Managed</span>
          )}
        </div>
      </section>

      {/* Auto-recharge */}
      {data.hasStripeCustomer && (
        <>
          <div className="h-px bg-[var(--border)]" />
          <section className="py-6">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-[var(--foreground)]">Auto-recharge</h2>
              <button
                onClick={() => setShowAutoRecharge(!showAutoRecharge)}
                className="text-xs text-[var(--foreground-tertiary)] hover:text-[var(--foreground)]"
              >
                {showAutoRecharge ? "Done" : "Configure"}
              </button>
            </div>

            {!showAutoRecharge ? (
              <p className="mt-2 text-sm text-[var(--foreground-secondary)]">
                {autoRecharge.enabled
                  ? `Auto-add ${formatNumber(autoRecharge.quantity)} credits when balance drops below ${formatNumber(autoRecharge.threshold)}`
                  : "Automatic credit refills are disabled"}
              </p>
            ) : (
              <div className="mt-3 space-y-3">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={autoRecharge.enabled}
                    onChange={(e) => setAutoRecharge((c) => ({ ...c, enabled: e.target.checked }))}
                    className="accent-[var(--brand)]"
                  />
                  <span className="text-sm text-[var(--foreground)]">Enable auto-recharge</span>
                </label>
                {autoRecharge.enabled && (
                  <>
                    <div>
                      <label className="text-xs text-[var(--foreground-tertiary)]">
                        When balance drops below
                      </label>
                      <input
                        type="number"
                        value={autoRecharge.threshold}
                        onChange={(e) => setAutoRecharge((c) => ({ ...c, threshold: Number(e.target.value) }))}
                        className="mt-1 block w-32 rounded-lg border border-[var(--border)] bg-white px-3 py-1.5 text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-[var(--foreground-tertiary)]">
                        Add credits
                      </label>
                      <input
                        type="number"
                        value={autoRecharge.quantity}
                        step={1000}
                        onChange={(e) => setAutoRecharge((c) => ({ ...c, quantity: Number(e.target.value) }))}
                        className="mt-1 block w-32 rounded-lg border border-[var(--border)] bg-white px-3 py-1.5 text-sm"
                      />
                    </div>
                    <button
                      onClick={() => void handleSaveAutoRecharge()}
                      className="button-secondary text-sm"
                    >
                      Save settings
                    </button>
                  </>
                )}
              </div>
            )}
          </section>
        </>
      )}
    </DashboardLayout>
  );
}
