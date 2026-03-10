import Link from "next/link";
import { DashboardLayout } from "./dashboard-layout";

export function DashboardPipelinesScreen() {
  return (
    <DashboardLayout
      actions={
        <Link className="button-secondary" href="/docs/architecture">
          Architecture guide
        </Link>
      }
      currentPath="/dashboard/pipelines"
      description="Pipeline telemetry has not been wired into the private dashboard API yet, so the frontend should avoid rendering stale mock worker status."
      title="Pipelines"
    >
      <section className="surface-elevated px-6 py-8">
        <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
          Not yet connected
        </p>
        <h2 className="mt-2 text-3xl font-semibold text-white">
          Worker telemetry is pending a real backend endpoint
        </h2>
        <p className="mt-4 max-w-3xl text-sm leading-7 text-[var(--foreground-secondary)]">
          Task 5 only includes dashboard endpoints for API keys, usage, and billing.
          Until pipeline state is exposed by the backend, this page stays intentionally
          honest instead of replaying demo snapshots as if they were live worker health.
        </p>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <article className="rounded-[20px] border border-[var(--border)] bg-[var(--surface)] px-5 py-5">
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
              Recommended next step
            </p>
            <p className="mt-3 text-lg font-semibold text-white">
              Add a private telemetry endpoint before shipping operator health UI.
            </p>
          </article>

          <article className="rounded-[20px] border border-[var(--border)] bg-[var(--surface)] px-5 py-5">
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
              Current boundary
            </p>
            <p className="mt-3 text-lg font-semibold text-white">
              Heavy ingestion remains in workers; the frontend should only read summarized state.
            </p>
          </article>
        </div>
      </section>
    </DashboardLayout>
  );
}
