"use client";

import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  billing,
  getApiErrorMessage,
  type BillingCatalog,
} from "@/lib/api";
import { useConsoleViewer } from "@/components/console/console-viewer-context";
import { formatNumber } from "@/lib/dashboard";
import { DashboardLayout } from "./dashboard-layout";
import { useMonthlyUsage } from "./use-monthly-usage";

type BootstrapStatus =
  | "loading"
  | "available"
  | "already_admin"
  | "unavailable";

function IconCopy({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} />
    </svg>
  );
}

function IconCheck({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path d="M4.5 12.75l6 6 9-13.5" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
    </svg>
  );
}

export function DashboardAccountScreen() {
  const router = useRouter();
  const viewer = useConsoleViewer();
  useMonthlyUsage();
  const [catalog, setCatalog] = useState<BillingCatalog | null>(null);
  const [referralInput, setReferralInput] = useState("");
  const [referralError, setReferralError] = useState<string | null>(null);
  const [referralSuccess, setReferralSuccess] = useState<string | null>(null);
  const [isRedeeming, setIsRedeeming] = useState(false);
  const [copied, setCopied] = useState(false);
  const [bootstrapStatus, setBootstrapStatus] = useState<BootstrapStatus>(
    () => (viewer.isAdmin ? "already_admin" : "loading")
  );
  const [bootstrapSecret, setBootstrapSecret] = useState("");
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);

  useEffect(() => {
    if (viewer.isAdmin) return;
    fetch("/api/console/bootstrap-admin/status", { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) {
          setBootstrapStatus("unavailable");
          return;
        }
        const payload = await res.json() as { eligible?: boolean };
        setBootstrapStatus(payload.eligible ? "available" : "unavailable");
      })
      .catch(() => setBootstrapStatus("unavailable"));
  }, [viewer.isAdmin]);

  useEffect(() => {
    billing.getCatalog().then(setCatalog).catch(() => {});
  }, []);

  async function handleCopyCode() {
    if (!catalog?.referral.code) return;
    await navigator.clipboard.writeText(catalog.referral.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleRedeem() {
    const code = referralInput.trim();
    if (!code) return;

    setIsRedeeming(true);
    setReferralError(null);
    setReferralSuccess(null);

    try {
      const result = await billing.redeemReferral(code);
      setReferralSuccess(`Code applied: ${result.status}`);
      setReferralInput("");
      billing.getCatalog().then(setCatalog).catch(() => {});
    } catch (e) {
      setReferralError(getApiErrorMessage(e, "Invalid code"));
    } finally {
      setIsRedeeming(false);
    }
  }

  async function handleBootstrap() {
    if (!bootstrapSecret.trim()) return;
    setBootstrapError(null);

    try {
      const res = await fetch("/api/console/bootstrap-admin", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: bootstrapSecret }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null) as { detail?: string } | null;
        setBootstrapError(data?.detail ?? "Failed");
        return;
      }
      router.push("/admin");
    } catch {
      setBootstrapError("Failed");
    }
  }

  return (
    <DashboardLayout
      currentPath="/dashboard/settings"
      title="Account"
      description={viewer.email ?? undefined}
    >
      {/* Profile Section */}
      <section className="py-6">
        <div className="flex items-center gap-4">
          <div className="h-16 w-16 rounded-full bg-[var(--background-elevated)] flex items-center justify-center text-xl font-medium text-[var(--foreground-secondary)]">
            {viewer.displayName?.[0]?.toUpperCase() ?? viewer.email?.[0]?.toUpperCase() ?? "?"}
          </div>
          <div>
            <h2 className="font-medium text-[var(--foreground)]">
              {viewer.displayName ?? "Personal Account"}
            </h2>
            <p className="text-sm text-[var(--foreground-tertiary)]">{viewer.email}</p>
          </div>
        </div>
      </section>

      <div className="h-px bg-[var(--border)]" />

      {/* Referral Section */}
      <section className="py-6">
        <h2 className="text-sm font-medium text-[var(--foreground)]">Referrals</h2>

        {catalog?.referral.code ? (
          <div className="mt-3 rounded-xl border border-[var(--border)] p-4">
            <p className="text-xs text-[var(--foreground-tertiary)]">Your referral code</p>
            <div className="mt-1 flex items-center gap-3">
              <code className="text-lg font-medium text-[var(--foreground)]">
                {catalog.referral.code}
              </code>
              <button
                onClick={handleCopyCode}
                className="rounded p-1 text-[var(--foreground-tertiary)] hover:bg-[var(--background-elevated)] hover:text-[var(--foreground)]"
              >
                {copied ? <IconCheck className="h-4 w-4" /> : <IconCopy className="h-4 w-4" />}
              </button>
            </div>
            <p className="mt-2 text-xs text-[var(--foreground-secondary)]">
              Invitees get {formatNumber(catalog.referral.inviteeBonusCredits)} and inviters get {formatNumber(catalog.referral.inviterBonusCredits)}
            </p>
          </div>
        ) : null}

        {!catalog?.referral.redeemedCode ? (
          <div className="mt-3 flex gap-2">
            <input
              type="text"
              value={referralInput}
              onChange={(e) => setReferralInput(e.target.value)}
              placeholder="Enter referral code"
              className="flex-1 rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--border-strong)]"
            />
            <button
              onClick={() => void handleRedeem()}
              disabled={isRedeeming || !referralInput.trim()}
              className="rounded-lg bg-[var(--foreground)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--foreground-secondary)] disabled:opacity-50"
            >
              {isRedeeming ? "..." : "Redeem"}
            </button>
          </div>
        ) : (
          <p className="mt-3 text-sm text-[var(--foreground-secondary)]">
            Redeemed: <code className="text-[var(--foreground)]">{catalog.referral.redeemedCode}</code>
          </p>
        )}

        {referralError && (
          <p className="mt-2 text-sm text-[var(--error)]">{referralError}</p>
        )}
        {referralSuccess && (
          <p className="mt-2 text-sm text-[var(--success)]">{referralSuccess}</p>
        )}
      </section>

      <div className="h-px bg-[var(--border)]" />

      {/* Admin Section */}
      {bootstrapStatus === "available" && !viewer.isAdmin && (
        <section className="py-6">
          <h2 className="text-sm font-medium text-[var(--foreground)]">Admin Access</h2>
          <p className="mt-1 text-xs text-[var(--foreground-tertiary)]">
            Enter bootstrap secret to become administrator
          </p>
          <div className="mt-3 flex gap-2">
            <input
              type="password"
              value={bootstrapSecret}
              onChange={(e) => setBootstrapSecret(e.target.value)}
              placeholder="Bootstrap secret"
              className="flex-1 rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm"
            />
            <button
              onClick={() => void handleBootstrap()}
              className="rounded-lg bg-[var(--foreground)] px-4 py-2 text-sm font-medium text-white"
            >
              Enable
            </button>
          </div>
          {bootstrapError && (
            <p className="mt-2 text-sm text-[var(--error)]">{bootstrapError}</p>
          )}
        </section>
      )}

      {viewer.isAdmin && (
        <section className="py-6">
          <h2 className="text-sm font-medium text-[var(--foreground)]">Admin</h2>
          <Link
            href="/admin" as={"/admin" as Route}
            className="mt-3 inline-block rounded-lg border border-[var(--border)] px-4 py-2 text-sm hover:bg-[var(--background-elevated)]"
          >
            Open Admin Console →
          </Link>
        </section>
      )}

      <div className="h-px bg-[var(--border)]" />

      {/* Links */}
      <section className="py-6">
        <h2 className="text-sm font-medium text-[var(--foreground)]">Support</h2>
        <div className="mt-3 space-y-2">
          <a href="mailto:support@cerul.co" className="block text-sm text-[var(--foreground-secondary)] hover:text-[var(--foreground)]">
            Contact Support
          </a>
          <Link href={"/docs" as Route} className="block text-sm text-[var(--foreground-secondary)] hover:text-[var(--foreground)]">
            Documentation
          </Link>
          <Link href={"/privacy" as Route} className="block text-sm text-[var(--foreground-secondary)] hover:text-[var(--foreground)]">
            Privacy Policy
          </Link>
          <Link href={"/terms" as Route} className="block text-sm text-[var(--foreground-secondary)] hover:text-[var(--foreground)]">
            Terms of Service
          </Link>
        </div>
      </section>
    </DashboardLayout>
  );
}
