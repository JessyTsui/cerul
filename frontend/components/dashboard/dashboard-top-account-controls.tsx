"use client";

import Link from "next/link";
import { startTransition, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth";
import { getAuthErrorMessage } from "@/lib/auth-shared";
import { formatNumber, getTierLabel } from "@/lib/dashboard";
import { useConsoleViewer } from "@/components/console/console-viewer-context";
import { useMonthlyUsage } from "./use-monthly-usage";

function getInitials(displayName: string | null, email: string | null): string {
  if (displayName) {
    return displayName
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0] ?? "")
      .join("")
      .toUpperCase();
  }

  return email?.[0]?.toUpperCase() ?? "U";
}

function IconBolt({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24">
      <path d="M13.5 2.75 6.75 13.5h4.5l-.75 7.75 6.75-10.75h-4.5l.75-7.75Z" fill="currentColor" />
    </svg>
  );
}

function IconCreditCard({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path d="M2.25 8.25h19.5M2.25 9h19.5m-1.5 10.5V7.5a2.25 2.25 0 0 0-2.25-2.25H4.5A2.25 2.25 0 0 0 2.25 7.5v12a2.25 2.25 0 0 0 2.25 2.25h15a2.25 2.25 0 0 0 2.25-2.25Z" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} />
    </svg>
  );
}

function IconGift({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path d="M21 11.25v8.25a1.5 1.5 0 0 1-1.5 1.5H4.5A1.5 1.5 0 0 1 3 19.5V11.25m18 0A1.5 1.5 0 0 0 21 9.75V8.25A2.25 2.25 0 0 0 18.75 6H18a3 3 0 0 0-3-3c-.86 0-1.637.366-2.182.952A3.001 3.001 0 0 0 10.5 3 3 3 0 0 0 7.5 6h-.75A2.25 2.25 0 0 0 4.5 8.25v1.5A1.5 1.5 0 0 0 6 11.25m15 0H6" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} />
    </svg>
  );
}

function IconArrowRight({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path d="M4.5 12h15m0 0-5.25-5.25M19.5 12l-5.25 5.25" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
    </svg>
  );
}

