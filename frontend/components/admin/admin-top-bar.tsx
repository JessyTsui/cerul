"use client";

import type { Route } from "next";
import Link from "next/link";
import { adminRoutes, isAdminRouteActive } from "@/lib/site";
import { UserAvatarMenu } from "./user-avatar-menu";

type AdminTopBarProps = {
  currentPath: string;
};

export function AdminTopBar({ currentPath }: AdminTopBarProps) {
  const activeRoute =
    adminRoutes.find((item) => isAdminRouteActive(currentPath, item.href))?.label ??
    "Overview";

  return (
    <header className="border-b border-[var(--border)] bg-white/34 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1240px] items-center justify-between gap-4 px-5 py-4 sm:px-6 lg:px-8">
        <div className="hidden items-center gap-2 text-sm md:flex">
          <span className="rounded-full border border-[var(--border-brand)] bg-[var(--brand-subtle)] px-3 py-1 text-[var(--brand-bright)]">
            Admin
          </span>
          <span className="text-[var(--foreground-tertiary)]">/</span>
          <span className="font-medium text-[var(--foreground)]">{activeRoute}</span>
        </div>

        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          <div className="hidden min-w-[240px] items-center gap-3 rounded-full border border-[var(--border)] bg-white/72 px-4 py-2.5 lg:flex">
            <svg
              className="h-4 w-4 text-[var(--foreground-tertiary)]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
              />
            </svg>
            <span className="text-sm text-[var(--foreground-tertiary)]">
              Search admin pages
            </span>
          </div>

          <span className="hidden items-center gap-2 rounded-full border border-[rgba(31,141,74,0.18)] bg-white/78 px-4 py-2 text-sm font-medium text-[var(--foreground)] md:inline-flex">
            <span className="h-2.5 w-2.5 rounded-full bg-[var(--success)]" />
            Live telemetry
          </span>

          <Link
            href={"/dashboard" as Route}
            className="inline-flex h-10 items-center rounded-full border border-[var(--border)] bg-white/72 px-4 text-sm font-medium text-[var(--foreground-secondary)] transition hover:border-[var(--border-strong)] hover:bg-white hover:text-[var(--foreground)]"
          >
            Dashboard
          </Link>
          <Link
            href={"/docs" as Route}
            className="inline-flex h-10 items-center rounded-full border border-[var(--border)] bg-white/72 px-4 text-sm font-medium text-[var(--foreground-secondary)] transition hover:border-[var(--border-strong)] hover:bg-white hover:text-[var(--foreground)]"
          >
            Docs
          </Link>
          <Link
            href={"/search" as Route}
            className="inline-flex h-10 items-center rounded-full border border-[var(--border)] bg-white/72 px-4 text-sm font-medium text-[var(--foreground-secondary)] transition hover:border-[var(--border-strong)] hover:bg-white hover:text-[var(--foreground)]"
          >
            Playground
          </Link>
          <UserAvatarMenu />
        </div>
      </div>
    </header>
  );
}
