import type { UsageChartPoint } from "@/lib/dashboard";
import { formatNumber } from "@/lib/dashboard";

type UsageChartProps = {
  title: string;
  description: string;
  data: UsageChartPoint[];
};

function buildLinePath(
  values: number[],
  width: number,
  height: number,
  paddingX: number,
  paddingY: number,
) {
  const maxValue = Math.max(1, ...values);
  const usableWidth = width - paddingX * 2;
  const usableHeight = height - paddingY * 2;

  return values
    .map((value, index) => {
      const x =
        values.length === 1
          ? width / 2
          : paddingX + (index / (values.length - 1)) * usableWidth;
      const y = paddingY + usableHeight - (value / maxValue) * usableHeight;
      return `${index === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");
}

function buildAreaPath(
  values: number[],
  width: number,
  height: number,
  paddingX: number,
  paddingY: number,
) {
  if (values.length === 0) {
    return "";
  }

  const linePath = buildLinePath(values, width, height, paddingX, paddingY);
  const usableWidth = width - paddingX * 2;
  const baseY = height - paddingY;

  return `${linePath} L ${paddingX + usableWidth} ${baseY} L ${paddingX} ${baseY} Z`;
}

export function UsageChart({ title, description, data }: UsageChartProps) {
  if (data.length === 0) {
    return (
      <article className="surface-elevated rounded-[28px] px-6 py-6">
        <h2 className="text-2xl font-semibold text-[var(--foreground)]">{title}</h2>
        <p className="mt-2 text-sm text-[var(--foreground-secondary)]">{description}</p>
        <div className="mt-6 rounded-[22px] border border-dashed border-[var(--border)] px-5 py-10 text-center text-sm text-[var(--foreground-secondary)]">
          No usage has been recorded for this period yet.
        </div>
      </article>
    );
  }

  const width = 920;
  const height = 280;
  const paddingX = 28;
  const paddingY = 24;
  const creditValues = data.map((point) => point.creditsUsed);
  const requestValues = data.map((point) => point.requestCount);
  const knowledgePath = buildLinePath(creditValues, width, height, paddingX, paddingY);
  const brollPath = buildLinePath(requestValues, width, height, paddingX, paddingY);
  const areaPath = buildAreaPath(creditValues, width, height, paddingX, paddingY);

  return (
    <article className="surface-elevated dashboard-card rounded-[28px] px-6 py-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] bg-[rgba(136,165,242,0.12)]">
            <svg className="h-[18px] w-[18px] text-[var(--brand-bright)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} />
            </svg>
          </span>
          <div>
            <h2 className="text-lg font-semibold text-[var(--foreground)]">{title}</h2>
            <p className="mt-1 text-sm text-[var(--foreground-secondary)]">
              {description}
            </p>
          </div>
        </div>
        <div className="flex gap-4 text-sm">
          <span className="flex items-center gap-2 text-[var(--brand-bright)]">
            <span className="h-2 w-6 rounded-full bg-[var(--brand)]" />
            credits
          </span>
          <span className="flex items-center gap-2 text-[var(--foreground-secondary)]">
            <span className="h-2 w-6 rounded-full bg-[var(--accent)]" />
            requests
          </span>
        </div>
      </div>

      <div className="mt-6 overflow-hidden rounded-[24px] border border-[var(--border)] bg-[var(--background-elevated)] p-4">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full">
          <defs>
            <linearGradient id="usage-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(136, 165, 242, 0.34)" />
              <stop offset="100%" stopColor="rgba(136, 165, 242, 0.04)" />
            </linearGradient>
          </defs>

          {[0, 1, 2, 3].map((index) => {
            const y = paddingY + ((height - paddingY * 2) / 3) * index;
            return (
              <line
                key={index}
                x1={paddingX}
                x2={width - paddingX}
                y1={y}
                y2={y}
                stroke="rgba(79, 67, 51, 0.1)"
              />
            );
          })}

          <path d={areaPath} fill="url(#usage-fill)" />
          <path d={knowledgePath} fill="none" stroke="var(--brand)" strokeWidth="4" />
          <path
            d={brollPath}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="3"
            strokeDasharray="10 10"
          />

          {data.map((point, index) => {
            const x =
              data.length === 1
                ? width / 2
                : paddingX + (index / (data.length - 1)) * (width - paddingX * 2);
            const knowledgeMax = Math.max(1, ...creditValues);
            const knowledgeY =
              paddingY
              + (height - paddingY * 2)
              - (point.creditsUsed / knowledgeMax) * (height - paddingY * 2);

            return (
              <g key={point.date}>
                <circle cx={x} cy={knowledgeY} r="4" fill="var(--brand-bright)" />
                <text
                  x={x}
                  y={height - 4}
                  fill="rgba(109,101,88,0.78)"
                  fontSize="12"
                  textAnchor="middle"
                >
                  {point.shortLabel}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {[
          { label: "Credits plotted", value: formatNumber(creditValues.reduce((sum, value) => sum + value, 0)), color: "var(--brand)" },
          { label: "Requests plotted", value: formatNumber(requestValues.reduce((sum, value) => sum + value, 0)), color: "var(--accent)" },
          { label: "Data points", value: formatNumber(data.length), color: "var(--foreground-tertiary)" },
        ].map((item) => (
          <div key={item.label} className="flex items-center gap-3 rounded-[16px] border border-[var(--border)] bg-[var(--background-elevated)] px-4 py-3">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: item.color }} />
            <div>
              <p className="text-xs text-[var(--foreground-tertiary)]">{item.label}</p>
              <p className="text-lg font-semibold text-[var(--foreground)]">{item.value}</p>
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}
