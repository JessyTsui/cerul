import type { Metadata } from "next";
import Link from "next/link";
import { DashboardShell } from "@/components/dashboard-shell";
import { getDashboardSnapshot } from "@/lib/demo-api";

export const metadata: Metadata = {
  title: "Dashboard Usage",
  robots: {
    index: false,
    follow: false,
  },
};

export default function DashboardUsagePage() {
  const snapshot = getDashboardSnapshot();

  return (
    <DashboardShell
      currentPath="/dashboard/usage"
      title="Inspect credits, rate posture, and operator-facing usage signals."
      description="The dashboard should expose the same usage model that API clients see through GET /v1/usage: credits remaining, active keys, request volume, and rate policy context."
      snapshot={snapshot}
      actions={
        <>
          <Link href="/docs/usage-api" className="button-secondary">
            Read usage API
          </Link>
          <Link href="/pricing" className="button-primary">
            Compare plans
          </Link>
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

      <section className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
        <article className="surface px-6 py-6">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
            Ledger snapshot
          </p>
          <div className="mt-5 space-y-4">
            {snapshot.usageLedger.map((entry) => (
              <div
                key={entry.label}
                className="rounded-[22px] border border-[var(--line)] bg-white/76 px-4 py-4"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-lg font-semibold tracking-tight">{entry.label}</p>
                    <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                      {entry.note}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--muted)]">
                      Requests
                    </p>
                    <p className="mt-1 text-lg font-semibold">{entry.requests}</p>
                    <p className="mt-3 font-mono text-xs uppercase tracking-[0.16em] text-[var(--muted)]">
                      Credits
                    </p>
                    <p className="mt-1 text-lg font-semibold">{entry.credits}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="surface px-6 py-6">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
            Recent requests
          </p>
          <div className="mt-5 overflow-hidden rounded-[24px] border border-[var(--line)]">
            <table className="min-w-full border-collapse text-left text-sm">
              <thead className="bg-white/86">
                <tr>
                  <th className="px-4 py-3 font-medium">Query</th>
                  <th className="px-4 py-3 font-medium">Track</th>
                  <th className="px-4 py-3 font-medium">Latency</th>
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
