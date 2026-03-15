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
    <div className="rounded-2xl border border-[var(--border)] bg-[rgba(255,255,255,0.02)] p-1">
      <div className="grid grid-cols-2 gap-1">
        <Link
          href={buildAuthPageHref("/login", nextPath) as Route}
          className={`inline-flex min-h-11 items-center justify-center rounded-[14px] px-4 text-base font-medium transition ${
            activeMode === "login"
              ? "border border-[var(--border-brand)] bg-[rgba(34,211,238,0.1)] text-[var(--brand-bright)] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
              : "border border-transparent text-[var(--foreground-tertiary)] hover:bg-[rgba(255,255,255,0.03)] hover:text-[var(--foreground-secondary)]"
          }`}
        >
          Sign in
        </Link>
        <Link
          href={buildAuthPageHref("/signup", nextPath) as Route}
          className={`inline-flex min-h-11 items-center justify-center rounded-[14px] px-4 text-base font-medium transition ${
            activeMode === "signup"
              ? "border border-[var(--border-brand)] bg-[rgba(34,211,238,0.1)] text-[var(--brand-bright)] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
              : "border border-transparent text-[var(--foreground-tertiary)] hover:bg-[rgba(255,255,255,0.03)] hover:text-[var(--foreground-secondary)]"
          }`}
        >
          Sign up
        </Link>
      </div>
    </div>
  );
}
