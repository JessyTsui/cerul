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
  note: string;
  kind?: "number" | "percent" | "milliseconds";
};

export function AdminMetricCard({
  label,
  metric,
  note,
  kind = "number",
}: AdminMetricCardProps) {
  const tone = getMetricTone(metric);
  const toneClasses =
    tone === "good"
      ? "border-emerald-500/30"
      : tone === "warning"
        ? "border-amber-500/30"
        : "border-[var(--border)]";

  return (
    <article className={`surface px-5 py-5 ${toneClasses}`}>
      <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
        {label}
      </p>
      <p className="mt-3 text-3xl font-semibold text-white">
        {formatAdminMetricValue(metric.current, { kind, compact: true })}
      </p>
      <p className="mt-2 text-sm leading-6 text-[var(--foreground-secondary)]">
        {note}
      </p>
      <div className="mt-4 flex flex-wrap gap-2 text-xs">
        <span className="rounded-full border border-[var(--border)] px-3 py-1 text-[var(--foreground-secondary)]">
          {formatAdminDelta(metric, { kind })}
        </span>
        <span className="rounded-full border border-[var(--border)] px-3 py-1 text-[var(--foreground-secondary)]">
          {formatTargetStatus(metric, { kind })}
        </span>
      </div>
    </article>
  );
}
