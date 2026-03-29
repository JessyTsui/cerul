"use client";

import { useEffect, useState } from "react";

export type TocItem = {
  id: string;
  text: string;
  level: number;
};

type DocsTocAction = {
  label: string;
  href: string;
};

type DocsTocProps = {
  items: TocItem[];
  title?: string;
  subtitle?: string;
  actions?: DocsTocAction[];
};

export function DocsToc({
  items,
  title = "On this page",
  subtitle = "Table of contents",
  actions = [],
}: DocsTocProps) {
  const [activeId, setActiveId] = useState<string>(() => items[0]?.id ?? "");

  useEffect(() => {
    if (items.length === 0) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const visibleEntry = entries
          .filter((entry) => entry.isIntersecting)
          .sort((entryA, entryB) => entryA.boundingClientRect.top - entryB.boundingClientRect.top)[0];

        if (visibleEntry) {
          setActiveId(visibleEntry.target.id);
        }
      },
      { rootMargin: "-120px 0px -68% 0px" },
    );

    items.forEach((item) => {
      const element = document.getElementById(item.id);
      if (element) {
        observer.observe(element);
      }
    });

    return () => observer.disconnect();
  }, [items]);

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="sticky top-20 rounded-[24px] border border-[var(--border)] bg-[rgba(255,252,247,0.76)] p-4 shadow-[0_18px_40px_rgba(36,29,21,0.06)] backdrop-blur-xl">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--brand-bright)]">
        {title}
      </p>
      <p className="mt-2 text-sm leading-6 text-[var(--foreground-secondary)]">{subtitle}</p>
      {actions.length > 0 ? (
        <div className="mt-4 space-y-2 border-b border-[var(--border)] pb-4">
          {actions.map((action) => (
            <a
              key={action.href}
              href={action.href}
              className="block rounded-[14px] border border-[var(--border)] bg-[var(--background-elevated)] px-3 py-2.5 text-sm text-[var(--foreground-secondary)] transition hover:border-[var(--border-strong)] hover:bg-white hover:text-[var(--foreground)]"
            >
              {action.label}
            </a>
          ))}
        </div>
      ) : null}
      <ul className="mt-4 space-y-1.5">
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              aria-current={activeId === item.id ? "location" : undefined}
              className={`block rounded-[14px] border-l-2 px-3 py-2 text-sm transition ${
                activeId === item.id
                  ? "border-l-[var(--brand-bright)] bg-[var(--brand-subtle)] text-[var(--foreground)]"
                  : "border-l-transparent text-[var(--foreground-secondary)] hover:bg-white/70 hover:text-[var(--foreground)]"
              }`}
              style={{ paddingLeft: `${item.level === 1 ? 12 : 20}px` }}
            >
              {item.text}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