export function DashboardTopAccountControls() {
  const viewer = useConsoleViewer();
  const { data, lastUpdatedAt } = useMonthlyUsage();
  const router = useRouter();
  const [creditDropdownOpen, setCreditDropdownOpen] = useState(false);
  const [avatarDropdownOpen, setAvatarDropdownOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  // Refs for hover timeout
  const creditTimeoutRef = useRef<number | null>(null);
  const avatarTimeoutRef = useRef<number | null>(null);

  const initials = getInitials(viewer.displayName, viewer.email);
  const spendableCredits = data ? formatNumber(data.walletBalance) : "—";
  const planLabel = data ? getTierLabel(data.tier) : "Free";

  // Clear timeouts on unmount
  useEffect(() => {
    return () => {
      if (creditTimeoutRef.current) window.clearTimeout(creditTimeoutRef.current);
      if (avatarTimeoutRef.current) window.clearTimeout(avatarTimeoutRef.current);
    };
  }, []);

  // Close dropdowns when clicking outside
  useEffect(() => {
    function handleDocumentClick(event: MouseEvent) {
      const target = event.target as Node;
      const creditDropdown = document.getElementById("credit-dropdown");
      const creditButton = document.getElementById("credit-button");
      const avatarDropdown = document.getElementById("avatar-dropdown");
      const avatarButton = document.getElementById("avatar-button");

      const isCreditClick = creditDropdown?.contains(target) || creditButton?.contains(target);
      const isAvatarClick = avatarDropdown?.contains(target) || avatarButton?.contains(target);

      if (!isCreditClick) setCreditDropdownOpen(false);
      if (!isAvatarClick) setAvatarDropdownOpen(false);
    }

    document.addEventListener("mousedown", handleDocumentClick);
    return () => document.removeEventListener("mousedown", handleDocumentClick);
  }, []);

  // Credit dropdown handlers with delayed close
  const openCreditDropdown = () => {
    if (creditTimeoutRef.current) {
      window.clearTimeout(creditTimeoutRef.current);
      creditTimeoutRef.current = null;
    }
    setCreditDropdownOpen(true);
  };

  const closeCreditDropdown = () => {
    creditTimeoutRef.current = window.setTimeout(() => {
      setCreditDropdownOpen(false);
    }, 150);
  };

  // Avatar dropdown handlers with delayed close
  const openAvatarDropdown = () => {
    if (avatarTimeoutRef.current) {
      window.clearTimeout(avatarTimeoutRef.current);
      avatarTimeoutRef.current = null;
    }
    setAvatarDropdownOpen(true);
  };

  const closeAvatarDropdown = () => {
    avatarTimeoutRef.current = window.setTimeout(() => {
      setAvatarDropdownOpen(false);
    }, 150);
  };

  async function handleSignOut() {
    setSignOutError(null);
    setIsSigningOut(true);

    try {
      const result = await authClient.signOut();
      if (result.error) {
        setSignOutError(getAuthErrorMessage(result.error, "Unable to sign out right now."));
        return;
      }

      startTransition(() => {
        router.replace("/login");
        router.refresh();
      });
    } catch (error) {
      setSignOutError(getAuthErrorMessage(error, "Unable to sign out right now."));
    } finally {
      setIsSigningOut(false);
    }
  }

  return (
    <div className="relative z-[110] flex items-center gap-3">
      {/* Credits badge with hover dropdown - Lovart style */}
      <div
        className="relative"
        onMouseEnter={openCreditDropdown}
        onMouseLeave={closeCreditDropdown}
      >
        <button
          id="credit-button"
          type="button"
          className="flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-white/88 px-3 py-1.5 text-sm font-medium text-[var(--foreground-secondary)] transition hover:bg-white hover:text-[var(--foreground)]"
        >
          <IconBolt className="h-4 w-4 text-[var(--brand)]" />
          <span>{spendableCredits}</span>
        </button>

        {/* Credits dropdown - Lovart style breakdown */}
        {creditDropdownOpen && data && (
          <div
            id="credit-dropdown"
            className="animate-dropdown-in absolute right-0 top-full z-[140] mt-2 w-[280px] rounded-[20px] border border-[var(--border)] bg-white/98 p-4 shadow-[0_24px_70px_rgba(27,20,13,0.14)] backdrop-blur-xl"
            onMouseEnter={openCreditDropdown}
            onMouseLeave={closeCreditDropdown}
          >
            {/* Plan header */}
            <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
              <span className="text-base font-semibold text-[var(--foreground)]">{planLabel}</span>
              <Link
                href="/dashboard/billing"
                className="button-primary rounded-full px-3 py-1 text-xs font-medium"
                onClick={() => setCreditDropdownOpen(false)}
              >
                Upgrade
              </Link>
            </div>

            {/* Credit breakdown */}
            <div className="mt-3 space-y-3">
              {/* Total remaining */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <IconBolt className="h-4 w-4 text-[var(--brand)]" />
                  <span className="text-sm text-[var(--foreground)]">Spendable credits</span>
                </div>
                <span className="text-sm font-semibold text-[var(--foreground)]">
                  {formatNumber(data.walletBalance)}
                </span>
              </div>

              {/* Included */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <IconCreditCard className="h-4 w-4 text-[var(--accent)]" />
                  <span className="text-xs text-[var(--foreground-secondary)]">Included</span>
                </div>
                <span className="text-xs text-[var(--foreground-secondary)]">
                  {formatNumber(data.creditBreakdown.includedRemaining)}
                </span>
              </div>

              {/* Purchased */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <IconCreditCard className="h-4 w-4 text-[var(--foreground-tertiary)]" />
                  <span className="text-xs text-[var(--foreground-secondary)]">Purchased</span>
                </div>
                <span className="text-xs text-[var(--foreground-secondary)]">
                  {formatNumber(data.creditBreakdown.paidRemaining)}
                </span>
              </div>

              {/* Bonus */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <IconGift className="h-4 w-4 text-[var(--success)]" />
                  <span className="text-xs text-[var(--foreground-secondary)]">Bonus</span>
                </div>
                <span className="text-xs text-[var(--foreground-secondary)]">
                  {formatNumber(data.creditBreakdown.bonusRemaining)}
                </span>
              </div>

              {/* Daily free */}
              <div className="flex items-center justify-between rounded-[12px] bg-[var(--background-elevated)] px-3 py-2">
                <div className="flex items-center gap-2">
                  <IconBolt className="h-4 w-4 text-[var(--foreground-tertiary)]" />
                  <span className="text-xs text-[var(--foreground-secondary)]">Daily free</span>
                </div>
                <span className="text-xs font-medium text-[var(--foreground)]">
                  {formatNumber(data.dailyFreeRemaining)} / {formatNumber(data.dailyFreeLimit)}
                </span>
              </div>
            </div>

            {/* Usage details link */}
            <Link
              href="/dashboard/usage"
              className="mt-4 flex items-center justify-between rounded-[14px] px-2 py-2 text-sm text-[var(--foreground-secondary)] transition hover:bg-[var(--background-elevated)] hover:text-[var(--foreground)]"
              onClick={() => setCreditDropdownOpen(false)}
            >
              <span>Usage details</span>
              <IconArrowRight className="h-4 w-4" />
            </Link>

            {/* Timestamp */}
            {lastUpdatedAt && (
              <div className="mt-3 border-t border-[var(--border)] pt-3">
                <span className="text-xs text-[var(--foreground-tertiary)]">
                  Updated {lastUpdatedAt.toLocaleTimeString()}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* User avatar with hover dropdown */}
      <div
        className="relative"
        onMouseEnter={openAvatarDropdown}
        onMouseLeave={closeAvatarDropdown}
      >
        <button
          id="avatar-button"
          type="button"
          className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--border)] bg-white/88 transition hover:border-[var(--border-strong)] hover:bg-white"
        >
          {viewer.image ? (
            // Avatar hosts come from auth providers, so we intentionally avoid a global next/image allowlist here.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={viewer.image} alt="" className="h-full w-full rounded-full object-cover" />
          ) : (
            <span className="text-xs font-semibold text-[var(--foreground-secondary)]">{initials}</span>
          )}
        </button>

        {/* Avatar dropdown */}
        {avatarDropdownOpen && (
          <div
            id="avatar-dropdown"
            className="animate-dropdown-in absolute right-0 top-full z-[140] mt-2 w-[260px] rounded-[20px] border border-[var(--border)] bg-white/98 p-3 shadow-[0_24px_70px_rgba(27,20,13,0.14)] backdrop-blur-xl"
            onMouseEnter={openAvatarDropdown}
            onMouseLeave={closeAvatarDropdown}
          >
            {/* User info header */}
            <div className="flex items-center gap-3 border-b border-[var(--border)] pb-3">
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--background-elevated)] text-sm font-semibold text-[var(--foreground-secondary)]">
                {viewer.image ? (
                  // Avatar hosts come from auth providers, so we intentionally avoid a global next/image allowlist here.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={viewer.image} alt="" className="h-full w-full rounded-full object-cover" />
                ) : (
                  initials
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-[var(--foreground)]">
                  {viewer.displayName || "Personal"}
                </p>
                <p className="truncate text-xs text-[var(--foreground-secondary)]">{viewer.email || ""}</p>
              </div>
            </div>

            {/* Menu items */}
            <div className="mt-2 space-y-0.5">
              <Link
                href="/dashboard/settings"
                onClick={() => setAvatarDropdownOpen(false)}
                className="flex w-full items-center justify-between rounded-[14px] px-3 py-2.5 text-left text-sm text-[var(--foreground-secondary)] transition hover:bg-[var(--background-elevated)] hover:text-[var(--foreground)]"
              >
                <span>Account settings</span>
              </Link>
              <Link
                href="/dashboard/billing"
                onClick={() => setAvatarDropdownOpen(false)}
                className="flex w-full items-center justify-between rounded-[14px] px-3 py-2.5 text-left text-sm text-[var(--foreground-secondary)] transition hover:bg-[var(--background-elevated)] hover:text-[var(--foreground)]"
              >
                <span>Billing & credits</span>
              </Link>
              <Link
                href="/dashboard/usage"
                onClick={() => setAvatarDropdownOpen(false)}
                className="flex w-full items-center justify-between rounded-[14px] px-3 py-2.5 text-left text-sm text-[var(--foreground-secondary)] transition hover:bg-[var(--background-elevated)] hover:text-[var(--foreground)]"
              >
                <span>Usage</span>
              </Link>
            </div>

            {signOutError ? (
              <p className="mt-2 rounded-[12px] border border-[rgba(191,91,70,0.35)] bg-[rgba(191,91,70,0.12)] px-3 py-2 text-xs text-[var(--error)]">
                {signOutError}
              </p>
            ) : null}

            <button
              type="button"
              disabled={isSigningOut}
              onClick={() => void handleSignOut()}
              className="mt-2 flex w-full items-center justify-between rounded-[14px] px-3 py-2.5 text-left text-sm text-[var(--foreground-secondary)] transition hover:bg-[var(--background-elevated)] hover:text-[var(--foreground)] disabled:opacity-60"
            >
              <span>{isSigningOut ? "Signing out..." : "Sign out"}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
