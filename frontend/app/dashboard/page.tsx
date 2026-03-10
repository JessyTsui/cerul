import type { Metadata } from "next";
import Link from "next/link";
import { DashboardShell } from "@/components/dashboard-shell";
import { getDashboardSnapshot } from "@/lib/demo-api";

export const metadata: Metadata = {
  title: "Dashboard",
  robots: {
    index: false,
    follow: false,
  },
  alternates: {
    canonical: "/dashboard",
  },
};

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  const snapshot = getDashboardSnapshot();

  return (
    <DashboardShell
      currentPath="/dashboard"
      title="Dashboard"
      description="Operate keys, usage, and indexing jobs."
      snapshot={snapshot}
      actions={
        <>
          <Link href="/docs" className="button-secondary">
            API docs
          </Link>
          <a className="button-primary" href="mailto:team@cerul.ai">
            Contact sales
          </a>
        </>
      }
    >
      {/* Overview cards */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {snapshot.overviewCards.map((item) => (
          <article key={item.label} className="surface px-5 py-5">
            <p className="font-mono text-xs uppercase tracking-[0.1em] text-[var(--foreground-tertiary)]">
              {item.label}
            </p>
            <p className="mt-3 text-2xl font-bold text-white">{item.value}</p>
            <p className="mt-1 text-sm text-[var(--foreground-tertiary)]">{item.caption}</p>
          </article>
        ))}
      </section>

      {/* Charts */}
      <section className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
        <article className="surface-elevated px-6 py-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.1em] text-[var(--foreground-tertiary)]">
                Monthly request mix
              </p>
              <h2 className="mt-2 text-xl font-bold text-white">
                Search volume by track
              </h2>
            </div>
            <span className={`badge ${
              snapshot.liveStatus.health === "Healthy"
                ? "badge-success"
                : snapshot.liveStatus.health === "Degraded"
                ? "badge-warning"
                : "badge-error"
            }`}>
              {snapshot.liveStatus.health}
            </span>
          </div>
          <div className="mt-6 space-y-4">
            {snapshot.searchMix.map((item) => (
              <div
                key={item.label}
                className="grid gap-2 sm:grid-cols-[140px_1fr_auto] sm:items-center"
              >
                <p className="text-sm font-medium text-white">{item.label}</p>
                <div className="chart-bar">
                  <span style={{ width: `${item.value}%` }} />
                </div>
                <p className="font-mono text-xs text-[var(--brand-bright)]">{item.value}%</p>
              </div>
            ))}
          </div>
        </article>

        <article className="surface-elevated px-6 py-6">
          <p className="font-mono text-xs uppercase tracking-[0.1em] text-[var(--foreground-tertiary)]">
            Pipeline state
          </p>
          <h2 className="mt-2 text-xl font-bold text-white">
            Worker health
          </h2>
          <div className="mt-5 space-y-3">
            {snapshot.pipelineRuns.slice(0, 3).map((run) => (
              <div
                key={run.id}
                className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium text-white">{run.source}</p>
                    <p className="text-sm text-[var(--foreground-tertiary)]">{run.stage}</p>
                  </div>
                  <p className="text-xl font-bold text-white">{run.progress}%</p>
                </div>
                <div className="chart-bar mt-3">
                  <span style={{ width: `${run.progress}%` }} />
                </div>
                <p className="mt-2 text-sm text-[var(--foreground-tertiary)]">{run.note}</p>
              </div>
            ))}
          </div>
        </article>
      </section>

      {/* API Keys + Recent queries */}
      <section className="grid gap-5 lg:grid-cols-2">
        <article className="surface-elevated px-6 py-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.1em] text-[var(--foreground-tertiary)]">
                API keys
              </p>
              <h2 className="mt-2 text-xl font-bold text-white">
                Access management
              </h2>
            </div>
            <Link href="/dashboard/keys" className="button-secondary text-sm">
              Manage
            </Link>
          </div>
          <div className="mt-5 space-y-3">
            {snapshot.apiKeys.map((key) => (
              <div
                key={key.name}
                className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3"
              >
                <div>
                  <p className="font-medium text-white">{key.name}</p>
                  <p className="font-mono text-xs text-[var(--foreground-tertiary)]">
                    {key.prefix}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                      key.status === "Active"
                        ? "bg-emerald-500/15 text-emerald-400"
                        : "bg-[var(--surface-elevated)] text-[var(--foreground-tertiary)]"
                    }`}
                  >
                    {key.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="surface-elevated px-6 py-6">
          <p className="font-mono text-xs uppercase tracking-[0.1em] text-[var(--foreground-tertiary)]">
            Recent queries
          </p>
          <h2 className="mt-2 text-xl font-bold text-white">
            Search traffic
          </h2>
          <div className="mt-5 overflow-hidden rounded-lg border border-[var(--border)]">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-[var(--surface)]">
                <tr>
                  <th className="px-4 py-3 font-medium text-[var(--foreground-secondary)]">Query</th>
                  <th className="px-4 py-3 font-medium text-[var(--foreground-secondary)]">Track</th>
                  <th className="px-4 py-3 font-medium text-[var(--foreground-secondary)]">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {snapshot.recentQueries.map((run) => (
                  <tr key={run.query} className="bg-[var(--background-elevated)]">
                    <td className="max-w-[200px] truncate px-4 py-3 text-white">{run.query}</td>
                    <td className="px-4 py-3 font-mono text-xs uppercase tracking-[0.1em] text-[var(--foreground-tertiary)]">
                      {run.track}
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-400">
                        {run.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </section>
    </DashboardShell>
  );
}
