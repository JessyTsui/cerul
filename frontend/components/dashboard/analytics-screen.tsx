"use client";

import { useMemo } from "react";
import {
  formatBillingPeriod,
  formatNumber,
  getTierLabel,
} from "@/lib/dashboard";
import { DashboardLayout } from "./dashboard-layout";
import { DashboardNotice, DashboardSkeleton, DashboardState } from "./dashboard-state";
import { useMonthlyUsage } from "./use-monthly-usage";

// Simple sparkline component
function Sparkline({ data, width = 120, height = 40 }: { data: number[]; width?: number; height?: number }) {
  if (data.length === 0) return <div className="h-[40px] w-[120px] rounded bg-[var(--background-elevated)]" />;

  const max = Math.max(1, ...data);
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1 || 1)) * width;
    const y = height - (v / max) * height;
    return `${x},${y}`;
  }).join(" ");

  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        points={points}
        className="text-[var(--brand)]"
      />
      {data.map((v, i) => {
        const x = (i / (data.length - 1 || 1)) * width;
        const y = height - (v / max) * height;
        return (
          <circle
            key={i}
            cx={x}
            cy={y}
            r="2"
            className="fill-[var(--brand)]"
          />
        );
      })}
    </svg>
  );
}

export function DashboardAnalyticsScreen() {
  const { data, error, isLoading, refresh } = useMonthlyUsage();

  const stats = useMemo(() => {
    if (!data) return null;

    const recentDays = data.dailyBreakdown.slice(-7);
    const requestData = recentDays.map((d) => d.requestCount);
    const totalRequests = data.requestCount;
    const avgDaily = recentDays.length > 0
      ? Math.round(recentDays.reduce((a, b) => a + b.requestCount, 0) / recentDays.length)
      : 0;
    const peakDay = recentDays.length > 0
      ? Math.max(...recentDays.map((d) => d.requestCount))
      : 0;
    const creditsPerRequest = totalRequests > 0
      ? (data.creditsUsed / totalRequests).toFixed(2)
      : "0";

    return {
      requestData,
      totalRequests,
      avgDaily,
      peakDay,
      creditsPerRequest,
      creditsUsed: data.creditsUsed,
      dailyFreeUsed: data.dailyFreeLimit - data.dailyFreeRemaining,
    };
  }, [data]);

  if (isLoading && !data) {
    return (
      <DashboardLayout currentPath="/dashboard/usage" title="Analytics">
        <DashboardSkeleton />
      </DashboardLayout>
    );
  }

  if (error && !data) {
    return (
      <DashboardLayout currentPath="/dashboard/usage" title="Analytics">
        <DashboardState
          title="Unable to load analytics"
          description={error}
          tone="error"
          action={<button className="button-primary" onClick={() => void refresh()}>Retry</button>}
        />
      </DashboardLayout>
    );
  }

  if (!data || !stats) {
    return (
      <DashboardLayout currentPath="/dashboard/usage" title="Analytics">
        <DashboardState title="No data available" description="Analytics data will appear after your account starts making requests." />
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout
      currentPath="/dashboard/usage"
      title="Analytics"
      description={`${getTierLabel(data.tier)} · ${formatBillingPeriod(data.periodStart, data.periodEnd)}`}
    >
      {error && (
        <DashboardNotice
          title="Showing cached data"
          description={error}
          tone="error"
        />
      )}

      {/* Key Metrics */}
      <section className="grid gap-px overflow-hidden rounded-2xl bg-[var(--border)] sm:grid-cols-3">
        {[
          {
            label: "Total requests",
            value: formatNumber(stats.totalRequests),
            sparkline: stats.requestData,
          },
          {
            label: "Credits used",
            value: formatNumber(stats.creditsUsed),
            subtext: `${stats.creditsPerRequest} per request`,
          },
          {
            label: "Avg daily",
            value: formatNumber(stats.avgDaily),
            subtext: `Peak: ${formatNumber(stats.peakDay)}`,
          },
        ].map((stat) => (
          <div
            key={stat.label}
            className="bg-[var(--surface)] p-5"
          >
            <p className="text-xs uppercase tracking-wider text-[var(--foreground-tertiary)]">
              {stat.label}
            </p>
            <div className="mt-2 flex items-end justify-between">
              <p className="text-3xl font-semibold tracking-tight text-[var(--foreground)]">
                {stat.value}
              </p>
              {stat.sparkline && (
                <Sparkline data={stat.sparkline} />
              )}
            </div>
            {stat.subtext && (
              <p className="mt-2 text-xs text-[var(--foreground-secondary)]">
                {stat.subtext}
              </p>
            )}
          </div>
        ))}
      </section>

      {/* Free vs Paid Breakdown */}
      <section className="mt-6 rounded-2xl border border-[var(--border)] p-5">
        <h3 className="text-sm font-medium text-[var(--foreground)]">Today&apos;s usage</h3>
        <div className="mt-4 flex items-center gap-4">
          <div className="flex-1">
            <div className="h-2 overflow-hidden rounded-full bg-[var(--background-elevated)]">
              <div
                className="h-full rounded-full bg-[var(--brand)]"
                style={{
                  width: `${Math.min(100, (stats.dailyFreeUsed / data.dailyFreeLimit) * 100)}%`,
                }}
              />
            </div>
            <div className="mt-2 flex justify-between text-xs">
              <span className="text-[var(--foreground-secondary)]">
                Free: {formatNumber(stats.dailyFreeUsed)} / {formatNumber(data.dailyFreeLimit)}
              </span>
              <span className="text-[var(--foreground-tertiary)]">
                Resets at midnight UTC
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Recent Activity Table */}
      <section className="mt-6">
        <h3 className="text-sm font-medium text-[var(--foreground)] mb-3">Recent activity</h3>
        {data.dailyBreakdown.length === 0 ? (
          <p className="text-sm text-[var(--foreground-tertiary)]">No activity yet</p>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-[var(--border)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--background-elevated)]">
                  <th className="px-4 py-3 text-left text-xs font-medium text-[var(--foreground-tertiary)]">Date</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-[var(--foreground-tertiary)]">Requests</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-[var(--foreground-tertiary)]">Credits</th>
                </tr>
              </thead>
              <tbody>
                {[...data.dailyBreakdown].reverse().slice(0, 7).map((row) => (
                  <tr key={row.date} className="border-t border-[var(--border)]">
                    <td className="px-4 py-3 text-[var(--foreground)]">
                      {new Date(row.date).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-[var(--brand-bright)]">
                      {formatNumber(row.requestCount)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-[var(--foreground-secondary)]">
                      {formatNumber(row.creditsUsed)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </DashboardLayout>
  );
}
