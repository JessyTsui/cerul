"use client";

import type { Route } from "next";
import Link from "next/link";
import { useId, useState } from "react";
import { docsSidebarGroups } from "@/lib/docs";

type DocsSidebarProps = {
  currentSlug?: string;
  currentPath?: string;
};

export function DocsSidebar({ currentSlug, currentPath }: DocsSidebarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const panelId = useId();
  const activeKey = currentSlug ?? currentPath ?? "/docs";

  return (
    <>
      <button
        aria-controls={panelId}
        aria-expanded={mobileOpen}
        type="button"
        onClick={() => setMobileOpen(!mobileOpen)}
        className="mb-4 flex w-full items-center justify-between rounded-[16px] border border-[var(--border)] bg-[rgba(255,255,255,0.03)] px-4 py-3 text-left text-sm text-[var(--foreground-secondary)] lg:hidden"
      >
        <span>Documentation menu</span>
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--brand-bright)]">
          {mobileOpen ? "Close" : "Open"}
        </span>
      </button>

      <aside id={panelId} className={`${mobileOpen ? "block" : "hidden"} lg:block`}>
        <div className="sticky top-24 overflow-hidden rounded-[24px] border border-[var(--border)] bg-[rgba(9,13,21,0.92)] p-4 shadow-[0_22px_60px_rgba(2,6,18,0.22)]">
          <div className="border-b border-[var(--border)] pb-4">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--brand-bright)]">
              Documentation
            </p>
            <p className="mt-3 text-lg font-semibold text-white">Cerul API</p>
            <p className="mt-2 text-sm leading-6 text-[var(--foreground-secondary)]">
              Quickstart, API guides, and platform notes for developers.
            </p>
          </div>

          <div className="mt-5 space-y-5">
            {docsSidebarGroups.map((group) => (
              <section key={group.title}>
                <h3 className="px-3 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--foreground-tertiary)]">
                  {group.title}
                </h3>
                <div className="mt-3 space-y-1">
                  {group.items.map((item) => {
                    const isActive =
                      (item.slug && item.slug === activeKey)
                      || item.href === activeKey
                      || item.href === currentPath;

                    return (
                      <Link
                        key={item.href}
                        href={item.href as Route}
                        onClick={() => setMobileOpen(false)}
                        className={`block rounded-[14px] border-l-2 px-3 py-3 transition ${
                          isActive
                            ? "border-l-[var(--brand)] bg-[rgba(34,211,238,0.08)] text-white"
                            : "border-l-transparent text-[var(--foreground-secondary)] hover:bg-[rgba(255,255,255,0.03)] hover:text-white"
                        }`}
                      >
                        <p className="text-sm font-medium">{item.title}</p>
                        {item.description ? (
                          <p className="mt-1 text-xs leading-5 text-[var(--foreground-tertiary)]">
                            {item.description}
                          </p>
                        ) : null}
                      </Link>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </div>
      </aside>
    </>
  );
}
