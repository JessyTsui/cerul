"use client";

import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { billing, getApiErrorMessage, type BillingCatalog } from "@/lib/api";
import { useConsoleViewer } from "@/components/console/console-viewer-context";
import {
  formatBillingPeriod,
  formatNumber,
  getTierLabel,
  resolveDashboardBillingAction,
} from "@/lib/dashboard";
import { AccountProfilePanel } from "./account-profile-panel";
import { CreditUsageBar } from "./credit-usage-bar";
import { DashboardLayout } from "./dashboard-layout";
import { DashboardNotice, DashboardSkeleton, DashboardState } from "./dashboard-state";
import { useMonthlyUsage } from "./use-monthly-usage";

type BootstrapAdminStatus =
  | "loading"
  | "available"
  | "already_admin"
  | "disabled"
  | "managed_by_emails"
  | "admin_exists"
  | "unavailable";

const planFeatures: Record<string, string[]> = {
  free: ["1 active API key", "1,000 credits / month", "Community support"],
  monthly: ["5 active API keys", "5,000 included credits / month", "Priority email support"],
  builder: ["5 active API keys", "10,000 legacy credits / month", "Priority email support"],
  pro: ["5 active API keys", "10,000 legacy credits / month", "Priority email support"],
  enterprise: ["Unlimited keys", "Custom credit envelope", "Dedicated onboarding"],
};

