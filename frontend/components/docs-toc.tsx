"use client";

import { useEffect, useState } from "react";

export type TocItem = {
  id: string;
  text: string;
  level: number;
};

type DocsTocProps = {
  items: TocItem[];
};

export function DocsToc({ items }: DocsTocProps) {
  const [activeId, setActiveId] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return window.location.hash.slice(1) || items[0]?.id || "";
    }

    return items[0]?.id || "";
  });

  useEffect(() => {
    if (items.length === 0) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const visibleEntries = entries
          .filter((entry) => entry.isIntersecting)
          .sort((entryA, entryB) => entryA.boundingClientRect.top - entryB.boundingClientRect.top);

        if (visibleEntries[0]) {
          setActiveId(visibleEntries[0].target.id);
        }
      },
      { rootMargin: "-96px 0px -70% 0px" }
    );

    items.forEach((item) => {
      const element = document.getElementById(item.id);
      if (element) {
        observer.observe(element);
      }
    });

    const handleHashChange = () => {
      const hash = window.location.hash.slice(1);
      if (hash) {
        setActiveId(hash);
      }
    };

    window.addEventListener("hashchange", handleHashChange);

    return () => {
      observer.disconnect();
      window.removeEventListener("hashchange", handleHashChange);
    };
  }, [items]);

  if (items.length === 0) {
    return null;
  }

  return (
    <nav
      aria-label="Page table of contents"
      className="surface-elevated sticky top-24 max-h-[calc(100vh-8rem)] overflow-y-auto p-4"
    >
      <div className="mb-4 border-b border-[var(--border)] pb-4">
        <p className="font-mono text-xs uppercase tracking-[0.1em] text-[var(--foreground-tertiary)]">
          On this page
        </p>
        <p className="mt-2 text-sm text-[var(--foreground-secondary)]">
          {items.length} sections
        </p>
      </div>
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item.id}>
            <a
              aria-current={activeId === item.id ? "location" : undefined}
              href={`#${item.id}`}
              className={`focus-ring block rounded-lg px-3 py-1.5 text-sm transition-colors ${
                activeId === item.id
                  ? "bg-[var(--brand-subtle)] text-[var(--brand-bright)] shadow-[inset_0_0_0_1px_var(--border-brand)]"
                  : "text-[var(--foreground-tertiary)] hover:bg-[var(--surface)] hover:text-[var(--foreground)]"
              }`}
              style={{ paddingLeft: `${(item.level - 1) * 12 + 12}px` }}
            >
              {item.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
