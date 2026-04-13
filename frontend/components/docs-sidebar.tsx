"use client";

import type { Route } from "next";
import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { docsSidebarGroups, docsUtilityLinks } from "@/lib/docs";

type DocsSidebarProps = {
  currentSlug?: string;
  currentPath?: string;
};

export function DocsSidebar({ currentSlug, currentPath }: DocsSidebarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const panelId = useId();
  const mobilePanelId = `${panelId}-mobile`;
  const desktopPanelId = `${panelId}-desktop`;
  const activeKey = currentSlug ?? currentPath ?? "/docs";

  useEffect(() => {
    if (!mobileOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileOpen(false);
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [mobileOpen]);

  return (
    <>
      <button
        aria-controls={mobilePanelId}
        aria-expanded={mobileOpen}
        type="button"
        onClick={() => setMobileOpen(!mobileOpen)}
        className="mb-4 flex w-full items-center justify-between rounded-[16px] border border-[var(--border)] bg-[rgba(255,252,247,0.76)] px-4 py-3 text-left text-sm text-[var(--foreground-secondary)] shadow-[0_12px_28px_rgba(36,29,21,0.05)] lg:hidden"
      >
        <span>Docs navigation</span>
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--brand-bright)]">
          {mobileOpen ? "Close" : "Open"}
        </span>
      </button>

      {mobileOpen ? (
        <div className="fixed inset-0 z-[135] lg:hidden">
          <button
            type="button"
            aria-label="Close docs navigation"
            onClick={() => setMobileOpen(false)}
            className="absolute inset-0 bg-[rgba(36,29,21,0.32)] backdrop-blur-sm"
          />

          <aside
            id={mobilePanelId}
            className="absolute inset-y-0 left-0 w-[min(88vw,360px)] max-w-full overflow-y-auto border-r border-[var(--border)] bg-[rgba(255,252,247,0.98)] p-5 shadow-[0_24px_80px_rgba(36,29,21,0.18)]"
          >
            <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] pb-4">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--brand-bright)]">
                  Documentation
                </p>
                <p className="mt-2 text-base font-semibold text-[var(--foreground)]">
                  Cerul API
                </p>
              </div>
              <button
                type="button"
                aria-label="Close docs navigation"
                onClick={() => setMobileOpen(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--border)] bg-white/80 text-[var(--foreground-secondary)] transition hover:border-[var(--border-strong)] hover:text-[var(--foreground)]"
              >
                <CloseIcon />
              </button>
            </div>

            <div className="mt-4 flex flex-wrap gap-2 border-b border-[var(--border)] pb-4">
              {docsUtilityLinks.map((item) => {
                const isExternal = item.href.startsWith("http") || item.href.startsWith("mailto:");

                if (isExternal) {
                  return (
                    <a
                      key={item.href}
                      href={item.href}
                      target={item.href.startsWith("http") ? "_blank" : undefined}
                      rel={item.href.startsWith("http") ? "noreferrer" : undefined}
                      onClick={() => setMobileOpen(false)}
                      className="rounded-full border border-[var(--border)] bg-[var(--background-elevated)] px-3 py-2 text-sm text-[var(--foreground-secondary)] transition hover:border-[var(--border-strong)] hover:bg-white hover:text-[var(--foreground)]"
                    >
                      {item.title}
                    </a>
                  );
                }

                return (
                  <Link
                    key={item.href}
                    href={item.href as Route}
                    onClick={() => setMobileOpen(false)}
                    className="rounded-full border border-[var(--border)] bg-[var(--background-elevated)] px-3 py-2 text-sm text-[var(--foreground-secondary)] transition hover:border-[var(--border-strong)] hover:bg-white hover:text-[var(--foreground)]"
                  >
                    {item.title}
                  </Link>
                );
              })}
            </div>

            <div className="mt-4 space-y-5">
              {docsSidebarGroups.map((group) => (
                <section key={group.title}>
                  <h3 className="px-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--foreground-tertiary)]">
                    {group.title}
                  </h3>
                  <div className="mt-2 space-y-1">
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
                          className={`block rounded-[14px] border-l-2 px-3 py-2.5 transition ${
                            isActive
                              ? "border-l-[var(--brand-bright)] bg-[var(--brand-subtle)] text-[var(--foreground)]"
                              : "border-l-transparent text-[var(--foreground-secondary)] hover:bg-white/70 hover:text-[var(--foreground)]"
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
          </aside>
        </div>
      ) : null}

      <aside id={desktopPanelId} className="hidden lg:block">
        <div className="sticky top-20 max-h-[calc(100vh-5.5rem)] overflow-y-auto rounded-[24px] border border-[var(--border)] bg-[rgba(255,252,247,0.76)] p-4 shadow-[0_18px_40px_rgba(36,29,21,0.06)] backdrop-blur-xl">
          <div className="border-b border-[var(--border)] pb-4">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--brand-bright)]">
              Documentation
            </p>
            <p className="mt-2 text-base font-semibold text-[var(--foreground)]">Cerul API</p>
            <p className="mt-1 text-sm leading-6 text-[var(--foreground-secondary)]">
              Guides, references, and integration notes.
            </p>
          </div>

          <div className="mt-4 flex flex-wrap gap-2 border-b border-[var(--border)] pb-4">
            {docsUtilityLinks.map((item) => {
              const isExternal = item.href.startsWith("http") || item.href.startsWith("mailto:");

              if (isExternal) {
                return (
                  <a
                    key={item.href}
                    href={item.href}
                    target={item.href.startsWith("http") ? "_blank" : undefined}
                    rel={item.href.startsWith("http") ? "noreferrer" : undefined}
                    className="rounded-full border border-[var(--border)] bg-[var(--background-elevated)] px-3 py-2 text-sm text-[var(--foreground-secondary)] transition hover:border-[var(--border-strong)] hover:bg-white hover:text-[var(--foreground)]"
                  >
                    {item.title}
                  </a>
                );
              }

              return (
                <Link
                  key={item.href}
                  href={item.href as Route}
                  className="rounded-full border border-[var(--border)] bg-[var(--background-elevated)] px-3 py-2 text-sm text-[var(--foreground-secondary)] transition hover:border-[var(--border-strong)] hover:bg-white hover:text-[var(--foreground)]"
                >
                  {item.title}
                </Link>
              );
            })}
          </div>

          <div className="mt-4 space-y-5">
            {docsSidebarGroups.map((group) => (
              <section key={group.title}>
                <h3 className="px-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--foreground-tertiary)]">
                  {group.title}
                </h3>
                <div className="mt-2 space-y-1">
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
                        className={`block rounded-[14px] border-l-2 px-3 py-2.5 transition ${
                          isActive
                            ? "border-l-[var(--brand-bright)] bg-[var(--brand-subtle)] text-[var(--foreground)]"
                            : "border-l-transparent text-[var(--foreground-secondary)] hover:bg-white/70 hover:text-[var(--foreground)]"
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

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
    </svg>
  );
}