export function DashboardSettingsScreen() {
  const router = useRouter();
  const viewer = useConsoleViewer();
  const { data, error, isLoading, refresh } = useMonthlyUsage();
  const [catalog, setCatalog] = useState<BillingCatalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [isCatalogLoading, setIsCatalogLoading] = useState(true);
  const [billingAction, setBillingAction] = useState<"checkout" | "portal" | null>(null);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [selectedProductCode, setSelectedProductCode] = useState<string | null>(null);
  const [referralInput, setReferralInput] = useState("");
  const [referralError, setReferralError] = useState<string | null>(null);
  const [referralSuccess, setReferralSuccess] = useState<string | null>(null);
  const [isRedeemingReferral, setIsRedeemingReferral] = useState(false);
  const [bootstrapSecret, setBootstrapSecret] = useState("");
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [isPromotingAdmin, setIsPromotingAdmin] = useState(false);
  const [bootstrapStatus, setBootstrapStatus] = useState<BootstrapAdminStatus>(
    () => (viewer.isAdmin ? "already_admin" : "loading"),
  );

  const availableBillingAction = data
    ? resolveDashboardBillingAction(data.tier, data.hasStripeCustomer)
    : null;
  const canUpgrade = availableBillingAction === "checkout";
  const canManageSubscription = availableBillingAction === "portal";
  const normalizedTier = data?.tier.toLowerCase() ?? "free";
  const usesManualBilling = data !== null && availableBillingAction === null && normalizedTier !== "free";

  async function loadCatalog() {
    setCatalogError(null);
    setIsCatalogLoading(true);
    try {
      const nextCatalog = await billing.getCatalog();
      setCatalog(nextCatalog);
    } catch (nextError) {
      setCatalogError(getApiErrorMessage(nextError, "Failed to load billing catalog."));
    } finally {
      setIsCatalogLoading(false);
    }
  }

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
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          setBootstrapStatus("unavailable");
          return;
        }
        const payload = await res.json() as { eligible?: boolean; reason?: BootstrapAdminStatus };
        setBootstrapStatus(payload.eligible === true ? "available" : (payload.reason ?? "unavailable"));
      })
      .catch(() => {
        if (!cancelled) setBootstrapStatus("unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, [viewer.isAdmin]);

  useEffect(() => {
    void loadCatalog();
  }, []);

  async function handleCheckout(productCode = "monthly") {
    setBillingAction("checkout");
    setSelectedProductCode(productCode);
    setBillingError(null);
    try {
      const redirect = await billing.createCheckout({ productCode });
      window.location.assign(redirect.url);
    } catch (nextError) {
      setBillingError(getApiErrorMessage(nextError, "Failed to start checkout."));
      setBillingAction(null);
      setSelectedProductCode(null);
    }
  }

  async function handlePortal() {
    setBillingAction("portal");
    setBillingError(null);
    try {
      const redirect = await billing.createPortal();
      window.location.assign(redirect.url);
    } catch (nextError) {
      setBillingError(getApiErrorMessage(nextError, "Failed to open billing portal."));
      setBillingAction(null);
    }
  }

  async function handleRedeemReferral() {
    const trimmedCode = referralInput.trim();
    if (!trimmedCode) {
      setReferralError("Referral code is required.");
      return;
    }

    setIsRedeemingReferral(true);
    setReferralError(null);
    setReferralSuccess(null);
    try {
      const referral = await billing.redeemReferral(trimmedCode);
      setReferralSuccess(`Referral code applied. Status: ${referral.status ?? "pending"}.`);
      setReferralInput("");
      await loadCatalog();
    } catch (nextError) {
      setReferralError(getApiErrorMessage(nextError, "Failed to redeem referral code."));
    } finally {
      setIsRedeemingReferral(false);
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: trimmedSecret }),
      });
      const payload = await response.json().catch(() => null) as { detail?: string } | null;
      if (!response.ok) {
        setBootstrapError(payload?.detail ?? "Unable to promote this account.");
        return;
      }
      router.replace("/admin");
      router.refresh();
    } catch {
      setBootstrapError("Unable to promote this account.");
    } finally {
      setIsPromotingAdmin(false);
    }
  }

  const bootstrapPanel =
    !viewer.isAdmin && bootstrapStatus === "available" ? (
      <article className="surface-elevated rounded-[30px] px-6 py-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--brand-bright)]">
              Bootstrap admin
            </p>
            <h2 className="mt-3 text-2xl font-semibold text-[var(--foreground)]">
              Promote this account to administrator
            </h2>
            <p className="mt-2 text-sm leading-7 text-[var(--foreground-secondary)]">
              Enter the <span className="font-mono text-[var(--foreground)]">BOOTSTRAP_ADMIN_SECRET</span>{" "}
              from your environment to elevate this account.
            </p>
          </div>
          <span className="inline-flex shrink-0 items-center rounded-full border border-[var(--border-brand)] bg-[var(--brand-subtle)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--brand-bright)]">
            No admin yet
          </span>
        </div>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end">
          <input
            type="password"
            value={bootstrapSecret}
            onChange={(e) => setBootstrapSecret(e.target.value)}
            placeholder="Bootstrap secret"
            className="h-12 w-full rounded-[16px] border border-[var(--border)] bg-white/78 px-4 text-sm text-[var(--foreground)] outline-none transition placeholder:text-[var(--foreground-tertiary)] focus:border-[var(--border-brand)] sm:max-w-xs"
            autoComplete="off"
          />
          <button
            className="button-primary shrink-0"
            type="button"
            disabled={isPromotingAdmin}
            onClick={() => void handleBootstrapAdmin()}
          >
            {isPromotingAdmin ? "Promoting..." : "Promote account"}
          </button>
        </div>
        {bootstrapError ? (
          <div className="mt-3 rounded-[16px] border border-[rgba(191,91,70,0.2)] bg-[rgba(191,91,70,0.08)] px-4 py-3 text-sm text-[var(--error)]">
            {bootstrapError}
          </div>
        ) : null}
      </article>
    ) : null;

  return (
    <DashboardLayout
      currentPath="/dashboard/settings"
      title="Settings"
      description="Account context, plan posture, and the operational defaults around your public API workspace."
      actions={
        <Link className="button-secondary" href={"/pricing" as Route}>
          Compare plans
        </Link>
      }
    >
      {isLoading && !data ? (
        <DashboardSkeleton />
      ) : error && !data ? (
        <DashboardState
          title="Plan data could not be loaded"
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
          {billingError ? (
            <DashboardNotice title="Billing action failed" description={billingError} tone="error" />
          ) : null}

          <AccountProfilePanel />

          <section className="grid gap-5 xl:grid-cols-[0.92fr_1.08fr]">
            <article className="surface-elevated rounded-[32px] px-6 py-6">
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                Billing
              </p>
              <h2 className="mt-3 text-2xl font-semibold text-[var(--foreground)]">
                Keep one clear place for plan and credits
              </h2>
              <div className="mt-5 grid gap-3">
                {[
                  {
                    label: "Current plan",
                    value: getTierLabel(data.tier),
                    note: formatBillingPeriod(data.periodStart, data.periodEnd),
                  },
                  {
                    label: "Spendable balance",
                    value: formatNumber(data.walletBalance),
                    note: `${formatNumber(data.creditBreakdown.includedRemaining)} included · ${formatNumber(data.creditBreakdown.topupRemaining)} top-up · ${formatNumber(data.creditBreakdown.bonusRemaining)} bonus`,
                  },
                  {
                    label: "Requests this period",
                    value: formatNumber(data.requestCount),
                    note: `${formatNumber(data.apiKeysActive)} active keys`,
                  },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="rounded-[20px] border border-[var(--border)] bg-[var(--background-elevated)] px-4 py-4"
                  >
                    <p className="text-xs text-[var(--foreground-tertiary)]">{item.label}</p>
                    <p className="mt-2 text-2xl font-semibold text-[var(--foreground)]">
                      {item.value}
                    </p>
                    <p className="mt-2 text-sm text-[var(--foreground-secondary)]">{item.note}</p>
                  </div>
                ))}
              </div>

              <div className="mt-5 space-y-3">
                {canUpgrade ? (
                  <button
                    className="button-primary w-full"
                    disabled={billingAction !== null || data.billingHold}
                    onClick={() => void handleCheckout("monthly")}
                    type="button"
                  >
                    {billingAction === "checkout" && selectedProductCode === "monthly"
                      ? "Redirecting..."
                      : "Upgrade to Monthly"}
                  </button>
                ) : null}
                {canManageSubscription ? (
                  <button
                    className="button-secondary w-full"
                    disabled={billingAction !== null}
                    onClick={() => void handlePortal()}
                    type="button"
                  >
                    {billingAction === "portal" ? "Opening portal..." : "Manage subscription"}
                  </button>
                ) : null}
                {usesManualBilling ? (
                  <div className="rounded-[20px] border border-[var(--border-brand)] bg-[var(--brand-subtle)] px-4 py-4">
                    <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--brand-bright)]">
                      Managed account
                    </p>
                    <p className="mt-2 text-sm leading-6 text-[var(--foreground)]">
                      Contact Cerul to change invoicing, seats, or contract terms.
                    </p>
                  </div>
                ) : null}
                {!canUpgrade && !canManageSubscription && !usesManualBilling ? (
                  <p className="text-sm text-[var(--foreground-tertiary)]">
                    No billing action available.
                  </p>
                ) : null}
                {data.billingHold ? (
                  <div className="rounded-[20px] border border-[rgba(191,91,70,0.2)] bg-[rgba(191,91,70,0.08)] px-4 py-4">
                    <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--error)]">
                      Billing hold
                    </p>
                    <p className="mt-2 text-sm leading-6 text-[var(--foreground)]">
                      Payments or credits need manual review before more self-serve checkout is allowed.
                    </p>
                  </div>
                ) : null}
              </div>
            </article>

            <div className="space-y-5">
              <CreditUsageBar
                label="Included credits this period"
                used={data.creditsUsed}
                limit={data.creditsLimit}
                remaining={data.creditBreakdown.includedRemaining}
              />

              <article className="surface-elevated rounded-[32px] px-6 py-6">
                <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                  Wallet
                </p>
                <h2 className="mt-3 text-2xl font-semibold text-[var(--foreground)]">
                  Add credits before traffic spikes.
                </h2>
                {catalogError ? (
                  <div className="mt-4 rounded-[18px] border border-[rgba(191,91,70,0.2)] bg-[rgba(191,91,70,0.08)] px-4 py-3 text-sm text-[var(--error)]">
                    {catalogError}
                  </div>
                ) : null}
                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                  {[
                    { label: "Included", value: data.creditBreakdown.includedRemaining },
                    { label: "Top-up", value: data.creditBreakdown.topupRemaining },
                    { label: "Bonus", value: data.creditBreakdown.bonusRemaining },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className="rounded-[20px] border border-[var(--border)] bg-[var(--background-elevated)] px-4 py-4"
                    >
                      <p className="text-xs text-[var(--foreground-tertiary)]">{item.label}</p>
                      <p className="mt-2 text-2xl font-semibold text-[var(--foreground)]">
                        {formatNumber(item.value)}
                      </p>
                    </div>
                  ))}
                </div>
                <div className="mt-5 grid gap-3">
                  {(catalog?.products ?? [])
                    .filter((product) => product.kind === "topup")
                    .map((product) => (
                      <button
                        key={product.code}
                        className="flex items-center justify-between rounded-[20px] border border-[var(--border)] bg-[var(--background-elevated)] px-4 py-4 text-left transition hover:border-[var(--border-strong)] hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={!product.isConfigured || billingAction !== null || data.billingHold}
                        onClick={() => void handleCheckout(product.code)}
                        type="button"
                      >
                        <span>
                          <span className="block text-base font-semibold text-[var(--foreground)]">
                            {product.name}
                          </span>
                          <span className="mt-1 block text-sm text-[var(--foreground-secondary)]">
                            {formatNumber(product.credits)} credits · {product.cadence}
                          </span>
                        </span>
                        <span className="text-right">
                          <span className="block text-lg font-semibold text-[var(--foreground)]">
                            {billingAction === "checkout" && selectedProductCode === product.code
                              ? "Redirecting..."
                              : product.priceDisplay}
                          </span>
                          <span className="block text-xs text-[var(--foreground-tertiary)]">
                            {product.allowPromotionCodes ? "Promo codes accepted" : "Standard checkout"}
                          </span>
                        </span>
                      </button>
                    ))}
                  {!isCatalogLoading && (catalog?.products ?? []).filter((product) => product.kind === "topup").length === 0 ? (
                    <p className="text-sm text-[var(--foreground-tertiary)]">
                      No top-up products are configured yet.
                    </p>
                  ) : null}
                </div>
                {data.expiringCredits.length > 0 ? (
                  <div className="mt-5 rounded-[20px] border border-[var(--border)] bg-white/72 px-4 py-4">
                    <p className="text-sm font-medium text-[var(--foreground)]">Expiring soon</p>
                    <div className="mt-3 space-y-2">
                      {data.expiringCredits.map((entry) => (
                        <p key={`${entry.grantType}-${entry.expiresAt}`} className="text-sm text-[var(--foreground-secondary)]">
                          {formatNumber(entry.credits)} {entry.grantType.replaceAll("_", " ")} by {entry.expiresAt.slice(0, 10)}
                        </p>
                      ))}
                    </div>
                  </div>
                ) : null}
              </article>

              <article className="surface-elevated rounded-[32px] px-6 py-6">
                <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                  Referral
                </p>
                <h2 className="mt-3 text-2xl font-semibold text-[var(--foreground)]">
                  Share credits, not spreadsheets.
                </h2>
                <div className="mt-5 rounded-[20px] border border-[var(--border)] bg-[var(--background-elevated)] px-4 py-4">
                  <p className="text-xs text-[var(--foreground-tertiary)]">Your code</p>
                  <p className="mt-2 font-mono text-2xl font-semibold tracking-[0.08em] text-[var(--foreground)]">
                    {catalog?.referral.code || "—"}
                  </p>
                  <p className="mt-2 text-sm text-[var(--foreground-secondary)]">
                    Both sides get {formatNumber(catalog?.referral.bonusCredits ?? 0)} bonus credits after the first paid order clears for {catalog?.referral.rewardDelayDays ?? 0} days.
                  </p>
                </div>
                <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                  <input
                    type="text"
                    value={referralInput}
                    onChange={(event) => setReferralInput(event.target.value)}
                    placeholder="Enter a referral code"
                    className="h-12 w-full rounded-[16px] border border-[var(--border)] bg-white/78 px-4 text-sm text-[var(--foreground)] outline-none transition placeholder:text-[var(--foreground-tertiary)] focus:border-[var(--border-brand)]"
                  />
                  <button
                    className="button-secondary shrink-0"
                    disabled={isRedeemingReferral || Boolean(catalog?.referral.redeemedCode)}
                    onClick={() => void handleRedeemReferral()}
                    type="button"
                  >
                    {isRedeemingReferral ? "Redeeming..." : "Redeem"}
                  </button>
                </div>
                {catalog?.referral.redeemedCode ? (
                  <p className="mt-3 text-sm text-[var(--foreground-secondary)]">
                    Redeemed code: <span className="font-mono text-[var(--foreground)]">{catalog.referral.redeemedCode}</span>
                    {catalog.referral.status ? ` · ${catalog.referral.status}` : ""}
                  </p>
                ) : null}
                {referralError ? (
                  <div className="mt-3 rounded-[16px] border border-[rgba(191,91,70,0.2)] bg-[rgba(191,91,70,0.08)] px-4 py-3 text-sm text-[var(--error)]">
                    {referralError}
                  </div>
                ) : null}
                {referralSuccess ? (
                  <div className="mt-3 rounded-[16px] border border-[rgba(62,118,100,0.2)] bg-[rgba(62,118,100,0.08)] px-4 py-3 text-sm text-[var(--success)]">
                    {referralSuccess}
                  </div>
                ) : null}
              </article>

              <article className="surface-elevated rounded-[32px] px-6 py-6">
                <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                  Resources
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {(planFeatures[normalizedTier] ?? planFeatures.free).map((feature) => (
                    <span
                      key={feature}
                      className="rounded-full border border-[var(--border)] bg-white/72 px-3 py-1.5 text-sm text-[var(--foreground-secondary)]"
                    >
                      {feature}
                    </span>
                  ))}
                </div>
                <div className="mt-5 space-y-3">
                  {[
                    {
                      href: "/docs/api-reference",
                      title: "Public API reference",
                      description: "Keep request shapes close to the settings surface users actually revisit.",
                    },
                    {
                      href: "/docs",
                      title: "Quickstart guide",
                      description: "Walk through the first authenticated request before you scale traffic.",
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
            </div>
          </section>

          {bootstrapPanel}
        </>
      ) : (
        <DashboardState
          title="No plan data available"
          description="The dashboard API returned no plan payload."
          action={
            <button className="button-primary" onClick={() => void refresh()} type="button">
              Retry
            </button>
          }
        />
      )}
    </DashboardLayout>
  );
}
