"use client";

import type { Route } from "next";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useConsoleViewer } from "@/components/console/console-viewer-context";
import {
  dashboardRoutes,
  isDashboardRouteActive,
} from "@/lib/site";

type DashboardMobileNavProps = {
  currentPath: string;
  activeRoute: string;
};

export function DashboardMobileNav({
  currentPath,
  activeRoute,
}: DashboardMobileNavProps) {
  const [open, setOpen] = useState(false);
  const viewer = useConsoleViewer();

  useEffect(() => {
    if (!open) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <>
      <div className="flex items-center gap-3 lg:hidden">
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? "Close dashboard navigation" : "Open dashboard navigation"}
          onClick={() => setOpen((value) => !value)}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--background-elevated,white)] text-[var(--foreground-secondary)] transition hover:border-[var(--border-strong)] hover:text-[var(--foreground)]"
        >
          {open ? <CloseIcon /> : <MenuIcon />}
        </button>

        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
            Console
          </p>
          <p className="truncate text-sm font-medium text-[var(--foreground)]">
            {activeRoute}
          </p>
        </div>
      </div>

      {open ? (
        <div className="fixed inset-0 z-[140] lg:hidden">
          <button
            type="button"
            aria-label="Close dashboard navigation"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-[rgba(36,29,21,0.32)] backdrop-blur-sm"
          />

          <aside className="absolute inset-y-0 left-0 flex w-[min(88vw,360px)] max-w-full flex-col border-r border-[var(--border)] bg-[rgba(255,252,247,0.98)] px-5 py-5 shadow-[0_24px_80px_rgba(36,29,21,0.18)]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                  Dashboard
                </p>
                <p className="mt-1 text-base font-semibold text-[var(--foreground)]">
                  Navigation
                </p>
              </div>
              <button
                type="button"
                aria-label="Close dashboard navigation"
                onClick={() => setOpen(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--border)] bg-white/80 text-[var(--foreground-secondary)] transition hover:border-[var(--border-strong)] hover:text-[var(--foreground)]"
              >
                <CloseIcon />
              </button>
            </div>

            <nav className="mt-6 space-y-2">
              {dashboardRoutes.map((item) => {
                const isActive = isDashboardRouteActive(currentPath, item.href);

                return (
                  <Link
                    key={item.href}
                    href={item.href as Route}
                    onClick={() => setOpen(false)}
                    className={`flex items-center justify-between rounded-[18px] border px-4 py-3 transition ${
                      isActive
                        ? "border-[var(--border-brand)] bg-[var(--brand-subtle)] text-[var(--foreground)]"
                        : "border-transparent bg-white/46 text-[var(--foreground-secondary)] hover:border-[var(--border)] hover:bg-white hover:text-[var(--foreground)]"
                    }`}
                  >
                    <span className="text-sm font-medium">{item.label}</span>
                    <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--foreground-tertiary)]">
                      {item.meta}
                    </span>
                  </Link>
                );
              })}
            </nav>

            <div className="mt-6 border-t border-[var(--border)] pt-6">
              <p className="px-1 text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                Shortcuts
              </p>
              <div className="mt-3 space-y-2">
                <Link
                  href={"/docs" as Route}
                  onClick={() => setOpen(false)}
                  className="flex items-center justify-between rounded-[18px] border border-transparent px-4 py-3 text-sm text-[var(--foreground-secondary)] transition hover:border-[var(--border)] hover:bg-white hover:text-[var(--foreground)]"
                >
                  <span>Documentation</span>
                  <ArrowRightIcon />
                </Link>
                <Link
                  href={"/pricing" as Route}
                  onClick={() => setOpen(false)}
                  className="flex items-center justify-between rounded-[18px] border border-transparent px-4 py-3 text-sm text-[var(--foreground-secondary)] transition hover:border-[var(--border)] hover:bg-white hover:text-[var(--foreground)]"
                >
                  <span>Pricing</span>
                  <ArrowRightIcon />
                </Link>
                {viewer.isAdmin ? (
                  <Link
                    href={"/admin" as Route}
                    onClick={() => setOpen(false)}
                    className="flex items-center justify-between rounded-[18px] border border-transparent px-4 py-3 text-sm text-[var(--foreground-secondary)] transition hover:border-[var(--border)] hover:bg-white hover:text-[var(--foreground)]"
                  >
                    <span>Admin Console</span>
                    <ArrowRightIcon />
                  </Link>
                ) : null}
              </div>
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}

function MenuIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <path d="M4.5 12h15m0 0-5.25-5.25M19.5 12l-5.25 5.25" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
    </svg>
  );
}
