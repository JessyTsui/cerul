import Link from "next/link";
import type { ReactNode } from "react";
import { SiteHeader } from "@/components/site-header";
import { adminRoutes, isAdminRouteActive } from "@/lib/site";

type AdminLayoutProps = {
  currentPath: string;
  title: string;
  description: string;
  actions?: ReactNode;
  children: ReactNode;
};

export function AdminLayout({
  currentPath,
  title,
  description,
  actions,
  children,
}: AdminLayoutProps) {
  return (
    <div className="mx-auto flex min-h-screen max-w-[1500px] flex-col px-4 pb-10 pt-4 sm:px-6 lg:px-8">
      <SiteHeader currentPath={currentPath} />
      <main className="flex-1 pt-8">
        <div className="mb-8 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <p className="eyebrow">Admin Console</p>
            <h1 className="mt-2 text-3xl font-bold text-white sm:text-4xl">
              {title}
            </h1>
            <p className="mt-3 text-base leading-7 text-[var(--foreground-secondary)]">
              {description}
            </p>
          </div>
          {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
        </div>

        <section className="grid gap-6 xl:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="space-y-4">
            <div className="surface-elevated overflow-hidden px-4 py-4">
              <div className="rounded-[22px] border border-[var(--border-brand)] bg-[linear-gradient(140deg,rgba(14,165,233,0.16),rgba(249,115,22,0.09))] px-4 py-4">
                <p className="font-mono text-xs uppercase tracking-[0.14em] text-[var(--brand-bright)]">
                  Skill-aligned surface
                </p>
                <p className="mt-2 text-xl font-semibold text-white">
                  Operator-readable, API-backed
                </p>
                <p className="mt-2 text-sm leading-6 text-[var(--foreground-secondary)]">
                  This console mirrors the same product language as the Cerul API
                  skill: retrieval coverage, ingestion health, and request quality
                  first.
                </p>
              </div>

              <nav className="mt-4 space-y-1">
                {adminRoutes.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`dashboard-sidebar-link ${
                      isAdminRouteActive(currentPath, item.href)
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
                Admin posture
              </p>
              <div className="mt-4 space-y-3 text-sm leading-6 text-[var(--foreground-secondary)]">
                <p>
                  User dashboard routes stay self-serve. Site-wide metrics stay in
                  `/admin`.
                </p>
                <p>
                  Targets, latency, and ingestion failures are pulled from real
                  backend state rather than demo snapshots.
                </p>
                <p>
                  Use `/dashboard/pipelines` for per-job forensics and `/admin` for
                  operating the overall system.
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
