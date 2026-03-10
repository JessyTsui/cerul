import Link from "next/link";
import type { ReactNode } from "react";
import { SiteHeader } from "@/components/site-header";
import { dashboardRoutes, isDashboardRouteActive } from "@/lib/site";

type DashboardLayoutProps = {
  currentPath: string;
  title: string;
  description: string;
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
    <div className="mx-auto flex min-h-screen max-w-[1440px] flex-col px-4 pb-10 pt-4 sm:px-6 lg:px-8">
      <SiteHeader currentPath={currentPath} />
      <main className="flex-1 pt-8">
        <div className="mb-8 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <p className="eyebrow">Control Plane</p>
            <h1 className="mt-2 text-3xl font-bold text-white sm:text-4xl">
              {title}
            </h1>
            <p className="mt-3 text-base leading-7 text-[var(--foreground-secondary)]">
              {description}
            </p>
          </div>
          {actions ? (
            <div className="flex flex-wrap gap-3">{actions}</div>
          ) : null}
        </div>

        <section className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="space-y-4">
            <div className="surface-elevated overflow-hidden px-4 py-4">
              <div className="rounded-[20px] border border-[var(--border-brand)] bg-[linear-gradient(135deg,rgba(59,130,246,0.16),rgba(249,115,22,0.08))] px-4 py-4">
                <p className="font-mono text-xs uppercase tracking-[0.14em] text-[var(--brand-bright)]">
                  Dashboard API
                </p>
                <p className="mt-2 text-xl font-semibold text-white">
                  Session-backed operator console
                </p>
                <p className="mt-2 text-sm leading-6 text-[var(--foreground-secondary)]">
                  API keys, usage, and billing are pulled from the private backend
                  surface. No demo snapshots are rendered on these pages anymore.
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
                    <span className="font-mono text-xs text-[var(--foreground-tertiary)]">
                      {item.meta}
                    </span>
                  </Link>
                ))}
              </nav>
            </div>

            <div className="surface px-4 py-4">
              <p className="font-mono text-xs uppercase tracking-[0.14em] text-[var(--foreground-tertiary)]">
                Guardrails
              </p>
              <div className="mt-4 space-y-3 text-sm leading-6 text-[var(--foreground-secondary)]">
                <p>
                  Web session auth stays separate from public API key auth.
                </p>
                <p>
                  Billing actions redirect through Stripe instead of recreating
                  checkout logic in the UI.
                </p>
                <p>
                  Pipeline telemetry is intentionally isolated until a dedicated
                  backend endpoint exists.
                </p>
              </div>
            </div>
          </aside>

          <div className="space-y-5">{children}</div>
        </section>
      </main>
    </div>
  );
}
