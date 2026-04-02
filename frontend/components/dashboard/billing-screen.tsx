"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  billing,
  getApiErrorMessage,
  type AutoRechargeSettings,
  type DashboardMonthlyUsage,
  type PaymentMethod,
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

/* ── Icons ────────────────────────────────────────────── */

function IconBolt({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24">
      <path d="M13.5 2.75 6.75 13.5h4.5l-.75 7.75 6.75-10.75h-4.5l.75-7.75Z" fill="currentColor" />
    </svg>
  );
}

function IconCard({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path d="M2.25 8.25h19.5M2.25 9h19.5m-1.5 10.5V7.5a2.25 2.25 0 0 0-2.25-2.25H4.5A2.25 2.25 0 0 0 2.25 7.5v12a2.25 2.25 0 0 0 2.25 2.25h15a2.25 2.25 0 0 0 2.25-2.25Z" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} />
    </svg>
  );
}

function IconPlus({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path d="M12 4.5v15m7.5-7.5h-15" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} />
    </svg>
  );
}

function IconCheck({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path d="m4.5 12.75 6 6 9-13.5" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
    </svg>
  );
}

const BRAND_ICONS: Record<string, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "Amex",
  discover: "Discover",
  jcb: "JCB",
  unionpay: "UnionPay",
};

type BillingTab = "plan" | "payment";

/* ── Tab components ───────────────────────────────────── */

