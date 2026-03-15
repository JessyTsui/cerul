"use client";

import { useEffect, useState } from "react";

export type TocItem = {
  id: string;
  text: string;
  level: number;
};

type DocsTocProps = {
  items: TocItem[];
  title?: string;
  subtitle?: string;
};

export function DocsToc({
  items,
  title = "On this page",
  subtitle = "Table of contents",
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
    <div className="sticky top-24 rounded-[24px] border border-[var(--border)] bg-[rgba(9,13,21,0.92)] p-4 shadow-[0_22px_60px_rgba(2,6,18,0.18)]">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--brand-bright)]">
        {title}
      </p>
      <p className="mt-3 text-sm leading-6 text-[var(--foreground-secondary)]">{subtitle}</p>
      <ul className="mt-4 space-y-1">
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              aria-current={activeId === item.id ? "location" : undefined}
              className={`block rounded-[14px] border-l-2 px-3 py-2 text-sm transition ${
                activeId === item.id
                  ? "border-l-[var(--brand)] bg-[rgba(34,211,238,0.08)] text-white"
                  : "border-l-transparent text-[var(--foreground-secondary)] hover:bg-[rgba(255,255,255,0.03)] hover:text-white"
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
