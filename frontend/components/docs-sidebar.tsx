"use client";

import type { Route } from "next";
import Link from "next/link";
import { useId, useState } from "react";
import { getDocsIndexCards } from "@/lib/docs";

type DocsSidebarProps = {
  currentSlug?: string;
};

export function DocsSidebar({ currentSlug }: DocsSidebarProps) {
  const guides = getDocsIndexCards();
  const [mobileOpen, setMobileOpen] = useState(false);
  const panelId = useId();
  const currentGuide = guides.find((guide) => guide.slug === currentSlug);

  return (
    <>
      {/* Mobile toggle */}
      <button
        aria-controls={panelId}
        aria-expanded={mobileOpen}
        type="button"
        onClick={() => setMobileOpen(!mobileOpen)}
        className="focus-ring mb-4 flex w-full items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-left text-sm font-medium text-[var(--foreground-secondary)] lg:hidden"
      >
        <span className="flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="4" y1="6" x2="20" y2="6" />
            <line x1="4" y1="12" x2="20" y2="12" />
            <line x1="4" y1="18" x2="20" y2="18" />
          </svg>
          Documentation menu
        </span>
        <span className="text-xs text-[var(--foreground-tertiary)]">
          {currentGuide?.title || "Overview"}
        </span>
      </button>

      <aside className={`${mobileOpen ? "block" : "hidden"} lg:block`} id={panelId}>
        <nav className="surface-elevated sticky top-24 max-h-[calc(100vh-8rem)] overflow-y-auto p-4">
          <div className="mb-4 border-b border-[var(--border)] pb-4">
            <p className="eyebrow text-[11px]">Documentation</p>
            <p className="mt-2 text-sm text-[var(--foreground-secondary)]">
              {guides.length} guides plus API overview
            </p>
          </div>

          {/* Overview link */}
          <Link
            href="/docs"
            className={`focus-ring mb-1 flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition ${
              !currentSlug
                ? "bg-[var(--brand-subtle)] text-[var(--brand-bright)]"
                : "text-[var(--foreground-secondary)] hover:bg-[var(--surface)] hover:text-[var(--foreground)]"
            }`}
            onClick={() => setMobileOpen(false)}
          >
            <span>Overview</span>
            <span className="font-mono text-xs text-[var(--foreground-tertiary)]">00</span>
          </Link>

          {/* Guides section */}
          <div className="mt-4">
            <p className="mb-2 px-3 font-mono text-xs uppercase tracking-[0.1em] text-[var(--foreground-tertiary)]">
              Guides
            </p>
            <div className="space-y-1">
              {guides.map((guide, index) => {
                const active = currentSlug === guide.slug;

                return (
                  <Link
                    key={guide.slug}
                    href={guide.href as Route}
                    className={`focus-ring flex items-center justify-between rounded-lg px-3 py-2 text-sm transition ${
                      active
                        ? "bg-[var(--brand-subtle)] text-[var(--brand-bright)]"
                        : "text-[var(--foreground-secondary)] hover:bg-[var(--surface)] hover:text-[var(--foreground)]"
                    }`}
                    onClick={() => setMobileOpen(false)}
                  >
                    <span className="truncate">{guide.title}</span>
                    <span className="ml-2 font-mono text-xs text-[var(--foreground-tertiary)]">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>

          {/* API Reference */}
          <div className="mt-4">
            <p className="mb-2 px-3 font-mono text-xs uppercase tracking-[0.1em] text-[var(--foreground-tertiary)]">
              Reference
            </p>
            <a
              href="https://github.com/JessyTsui/cerul"
              target="_blank"
              rel="noreferrer"
              className="focus-ring flex items-center justify-between rounded-lg px-3 py-2 text-sm text-[var(--foreground-secondary)] transition hover:bg-[var(--surface)] hover:text-[var(--foreground)]"
            >
              <span>GitHub Repository</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </a>
          </div>
        </nav>
      </aside>
    </>
  );
}
