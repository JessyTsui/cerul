"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  billing,
  getApiErrorMessage,
  type AutoRechargeSettings,
  type BillingCatalog,
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
const QUICK_TOPUP_OPTIONS = [1000, 2500, 5000, 10000] as const;

function normalizeCreditQuantity(value: number): number {
  if (!Number.isFinite(value)) return 1000;
  return Math.max(Math.round(value / 100) * 100, 1000);
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function IconBolt({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24">
      <path d="M13.5 2.75 6.75 13.5h4.5l-.75 7.75 6.75-10.75h-4.5l.75-7.75Z" fill="currentColor" />
    </svg>
  );
}

export function DashboardBillingScreen() {
  const searchParams = useSearchParams();
  const { data, error, isLoading, refresh } = useMonthlyUsage();
  const [catalog, setCatalog] = useState<BillingCatalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [billingAction, setBillingAction] = useState<"checkout" | "portal" | "topup" | null>(null);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [checkoutNotice, setCheckoutNotice] = useState<string | null>(null);
  const [topupQuantity, setTopupQuantity] = useState(1000);
  const [isCreatingTopup, setIsCreatingTopup] = useState(false);
  const [autoRecharge, setAutoRecharge] = useState<AutoRechargeSettings>({
    enabled: false,
    threshold: 100,
    quantity: 1000,
  });
  const [autoRechargeError, setAutoRechargeError] = useState<string | null>(null);
  const [autoRechargeSuccess, setAutoRechargeSuccess] = useState<string | null>(null);
  const [isAutoRechargeLoading, setIsAutoRechargeLoading] = useState(false);
  const [isSavingAutoRecharge, setIsSavingAutoRecharge] = useState(false);

  const availableBillingAction = data
    ? resolveDashboardBillingAction(data.tier, data.hasStripeCustomer)
    : null;
  const canUpgrade = availableBillingAction === "checkout";
  const canManageSubscription = availableBillingAction === "portal";
  const usesManualBilling = data !== null && availableBillingAction === null && data.tier.toLowerCase() !== "free";
  const normalizedTopupQuantity = normalizeCreditQuantity(topupQuantity);
  const topupPrice = normalizedTopupQuantity * TOPUP_UNIT_PRICE_USD;

  async function loadCatalog() {
    setCatalogError(null);
    try {
      setCatalog(await billing.getCatalog());
    } catch (nextError) {
      setCatalogError(getApiErrorMessage(nextError, "Failed to load billing catalog."));
    }
  }

  useEffect(() => { void loadCatalog(); }, []);

  useEffect(() => {
    const checkoutState = searchParams.get("checkout");
    const checkoutSessionId = searchParams.get("session_id");
    if (checkoutState !== "success") return;

    const clearCheckoutParams = () => {
      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.delete("checkout");
      nextUrl.searchParams.delete("session_id");
      nextUrl.searchParams.delete("type");
      const query = nextUrl.searchParams.toString();
      window.history.replaceState({}, "", `${nextUrl.pathname}${query ? `?${query}` : ""}`);
    };

    if (!checkoutSessionId) {
      setCheckoutNotice("Payment completed. Refresh the page in a moment if your wallet does not update immediately.");
      clearCheckoutParams();
      return;
    }

    let cancelled = false;
    void billing.reconcileCheckout(checkoutSessionId)
      .then(async (result) => {
        if (cancelled) return;
        await Promise.all([refresh(), loadCatalog()]);
        setCheckoutNotice(
          result.mode === "payment"
            ? `Credits added successfully${result.creditsGranted > 0 ? `: ${formatNumber(result.creditsGranted)} credits.` : "."}`
            : "Billing synced successfully.",
        );
        clearCheckoutParams();
      })
      .catch((nextError) => {
        if (!cancelled) setCheckoutNotice(getApiErrorMessage(nextError, "Payment completed, but settings still need a manual refresh."));
      });
    return () => { cancelled = true; };
  }, [refresh, searchParams]);

  useEffect(() => {
    if (!data?.hasStripeCustomer) {
      setAutoRecharge({ enabled: false, threshold: 100, quantity: 1000 });
      setAutoRechargeError(null);
      setAutoRechargeSuccess(null);
      setIsAutoRechargeLoading(false);
      return;
    }
    let cancelled = false;
    setIsAutoRechargeLoading(true);
    setAutoRechargeError(null);
    void billing.getAutoRecharge()
      .then((s) => { if (!cancelled) setAutoRecharge(s); })
      .catch((e) => { if (!cancelled) setAutoRechargeError(getApiErrorMessage(e, "Failed to load auto-recharge settings.")); })
      .finally(() => { if (!cancelled) setIsAutoRechargeLoading(false); });
    return () => { cancelled = true; };
  }, [data?.hasStripeCustomer]);

  async function handleCheckout() {
    setBillingAction("checkout"); setBillingError(null);
    try { window.location.assign((await billing.createCheckout()).url); }
    catch (e) { setBillingError(getApiErrorMessage(e, "Failed to start checkout.")); setBillingAction(null); }
  }

  async function handlePortal() {
    setBillingAction("portal"); setBillingError(null);
    try { window.location.assign((await billing.createPortal()).url); }
    catch (e) { setBillingError(getApiErrorMessage(e, "Failed to open billing portal.")); setBillingAction(null); }
  }

  async function handleTopup() {
    setIsCreatingTopup(true); setBillingError(null);
    try { window.location.assign((await billing.createTopup(normalizedTopupQuantity)).url); }
    catch (e) { setBillingError(getApiErrorMessage(e, "Failed to start credit purchase.")); setIsCreatingTopup(false); }
  }

  async function handleSaveAutoRecharge() {
    setIsSavingAutoRecharge(true); setAutoRechargeError(null); setAutoRechargeSuccess(null);
    try {
      const next = await billing.updateAutoRecharge({
        enabled: autoRecharge.enabled,
        threshold: Math.max(Math.round(autoRecharge.threshold), 0),
        quantity: normalizeCreditQuantity(autoRecharge.quantity),
      });
      setAutoRecharge(next);
      setAutoRechargeSuccess("Auto-recharge settings saved.");
    } catch (e) {
      setAutoRechargeError(getApiErrorMessage(e, "Failed to save auto-recharge settings."));
    } finally { setIsSavingAutoRecharge(false); }
  }

  if (isLoading && !data) {
    return (<DashboardLayout currentPath="/dashboard/billing" title="Billing" description="Manage credits and subscription."><DashboardSkeleton /></DashboardLayout>);
  }
  if (error && !data) {
    return (<DashboardLayout currentPath="/dashboard/billing" title="Billing" description="Manage credits and subscription."><DashboardState title="Billing data could not be loaded" description={error} tone="error" action={<button className="button-primary" onClick={() => void refresh()} type="button">Retry</button>} /></DashboardLayout>);
  }
  if (!data) {
    return (<DashboardLayout currentPath="/dashboard/billing" title="Billing" description="Manage credits and subscription."><DashboardState title="No billing data available" description="The dashboard API returned no billing payload." /></DashboardLayout>);
  }

  return (
    <DashboardLayout
      currentPath="/dashboard/billing"
      title="Billing"
      description={`${getTierLabel(data.tier)} plan`}
      actions={null}
    >
      {error && <DashboardNotice title="Showing last successful snapshot." description={error} tone="error" />}
      {billingError && <DashboardNotice title="Billing action failed" description={billingError} tone="error" />}
      {checkoutNotice && <DashboardNotice title="Billing updated" description={checkoutNotice} tone="success" />}
      {catalogError && <DashboardNotice title="Catalog load failed" description={catalogError} tone="error" />}

      {/* ── Plan + balance ────────────────────────────── */}
      <article className="surface-elevated dashboard-card rounded-[28px] px-6 py-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] border border-[var(--border-brand)] bg-[var(--brand-subtle)]">
              <IconBolt className="h-5 w-5 text-[var(--brand-bright)]" />
            </span>
            <div>
              <p className="text-sm text-[var(--foreground-secondary)]">{getTierLabel(data.tier)} plan</p>
              <p className="text-2xl font-semibold tracking-[-0.04em] text-[var(--foreground)]">
                {formatNumber(data.walletBalance + data.dailyFreeRemaining)} <span className="text-base font-normal text-[var(--foreground-tertiary)]">credits available</span>
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            {canUpgrade && (
              <button className="button-primary" disabled={billingAction !== null || data.billingHold} onClick={() => void handleCheckout()} type="button">
                {billingAction === "checkout" ? "Redirecting..." : "Upgrade to Pro"}
              </button>
            )}
            {canManageSubscription && (
              <button className="button-secondary" disabled={billingAction !== null} onClick={() => void handlePortal()} type="button">
                {billingAction === "portal" ? "Opening..." : "Manage subscription"}
              </button>
            )}
            {usesManualBilling && (
              <span className="inline-flex items-center rounded-full border border-[var(--border)] bg-white/72 px-3 py-1.5 text-xs text-[var(--foreground-secondary)]">
                Managed billing
              </span>
            )}
          </div>
        </div>

        {data.billingHold && (
          <div className="mt-5 rounded-[16px] border border-[rgba(191,91,70,0.2)] bg-[rgba(191,91,70,0.08)] px-4 py-3 text-sm text-[var(--error)]">
            Billing hold — payments need manual review before self-serve checkout.
          </div>
        )}
      </article>

      {/* ── Buy credits ───────────────────────────────── */}
      <article className="surface-elevated dashboard-card rounded-[28px] px-6 py-6" id="buy-credits">
        <h2 className="text-base font-semibold text-[var(--foreground)]">Buy credits</h2>
        <p className="mt-1 text-sm text-[var(--foreground-secondary)]">
          Credits never expire. Min 1,000, steps of 100.
        </p>

        <div className="mt-5 rounded-[20px] border border-[var(--border)] bg-[var(--background-elevated)] px-5 py-5">
          <div className="flex flex-wrap gap-2">
            {QUICK_TOPUP_OPTIONS.map((option) => {
              const active = normalizedTopupQuantity === option;
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => setTopupQuantity(option)}
                  className={`rounded-full border px-3.5 py-1.5 text-sm transition ${
                    active
                      ? "border-[var(--border-brand)] bg-[var(--brand-subtle)] font-medium text-[var(--brand-bright)]"
                      : "border-[var(--border)] bg-white/70 text-[var(--foreground-secondary)] hover:text-[var(--foreground)]"
                  }`}
                >
                  {formatNumber(option)}
                </button>
              );
            })}
          </div>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label className="text-xs text-[var(--foreground-tertiary)]" htmlFor="topup-quantity">Custom amount</label>
              <input
                id="topup-quantity"
                type="number"
                min={1000}
                step={100}
                value={topupQuantity}
                onChange={(e) => setTopupQuantity(Number.parseInt(e.target.value || "1000", 10) || 1000)}
                className="mt-1.5 h-11 w-full rounded-[14px] border border-[var(--border)] bg-white/82 px-4 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--border-brand)]"
              />
            </div>
            <button
              className="button-primary h-11 shrink-0 px-6"
              disabled={isCreatingTopup || data.billingHold}
              onClick={() => void handleTopup()}
              type="button"
            >
              {isCreatingTopup ? "Redirecting..." : `Buy ${formatNumber(normalizedTopupQuantity)} · ${formatUsd(topupPrice)}`}
            </button>
          </div>
        </div>
      </article>

      {/* ── Auto-recharge ─────────────────────────────── */}
      {data.hasStripeCustomer && (
        <article className="surface-elevated dashboard-card rounded-[28px] px-6 py-6">
          <h2 className="text-base font-semibold text-[var(--foreground)]">Auto-recharge</h2>
          <p className="mt-1 text-sm text-[var(--foreground-secondary)]">
            Automatically top up when your balance drops below a threshold.
          </p>

          <div className="mt-5 space-y-3">
            <label className="flex cursor-pointer items-center justify-between rounded-[16px] border border-[var(--border)] bg-[var(--background-elevated)] px-4 py-3.5">
              <span className="text-sm text-[var(--foreground)]">Enable auto-recharge</span>
              <input
                type="checkbox"
                checked={autoRecharge.enabled}
                disabled={isAutoRechargeLoading}
                onChange={(e) => setAutoRecharge((c) => ({ ...c, enabled: e.target.checked }))}
                className="h-5 w-5 accent-[var(--brand)]"
              />
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs text-[var(--foreground-tertiary)]" htmlFor="ar-threshold">When balance drops below</label>
                <input
                  id="ar-threshold"
                  type="number" min={0} step={1}
                  value={autoRecharge.threshold}
                  disabled={isAutoRechargeLoading}
                  onChange={(e) => setAutoRecharge((c) => ({ ...c, threshold: Number.parseInt(e.target.value || "0", 10) || 0 }))}
                  className="mt-1.5 h-11 w-full rounded-[14px] border border-[var(--border)] bg-white/78 px-4 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--border-brand)]"
                />
              </div>
              <div>
                <label className="text-xs text-[var(--foreground-tertiary)]" htmlFor="ar-quantity">Add credits each time</label>
                <input
                  id="ar-quantity"
                  type="number" min={1000} step={100}
                  value={autoRecharge.quantity}
                  disabled={isAutoRechargeLoading}
                  onChange={(e) => setAutoRecharge((c) => ({ ...c, quantity: Number.parseInt(e.target.value || "1000", 10) || 1000 }))}
                  className="mt-1.5 h-11 w-full rounded-[14px] border border-[var(--border)] bg-white/78 px-4 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--border-brand)]"
                />
              </div>
            </div>
          </div>

          {autoRechargeError && (
            <div className="mt-4 rounded-[14px] border border-[rgba(191,91,70,0.2)] bg-[rgba(191,91,70,0.08)] px-4 py-3 text-sm text-[var(--error)]">{autoRechargeError}</div>
          )}
          {autoRechargeSuccess && (
            <div className="mt-4 rounded-[14px] border border-[rgba(62,118,100,0.2)] bg-[rgba(62,118,100,0.08)] px-4 py-3 text-sm text-[var(--success)]">{autoRechargeSuccess}</div>
          )}

          <button
            className="button-secondary mt-5"
            disabled={isAutoRechargeLoading || isSavingAutoRecharge}
            onClick={() => void handleSaveAutoRecharge()}
            type="button"
          >
            {isSavingAutoRecharge ? "Saving..." : "Save settings"}
          </button>
        </article>
      )}

      {/* ── Expiring credits ──────────────────────────── */}
      {data.expiringCredits.length > 0 && (
        <article className="surface-elevated dashboard-card rounded-[28px] px-6 py-6">
          <h2 className="text-base font-semibold text-[var(--foreground)]">Expiring soon</h2>
          <div className="mt-3 space-y-1.5">
            {data.expiringCredits.map((entry) => (
              <p key={`${entry.grantType}-${entry.expiresAt}`} className="text-sm text-[var(--foreground-secondary)]">
                {formatNumber(entry.credits)} {entry.grantType.replaceAll("_", " ")} credits expire {entry.expiresAt.slice(0, 10)}
              </p>
            ))}
          </div>
        </article>
      )}
    </DashboardLayout>
  );
}
