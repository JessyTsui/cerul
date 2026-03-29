"use client";

import type { Route } from "next";
import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { useConsoleViewer } from "@/components/console/console-viewer-context";
import {
  ACCOUNT_SETTINGS_ROUTE,
  dashboardRoutes,
  isDashboardRouteActive,
} from "@/lib/site";

function IconHome({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path d="M3 10.5 12 3l9 7.5" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
      <path d="M5.25 9.75V21h13.5V9.75" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
      <path d="M9.75 21v-6.75h4.5V21" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
    </svg>
  );
}

function IconChartBar({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path d="M7.5 20.25v-9m4.5 9v-15m4.5 15V15m-12 5.25h15" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
    </svg>
  );
}

function IconCog({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.592c.55 0 1.02.398 1.11.94l.213 1.279c.066.39.322.72.682.883.36.162.778.14 1.12-.058l1.12-.647a1.125 1.125 0 0 1 1.434.17l1.834 1.834c.39.39.457 1 .17 1.435l-.647 1.119a1.125 1.125 0 0 0-.058 1.12c.162.36.492.616.883.682l1.279.213c.542.09.94.56.94 1.11v2.592c0 .55-.398 1.02-.94 1.11l-1.279.213a1.125 1.125 0 0 0-.883.682c-.162.36-.14.778.058 1.12l.647 1.12c.287.434.22 1.044-.17 1.434l-1.834 1.834a1.125 1.125 0 0 1-1.435.17l-1.119-.647a1.125 1.125 0 0 0-1.12-.058c-.36.162-.616.492-.682.883l-.213 1.279c-.09.542-.56.94-1.11.94h-2.592c-.55 0-1.02-.398-1.11-.94l-.213-1.279a1.125 1.125 0 0 0-.682-.883 1.125 1.125 0 0 0-1.12.058l-1.12.647a1.125 1.125 0 0 1-1.434-.17L3.567 19.3a1.125 1.125 0 0 1-.17-1.434l.647-1.12c.198-.342.22-.76.058-1.12a1.125 1.125 0 0 0-.883-.682l-1.279-.213A1.125 1.125 0 0 1 1 13.621V11.03c0-.55.398-1.02.94-1.11l1.279-.213c.39-.066.72-.322.883-.682.162-.36.14-.778-.058-1.12l-.647-1.12a1.125 1.125 0 0 1 .17-1.434L5.4 3.517a1.125 1.125 0 0 1 1.434-.17l1.12.647c.342.198.76.22 1.12.058.36-.162.616-.492.682-.883l.213-1.279Z" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} />
      <path d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} />
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

const ROUTE_ICONS: Record<string, React.FC<{ className?: string }>> = {
  Overview: IconHome,
  Usage: IconChartBar,
  Settings: IconCog,
};

type DashboardSidebarProps = {
  currentPath: string;
};

export function DashboardSidebar({ currentPath }: DashboardSidebarProps) {
  const viewer = useConsoleViewer();
  const initials = (viewer.displayName ?? viewer.email ?? "U")
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <aside className="hidden w-[292px] shrink-0 lg:block">
      <div className="sticky top-0 h-screen p-4 pr-0">
        <div className="surface-elevated flex h-full flex-col overflow-hidden rounded-[34px] px-4 py-5">
          <BrandMark />

          <div className="mt-7 rounded-[20px] border border-[var(--border-brand)] bg-[var(--brand-subtle)] px-4 py-4">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--brand-bright)]">
              Workspace
            </p>
            <Link
              href={ACCOUNT_SETTINGS_ROUTE as Route}
              className="mt-3 flex items-center justify-between gap-3 rounded-full bg-white/78 px-3 py-2.5 transition hover:bg-white"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[var(--background-sunken)] text-xs font-semibold text-[var(--foreground-secondary)]">
                  {initials || "U"}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[var(--foreground)]">Personal</p>
                  <p className="truncate text-xs text-[var(--foreground-tertiary)]">
                    {viewer.email ?? "Signed in"}
                  </p>
                </div>
              </div>
              <svg className="h-4 w-4 shrink-0 text-[var(--foreground-tertiary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
              </svg>
            </Link>
          </div>

          <div className="mt-7">
            <p className="px-3 text-xs font-medium uppercase tracking-[0.18em] text-[var(--foreground-tertiary)]">
              Console
            </p>
            <nav className="mt-3 space-y-1.5">
              {dashboardRoutes.map((item) => {
                const isActive = isDashboardRouteActive(currentPath, item.href);
                const Icon = ROUTE_ICONS[item.label] ?? IconCog;

                return (
                  <Link
                    key={item.href}
                    href={item.href as Route}
                    className={`flex items-center gap-3 rounded-[18px] border px-4 py-3 transition ${
                      isActive
                        ? "border-[var(--border-brand)] bg-[var(--brand-subtle)] text-[var(--foreground)]"
                        : "border-transparent text-[var(--foreground-secondary)] hover:border-[var(--border)] hover:bg-white/56 hover:text-[var(--foreground)]"
                    }`}
                  >
                    <span
                      className={`inline-flex h-9 w-9 items-center justify-center rounded-full ${
                        isActive ? "bg-white/78 text-[var(--brand-bright)]" : "bg-white/46 text-[var(--foreground-tertiary)]"
                      }`}
                    >
                      <Icon className="h-[18px] w-[18px]" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{item.label}</p>
                    </div>
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="mt-7">
            <p className="px-3 text-xs font-medium uppercase tracking-[0.18em] text-[var(--foreground-tertiary)]">
              Shortcuts
            </p>
            <div className="mt-3 space-y-1.5">
              {[
                { href: "/docs", label: "Documentation", external: false },
                { href: "/docs/api-reference", label: "API reference", external: false },
                { href: "/pricing", label: "Pricing", external: false },
              ].map((item) => (
                <Link
                  key={item.href}
                  href={item.href as Route}
                  className="flex items-center justify-between rounded-[18px] border border-transparent px-4 py-3 text-sm text-[var(--foreground-secondary)] transition hover:border-[var(--border)] hover:bg-white/56 hover:text-[var(--foreground)]"
                >
                  <span>{item.label}</span>
                  <IconArrowRight className="h-4 w-4" />
                </Link>
              ))}
              {viewer.isAdmin ? (
                <Link
                  href={"/admin" as Route}
                  className="flex items-center justify-between rounded-[18px] border border-transparent px-4 py-3 text-sm text-[var(--foreground-secondary)] transition hover:border-[var(--border)] hover:bg-white/56 hover:text-[var(--foreground)]"
                >
                  <span>Admin Console</span>
                  <IconArrowRight className="h-4 w-4" />
                </Link>
              ) : null}
            </div>
          </div>

        </div>
      </div>
    </aside>
  );
}
