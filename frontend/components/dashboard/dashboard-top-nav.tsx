"use client";

import type { Route } from "next";
import Link from "next/link";
import { UserAvatarMenu } from "@/components/admin/user-avatar-menu";
import { useConsoleViewer } from "@/components/console/console-viewer-context";
import { dashboardRoutes, isDashboardRouteActive } from "@/lib/site";

type DashboardTopNavProps = {
  currentPath: string;
};

export function DashboardTopNav({ currentPath }: DashboardTopNavProps) {
  const viewer = useConsoleViewer();
  const activeRoute =
    dashboardRoutes.find((item) => isDashboardRouteActive(currentPath, item.href))?.label ?? "Overview";

  return (
    <header className="border-b border-[var(--border)] bg-white/30 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1120px] items-center justify-between gap-4 px-5 py-4 sm:px-6 lg:px-8">
        <div className="hidden items-center gap-2 text-sm md:flex">
          <span className="rounded-full border border-[var(--border)] bg-white/72 px-3 py-1 text-[var(--foreground-tertiary)]">
            Pages
          </span>
          <span className="text-[var(--foreground-tertiary)]">/</span>
          <span className="font-medium text-[var(--foreground)]">{activeRoute}</span>
        </div>

        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          <span className="inline-flex items-center gap-2 rounded-full border border-[rgba(31,141,74,0.16)] bg-white/78 px-4 py-2 text-sm font-medium text-[var(--foreground)]">
            <span className="h-2.5 w-2.5 rounded-full bg-[var(--success)]" />
            Operational
          </span>
          <Link
            href={"/search" as Route}
            className="inline-flex h-10 items-center rounded-full border border-[var(--border)] bg-white/70 px-4 text-sm font-medium text-[var(--foreground-secondary)] transition hover:border-[var(--border-strong)] hover:bg-white hover:text-[var(--foreground)]"
          >
            Playground
          </Link>
          <Link
            href={"/docs" as Route}
            className="inline-flex h-10 items-center rounded-full border border-[var(--border)] bg-white/70 px-4 text-sm font-medium text-[var(--foreground-secondary)] transition hover:border-[var(--border-strong)] hover:bg-white hover:text-[var(--foreground)]"
          >
            Docs
          </Link>
          {viewer.isAdmin ? (
            <Link
              href={"/admin" as Route}
              className="inline-flex h-10 items-center rounded-full border border-[var(--border)] bg-white/70 px-4 text-sm font-medium text-[var(--foreground-secondary)] transition hover:border-[var(--border-strong)] hover:bg-white hover:text-[var(--foreground)]"
            >
              Admin
            </Link>
          ) : null}
          <a
            href="https://github.com/JessyTsui/cerul"
            target="_blank"
            rel="noreferrer"
            aria-label="Open Cerul on GitHub"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--border)] bg-white/70 text-[var(--foreground-secondary)] transition hover:border-[var(--border-strong)] hover:bg-white hover:text-[var(--foreground)]"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 0C5.373 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.6.112.793-.26.793-.577v-2.234C5.662 21.303 4.967 19.16 4.967 19.16c-.546-1.387-1.333-1.756-1.333-1.756-1.089-.744.083-.729.083-.729 1.205.084 1.838 1.237 1.838 1.237 1.071 1.834 2.808 1.304 3.493.998.107-.776.418-1.305.762-1.605-2.665-.304-5.467-1.333-5.467-5.931 0-1.31.469-2.38 1.235-3.22-.123-.303-.535-1.524.118-3.176 0 0 1.007-.322 3.301 1.229A11.53 11.53 0 0 1 12 5.8c1.02.005 2.047.138 3.005.404 2.292-1.551 3.299-1.229 3.299-1.229.653 1.652.242 2.873.119 3.176.768.84 1.234 1.91 1.234 3.22 0 4.61-2.805 5.625-5.476 5.922.43.37.823 1.102.823 2.222v3.293c0 .319.192.69.8.576C20.565 21.796 24 17.3 24 12 24 5.373 18.627 0 12 0Z" />
            </svg>
          </a>
          <UserAvatarMenu />
        </div>
      </div>
    </header>
  );
}
