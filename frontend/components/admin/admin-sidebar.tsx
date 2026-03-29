"use client";

import type { Route } from "next";
import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { useConsoleViewer } from "@/components/console/console-viewer-context";
import {
  ACCOUNT_SETTINGS_ROUTE,
  adminRoutes,
  isAdminRouteActive,
} from "@/lib/site";

/* ---------- Icon map ---------- */

function IconHome({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
    </svg>
  );
}

function IconChartBar({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
    </svg>
  );
}

function IconArrows({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
    </svg>
  );
}

function IconArrowPath({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
    </svg>
  );
}

function IconUsers({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
    </svg>
  );
}

function IconFilm({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
    </svg>
  );
}

function IconDatabase({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
    </svg>
  );
}

function IconArchive({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
    </svg>
  );
}

function IconCog({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
      <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
    </svg>
  );
}

const ROUTE_ICONS: Record<string, React.FC<{ className?: string }>> = {
  Overview: IconChartBar,
  Pipelines: IconArrows,
  Requests: IconArrowPath,
  Users: IconUsers,
  Content: IconFilm,
  Ingestion: IconDatabase,
  Sources: IconArchive,
  Targets: IconCog,
};

/* ---------- Sidebar Component ---------- */

type AdminSidebarProps = {
  currentPath: string;
};

export function AdminSidebar({ currentPath }: AdminSidebarProps) {
  const viewer = useConsoleViewer();
  const initials = (viewer.displayName ?? viewer.email ?? "A")
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <aside className="hidden w-[308px] shrink-0 xl:block">
      <div className="sticky top-0 h-screen p-4 pr-0">
        <div className="surface-elevated flex h-full flex-col overflow-hidden rounded-[34px] px-4 py-5">
          <BrandMark />

          <div className="mt-7 rounded-[22px] border border-[var(--border-brand)] bg-[var(--brand-subtle)] px-4 py-4">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--brand-bright)]">
              Control Room
            </p>
            <p className="mt-3 text-sm leading-6 text-[var(--foreground-secondary)]">
              Internal visibility for demand, ingestion, sources, and operator actions.
            </p>
            <Link
              href={"/dashboard" as Route}
              className="mt-4 flex items-center justify-between rounded-full bg-white/78 px-3 py-2.5 text-sm font-medium text-[var(--foreground)] transition hover:bg-white"
            >
              <span>Back to dashboard</span>
              <IconHome className="h-4 w-4" />
            </Link>
          </div>

          <div className="mt-7">
            <p className="px-3 text-xs font-medium uppercase tracking-[0.18em] text-[var(--foreground-tertiary)]">
              Admin Pages
            </p>
            <nav className="mt-3 space-y-1.5">
              {adminRoutes.map((item) => {
                const isActive = isAdminRouteActive(currentPath, item.href);
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
                        isActive
                          ? "bg-white/84 text-[var(--brand-bright)]"
                          : "bg-white/48 text-[var(--foreground-tertiary)]"
                      }`}
                    >
                      <Icon className="h-[18px] w-[18px]" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{item.label}</p>
                      <p className="text-xs text-[var(--foreground-tertiary)]">
                        Page {item.meta}
                      </p>
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
                { href: "/search", label: "Search playground" },
                { href: "/docs", label: "Documentation" },
                { href: ACCOUNT_SETTINGS_ROUTE, label: "Account settings" },
              ].map((item) => (
                <Link
                  key={item.href}
                  href={item.href as Route}
                  className="flex items-center justify-between rounded-[18px] border border-transparent px-4 py-3 text-sm text-[var(--foreground-secondary)] transition hover:border-[var(--border)] hover:bg-white/56 hover:text-[var(--foreground)]"
                >
                  <span>{item.label}</span>
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      d="M4.5 12h15m0 0-5.25-5.25M19.5 12l-5.25 5.25"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                    />
                  </svg>
                </Link>
              ))}
            </div>
          </div>

          <Link
            href={ACCOUNT_SETTINGS_ROUTE as Route}
            className="mt-auto rounded-[24px] border border-[var(--border)] bg-white/72 px-4 py-4 transition hover:bg-white"
          >
            <div className="flex items-center gap-3">
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-[var(--background-sunken)] text-sm font-semibold text-[var(--foreground-secondary)]">
                {initials || "A"}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-[var(--foreground)]">
                  {viewer.displayName ?? "Admin workspace"}
                </p>
                <p className="truncate text-xs text-[var(--foreground-tertiary)]">
                  {viewer.email ?? "Signed in"}
                </p>
              </div>
            </div>
          </Link>
        </div>
      </div>
    </aside>
  );
}
