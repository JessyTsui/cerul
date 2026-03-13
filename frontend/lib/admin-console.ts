import type {
  AdminMetricValue,
  AdminNamedCount,
  AdminRange,
  AdminSummaryPoint,
} from "./admin-api";
import { formatDashboardDate, formatDashboardDateTime, formatNumber } from "./dashboard";

const PERCENT_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "percent",
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

const DECIMAL_FORMATTER = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

export const ADMIN_RANGE_OPTIONS: Array<{ label: string; value: AdminRange }> = [
  { label: "Today", value: "today" },
  { label: "Last 7d", value: "7d" },
  { label: "Last 30d", value: "30d" },
] as const;

export function formatAdminMetricValue(
  value: number,
  options?: {
    kind?: "number" | "percent" | "milliseconds";
    compact?: boolean;
  },
): string {
  const kind = options?.kind ?? "number";

  if (kind === "percent") {
    return PERCENT_FORMATTER.format(value);
  }

  if (kind === "milliseconds") {
    return `${formatNumber(Math.round(value))} ms`;
  }

  if (options?.compact && Math.abs(value) >= 1000) {
    if (Math.abs(value) >= 1_000_000) {
      return `${DECIMAL_FORMATTER.format(value / 1_000_000)}M`;
    }

    return `${DECIMAL_FORMATTER.format(value / 1000)}K`;
  }

  return formatNumber(Math.round(value));
}

export function formatAdminDelta(
  metric: AdminMetricValue,
  options?: {
    kind?: "number" | "percent" | "milliseconds";
  },
): string {
  if (metric.deltaRatio === null) {
    const value = metric.delta;
    const sign = value > 0 ? "+" : "";
    return `${sign}${formatAdminMetricValue(value, options)}`;
  }

  const sign = metric.deltaRatio > 0 ? "+" : "";
  return `${sign}${PERCENT_FORMATTER.format(metric.deltaRatio)}`;
}

export function formatTargetStatus(
  metric: AdminMetricValue,
  options?: {
    kind?: "number" | "percent" | "milliseconds";
  },
): string {
  if (metric.target === null || metric.comparisonMode === null) {
    return "No target";
  }

  const current = formatAdminMetricValue(metric.current, options);
  const target = formatAdminMetricValue(metric.target, options);
  return metric.comparisonMode === "at_most"
    ? `${current} vs max ${target}`
    : `${current} vs target ${target}`;
}

export function getMetricTone(metric: AdminMetricValue): "good" | "warning" | "neutral" {
  if (metric.target === null || metric.comparisonMode === null) {
    return "neutral";
  }

  if (metric.comparisonMode === "at_most") {
    return metric.current <= metric.target ? "good" : "warning";
  }

  return metric.current >= metric.target ? "good" : "warning";
}

export function toAdminChartData(
  points: AdminSummaryPoint[],
  metricKey:
    | "requests"
    | "creditsUsed"
    | "brollAssetsAdded"
    | "knowledgeVideosAdded"
    | "knowledgeSegmentsAdded"
    | "jobsCompleted"
    | "jobsFailed",
) {
  return points.map((point) => ({
    date: point.date,
    shortLabel: formatDashboardDate(point.date),
    fullLabel: formatDashboardDate(point.date),
    primaryValue: point[metricKey],
    secondaryValue:
      metricKey === "requests" ? point.creditsUsed : point.requests,
  }));
}

export function formatAdminDateTime(value: string | null): string {
  return formatDashboardDateTime(value);
}

export function topCountLabel(items: AdminNamedCount[]): string {
  if (items.length === 0) {
    return "No data";
  }

  const [top] = items;
  return `${top.label} · ${formatNumber(top.count)}`;
}
