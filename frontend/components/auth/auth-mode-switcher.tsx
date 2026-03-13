"use client";

import type { Route } from "next";
import Link from "next/link";
import { buildAuthPageHref } from "@/lib/auth-shared";

type AuthModeSwitcherProps = {
  activeMode: "login" | "signup";
  nextPath: string;
};

export function AuthModeSwitcher({
  activeMode,
  nextPath,
}: AuthModeSwitcherProps) {
  return (
    <div className="rounded-[24px] border border-[rgba(255,255,255,0.08)] bg-[linear-gradient(145deg,rgba(9,14,26,0.92),rgba(17,24,39,0.76))] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
      <div className="grid grid-cols-2 gap-1">
        <Link
          href={buildAuthPageHref("/login", nextPath) as Route}
          className={`focus-ring rounded-[18px] px-4 py-3 text-center text-sm font-medium transition ${
            activeMode === "login"
              ? "bg-[linear-gradient(135deg,rgba(14,165,233,0.24),rgba(249,115,22,0.16))] text-white shadow-[0_12px_30px_rgba(14,165,233,0.16)]"
              : "text-[var(--foreground-secondary)] hover:bg-white/5 hover:text-white"
          }`}
        >
          Sign in
        </Link>
        <Link
          href={buildAuthPageHref("/signup", nextPath) as Route}
          className={`focus-ring rounded-[18px] px-4 py-3 text-center text-sm font-medium transition ${
            activeMode === "signup"
              ? "bg-[linear-gradient(135deg,rgba(249,115,22,0.24),rgba(14,165,233,0.14))] text-white shadow-[0_12px_30px_rgba(249,115,22,0.16)]"
              : "text-[var(--foreground-secondary)] hover:bg-white/5 hover:text-white"
          }`}
        >
          Sign up
        </Link>
      </div>
    </div>
  );
}
