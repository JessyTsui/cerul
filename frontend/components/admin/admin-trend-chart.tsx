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

  return (
    <article className="surface-elevated px-6 py-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
            Trend
          </p>
          <h2 className="mt-2 text-2xl font-semibold text-white">{title}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--foreground-secondary)]">
            {description}
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-[18px] border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
              {metricLabel}
            </p>
            <p className="mt-2 text-lg font-semibold text-white">
              {formatAdminMetricValue(totalValue, { kind })}
            </p>
          </div>
          {secondaryLabel ? (
            <div className="rounded-[18px] border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                {secondaryLabel}
              </p>
              <p className="mt-2 text-lg font-semibold text-white">
                {formatAdminMetricValue(totalSecondary)}
              </p>
            </div>
          ) : null}
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
                Math.round((point.primaryValue / maxValue) * 160),
              );
              const showLabel =
                data.length <= 10 ||
                index === 0 ||
                index === data.length - 1 ||
                index % 5 === 0;

              return (
                <div
                  key={point.date}
                  className="flex w-10 flex-none flex-col items-center gap-2"
                  title={`${point.fullLabel}: ${formatAdminMetricValue(point.primaryValue, { kind })}`}
                >
                  <div className="flex h-[180px] w-full items-end rounded-[16px] border border-[var(--border)] bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.01))] px-1 pb-1">
                    <div
                      className="w-full rounded-[12px] bg-[linear-gradient(180deg,var(--brand-bright),var(--accent))] shadow-[0_0_18px_rgba(59,130,246,0.28)] transition-[height] duration-300"
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
    </article>
  );
}
