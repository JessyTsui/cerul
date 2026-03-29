"use client";

import { useId, useState, type KeyboardEvent, type ReactNode } from "react";

type TabItem = {
  label: string;
  value: string;
  content: ReactNode;
};

type DocsTabsProps = {
  items: TabItem[];
  defaultValue?: string;
};

export function DocsTabs({ items, defaultValue }: DocsTabsProps) {
  const initialTab =
    defaultValue && items.some((item) => item.value === defaultValue)
      ? defaultValue
      : items[0]?.value ?? "";
  const [activeTab, setActiveTab] = useState(initialTab);
  const tabsId = useId();

  if (items.length === 0) {
    return null;
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      return;
    }

    event.preventDefault();

    if (event.key === "Home") {
      setActiveTab(items[0]?.value ?? "");
      return;
    }

    if (event.key === "End") {
      setActiveTab(items.at(-1)?.value ?? "");
      return;
    }

    const direction = event.key === "ArrowRight" ? 1 : -1;
    const nextIndex = (index + direction + items.length) % items.length;
    setActiveTab(items[nextIndex]?.value ?? "");
  }

  return (
    <div className="overflow-hidden rounded-[20px] border border-[var(--border)] bg-[rgba(255,252,247,0.72)] shadow-[0_14px_36px_rgba(36,29,21,0.06)]">
      <div
        aria-label="Code examples"
        role="tablist"
        className="flex gap-2 overflow-x-auto border-b border-[var(--border)] bg-[rgba(255,255,255,0.48)] px-3 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.map((item, index) => {
          const selected = activeTab === item.value;
          const tabId = `${tabsId}-${item.value}-tab`;
          const panelId = `${tabsId}-${item.value}-panel`;

          return (
            <button
              key={item.value}
              id={tabId}
              type="button"
              role="tab"
              tabIndex={selected ? 0 : -1}
              aria-selected={selected}
              aria-controls={panelId}
              onClick={() => setActiveTab(item.value)}
              onKeyDown={(event) => handleKeyDown(event, index)}
              className={`rounded-full border px-4 py-2 text-sm transition ${
                selected
                  ? "border-[var(--border-brand)] bg-white text-[var(--foreground)] shadow-[0_8px_20px_rgba(36,29,21,0.06)]"
                  : "border-transparent text-[var(--foreground-secondary)] hover:border-[var(--border)] hover:bg-white/70 hover:text-[var(--foreground)]"
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      <div className="p-4">
        {items.map((item) => (
          <div
            key={item.value}
            id={`${tabsId}-${item.value}-panel`}
            role="tabpanel"
            aria-labelledby={`${tabsId}-${item.value}-tab`}
            hidden={activeTab !== item.value}
          >
            {item.content}
          </div>
        ))}
      </div>
    </div>
  );
}
