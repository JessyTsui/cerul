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
      title="Operate keys, usage, and indexing jobs."
      description="The console is organized around operator workflows: inspect credit health, understand search traffic, and monitor pipeline throughput without leaking backend logic into the frontend."
      snapshot={snapshot}
      actions={
        <>
          <Link href="/docs" className="button-secondary">
            API docs
          </Link>
          <a className="button-primary" href="mailto:team@cerul.ai">
            Request enterprise access
          </a>
        </>
      }
    >
      <section className="grid gap-4 lg:grid-cols-4">
        {snapshot.overviewCards.map((item) => (
          <article key={item.label} className="surface px-5 py-5">
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
              {item.label}
            </p>
            <p className="mt-4 text-3xl font-semibold tracking-tight">{item.value}</p>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{item.caption}</p>
          </article>
        ))}
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <article className="surface px-6 py-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
                Monthly request mix
              </p>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight">
                Search volume by track
              </h2>
            </div>
            <span className="rounded-full bg-[var(--accent-soft)] px-3 py-1 text-xs font-semibold text-[var(--accent)]">
              {snapshot.liveStatus.health}
            </span>
          </div>
          <div className="mt-8 space-y-5">
            {snapshot.searchMix.map((item) => (
              <div
                key={item.label}
                className="grid gap-2 sm:grid-cols-[160px_1fr_auto] sm:items-center"
              >
                <p className="text-sm font-medium">{item.label}</p>
                <div className="chart-bar h-3">
                  <span style={{ width: `${item.value}%` }} />
                </div>
                <p className="font-mono text-xs text-[var(--brand-deep)]">{item.value}%</p>
              </div>
            ))}
          </div>
        </article>

        <article className="surface px-6 py-6">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
            Worker state
          </p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight">
            Pipeline health
          </h2>
          <div className="mt-6 space-y-4">
            {snapshot.pipelineRuns.slice(0, 3).map((run) => (
              <div
                key={run.id}
                className="rounded-[22px] border border-[var(--line)] bg-white/72 px-4 py-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">{run.source}</p>
                    <p className="mt-1 text-sm text-[var(--muted)]">{run.stage}</p>
                  </div>
                  <p className="text-2xl font-semibold tracking-tight">{run.progress}%</p>
                </div>
                <div className="chart-bar mt-4 h-3">
                  <span style={{ width: `${run.progress}%` }} />
                </div>
                <p className="mt-3 text-sm leading-6 text-[var(--muted)]">{run.note}</p>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
        <article className="surface px-6 py-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
                API keys
              </p>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight">
                Access management
              </h2>
            </div>
            <Link href="/dashboard/keys" className="button-secondary">
              Manage keys
            </Link>
          </div>
          <div className="mt-6 space-y-3">
            {snapshot.apiKeys.map((key) => (
              <div
                key={key.name}
                className="rounded-[22px] border border-[var(--line)] bg-white/72 px-4 py-4"
              >
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="font-medium">{key.name}</p>
                    <p className="mt-1 font-mono text-xs uppercase tracking-[0.16em] text-[var(--muted)]">
                      {key.prefix}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      key.status === "Active"
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-slate-200 text-slate-700"
                    }`}
                  >
                    {key.status}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 text-sm text-[var(--muted)]">
                  <span>{key.scope}</span>
                  <span className="text-right">{key.lastUsed}</span>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="surface px-6 py-6">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
            Recent query runs
          </p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight">
            Search traffic snapshot
          </h2>
          <div className="mt-6 overflow-hidden rounded-[24px] border border-[var(--line)]">
            <table className="min-w-full border-collapse text-left text-sm">
              <thead className="bg-white/86">
                <tr>
                  <th className="px-4 py-3 font-medium">Query</th>
                  <th className="px-4 py-3 font-medium">Track</th>
                  <th className="px-4 py-3 font-medium">Latency</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.recentQueries.map((run) => (
                  <tr key={run.query} className="border-t border-[var(--line)] bg-white/72">
                    <td className="px-4 py-3">{run.query}</td>
                    <td className="px-4 py-3 font-mono text-xs uppercase tracking-[0.16em] text-[var(--muted)]">
                      {run.track}
                    </td>
                    <td className="px-4 py-3">{run.latency}</td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
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
