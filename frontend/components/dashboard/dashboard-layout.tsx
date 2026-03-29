"use client";

import type { ReactNode } from "react";
import { DashboardSidebar } from "./dashboard-sidebar";
import { DashboardTopNav } from "./dashboard-top-nav";

type DashboardLayoutProps = {
  currentPath: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
};

export function DashboardLayout({
  currentPath,
  title,
  description,
  actions,
  children,
}: DashboardLayoutProps) {
  return (
    <div className="soft-theme flex min-h-screen">
      <DashboardSidebar currentPath={currentPath} />
      <div className="flex min-w-0 flex-1 flex-col">
        <DashboardTopNav currentPath={currentPath} />
        <main className="flex-1 overflow-y-auto px-5 py-5 sm:px-6 lg:px-8">
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
        </main>
      </div>
    </div>
  );
}
