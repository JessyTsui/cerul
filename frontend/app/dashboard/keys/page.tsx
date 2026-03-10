import type { Metadata } from "next";
import Link from "next/link";
import { DashboardShell } from "@/components/dashboard-shell";
import { getDashboardSnapshot } from "@/lib/demo-api";

export const metadata: Metadata = {
  title: "Dashboard Keys",
  robots: {
    index: false,
    follow: false,
  },
};

export default function DashboardKeysPage() {
  const snapshot = getDashboardSnapshot();

  return (
    <DashboardShell
      currentPath="/dashboard/keys"
      title="Manage API keys without widening the auth surface."
      description="Web auth and API key auth stay separate. The console exists to rotate keys, scope usage, and keep operator visibility high without complicating the public integration path."
      snapshot={snapshot}
      actions={
        <>
          <Link href="/docs/usage-api" className="button-secondary">
            Usage guide
          </Link>
          <button type="button" className="button-primary">
            Create new key
          </button>
        </>
      }
    >
      <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <article className="surface px-6 py-6">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
            Active inventory
          </p>
          <div className="mt-5 space-y-4">
            {snapshot.apiKeys.map((key) => (
              <div
                key={key.name}
                className="rounded-[24px] border border-[var(--line)] bg-white/76 px-5 py-5"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-semibold tracking-tight">{key.name}</h2>
                    <p className="mt-2 font-mono text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
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
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-[18px] bg-slate-900/4 px-4 py-3 text-sm text-[var(--muted)]">
                    Scope: {key.scope}
                  </div>
                  <div className="rounded-[18px] bg-slate-900/4 px-4 py-3 text-sm text-[var(--muted)]">
                    {key.lastUsed}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="surface px-6 py-6">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
            Governance notes
          </p>
          <div className="mt-5 space-y-4">
            {[
              "Use separate keys for public demos and internal automation.",
              "Keep the dashboard as the operator surface and the API key as the integration credential.",
              "Surface last-used timestamps and scope notes before adding deeper permission complexity.",
            ].map((item) => (
              <div
                key={item}
                className="rounded-[22px] border border-[var(--line)] bg-white/76 px-4 py-4 text-sm leading-6"
              >
                {item}
              </div>
            ))}
          </div>
        </article>
      </section>
    </DashboardShell>
  );
}
