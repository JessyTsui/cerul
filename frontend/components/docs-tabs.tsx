"use client";

import {
  useId,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

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
  const [activeTab, setActiveTab] = useState<string>(initialTab);
  const tabsId = useId();

  if (items.length === 0) {
    return null;
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      return;
    }

    event.preventDefault();

    if (event.key === "Home") {
      setActiveTab(items[0]?.value || "");
      return;
    }

    if (event.key === "End") {
      setActiveTab(items.at(-1)?.value || items[0]?.value || "");
      return;
    }

    const direction = event.key === "ArrowRight" ? 1 : -1;
    const nextIndex = (index + direction + items.length) % items.length;
    setActiveTab(items[nextIndex]?.value || items[0]?.value || "");
  };

  return (
    <div className="overflow-hidden rounded-[20px] border border-[var(--border)] bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] shadow-[var(--shadow)]">
      <div
        aria-label="Code examples"
        className="flex gap-1 overflow-x-auto border-b border-[var(--border)] px-3 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="tablist"
      >
        {items.map((item, index) => {
          const selected = activeTab === item.value;
          const tabId = `${tabsId}-${item.value}-tab`;
          const panelId = `${tabsId}-${item.value}-panel`;

          return (
            <button
              key={item.value}
              onClick={() => setActiveTab(item.value)}
              onKeyDown={(event) => handleKeyDown(event, index)}
              aria-controls={panelId}
              aria-selected={selected}
              className={`focus-ring rounded-full px-4 py-2 text-sm font-medium transition ${
                selected
                  ? "bg-[var(--brand-subtle)] text-[var(--brand-bright)] shadow-[inset_0_0_0_1px_var(--border-brand)]"
                  : "text-[var(--foreground-tertiary)] hover:bg-[var(--surface)] hover:text-[var(--foreground)]"
              }`}
              id={tabId}
              role="tab"
              tabIndex={selected ? 0 : -1}
              type="button"
            >
              {item.label}
            </button>
          );
        })}
      </div>
      <div className="p-4">
        {items.map((item) => (
          <div
            aria-labelledby={`${tabsId}-${item.value}-tab`}
            hidden={activeTab !== item.value}
            key={item.value}
            id={`${tabsId}-${item.value}-panel`}
            role="tabpanel"
          >
            {item.content}
          </div>
        ))}
      </div>
    </div>
  );
}
