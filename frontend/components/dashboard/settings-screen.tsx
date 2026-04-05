"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { billing, getApiErrorMessage, type BillingCatalog } from "@/lib/api";
import { useConsoleViewer } from "@/components/console/console-viewer-context";
import { formatNumber } from "@/lib/dashboard";
import { buildReferralPath, buildReferralUrl } from "@/lib/referral";
import { AccountProfilePanel } from "./account-profile-panel";
import { DashboardLayout } from "./dashboard-layout";
import { DashboardNotice, DashboardSkeleton, DashboardState } from "./dashboard-state";
import { useMonthlyUsage } from "./use-monthly-usage";

type BootstrapAdminStatus = "loading" | "available" | "already_admin" | "disabled" | "managed_by_emails" | "admin_exists" | "unavailable";

function IconCopy({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9.75a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} />
    </svg>
  );
}

function IconEdit({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Z" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} />
    </svg>
  );
}

function formatRelativeDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const diff = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 30) return `${diff}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function DashboardSettingsScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const viewer = useConsoleViewer();
  const { data, error, isLoading, refresh } = useMonthlyUsage();
  const [catalog, setCatalog] = useState<BillingCatalog | null>(null);
  const [referralInput, setReferralInput] = useState("");
  const [referralError, setReferralError] = useState<string | null>(null);
  const [referralSuccess, setReferralSuccess] = useState<string | null>(null);
  const [isRedeemingReferral, setIsRedeemingReferral] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copyLinkError, setCopyLinkError] = useState<string | null>(null);
  const [editingCode, setEditingCode] = useState(false);
  const [newCode, setNewCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [isSavingCode, setIsSavingCode] = useState(false);
  const [checkoutNotice, setCheckoutNotice] = useState<string | null>(null);
  const [bootstrapSecret, setBootstrapSecret] = useState("");
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [isPromotingAdmin, setIsPromotingAdmin] = useState(false);
  const [pageOrigin, setPageOrigin] = useState<string | null>(null);
  const [bootstrapStatus, setBootstrapStatus] = useState<BootstrapAdminStatus>(
    () => (viewer.isAdmin ? "already_admin" : "loading"),
  );

  useEffect(() => { void billing.getCatalog().then(setCatalog).catch(() => {}); }, []);

  useEffect(() => {
    setPageOrigin(window.location.origin);
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
      const nextQuery = nextUrl.searchParams.toString();
      window.history.replaceState({}, "", `${nextUrl.pathname}${nextQuery ? `?${nextQuery}` : ""}`);
    };

    if (!checkoutSessionId) {
      setCheckoutNotice("Payment completed. Refresh the page if your balance does not update right away.");
      clearCheckoutParams();
      return;
    }

    let cancelled = false;

    void billing.reconcileCheckout(checkoutSessionId)
      .then(async (result) => {
        if (cancelled) {
          return;
        }

        await Promise.all([
          billing.getCatalog().then(setCatalog).catch(() => {}),
          refresh(),
        ]);

        if (!cancelled) {
          setCheckoutNotice(
            result.mode === "payment"
              ? `Credits added${result.creditsGranted > 0 ? `: ${formatNumber(result.creditsGranted)}.` : "."}`
              : "Billing synced successfully.",
          );
        }
        clearCheckoutParams();
      })
      .catch((nextError) => {
        if (cancelled) {
          return;
        }
        setCheckoutNotice(
          getApiErrorMessage(nextError, "Payment completed, but this page may need a manual refresh."),
        );
      });

    return () => {
      cancelled = true;
    };
  }, [refresh, searchParams]);

  useEffect(() => {
    if (viewer.isAdmin) { setBootstrapStatus("already_admin"); return; }
    let cancelled = false;
    void fetch("/api/console/bootstrap-admin/status", { credentials: "include", cache: "no-store" })
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) { setBootstrapStatus("unavailable"); return; }
        const p = await res.json() as { eligible?: boolean; reason?: BootstrapAdminStatus };
        setBootstrapStatus(p.eligible === true ? "available" : (p.reason ?? "unavailable"));
      })
      .catch(() => { if (!cancelled) setBootstrapStatus("unavailable"); });
    return () => { cancelled = true; };
  }, [viewer.isAdmin]);

  async function handleRedeemReferral() {
    const code = referralInput.trim();
    if (!code) { setReferralError("Enter a code."); return; }
    setIsRedeemingReferral(true); setReferralError(null); setReferralSuccess(null);
    try {
      await billing.redeemReferral(code);
      setReferralSuccess(
        `Code applied! ${formatNumber(catalog?.referral.inviteeBonusCredits ?? 100)} credits added.`,
      );
      setReferralInput("");
      void billing.getCatalog().then(setCatalog).catch(() => {});
      void refresh();
    } catch (e) { setReferralError(getApiErrorMessage(e, "Failed to redeem.")); }
    finally { setIsRedeemingReferral(false); }
  }

  async function handleUpdateCode() {
    const code = newCode.trim();
    if (!code) { setCodeError("Enter a code."); return; }
    setIsSavingCode(true); setCodeError(null);
    try {
      const result = await billing.updateReferralCode(code);
      setCatalog((prev) => prev ? { ...prev, referral: { ...prev.referral, code: result.code } } : prev);
      setEditingCode(false);
      setNewCode("");
    } catch (e) { setCodeError(getApiErrorMessage(e, "Failed to update.")); }
    finally { setIsSavingCode(false); }
  }

  function handleCopyLink() {
    const code = catalog?.referral.code;
    if (!code) return;
    const origin = pageOrigin ?? window.location.origin;
    const link = buildReferralUrl(origin, code);
    setCopyLinkError(null);
    void navigator.clipboard.writeText(link)
      .then(() => {
        setCopiedLink(true);
        window.setTimeout(() => setCopiedLink(false), 2000);
      })
      .catch(() => {
        setCopyLinkError("Copy failed. Select and copy the link manually.");
      });
  }

  async function handleBootstrapAdmin() {
    const secret = bootstrapSecret.trim();
    if (!secret) { setBootstrapError("Secret required."); return; }
    setIsPromotingAdmin(true); setBootstrapError(null);
    try {
      const res = await fetch("/api/console/bootstrap-admin", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ secret }) });
      const payload = await res.json().catch(() => null) as { detail?: string } | null;
      if (!res.ok) { setBootstrapError(payload?.detail ?? "Failed."); return; }
      router.replace("/admin"); router.refresh();
    } catch { setBootstrapError("Failed."); }
    finally { setIsPromotingAdmin(false); }
  }

  const referral = catalog?.referral;
  const referralPath = referral?.code ? buildReferralPath(referral.code) : null;
  const referralLink = referral?.code && pageOrigin
    ? buildReferralUrl(pageOrigin, referral.code)
    : null;

  return (
    <DashboardLayout currentPath="/dashboard/settings" title="Settings" actions={null}>
      {isLoading && !data ? (
        <DashboardSkeleton />
      ) : error && !data ? (
        <DashboardState title="Could not load settings" description={error} tone="error"
          action={<button className="button-primary" onClick={() => void refresh()} type="button">Retry</button>} />
      ) : data ? (
        <div className="space-y-6">
          {checkoutNotice ? (
            <DashboardNotice title="Billing update" description={checkoutNotice} tone="success" />
          ) : null}

          {/* ── Profile ───────────────────────────────── */}
          <section>
            <h2 className="mb-3 text-sm font-semibold text-[var(--foreground)]">Profile</h2>
            <AccountProfilePanel />
          </section>

          {/* ── Referral ──────────────────────────────── */}
          <section>
            <h2 className="mb-3 text-sm font-semibold text-[var(--foreground)]">Referral</h2>
            <div className="space-y-3">
              {/* Invite link + code */}
              <div className="rounded-[18px] border border-[var(--border)] bg-white/60 px-5 py-4">
                <p className="text-xs text-[var(--foreground-tertiary)]">Your invite link</p>
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="min-w-0 flex-1 rounded-[10px] border border-[var(--border)] bg-white/80 px-3 py-2 font-mono text-sm text-[var(--foreground)]">
                    {referralLink ?? referralPath ?? "—"}
                  </div>
                  <button type="button" onClick={handleCopyLink} className="flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] border border-[var(--border)] bg-white/70 px-3 text-xs text-[var(--foreground-secondary)] transition hover:bg-white hover:text-[var(--foreground)]">
                    <IconCopy className="h-3.5 w-3.5" />
                    {copiedLink ? "Copied!" : "Copy"}
                  </button>
                </div>
                {copyLinkError ? (
                  <p className="mt-2 text-xs text-[var(--error)]">{copyLinkError}</p>
                ) : null}

                {/* Editable code */}
                <div className="mt-3 flex items-center gap-2">
                  <p className="text-xs text-[var(--foreground-tertiary)]">Code:</p>
                  {editingCode ? (
                    <>
                      <input
                        type="text"
                        value={newCode}
                        onChange={(e) => setNewCode(e.target.value)}
                        placeholder="4–20 characters"
                        className="h-7 w-36 rounded-[6px] border border-[var(--border)] bg-white/82 px-2 font-mono text-xs text-[var(--foreground)] outline-none focus:border-[var(--border-brand)]"
                        maxLength={20}
                      />
                      <button className="button-primary h-7 px-2.5 text-[11px]" disabled={isSavingCode} onClick={() => void handleUpdateCode()} type="button">
                        {isSavingCode ? "..." : "Save"}
                      </button>
                      <button className="text-[11px] text-[var(--foreground-tertiary)] hover:text-[var(--foreground)]" onClick={() => { setEditingCode(false); setCodeError(null); }} type="button">
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="font-mono text-xs font-medium text-[var(--foreground)]">{referral?.code || "—"}</span>
                      <button type="button" onClick={() => { setEditingCode(true); setNewCode(referral?.code ?? ""); }} className="text-[var(--foreground-tertiary)] transition hover:text-[var(--foreground)]">
                        <IconEdit className="h-3 w-3" />
                      </button>
                    </>
                  )}
                  {codeError && <span className="text-[11px] text-[var(--error)]">{codeError}</span>}
                </div>

                <p className="mt-2 text-xs text-[var(--foreground-tertiary)]">
                  Invitees get {formatNumber(referral?.inviteeBonusCredits ?? 100)} credits and inviters get {formatNumber(referral?.inviterBonusCredits ?? 200)} credits instantly. Credits expire in 90 days.
                </p>
              </div>

              {/* Stats */}
              {referral && referral.totalReferred > 0 && (
                <div className="rounded-[18px] border border-[var(--border)] bg-white/60 px-5 py-4">
                  <div className="flex items-center gap-6">
                    <div>
                      <p className="text-xs text-[var(--foreground-tertiary)]">Invited</p>
                      <p className="text-lg font-semibold text-[var(--foreground)]">{referral.totalReferred}<span className="text-sm font-normal text-[var(--foreground-tertiary)]"> / {referral.maxReferrals}</span></p>
                    </div>
                    <div>
                      <p className="text-xs text-[var(--foreground-tertiary)]">Credits earned</p>
                      <p className="text-lg font-semibold text-[var(--foreground)]">{formatNumber(referral.totalCreditsEarned)}</p>
                    </div>
                  </div>

                  {referral.referrals.length > 0 && (
                    <div className="mt-3 border-t border-[var(--border)] pt-3">
                      <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--foreground-tertiary)]">Recent referrals</p>
                      <div className="space-y-1.5">
                        {referral.referrals.slice(0, 10).map((r, i) => (
                          <div key={i} className="flex items-center justify-between text-sm">
                            <span className="font-mono text-xs text-[var(--foreground-secondary)]">{r.refereeEmail}</span>
                            <div className="flex items-center gap-3">
                              <span className={`text-xs ${r.status === "awarded" ? "text-[var(--success)]" : "text-[var(--foreground-tertiary)]"}`}>
                                {r.status === "awarded" ? `+${r.creditsEarned}` : r.status}
                              </span>
                              <span className="text-xs text-[var(--foreground-tertiary)]">{formatRelativeDate(r.createdAt)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Redeem */}
              <div className="rounded-[18px] border border-[var(--border)] bg-white/60 px-5 py-4">
                <p className="text-xs text-[var(--foreground-tertiary)]">Have a referral code?</p>
                <div className="mt-2 flex gap-2">
                  <input
                    type="text"
                    value={referralInput}
                    onChange={(e) => setReferralInput(e.target.value)}
                    placeholder="Enter code"
                    disabled={Boolean(referral?.redeemedCode)}
                    className="h-9 flex-1 rounded-[10px] border border-[var(--border)] bg-white/78 px-3 text-sm text-[var(--foreground)] outline-none transition placeholder:text-[var(--foreground-tertiary)] focus:border-[var(--border-brand)] disabled:opacity-50"
                  />
                  <button
                    className="button-secondary h-9 shrink-0 px-4 text-sm"
                    disabled={isRedeemingReferral || Boolean(referral?.redeemedCode)}
                    onClick={() => void handleRedeemReferral()}
                    type="button"
                  >
                    {isRedeemingReferral ? "..." : "Redeem"}
                  </button>
                </div>
                {referral?.redeemedCode && (
                  <p className="mt-2 text-xs text-[var(--foreground-secondary)]">
                    Redeemed: <span className="font-mono text-[var(--foreground)]">{referral.redeemedCode}</span>
                    {referral.status ? ` · ${referral.status}` : ""}
                  </p>
                )}
                {referralError && <p className="mt-2 text-xs text-[var(--error)]">{referralError}</p>}
                {referralSuccess && <p className="mt-2 text-xs text-[var(--success)]">{referralSuccess}</p>}
              </div>
            </div>
          </section>

          {/* ── Bootstrap admin ────────────────────────── */}
          {!viewer.isAdmin && bootstrapStatus === "available" && (
            <section>
              <h2 className="mb-3 text-sm font-semibold text-[var(--foreground)]">Admin</h2>
              <div className="rounded-[18px] border border-[var(--border)] bg-white/60 px-5 py-4">
                <p className="text-xs text-[var(--foreground-tertiary)]">No admin exists yet. Enter bootstrap secret to promote this account.</p>
                <div className="mt-3 flex gap-2">
                  <input type="password" value={bootstrapSecret} onChange={(e) => setBootstrapSecret(e.target.value)} placeholder="Bootstrap secret" autoComplete="off"
                    className="h-9 flex-1 rounded-[10px] border border-[var(--border)] bg-white/78 px-3 text-sm text-[var(--foreground)] outline-none transition placeholder:text-[var(--foreground-tertiary)] focus:border-[var(--border-brand)]"
                  />
                  <button className="button-primary h-9 shrink-0 px-4 text-sm" type="button" disabled={isPromotingAdmin} onClick={() => void handleBootstrapAdmin()}>
                    {isPromotingAdmin ? "..." : "Promote"}
                  </button>
                </div>
                {bootstrapError && <p className="mt-2 text-xs text-[var(--error)]">{bootstrapError}</p>}
              </div>
            </section>
          )}

        </div>
      ) : (
        <DashboardState title="No data" description="Settings could not be loaded." />
      )}
    </DashboardLayout>
  );
}
