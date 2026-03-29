"use client";

import type { Route } from "next";
import Link from "next/link";
import { useEffect, useRef, useState, startTransition } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth";
import { getAuthErrorMessage } from "@/lib/auth-shared";
import { useConsoleViewer } from "@/components/console/console-viewer-context";
import { ACCOUNT_SETTINGS_ROUTE } from "@/lib/site";

function getInitials(displayName: string | null, email: string | null): string {
  if (displayName) {
    return displayName
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase();
  }
  if (email) {
    return email[0]?.toUpperCase() ?? "U";
  }
  return "U";
}

export function UserAvatarMenu() {
  const viewer = useConsoleViewer();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const initials = getInitials(viewer.displayName, viewer.email);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
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
    } catch (err) {
      setSignOutError(getAuthErrorMessage(err, "Unable to sign out right now."));
    } finally {
      setIsSigningOut(false);
    }
  }

  return (
    <>
      <div ref={menuRef} className="relative">
        {/* Avatar trigger */}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-[var(--border)] bg-[var(--surface)] transition-colors hover:border-[var(--border-strong)]"
        >
          {viewer.image ? (
            // Avatar hosts come from auth providers, so we intentionally avoid a global next/image allowlist here.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={viewer.image}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="text-xs font-semibold text-[var(--foreground-secondary)]">{initials}</span>
          )}
        </button>

        {/* Dropdown */}
        {open ? (
          <div className="absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-[22px] border border-[var(--border)] bg-[var(--surface-elevated)] shadow-[0_18px_50px_rgba(27,20,13,0.12)]">
            {/* Header */}
            <div className="border-b border-[var(--border)] px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--border)] bg-[var(--surface)]">
                  {viewer.image ? (
                    // Avatar hosts come from auth providers, so we intentionally avoid a global next/image allowlist here.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={viewer.image} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-sm font-semibold text-[var(--foreground-secondary)]">
                      {initials}
                    </span>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[var(--foreground)]">
                    {viewer.displayName ?? "User"}
                  </p>
                  <p className="truncate text-xs text-[var(--foreground-tertiary)]">
                    {viewer.email ?? ""}
                  </p>
                </div>
              </div>
            </div>

            {/* Menu items */}
            <div className="py-1">
              <Link
                href={ACCOUNT_SETTINGS_ROUTE as Route}
                onClick={() => setOpen(false)}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-[var(--foreground-secondary)] transition-colors hover:bg-[var(--background-sunken)] hover:text-[var(--foreground)]"
              >
                <svg
                  className="h-4 w-4 text-[var(--foreground-tertiary)]"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
                </svg>
                Account settings
              </Link>
            </div>

            {/* Divider + Sign out */}
            <div className="border-t border-[var(--border)] py-1">
              {signOutError ? (
                <p className="px-4 py-1 text-xs text-[var(--error)]">{signOutError}</p>
              ) : null}
              <button
                type="button"
                disabled={isSigningOut}
                onClick={() => void handleSignOut()}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-[var(--foreground-secondary)] transition-colors hover:bg-[var(--background-sunken)] hover:text-[var(--foreground)] disabled:opacity-50"
              >
                <svg
                  className="h-4 w-4 text-[var(--foreground-tertiary)]"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
                </svg>
                {isSigningOut ? "Signing out..." : "Sign out"}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
