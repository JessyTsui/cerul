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
  description: string;
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
  const totalSecondary = data.reduce(
    (sum, point) => sum + (point.secondaryValue ?? 0),
    0,
  );
  const peakPoint = data.reduce<AdminTrendPoint | null>((current, point) => {
    if (!current || point.primaryValue > current.primaryValue) {
      return point;
    }

    return current;
  }, null);
  const averageValue = data.length === 0 ? 0 : totalValue / data.length;

  return (
    <article className="surface-elevated rounded-[32px] px-6 py-6">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(103,232,249,0.1),transparent_24%),radial-gradient(circle_at_bottom_left,rgba(249,115,22,0.08),transparent_26%)]" />
      <div className="relative">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--foreground-tertiary)]">
              Trend
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-white">
              {title}
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--foreground-secondary)]">
              {description}
            </p>
          </div>

          <div className={`grid gap-3 ${secondaryLabel ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
            <div className="rounded-[20px] border border-[var(--border)] bg-[rgba(8,12,20,0.56)] px-4 py-3">
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                {metricLabel}
              </p>
              <p className="mt-2 text-xl font-semibold text-white">
                {formatAdminMetricValue(totalValue, { kind })}
              </p>
            </div>
            {secondaryLabel ? (
              <div className="rounded-[20px] border border-[var(--border)] bg-[rgba(8,12,20,0.56)] px-4 py-3">
                <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                  {secondaryLabel}
                </p>
                <p className="mt-2 text-xl font-semibold text-white">
                  {formatAdminMetricValue(totalSecondary)}
                </p>
              </div>
            ) : null}
            <div className="rounded-[20px] border border-[var(--border)] bg-[rgba(8,12,20,0.56)] px-4 py-3">
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                {peakPoint ? "Peak day" : "Average"}
              </p>
              <p className="mt-2 text-xl font-semibold text-white">
                {peakPoint
                  ? formatAdminMetricValue(peakPoint.primaryValue, { kind, compact: true })
                  : formatAdminMetricValue(averageValue, { kind })}
              </p>
              <p className="mt-1 text-xs text-[var(--foreground-tertiary)]">
                {peakPoint ? peakPoint.fullLabel : "No recorded window"}
              </p>
            </div>
          </div>
        </div>

        {data.length === 0 ? (
          <div className="mt-6 rounded-[20px] border border-dashed border-[var(--border)] px-5 py-10 text-center text-sm text-[var(--foreground-secondary)]">
            No data was recorded in this window.
          </div>
        ) : (
          <div className="mt-8 overflow-x-auto pb-2">
            <div className="flex min-w-max items-end gap-3">
              {data.map((point, index) => {
                const barHeight = Math.max(
                  point.primaryValue > 0 ? 18 : 10,
                  Math.round((point.primaryValue / maxValue) * 184),
                );
                const showLabel =
                  data.length <= 10 ||
                  index === 0 ||
                  index === data.length - 1 ||
                  index % 5 === 0;

                return (
                  <div
                    key={point.date}
                    className="flex w-12 flex-none flex-col items-center gap-2"
                    title={`${point.fullLabel}: ${formatAdminMetricValue(point.primaryValue, { kind })}`}
                  >
                    <div className="w-full text-center text-[11px] text-[var(--foreground-tertiary)]">
                      {point.secondaryValue !== undefined
                        ? formatAdminMetricValue(point.secondaryValue, { compact: true })
                        : " "}
                    </div>
                    <div className="flex h-[206px] w-full items-end rounded-[18px] border border-[var(--border)] bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.01))] px-1.5 pb-1.5">
                      <div
                        className="w-full rounded-[14px] bg-[linear-gradient(180deg,rgba(103,232,249,0.96),rgba(14,165,233,0.82) 60%,rgba(249,115,22,0.8))] shadow-[0_10px_30px_rgba(34,211,238,0.18)] transition-[height] duration-300"
                        style={{ height: `${barHeight}px` }}
                      />
                    </div>
                    <div className="text-center">
                      <p className="font-mono text-[11px] text-[var(--foreground-tertiary)]">
                        {showLabel ? point.shortLabel : " "}
                      </p>
                      <p className="mt-1 text-[11px] text-[var(--foreground-secondary)]">
                        {formatAdminMetricValue(point.primaryValue, { kind, compact: true })}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </article>
  );
}
