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
        <h2 className="text-2xl font-semibold text-white">{title}</h2>
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
    <article className="surface-elevated rounded-[28px] px-6 py-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-white">{title}</h2>
          <p className="mt-2 text-sm leading-7 text-[var(--foreground-secondary)]">
            {description}
          </p>
        </div>
        <div className="flex gap-4 text-sm">
          <span className="flex items-center gap-2 text-[var(--brand-bright)]">
            <span className="h-2 w-6 rounded-full bg-[var(--brand)]" />
            knowledge
          </span>
          <span className="flex items-center gap-2 text-[var(--foreground-secondary)]">
            <span className="h-2 w-6 rounded-full bg-white/45" />
            broll
          </span>
        </div>
      </div>

      <div className="mt-6 overflow-hidden rounded-[24px] border border-[var(--border)] bg-[rgba(255,255,255,0.03)] p-4">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full">
          <defs>
            <linearGradient id="usage-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(34, 211, 238, 0.34)" />
              <stop offset="100%" stopColor="rgba(34, 211, 238, 0.02)" />
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
                stroke="rgba(255,255,255,0.08)"
              />
            );
          })}

          <path d={areaPath} fill="url(#usage-fill)" />
          <path d={knowledgePath} fill="none" stroke="var(--brand)" strokeWidth="4" />
          <path
            d={brollPath}
            fill="none"
            stroke="rgba(255,255,255,0.56)"
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
                  fill="rgba(255,255,255,0.58)"
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

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <div className="rounded-[20px] border border-[var(--border)] bg-[rgba(255,255,255,0.03)] px-4 py-4">
          <p className="text-sm text-[var(--foreground-secondary)]">Credits plotted</p>
          <p className="mt-2 text-2xl font-semibold text-white">
            {formatNumber(creditValues.reduce((sum, value) => sum + value, 0))}
          </p>
        </div>
        <div className="rounded-[20px] border border-[var(--border)] bg-[rgba(255,255,255,0.03)] px-4 py-4">
          <p className="text-sm text-[var(--foreground-secondary)]">Requests plotted</p>
          <p className="mt-2 text-2xl font-semibold text-white">
            {formatNumber(requestValues.reduce((sum, value) => sum + value, 0))}
          </p>
        </div>
        <div className="rounded-[20px] border border-[var(--border)] bg-[rgba(255,255,255,0.03)] px-4 py-4">
          <p className="text-sm text-[var(--foreground-secondary)]">Data points</p>
          <p className="mt-2 text-2xl font-semibold text-white">{formatNumber(data.length)}</p>
        </div>
      </div>
    </article>
  );
}