function PlanTab({
  data,
  billingAction,
  onCheckout,
  onPortal,
}: {
  data: DashboardMonthlyUsage;
  billingAction: string | null;
  onCheckout: () => void;
  onPortal: () => void;
}) {
  const availableBillingAction = resolveDashboardBillingAction(data.tier, data.hasStripeCustomer);
  const canUpgrade = availableBillingAction === "checkout";
  const canManageSubscription = availableBillingAction === "portal";

  return (
    <div className="space-y-5">
      {/* Current plan summary */}
      <div className="rounded-[18px] border border-[var(--border)] bg-white/60 px-5 py-4">
        <p className="text-xs text-[var(--foreground-tertiary)]">Current plan</p>
          <div className="mt-1 flex items-center gap-3">
            <p className="text-lg font-semibold text-[var(--foreground)]">{getTierLabel(data.tier)}</p>
            <span className="rounded-full border border-[var(--border-brand)] bg-[var(--brand-subtle)] px-2 py-0.5 text-[11px] font-medium text-[var(--brand-bright)]">
              {formatNumber(data.creditsUsed)} / {data.creditsLimit > 0 ? formatNumber(data.creditsLimit) : "∞"}
            </span>
          </div>
        {data.tier.toLowerCase() === "pro" && (
          <p className="mt-1 text-sm text-[var(--foreground-secondary)]">5,000 included credits per month · $29.90/mo</p>
        )}
      </div>

      {/* Plan cards */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Free */}
        <div className={`rounded-[18px] border px-5 py-5 ${data.tier.toLowerCase() === "free" ? "border-[var(--border-brand)] bg-[var(--brand-subtle)]" : "border-[var(--border)] bg-white/50"}`}>
          <div className="flex items-center gap-2">
            <p className="text-base font-semibold text-[var(--foreground)]">Free</p>
            {data.tier.toLowerCase() === "free" && (
              <span className="rounded-full bg-[var(--brand-bright)] px-2 py-0.5 text-[10px] font-medium text-white">Current</span>
            )}
          </div>
          <div className="mt-4 space-y-2">
            {["10 free searches / day", "No credit card required", "Community support"].map((f) => (
              <div key={f} className="flex items-center gap-2 text-sm text-[var(--foreground-secondary)]">
                <IconCheck className="h-4 w-4 shrink-0 text-[var(--success)]" />
                {f}
              </div>
            ))}
          </div>
        </div>

        {/* Pro */}
        <div className={`rounded-[18px] border px-5 py-5 ${data.tier.toLowerCase() === "pro" ? "border-[var(--border-brand)] bg-[var(--brand-subtle)]" : "border-[var(--border)] bg-white/50"}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <p className="text-base font-semibold text-[var(--foreground)]">Pro</p>
              {data.tier.toLowerCase() === "pro" && (
                <span className="rounded-full bg-[var(--brand-bright)] px-2 py-0.5 text-[10px] font-medium text-white">Current</span>
              )}
            </div>
            <p className="text-sm font-semibold text-[var(--foreground)]">$29.90<span className="font-normal text-[var(--foreground-tertiary)]">/mo</span></p>
          </div>
          <div className="mt-4 space-y-2">
            {["5,000 credits / month", "Top up at $8 / 1K credits", "Priority support", "Auto-recharge"].map((f) => (
              <div key={f} className="flex items-center gap-2 text-sm text-[var(--foreground-secondary)]">
                <IconCheck className="h-4 w-4 shrink-0 text-[var(--success)]" />
                {f}
              </div>
            ))}
          </div>
          {canUpgrade && (
            <button className="button-primary mt-5 w-full" disabled={billingAction !== null || data.billingHold} onClick={onCheckout} type="button">
              {billingAction === "checkout" ? "Redirecting..." : "Upgrade"}
            </button>
          )}
          {canManageSubscription && (
            <button className="button-secondary mt-5 w-full" disabled={billingAction !== null} onClick={onPortal} type="button">
              {billingAction === "portal" ? "Opening..." : "Manage subscription"}
            </button>
          )}
        </div>

        {/* Enterprise */}
        <div className="rounded-[18px] border border-[var(--border)] bg-white/50 px-5 py-5">
          <p className="text-base font-semibold text-[var(--foreground)]">Enterprise</p>
          <div className="mt-4 space-y-2">
            {["Custom credit volume", "Dedicated support", "Custom rate limits", "SLA & MSA"].map((f) => (
              <div key={f} className="flex items-center gap-2 text-sm text-[var(--foreground-secondary)]">
                <IconCheck className="h-4 w-4 shrink-0 text-[var(--success)]" />
                {f}
              </div>
            ))}
          </div>
          <a href="mailto:support@cerul.ai" className="button-secondary mt-5 block w-full text-center">
            Contact us
          </a>
        </div>
      </div>

      {data.billingHold && (
        <div className="rounded-[14px] border border-[rgba(191,91,70,0.2)] bg-[rgba(191,91,70,0.08)] px-4 py-3 text-sm text-[var(--error)]">
          Billing hold — payments need manual review.
        </div>
      )}
    </div>
  );
}

function CreditsTab({
  data,
  topupQuantity,
  setTopupQuantity,
  isCreatingTopup,
  onTopup,
  autoRecharge,
  setAutoRecharge,
  isAutoRechargeLoading,
  isSavingAutoRecharge,
  autoRechargeError,
  autoRechargeSuccess,
  onSaveAutoRecharge,
}: {
  data: DashboardMonthlyUsage;
  topupQuantity: number;
  setTopupQuantity: (v: number) => void;
  isCreatingTopup: boolean;
  onTopup: () => void;
  autoRecharge: AutoRechargeSettings;
  setAutoRecharge: (fn: (c: AutoRechargeSettings) => AutoRechargeSettings) => void;
  isAutoRechargeLoading: boolean;
  isSavingAutoRecharge: boolean;
  autoRechargeError: string | null;
  autoRechargeSuccess: string | null;
  onSaveAutoRecharge: () => void;
}) {
  const normalizedTopupQuantity = normalizeCreditQuantity(topupQuantity);
  const topupPrice = normalizedTopupQuantity * TOPUP_UNIT_PRICE_USD;

  return (
    <div className="space-y-5">
      {/* Balance + Buy credits — merged */}
      <div className="rounded-[18px] border border-[var(--border)] bg-white/60 px-5 py-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <IconBolt className="h-5 w-5 text-[var(--brand-bright)]" />
            <div>
              <p className="text-xs text-[var(--foreground-tertiary)]">Spendable credits</p>
              <p className="text-xl font-semibold text-[var(--foreground)]">{formatNumber(data.walletBalance)}</p>
              <p className="text-xs text-[var(--foreground-tertiary)]">
                Free today: {formatNumber(data.dailyFreeRemaining)} / {formatNumber(data.dailyFreeLimit)}
              </p>
            </div>
          </div>
          <p className="text-xs text-[var(--foreground-tertiary)]">$0.008 / credit · never expire</p>
        </div>

        <div className="mt-4 flex items-center gap-2">
          {QUICK_TOPUP_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setTopupQuantity(option)}
              className={`rounded-full border px-3 py-1 text-sm transition ${
                normalizedTopupQuantity === option
                  ? "border-[var(--border-brand)] bg-[var(--brand-subtle)] font-medium text-[var(--brand-bright)]"
                  : "border-[var(--border)] bg-white/70 text-[var(--foreground-secondary)] hover:text-[var(--foreground)]"
              }`}
            >
              {formatNumber(option)}
            </button>
          ))}
          <input
            type="number"
            min={1000}
            step={100}
            value={topupQuantity}
            onChange={(e) => setTopupQuantity(Number.parseInt(e.target.value || "1000", 10) || 1000)}
            className="h-9 w-24 rounded-[10px] border border-[var(--border)] bg-white/82 px-3 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--border-brand)]"
          />
          <button
            className="button-primary ml-auto h-9 shrink-0 px-5"
            disabled={isCreatingTopup || data.billingHold}
            onClick={onTopup}
            type="button"
          >
            {isCreatingTopup ? "Redirecting..." : `Buy · ${formatUsd(topupPrice)}`}
          </button>
        </div>
      </div>

      {/* Auto-recharge */}
      {data.hasStripeCustomer && (
        <div className="rounded-[18px] border border-[var(--border)] bg-white/60 px-5 py-4">
          <label className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-[var(--foreground)]">Auto-recharge</p>
              <p className="text-xs text-[var(--foreground-tertiary)]">Top up when balance drops low</p>
            </div>
            <input
              type="checkbox"
              checked={autoRecharge.enabled}
              disabled={isAutoRechargeLoading}
              onChange={(e) => setAutoRecharge((c) => ({ ...c, enabled: e.target.checked }))}
              className="h-5 w-5 accent-[var(--brand)]"
            />
          </label>
          {autoRecharge.enabled && (
            <div className="mt-3 flex items-end gap-3">
              <div className="flex-1">
                <label className="text-[11px] text-[var(--foreground-tertiary)]" htmlFor="ar-threshold">When below</label>
                <input id="ar-threshold" type="number" min={0} step={1} value={autoRecharge.threshold} disabled={isAutoRechargeLoading}
                  onChange={(e) => setAutoRecharge((c) => ({ ...c, threshold: Number.parseInt(e.target.value || "0", 10) || 0 }))}
                  className="mt-1 h-9 w-full rounded-[10px] border border-[var(--border)] bg-white/78 px-3 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--border-brand)]"
                />
              </div>
              <div className="flex-1">
                <label className="text-[11px] text-[var(--foreground-tertiary)]" htmlFor="ar-quantity">Add each time</label>
                <input id="ar-quantity" type="number" min={1000} step={100} value={autoRecharge.quantity} disabled={isAutoRechargeLoading}
                  onChange={(e) => setAutoRecharge((c) => ({ ...c, quantity: Number.parseInt(e.target.value || "1000", 10) || 1000 }))}
                  className="mt-1 h-9 w-full rounded-[10px] border border-[var(--border)] bg-white/78 px-3 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--border-brand)]"
                />
              </div>
              <button className="button-secondary h-9 shrink-0 px-4" disabled={isAutoRechargeLoading || isSavingAutoRecharge} onClick={onSaveAutoRecharge} type="button">
                {isSavingAutoRecharge ? "..." : "Save"}
              </button>
            </div>
          )}
          {autoRechargeError && <p className="mt-2 text-sm text-[var(--error)]">{autoRechargeError}</p>}
          {autoRechargeSuccess && <p className="mt-2 text-sm text-[var(--success)]">{autoRechargeSuccess}</p>}
        </div>
      )}

      {/* Expiring */}
      {data.expiringCredits.length > 0 && (
        <div className="rounded-[18px] border border-[var(--border)] bg-white/60 px-5 py-3">
          <p className="text-xs font-medium text-[var(--foreground-tertiary)]">Expiring soon</p>
          {data.expiringCredits.map((entry) => (
            <p key={`${entry.grantType}-${entry.expiresAt}`} className="mt-1 text-sm text-[var(--foreground-secondary)]">
              {formatNumber(entry.credits)} {entry.grantType.replaceAll("_", " ")} — {entry.expiresAt.slice(0, 10)}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function PaymentTab({ data }: { data: DashboardMonthlyUsage }) {
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAddingCard, setIsAddingCard] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadMethods() {
      if (!data.hasStripeCustomer) {
        if (!cancelled) {
          setMethods([]);
          setError(null);
          setIsLoading(false);
        }
        return;
      }

      if (!cancelled) {
        setIsLoading(true);
        setError(null);
      }

      try {
        const nextMethods = await billing.listPaymentMethods();
        if (!cancelled) {
          setMethods(nextMethods);
        }
      } catch (e) {
        if (!cancelled) {
          setError(getApiErrorMessage(e, "Failed to load payment methods."));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadMethods();

    return () => {
      cancelled = true;
    };
  }, [data.hasStripeCustomer]);

  async function handleAddCard() {
    setIsAddingCard(true);
    try {
      const redirect = await billing.setupPaymentMethod();
      window.location.assign(redirect.url);
    } catch (e) {
      setError(getApiErrorMessage(e, "Failed to start card setup."));
      setIsAddingCard(false);
    }
  }

  if (!data.hasStripeCustomer) {
    return (
      <div className="rounded-[18px] border border-dashed border-[var(--border)] px-5 py-10 text-center">
        <IconCard className="mx-auto h-8 w-8 text-[var(--foreground-tertiary)]" />
        <p className="mt-3 text-sm text-[var(--foreground-secondary)]">
          Complete your first purchase to set up a payment method.
        </p>
      </div>
    );
  }

  if (isLoading) return <DashboardSkeleton />;

  return (
    <div className="space-y-4">
      {error && <DashboardNotice title="Error" description={error} tone="error" />}

      {methods.length === 0 ? (
        <div className="rounded-[18px] border border-dashed border-[var(--border)] px-5 py-10 text-center">
          <IconCard className="mx-auto h-8 w-8 text-[var(--foreground-tertiary)]" />
          <p className="mt-3 text-sm text-[var(--foreground-secondary)]">No payment methods on file.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {methods.map((pm) => (
            <div key={pm.id} className="flex items-center gap-4 rounded-[16px] border border-[var(--border)] bg-white/60 px-5 py-4">
              <div className="flex h-10 w-14 items-center justify-center rounded-[8px] border border-[var(--border)] bg-white/80 text-xs font-bold uppercase text-[var(--foreground-secondary)]">
                {BRAND_ICONS[pm.brand] ?? pm.brand}
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-[var(--foreground)]">
                  •••• {pm.last4}
                </p>
                <p className="text-xs text-[var(--foreground-tertiary)]">
                  Expires {String(pm.expMonth).padStart(2, "0")}/{pm.expYear}
                </p>
              </div>
              {pm.isDefault && (
                <span className="rounded-full border border-[var(--border-brand)] bg-[var(--brand-subtle)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--brand-bright)]">
                  Default
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        className="button-secondary flex items-center gap-2"
        disabled={isAddingCard}
        onClick={() => void handleAddCard()}
      >
        <IconPlus className="h-4 w-4" />
        {isAddingCard ? "Redirecting..." : "Add payment method"}
      </button>
    </div>
  );
}

/* ── Main screen ──────────────────────────────────────── */

export function DashboardBillingScreen() {
  const searchParams = useSearchParams();
  const { data, error, isLoading, refresh } = useMonthlyUsage();
  const [billingAction, setBillingAction] = useState<"checkout" | "portal" | "topup" | null>(null);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [checkoutNotice, setCheckoutNotice] = useState<string | null>(null);
  const [topupQuantity, setTopupQuantity] = useState(1000);
  const [isCreatingTopup, setIsCreatingTopup] = useState(false);
  const [autoRecharge, setAutoRecharge] = useState<AutoRechargeSettings>({ enabled: false, threshold: 100, quantity: 1000 });
  const [autoRechargeError, setAutoRechargeError] = useState<string | null>(null);
  const [autoRechargeSuccess, setAutoRechargeSuccess] = useState<string | null>(null);
  const [isAutoRechargeLoading, setIsAutoRechargeLoading] = useState(false);
  const [isSavingAutoRecharge, setIsSavingAutoRecharge] = useState(false);

  const initialTab = (searchParams.get("tab") as BillingTab) || "plan";
  const [activeTab, setActiveTab] = useState<BillingTab>(initialTab);

  useEffect(() => {
    if (!data?.hasStripeCustomer) {
      setAutoRecharge({ enabled: false, threshold: 100, quantity: 1000 });
      setIsAutoRechargeLoading(false);
      return;
    }
    let cancelled = false;
    setIsAutoRechargeLoading(true);
    void billing.getAutoRecharge()
      .then((s) => { if (!cancelled) setAutoRecharge(s); })
      .catch((e) => { if (!cancelled) setAutoRechargeError(getApiErrorMessage(e, "Failed to load auto-recharge.")); })
      .finally(() => { if (!cancelled) setIsAutoRechargeLoading(false); });
    return () => { cancelled = true; };
  }, [data?.hasStripeCustomer]);

  useEffect(() => {
    const checkoutState = searchParams.get("checkout");
    const checkoutSessionId = searchParams.get("session_id");
    if (checkoutState !== "success") return;
    const clearParams = () => {
      const u = new URL(window.location.href);
      u.searchParams.delete("checkout");
      u.searchParams.delete("session_id");
      u.searchParams.delete("type");
      window.history.replaceState({}, "", `${u.pathname}${u.search || ""}`);
    };
    if (!checkoutSessionId) { setCheckoutNotice("Payment completed."); clearParams(); return; }
    let cancelled = false;
    void billing.reconcileCheckout(checkoutSessionId)
      .then(async (result) => {
        if (cancelled) return;
        await refresh();
        setCheckoutNotice(result.mode === "payment" ? `Credits added${result.creditsGranted > 0 ? `: ${formatNumber(result.creditsGranted)}.` : "."}` : "Billing synced.");
        clearParams();
      })
      .catch((e) => { if (!cancelled) setCheckoutNotice(getApiErrorMessage(e, "Payment completed but sync needed.")); });
    return () => { cancelled = true; };
  }, [refresh, searchParams]);

  async function handleCheckout() {
    setBillingAction("checkout"); setBillingError(null);
    try { window.location.assign((await billing.createCheckout()).url); }
    catch (e) { setBillingError(getApiErrorMessage(e, "Failed to start checkout.")); setBillingAction(null); }
  }
  async function handlePortal() {
    setBillingAction("portal"); setBillingError(null);
    try { window.location.assign((await billing.createPortal()).url); }
    catch (e) { setBillingError(getApiErrorMessage(e, "Failed to open portal.")); setBillingAction(null); }
  }
  async function handleTopup() {
    setIsCreatingTopup(true); setBillingError(null);
    try { window.location.assign((await billing.createTopup(normalizeCreditQuantity(topupQuantity))).url); }
    catch (e) { setBillingError(getApiErrorMessage(e, "Failed to start purchase.")); setIsCreatingTopup(false); }
  }
  async function handleSaveAutoRecharge() {
    setIsSavingAutoRecharge(true); setAutoRechargeError(null); setAutoRechargeSuccess(null);
    try {
      const next = await billing.updateAutoRecharge({ enabled: autoRecharge.enabled, threshold: Math.max(Math.round(autoRecharge.threshold), 0), quantity: normalizeCreditQuantity(autoRecharge.quantity) });
      setAutoRecharge(next);
      setAutoRechargeSuccess("Saved.");
    } catch (e) { setAutoRechargeError(getApiErrorMessage(e, "Failed to save.")); }
    finally { setIsSavingAutoRecharge(false); }
  }

  const tabs: { key: BillingTab; label: string; icon: React.ReactNode }[] = [
    { key: "plan", label: "Plan & Credits", icon: <IconBolt className="h-4 w-4" /> },
    { key: "payment", label: "Payment Methods", icon: <IconCard className="h-4 w-4" /> },
  ];

  if (isLoading && !data) {
    return (<DashboardLayout currentPath="/dashboard/billing" title="Billing"><DashboardSkeleton /></DashboardLayout>);
  }
  if (error && !data) {
    return (<DashboardLayout currentPath="/dashboard/billing" title="Billing"><DashboardState title="Could not load billing" description={error} tone="error" action={<button className="button-primary" onClick={() => void refresh()} type="button">Retry</button>} /></DashboardLayout>);
  }
  if (!data) {
    return (<DashboardLayout currentPath="/dashboard/billing" title="Billing"><DashboardState title="No billing data" description="The API returned no payload." /></DashboardLayout>);
  }

  return (
    <DashboardLayout currentPath="/dashboard/billing" title="Billing" actions={null}>
      {billingError && <DashboardNotice title="Error" description={billingError} tone="error" />}
      {checkoutNotice && <DashboardNotice title="Updated" description={checkoutNotice} tone="success" />}

      {/* Tabs */}
      <div className="flex gap-2">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm transition ${
              activeTab === tab.key
                ? "border-[var(--foreground)] bg-[var(--foreground)] font-medium text-white"
                : "border-[var(--border)] bg-white/70 text-[var(--foreground-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--foreground)]"
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="animate-fade-in">
        {activeTab === "plan" && (
          <>
            <PlanTab data={data} billingAction={billingAction} onCheckout={() => void handleCheckout()} onPortal={() => void handlePortal()} />
            <div className="mt-5">
              <CreditsTab
                data={data}
                topupQuantity={topupQuantity}
                setTopupQuantity={setTopupQuantity}
                isCreatingTopup={isCreatingTopup}
                onTopup={() => void handleTopup()}
                autoRecharge={autoRecharge}
                setAutoRecharge={setAutoRecharge}
                isAutoRechargeLoading={isAutoRechargeLoading}
                isSavingAutoRecharge={isSavingAutoRecharge}
                autoRechargeError={autoRechargeError}
                autoRechargeSuccess={autoRechargeSuccess}
                onSaveAutoRecharge={() => void handleSaveAutoRecharge()}
              />
            </div>
          </>
        )}
        {activeTab === "payment" && <PaymentTab data={data} />}
      </div>
    </DashboardLayout>
  );
}
