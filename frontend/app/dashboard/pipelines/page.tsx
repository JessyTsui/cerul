import type { Metadata } from "next";
import Link from "next/link";
import { DashboardShell } from "@/components/dashboard-shell";
import { getDashboardSnapshot } from "@/lib/demo-api";

export const metadata: Metadata = {
  title: "Dashboard Pipelines",
  robots: {
    index: false,
    follow: false,
  },
};

export default function DashboardPipelinesPage() {
  const snapshot = getDashboardSnapshot();

  return (
    <DashboardShell
      currentPath="/dashboard/pipelines"
      title="Watch ingestion throughput without turning the web app into a worker."
      description="The console should reflect queue state and step progress, but heavy media logic stays in Python workers. This page is an operator lens, not the processing engine itself."
      snapshot={snapshot}
      actions={
        <>
          <Link href="/docs/architecture" className="button-secondary">
            Architecture guide
          </Link>
          <button type="button" className="button-primary">
            Retry failed jobs
          </button>
        </>
      }
    >
      <section className="space-y-4">
        {snapshot.pipelineRuns.map((run) => (
          <article key={run.id} className="surface px-6 py-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
                  {run.id}
                </p>
                <h2 className="mt-3 text-2xl font-semibold tracking-tight">{run.source}</h2>
                <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{run.note}</p>
              </div>
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  run.status === "completed"
                    ? "bg-emerald-100 text-emerald-700"
                    : run.status === "running"
                      ? "bg-sky-100 text-sky-700"
                      : "bg-slate-200 text-slate-700"
                }`}
              >
                {run.status}
              </span>
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-[220px_1fr_auto] sm:items-center">
              <p className="text-sm font-medium">{run.stage}</p>
              <div className="chart-bar h-3">
                <span style={{ width: `${run.progress}%` }} />
              </div>
              <p className="font-mono text-xs text-[var(--brand-deep)]">{run.progress}%</p>
            </div>
          </article>
        ))}
      </section>
    </DashboardShell>
  );
}
