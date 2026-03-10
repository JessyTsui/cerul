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
    <div className="mx-auto flex min-h-screen max-w-[1440px] flex-col px-5 pb-8 pt-5 sm:px-8 lg:px-10">
      <SiteHeader currentPath={currentPath} />
      <main className="flex-1 pb-8 pt-10">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="eyebrow">Private console</p>
            <h1 className="display-title mt-2 text-5xl sm:text-6xl">{title}</h1>
            <p className="mt-4 max-w-3xl text-base leading-7 text-[var(--muted)] sm:text-lg">
              {description}
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">{actions}</div>
        </div>

        <section className="grid gap-6 xl:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="surface h-fit px-5 py-5">
            <div className="rounded-[24px] bg-[var(--surface-dark)] px-4 py-4 text-white">
              <p className="font-mono text-xs uppercase tracking-[0.18em] text-white/68">
                Workspace
              </p>
              <p className="mt-3 text-2xl font-semibold">Cerul Sandbox</p>
              <p className="mt-2 text-sm leading-6 text-white/68">
                Shared platform for b-roll and knowledge search.
              </p>
            </div>
            <nav className="mt-5 space-y-2">
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
                  <span className="font-mono text-xs">{item.meta}</span>
                </Link>
              ))}
            </nav>
            <div className="mt-5">
              <DashboardLiveStatus initialStatus={snapshot.liveStatus} />
            </div>
          </aside>

          <div className="space-y-6">{children}</div>
        </section>
      </main>
    </div>
  );
}
