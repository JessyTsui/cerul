import type { Metadata } from "next";
import Link from "next/link";
import { DashboardShell } from "@/components/dashboard-shell";
import { getDashboardSnapshot } from "@/lib/demo-api";

export const metadata: Metadata = {
  title: "Dashboard Settings",
  robots: {
    index: false,
    follow: false,
  },
};

export default function DashboardSettingsPage() {
  const snapshot = getDashboardSnapshot();

  return (
    <DashboardShell
      currentPath="/dashboard/settings"
      title="Set defaults for demos, operators, and future usage policy."
      description="The settings surface should focus on product defaults and notifications, not on duplicating backend business logic. Keep it high-signal and operator-oriented."
      snapshot={snapshot}
      actions={
        <>
          <Link href="/pricing" className="button-secondary">
            Plan limits
          </Link>
          <button type="button" className="button-primary">
            Save changes
          </button>
        </>
      }
    >
      <section className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        {snapshot.settingsPanels.map((panel) => (
          <article key={panel.title} className="surface px-6 py-6">
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
              Setting
            </p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight">{panel.title}</h2>
            <p className="mt-3 text-sm leading-6 text-[var(--muted)]">{panel.description}</p>
            <div className="mt-5 rounded-[20px] border border-[var(--line)] bg-white/76 px-4 py-4">
              <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--muted)]">
                Current value
              </p>
              <p className="mt-3 text-lg font-semibold">{panel.value}</p>
            </div>
          </article>
        ))}
      </section>
    </DashboardShell>
  );
}
