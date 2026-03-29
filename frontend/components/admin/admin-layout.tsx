"use client";

import type { ReactNode } from "react";

type AdminLayoutProps = {
  currentPath: string;
  title: string;
  description: string;
  actions?: ReactNode;
  children: ReactNode;
};

export function AdminLayout({
  title,
  description,
  actions,
  children,
}: AdminLayoutProps) {
  return (
    <div className="mx-auto max-w-[1240px]">
      <div className="mb-6 flex flex-col gap-4 border-b border-[var(--border)] pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm text-[var(--foreground-tertiary)]">
            Admin Console / {title}
          </p>
          <h1 className="mt-2 text-4xl font-semibold tracking-[-0.04em] text-[var(--foreground)]">
            {title}
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--foreground-secondary)]">
            {description}
          </p>
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-3">
            {actions}
          </div>
        ) : null}
      </div>
      <div className="space-y-5">{children}</div>
    </div>
  );
}
