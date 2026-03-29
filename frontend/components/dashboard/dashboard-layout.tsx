"use client";

import type { ReactNode } from "react";

type DashboardLayoutProps = {
  currentPath: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
};

export function DashboardLayout({
  title,
  description,
  actions,
  children,
}: DashboardLayoutProps) {
  return (
    <div className="mx-auto max-w-[1120px]">
      <div className="mb-6 flex flex-col gap-4 border-b border-[var(--border)] pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-[var(--foreground-tertiary)]">Pages / {title}</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-[-0.04em] text-[var(--foreground)]">
            {title}
          </h1>
          {description ? (
            <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--foreground-secondary)]">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-3">{actions}</div> : null}
      </div>
      <div className="space-y-5">{children}</div>
    </div>
  );
}
