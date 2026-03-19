import type { AdminMetricValue } from "@/lib/admin-api";
import {
  formatAdminDelta,
  formatAdminMetricValue,
  formatTargetStatus,
  getMetricTone,
} from "@/lib/admin-console";

type AdminMetricCardProps = {
  label: string;
  metric: AdminMetricValue;
  note?: string;
  kind?: "number" | "percent" | "milliseconds";
};

export function AdminMetricCard({
  label,
  metric,
  note,
  kind = "number",
}: AdminMetricCardProps) {
  const tone = getMetricTone(metric);
  const toneMeta =
    tone === "good"
      ? {
          card: "border-emerald-500/24 bg-[linear-gradient(180deg,rgba(16,185,129,0.11),rgba(18,27,44,0.9))]",
          badge: "border-emerald-400/24 bg-emerald-400/10 text-emerald-200",
          accent: "from-emerald-300/32 via-emerald-400/12 to-transparent",
          state: "On target",
        }
      : tone === "warning"
        ? {
            card: "border-amber-500/26 bg-[linear-gradient(180deg,rgba(245,158,11,0.11),rgba(18,27,44,0.9))]",
            badge: "border-amber-400/24 bg-amber-400/10 text-amber-100",
            accent: "from-amber-300/30 via-orange-400/10 to-transparent",
            state: "Needs review",
          }
        : {
            card: "border-[var(--border)] bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(18,27,44,0.92))]",
            badge: "border-[var(--border)] bg-[rgba(255,255,255,0.04)] text-[var(--foreground-secondary)]",
            accent: "from-cyan-200/20 via-sky-400/8 to-transparent",
            state: "No target",
          };

  return (
    <article
      className={`surface-elevated rounded-[28px] px-5 py-5 ${toneMeta.card}`}
    >
      <div
        className={`pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-b ${toneMeta.accent}`}
      />
      <div className="relative">
        <div className="flex items-start justify-between gap-3">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--foreground-tertiary)]">
            {label}
          </p>
          <span
            className={`inline-flex items-center rounded-full border px-3 py-1 font-mono text-[11px] uppercase tracking-[0.16em] ${toneMeta.badge}`}
          >
            {toneMeta.state}
          </span>
        </div>
        <p className="mt-5 text-4xl font-semibold tracking-[-0.05em] text-white">
          {formatAdminMetricValue(metric.current, { kind, compact: true })}
        </p>
        {note ? (
          <p className="mt-3 text-sm leading-7 text-[var(--foreground-secondary)]">
            {note}
          </p>
        ) : null}
        <div className="mt-5 flex flex-wrap gap-2 text-xs">
          <span className="rounded-full border border-[var(--border)] bg-[rgba(8,12,20,0.42)] px-3 py-1.5 text-[var(--foreground-secondary)]">
            Delta {formatAdminDelta(metric, { kind })}
          </span>
          {metric.target !== null ? (
            <span className="rounded-full border border-[var(--border)] bg-[rgba(8,12,20,0.42)] px-3 py-1.5 text-[var(--foreground-secondary)]">
              {formatTargetStatus(metric, { kind })}
            </span>
          ) : null}
        </div>
      </div>
    </article>
  );
}
