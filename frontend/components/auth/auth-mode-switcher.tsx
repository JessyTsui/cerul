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
    <div className="rounded-[22px] border border-[var(--border)] bg-white/76 p-1.5 shadow-[0_12px_26px_rgba(70,52,29,0.06)]">
      <div className="grid grid-cols-2 gap-1">
        <Link
          href={buildAuthPageHref("/login", nextPath) as Route}
          className={`inline-flex min-h-11 items-center justify-center rounded-[14px] px-4 text-base font-medium transition ${
            activeMode === "login"
              ? "auth-tab-active border border-[rgba(32,25,18,0.08)] bg-[linear-gradient(180deg,#383027,#231d17)] shadow-[0_12px_28px_rgba(70,52,29,0.12)]"
              : "border border-transparent text-[var(--foreground-secondary)] hover:bg-white hover:text-[var(--foreground)]"
          }`}
        >
          Sign in
        </Link>
        <Link
          href={buildAuthPageHref("/signup", nextPath) as Route}
          className={`inline-flex min-h-11 items-center justify-center rounded-[14px] px-4 text-base font-medium transition ${
            activeMode === "signup"
              ? "auth-tab-active border border-[rgba(32,25,18,0.08)] bg-[linear-gradient(180deg,#383027,#231d17)] shadow-[0_12px_28px_rgba(70,52,29,0.12)]"
              : "border border-transparent text-[var(--foreground-secondary)] hover:bg-white hover:text-[var(--foreground)]"
          }`}
        >
          Sign up
        </Link>
      </div>
    </div>
  );
}
