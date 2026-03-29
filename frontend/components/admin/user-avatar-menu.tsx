"use client";

import { useEffect, useRef, useState, startTransition } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth";
import { getAuthErrorMessage } from "@/lib/auth-shared";
import { useConsoleViewer } from "@/components/console/console-viewer-context";
import { ProfileSettingsModal } from "./profile-settings-modal";

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
  const [showProfile, setShowProfile] = useState(false);
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
          className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-slate-700 bg-slate-800 transition-colors hover:border-slate-500"
        >
          {viewer.image ? (
            <img
              src={viewer.image}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="text-xs font-semibold text-slate-300">{initials}</span>
          )}
        </button>

        {/* Dropdown */}
        {open ? (
          <div className="absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-xl border border-slate-700 bg-[#111827] shadow-xl">
            {/* Header */}
            <div className="border-b border-slate-800 px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-600 bg-slate-800">
                  {viewer.image ? (
                    <img src={viewer.image} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-sm font-semibold text-slate-300">{initials}</span>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-white">
                    {viewer.displayName ?? "User"}
                  </p>
                  <p className="truncate text-xs text-slate-400">
                    {viewer.email ?? ""}
                  </p>
                </div>
              </div>
            </div>

            {/* Menu items */}
            <div className="py-1">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setShowProfile(true);
                }}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
              >
                <svg className="h-4 w-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
                </svg>
                Profile Settings
              </button>
            </div>

            {/* Divider + Sign out */}
            <div className="border-t border-slate-800 py-1">
              {signOutError ? (
                <p className="px-4 py-1 text-xs text-red-400">{signOutError}</p>
              ) : null}
              <button
                type="button"
                disabled={isSigningOut}
                onClick={() => void handleSignOut()}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-slate-300 transition-colors hover:bg-slate-800 hover:text-white disabled:opacity-50"
              >
                <svg className="h-4 w-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
                </svg>
                {isSigningOut ? "Signing out..." : "Sign out"}
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {showProfile ? (
        <ProfileSettingsModal onClose={() => setShowProfile(false)} />
      ) : null}
    </>
  );
}
