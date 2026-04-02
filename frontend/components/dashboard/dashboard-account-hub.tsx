"use client";

import { startTransition, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
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

export function DashboardAccountHub() {
  const viewer = useConsoleViewer();
  const { data } = useMonthlyUsage();
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  const initials = getInitials(viewer.displayName, viewer.email);
  const planLabel = data ? getTierLabel(data.tier) : "Free";
  const spendableCredits = data ? formatNumber(data.walletBalance) : "—";
  const freeToday = data
    ? `${formatNumber(data.dailyFreeRemaining)}/${formatNumber(data.dailyFreeLimit)} free today`
    : "—";

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleClick(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

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
    <div ref={containerRef} className="mt-auto border-t border-[var(--border)] pt-4">
      {/* Simplified one-line design: avatar + name + plan + credits */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 rounded-[18px] px-2 py-2 text-left transition hover:bg-white/56"
      >
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--background-elevated)] text-sm font-semibold text-[var(--foreground-secondary)]">
          {viewer.image ? (
            // Avatar hosts come from auth providers, so we intentionally avoid a global next/image allowlist here.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={viewer.image} alt="" className="h-full w-full object-cover" />
          ) : (
            initials
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-[var(--foreground)]">
            {viewer.displayName ?? "Personal"}
          </p>
          <p className="truncate text-xs text-[var(--foreground-secondary)]">
            {planLabel} · <IconBolt className="inline h-3 w-3" /> {spendableCredits} credits · {freeToday}
          </p>
        </div>
      </button>

      {open ? (
        <div className="animate-dropdown-in mt-2 space-y-1 rounded-[18px] border border-[var(--border)] bg-white/88 p-2 shadow-[0_12px_40px_rgba(27,20,13,0.08)]">
          <Link
            href={"/dashboard/settings" as Route}
            onClick={() => setOpen(false)}
            className="flex w-full items-center justify-between rounded-[14px] px-3 py-2.5 text-left text-sm text-[var(--foreground-secondary)] transition hover:bg-[var(--background-elevated)] hover:text-[var(--foreground)]"
          >
            <span>Account settings</span>
          </Link>
          <Link
            href={"/dashboard/usage" as Route}
            onClick={() => setOpen(false)}
            className="flex w-full items-center justify-between rounded-[14px] px-3 py-2.5 text-left text-sm text-[var(--foreground-secondary)] transition hover:bg-[var(--background-elevated)] hover:text-[var(--foreground)]"
          >
            <span>Usage & billing</span>
          </Link>

          {signOutError ? (
            <p className="rounded-[12px] border border-[rgba(191,91,70,0.35)] bg-[rgba(191,91,70,0.12)] px-3 py-2 text-xs text-[var(--error)]">
              {signOutError}
            </p>
          ) : null}

          <button
            type="button"
            disabled={isSigningOut}
            onClick={() => void handleSignOut()}
            className="flex w-full items-center justify-between rounded-[14px] px-3 py-2.5 text-left text-sm text-[var(--foreground-secondary)] transition hover:bg-[var(--background-elevated)] hover:text-[var(--foreground)] disabled:opacity-60"
          >
            <span>{isSigningOut ? "Signing out..." : "Sign out"}</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
