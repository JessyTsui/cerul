import Link from "next/link";
import type { ReactNode } from "react";
import type { DashboardSnapshot } from "@/lib/demo-api";
import { DashboardLiveStatus } from "@/components/dashboard-live-status";
import { SiteHeader } from "@/components/site-header";
import { dashboardRoutes, isDashboardRouteActive } from "@/lib/site";

type DashboardShellProps = {
  currentPath: string;
  title: string;
  description: string;
  snapshot: DashboardSnapshot;
  children: ReactNode;
  actions?: ReactNode;
};

export function DashboardShell({
  currentPath,
  title,
  description,
  snapshot,
  children,
  actions,
}: DashboardShellProps) {
  return (
    <div className="mx-auto flex min-h-screen max-w-[1400px] flex-col px-4 pb-8 pt-4 sm:px-6 lg:px-8">
      <SiteHeader currentPath={currentPath} />
      <main className="flex-1 pt-8">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="eyebrow">Console</p>
            <h1 className="mt-2 text-3xl font-bold text-white sm:text-4xl">{title}</h1>
            <p className="mt-3 max-w-2xl text-[var(--foreground-secondary)]">
              {description}
            </p>
          </div>
          <div className="flex flex-wrap gap-3">{actions}</div>
        </div>

        <section className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="surface h-fit px-4 py-4">
            <div className="rounded-xl bg-gradient-to-br from-[var(--brand)]/20 to-[var(--accent)]/10 px-4 py-4">
              <p className="font-mono text-xs uppercase tracking-[0.1em] text-[var(--brand-bright)]">
                Workspace
              </p>
              <p className="mt-2 text-xl font-bold text-white">Cerul Sandbox</p>
              <p className="mt-1 text-sm text-[var(--foreground-secondary)]">
                Shared workspace for API keys, usage, and search operations.
              </p>
            </div>
            <nav className="mt-4 space-y-1">
              {dashboardRoutes.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`dashboard-sidebar-link ${
                    isDashboardRouteActive(currentPath, item.href)
                      ? "dashboard-sidebar-link-active"
                      : ""
                  }`}
                >
                  <span>{item.label}</span>
                  <span className="font-mono text-xs text-[var(--foreground-tertiary)]">{item.meta}</span>
                </Link>
              ))}
            </nav>
            <div className="mt-4">
              <DashboardLiveStatus initialStatus={snapshot.liveStatus} />
            </div>
          </aside>

          <div className="space-y-5">{children}</div>
        </section>
      </main>
    </div>
  );
}
