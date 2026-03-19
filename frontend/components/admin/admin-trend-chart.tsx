import { formatAdminMetricValue } from "@/lib/admin-console";

type AdminTrendPoint = {
  date: string;
  shortLabel: string;
  fullLabel: string;
  primaryValue: number;
  secondaryValue?: number;
};

type AdminTrendChartProps = {
  title: string;
  description?: string;
  data: AdminTrendPoint[];
  metricLabel: string;
  secondaryLabel?: string;
  kind?: "number" | "percent" | "milliseconds";
};

export function AdminTrendChart({
  title,
  description,
  data,
  metricLabel,
  secondaryLabel,
  kind = "number",
}: AdminTrendChartProps) {
  const maxValue = Math.max(1, ...data.map((point) => point.primaryValue));
  const totalValue = data.reduce((sum, point) => sum + point.primaryValue, 0);
  const totalSecondary = data.reduce((sum, point) => sum + (point.secondaryValue ?? 0), 0);
  const peakPoint = data.reduce<AdminTrendPoint | null>((current, point) => {
    if (!current || point.primaryValue > current.primaryValue) return point;
    return current;
  }, null);

  return (
    <article className="surface-elevated px-5 py-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-white">{title}</p>
          {description ? (
            <p className="mt-1 text-xs text-[var(--foreground-tertiary)]">{description}</p>
          ) : null}
        </div>
        <div className={`flex gap-3 ${secondaryLabel ? "sm:flex-row" : ""}`}>
          <div className="rounded-xl border border-[var(--border)] px-3 py-2 text-center">
            <p className="text-[10px] text-[var(--foreground-tertiary)]">{metricLabel}</p>
            <p className="mt-1 text-sm font-semibold text-white">
              {formatAdminMetricValue(totalValue, { kind })}
            </p>
          </div>
          {secondaryLabel ? (
            <div className="rounded-xl border border-[var(--border)] px-3 py-2 text-center">
              <p className="text-[10px] text-[var(--foreground-tertiary)]">{secondaryLabel}</p>
              <p className="mt-1 text-sm font-semibold text-white">
                {formatAdminMetricValue(totalSecondary)}
              </p>
            </div>
          ) : null}
          <div className="rounded-xl border border-[var(--border)] px-3 py-2 text-center">
            <p className="text-[10px] text-[var(--foreground-tertiary)]">Peak</p>
            <p className="mt-1 text-sm font-semibold text-white">
              {peakPoint
                ? formatAdminMetricValue(peakPoint.primaryValue, { kind, compact: true })
                : "—"}
            </p>
          </div>
        </div>
      </div>

      {data.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-[var(--border)] px-4 py-8 text-center text-xs text-[var(--foreground-tertiary)]">
          No data in this window.
        </div>
      ) : (
        <div className="mt-5 overflow-x-auto pb-2">
          <div className="flex min-w-max items-end gap-2">
            {data.map((point, index) => {
              const barHeight = Math.max(
                point.primaryValue > 0 ? 14 : 6,
                Math.round((point.primaryValue / maxValue) * 140),
              );
              const showLabel =
                data.length <= 10 ||
                index === 0 ||
                index === data.length - 1 ||
                index % 5 === 0;

              return (
                <div
                  key={point.date}
                  className="flex w-10 flex-none flex-col items-center gap-1"
                  title={`${point.fullLabel}: ${formatAdminMetricValue(point.primaryValue, { kind })}`}
                >
                  <div className="w-full text-center text-[10px] text-[var(--foreground-tertiary)]">
                    {point.secondaryValue !== undefined
                      ? formatAdminMetricValue(point.secondaryValue, { compact: true })
                      : " "}
                  </div>
                  <div className="flex h-[160px] w-full items-end rounded-xl border border-[var(--border)] bg-white/[0.03] px-1 pb-1">
                    <div
                      className="w-full rounded-lg bg-gradient-to-b from-cyan-400/90 to-sky-500/80 transition-[height] duration-300"
                      style={{ height: `${barHeight}px` }}
                    />
                  </div>
                  <p className="text-center font-mono text-[10px] text-[var(--foreground-tertiary)]">
                    {showLabel ? point.shortLabel : " "}
                  </p>
                  <p className="text-center text-[10px] text-[var(--foreground-secondary)]">
                    {formatAdminMetricValue(point.primaryValue, { kind, compact: true })}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </article>
  );
}
