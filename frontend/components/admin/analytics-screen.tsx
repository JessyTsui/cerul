"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import {
  adminAnalytics,
  type AdminAnalyticsContentRow,
  type AdminAnalyticsCreatorRow,
  type AdminAnalyticsDashboard,
  type AdminAnalyticsFeedbackResultRow,
  type AdminAnalyticsFeedbackVideoRow,
  type AdminAnalyticsQueryRow,
  type AdminAnalyticsRankBaseline,
  type AdminSearchSurfaceFilter,
} from "@/lib/admin-analytics";
import type { AdminRange } from "@/lib/admin-api";
import { formatAdminDateTime, formatAdminMetricValue } from "@/lib/admin-console";
import { formatDashboardDate } from "@/lib/dashboard";
import { getApiErrorMessage } from "@/lib/api";
import { AdminLayout } from "./admin-layout";
import { AdminMetricCard } from "./admin-metric-card";
import { AdminRangePicker } from "./admin-range-picker";
import { AdminTrendChart } from "./admin-trend-chart";
import {
  DashboardNotice,
  DashboardSkeleton,
  DashboardState,
} from "@/components/dashboard/dashboard-state";

const SURFACE_OPTIONS: Array<{ label: string; value: AdminSearchSurfaceFilter }> = [
  { label: "All surfaces", value: "all" },
  { label: "API only", value: "api" },
  { label: "MCP only", value: "mcp" },
  { label: "Playground only", value: "playground" },
];

function toAnalyticsChartData(points: AdminAnalyticsDashboard["overview"]["trendSeries"]) {
  return points.map((point) => ({
    date: point.date,
    shortLabel: formatDashboardDate(point.date),
    fullLabel: formatDashboardDate(point.date),
    primaryValue: point.impressions,
    secondaryValue: point.uniqueOutboundClicks,
  }));
}

function formatAverageRank(value: number | null): string {
  if (value == null || !Number.isFinite(value)) {
    return "—";
  }
  return `#${value.toFixed(1)}`;
}

function formatTimestampRange(start: number | null, end: number | null): string {
  if (start == null && end == null) {
    return "—";
  }
  if (start != null && end != null) {
    return `${start.toFixed(1)}s-${end.toFixed(1)}s`;
  }
  if (start != null) {
    return `${start.toFixed(1)}s`;
  }
  return `${end!.toFixed(1)}s`;
}

function formatSurfaceLabel(value: string | null): string {
  if (value === "api") {
    return "API";
  }
  if (value === "playground") {
    return "Playground";
  }
  if (value === "mcp") {
    return "MCP";
  }
  return "Legacy";
}

function AnalyticsSurfacePicker({
  value,
  onChange,
}: {
  value: AdminSearchSurfaceFilter;
  onChange: (value: AdminSearchSurfaceFilter) => void;
}) {
  return (
    <div className="inline-flex rounded-full border border-[var(--border)] bg-white/68 p-1 shadow-sm">
      {SURFACE_OPTIONS.map((option) => {
        const isActive = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`rounded-full px-4 py-2 text-sm transition-colors ${
              isActive
                ? "bg-[var(--brand-bright)] text-white"
                : "text-[var(--foreground-secondary)] hover:bg-white/80 hover:text-[var(--foreground)]"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function AnalyticsTableCard({
  eyebrow,
  title,
  description,
  footer,
  children,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  footer?: string;
  children: ReactNode;
}) {
  return (
    <article className="surface-elevated overflow-hidden rounded-[30px] px-5 py-5">
      {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
      <p className="mt-1 text-sm font-semibold text-[var(--foreground)]">{title}</p>
      <p className="mt-1 text-xs leading-6 text-[var(--foreground-tertiary)]">{description}</p>
      <div className="mt-4">{children}</div>
      {footer ? (
        <p className="mt-4 text-[11px] uppercase tracking-[0.14em] text-[var(--foreground-tertiary)]">
          {footer}
        </p>
      ) : null}
    </article>
  );
}

function EmptyTableRow({ colSpan, label = "Not enough data yet." }: { colSpan: number; label?: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="py-5 text-center text-xs text-[var(--foreground-tertiary)]">
        {label}
      </td>
    </tr>
  );
}

function ContentTableRows({ rows }: { rows: AdminAnalyticsContentRow[] }) {
  if (rows.length === 0) {
    return <EmptyTableRow colSpan={6} />;
  }

  return (
    <>
      {rows.map((row) => (
        <tr key={`${row.videoId ?? row.unitId ?? row.shortId ?? row.title}-${row.title}`}>
          <td className="admin-table-primary">
            <div className="flex flex-col gap-1">
              <span>{row.title}</span>
              <span className="text-[11px] font-normal text-[var(--foreground-tertiary)]">
                {(row.creator ?? "Unknown creator")} · {row.source}
              </span>
            </div>
          </td>
          <td>{formatAdminMetricValue(row.impressions, { compact: true })}</td>
          <td>{formatAdminMetricValue(row.uniqueOutboundClicks, { compact: true })}</td>
          <td>{formatAdminMetricValue(row.ctr, { kind: "percent" })}</td>
          <td>{formatAverageRank(row.avgRank)}</td>
          <td>{row.distinctQueriesClicked}</td>
        </tr>
      ))}
    </>
  );
}

function CreatorTableRows({ rows, showShare = false }: { rows: AdminAnalyticsCreatorRow[]; showShare?: boolean }) {
  if (rows.length === 0) {
    return <EmptyTableRow colSpan={showShare ? 6 : 5} />;
  }

  return (
    <>
      {rows.map((row) => (
        <tr key={`${row.creatorKey}-${row.source}`}>
          <td className="admin-table-primary">
            <div className="flex flex-col gap-1">
              <span>{row.creator}</span>
              <span className="text-[11px] font-normal text-[var(--foreground-tertiary)]">
                {row.source}
                {row.channelId ? ` · ${row.channelId}` : ""}
              </span>
            </div>
          </td>
          <td>{formatAdminMetricValue(row.impressions, { compact: true })}</td>
          <td>{formatAdminMetricValue(row.uniqueOutboundClicks, { compact: true })}</td>
          <td>{formatAdminMetricValue(row.ctr, { kind: "percent" })}</td>
          <td>{row.distinctVideos}</td>
          {showShare ? <td>{formatAdminMetricValue(row.shareDelta, { kind: "percent" })}</td> : null}
        </tr>
      ))}
    </>
  );
}

function QueryTableRows({ rows, showZeroResults = false }: { rows: AdminAnalyticsQueryRow[]; showZeroResults?: boolean }) {
  if (rows.length === 0) {
    return <EmptyTableRow colSpan={showZeroResults ? 5 : 5} />;
  }

  return (
    <>
      {rows.map((row) => (
        <tr key={row.normalizedQueryText}>
          <td className="admin-table-primary">{row.exampleQueryText}</td>
          <td>{row.searches}</td>
          <td>{formatAdminMetricValue(row.impressions, { compact: true })}</td>
          <td>{formatAdminMetricValue(row.uniqueOutboundClicks, { compact: true })}</td>
          <td>{showZeroResults ? row.zeroResultSearches : formatAdminMetricValue(row.ctr, { kind: "percent" })}</td>
        </tr>
      ))}
    </>
  );
}

function RankBaselineRows({ rows }: { rows: AdminAnalyticsRankBaseline[] }) {
  if (rows.length === 0) {
    return <EmptyTableRow colSpan={4} />;
  }

  return (
    <>
      {rows.map((row) => (
        <tr key={row.resultRank}>
          <td className="admin-table-primary">#{row.resultRank + 1}</td>
          <td>{formatAdminMetricValue(row.impressions, { compact: true })}</td>
          <td>{formatAdminMetricValue(row.uniqueOutboundClicks, { compact: true })}</td>
          <td>{formatAdminMetricValue(row.ctr, { kind: "percent" })}</td>
        </tr>
      ))}
    </>
  );
}

function FeedbackVideoRows({ rows }: { rows: AdminAnalyticsFeedbackVideoRow[] }) {
  if (rows.length === 0) {
    return <EmptyTableRow colSpan={4} />;
  }

  return (
    <>
      {rows.map((row) => (
        <tr key={row.videoId}>
          <td className="admin-table-primary">
            <div className="flex flex-col gap-1">
              <span>{row.title}</span>
              <span className="text-[11px] font-normal text-[var(--foreground-tertiary)]">
                {(row.creator ?? "Unknown creator")} · {row.source}
              </span>
            </div>
          </td>
          <td>{row.likes}</td>
          <td>{row.dislikes}</td>
          <td>{row.netScore}</td>
        </tr>
      ))}
    </>
  );
}

function FeedbackResultRows({ rows }: { rows: AdminAnalyticsFeedbackResultRow[] }) {
  if (rows.length === 0) {
    return <EmptyTableRow colSpan={5} />;
  }

  return (
    <>
      {rows.map((row) => (
        <tr key={row.unitId}>
          <td className="admin-table-primary">
            <div className="flex flex-col gap-1">
              <span>{row.title}</span>
              <span className="text-[11px] font-normal text-[var(--foreground-tertiary)]">
                {(row.creator ?? "Unknown creator")} · {formatTimestampRange(row.timestampStart, row.timestampEnd)}
              </span>
            </div>
          </td>
          <td>{row.unitType ?? "—"}</td>
          <td>{row.likes}</td>
          <td>{row.dislikes}</td>
          <td>{row.netScore}</td>
        </tr>
      ))}
    </>
  );
}

export function AdminAnalyticsScreen() {
  const [range, setRange] = useState<AdminRange>("7d");
  const [surface, setSurface] = useState<AdminSearchSurfaceFilter>("all");
  const [data, setData] = useState<AdminAnalyticsDashboard | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);

      try {
        const nextData = await adminAnalytics.getDashboard(range, surface);
        if (!cancelled) {
          setData(nextData);
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(getApiErrorMessage(nextError, "Failed to load admin analytics."));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [range, surface]);

  const refresh = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const nextData = await adminAnalytics.getDashboard(range, surface);
      setData(nextData);
    } catch (nextError) {
      setError(getApiErrorMessage(nextError, "Failed to load admin analytics."));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AdminLayout
      currentPath="/admin/analytics"
      title="Analytics"
      description="CTR, creator routing, clip preference, and search quality in one operator-facing surface."
      actions={
        <>
          <AdminRangePicker value={range} onChange={setRange} />
          <AnalyticsSurfacePicker value={surface} onChange={setSurface} />
        </>
      }
    >
      {isLoading && !data ? (
        <DashboardSkeleton />
      ) : error && !data ? (
        <DashboardState
          action={
            <button className="button-primary" onClick={() => void refresh()} type="button">
              Retry
            </button>
          }
          description={error}
          title="Analytics could not be loaded"
          tone="error"
        />
      ) : data ? (
        <>
          {error ? (
            <DashboardNotice
              title="Showing last successful snapshot."
              description={error}
              tone="error"
            />
          ) : null}

          {data.overview.notices.map((notice) => (
            <DashboardNotice
              key={`${notice.tone}-${notice.title}`}
              title={notice.title}
              description={notice.description}
              tone={notice.tone === "error" ? "error" : "default"}
            />
          ))}

          {data.feedback.notice ? (
            <DashboardNotice
              title={data.feedback.notice.title}
              description={data.feedback.notice.description}
              tone="default"
            />
          ) : null}

          <section
            className="surface-elevated overflow-hidden rounded-[34px] px-6 py-6"
            style={{
              backgroundImage:
                "radial-gradient(circle at top right, rgba(38,191,169,0.18), transparent 28%), radial-gradient(circle at left center, rgba(242,144,74,0.16), transparent 30%)",
            }}
          >
            <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
              <div className="max-w-3xl">
                <p className="eyebrow">Signal Atlas</p>
                <h2 className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-[var(--foreground)]">
                  See where Cerul is actually sending attention, not just where it is generating traffic.
                </h2>
                <p className="mt-3 text-sm leading-7 text-[var(--foreground-secondary)]">
                  This surface separates exposure from preference so we can distinguish ranking volume, clip desirability,
                  creator pull, and feedback bias. Last refreshed {formatAdminDateTime(data.overview.generatedAt)}.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-3 xl:min-w-[420px]">
                {[
                  {
                    label: "Searches w/ results",
                    value: formatAdminMetricValue(data.overview.summary.searchesWithResults, { compact: true }),
                    detail: `${formatAdminMetricValue(
                      data.overview.summary.searchesWithResults / Math.max(data.overview.summary.searches, 1),
                      { kind: "percent" },
                    )} hit rate`,
                  },
                  {
                    label: "Detail assist",
                    value: formatAdminMetricValue(data.overview.summary.detailAssistRate, { kind: "percent" }),
                    detail: `${formatAdminMetricValue(data.overview.summary.uniqueDetailPageViews, { compact: true })} page views`,
                  },
                  {
                    label: "Feedback net",
                    value: formatAdminMetricValue(data.feedback.summary.netScore),
                    detail: `${data.feedback.summary.likes} up / ${data.feedback.summary.dislikes} down`,
                  },
                ].map((item) => (
                  <div key={item.label} className="rounded-[24px] border border-[var(--border)] bg-white/72 px-4 py-4">
                    <p className="text-xs uppercase tracking-[0.14em] text-[var(--foreground-tertiary)]">
                      {item.label}
                    </p>
                    <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-[var(--foreground)]">
                      {item.value}
                    </p>
                    <p className="mt-1 text-[11px] text-[var(--foreground-tertiary)]">{item.detail}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <AdminMetricCard label="Searches" metric={data.overview.metrics.searches} />
            <AdminMetricCard label="Impressions" metric={data.overview.metrics.impressions} />
            <AdminMetricCard label="Outbound clicks" metric={data.overview.metrics.uniqueOutboundClicks} />
            <AdminMetricCard label="Overall CTR" metric={data.overview.metrics.overallCtr} kind="percent" />
            <AdminMetricCard label="Detail assist" metric={data.overview.metrics.detailAssistRate} kind="percent" />
            <AdminMetricCard label="Answer CTR gap" metric={data.overview.metrics.answerCtrGap} kind="percent" />
          </section>

          <div className="grid gap-3 xl:grid-cols-[1.4fr_0.9fr]">
            <AdminTrendChart
              title="Exposure to outbound intent"
              description="Track returned result volume against unique outbound intent across the active time window."
              data={toAnalyticsChartData(data.overview.trendSeries)}
              metricLabel="Impressions"
              secondaryLabel="Outbound clicks"
            />

            <AnalyticsTableCard
              eyebrow="Mode split"
              title="Answer vs no-answer CTR"
              description="Useful for checking whether answer generation is supporting or cannibalizing outbound clicks."
            >
              <div className="space-y-3">
                {data.overview.answerModes.map((row) => (
                  <div key={row.includeAnswer ? "with-answer" : "without-answer"} className="rounded-[22px] border border-[var(--border)] bg-white/70 px-4 py-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-[var(--foreground)]">
                          {row.includeAnswer ? "With answer" : "Without answer"}
                        </p>
                        <p className="mt-1 text-xs text-[var(--foreground-tertiary)]">
                          {row.searches} searches · {formatAdminMetricValue(row.impressions, { compact: true })} impressions
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-semibold text-[var(--foreground)]">
                          {formatAdminMetricValue(row.ctr, { kind: "percent" })}
                        </p>
                        <p className="text-[11px] text-[var(--foreground-tertiary)]">
                          {formatAdminMetricValue(row.uniqueOutboundClicks, { compact: true })} outbound clicks
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </AnalyticsTableCard>
          </div>

          {surface === "all" ? (
            <AnalyticsTableCard
              eyebrow="Surface mix"
              title="Where demand is coming from"
              description="Search surface attribution is now first-class, so we can compare public API behavior with dashboard playground behavior."
            >
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Surface</th>
                    <th>Searches</th>
                    <th>Impr.</th>
                    <th>Clicks</th>
                    <th>CTR</th>
                  </tr>
                </thead>
                <tbody>
                  {data.overview.surfaceBreakdown.length === 0 ? (
                    <EmptyTableRow colSpan={5} />
                  ) : (
                    data.overview.surfaceBreakdown.map((row) => (
                      <tr key={row.searchSurface ?? "legacy"}>
                        <td className="admin-table-primary">{formatSurfaceLabel(row.searchSurface)}</td>
                        <td>{row.searches}</td>
                        <td>{formatAdminMetricValue(row.impressions, { compact: true })}</td>
                        <td>{formatAdminMetricValue(row.uniqueOutboundClicks, { compact: true })}</td>
                        <td>{formatAdminMetricValue(row.ctr, { kind: "percent" })}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </AnalyticsTableCard>
          ) : null}

          <section className="grid gap-3 xl:grid-cols-2">
            <AnalyticsTableCard
              eyebrow="Content"
              title="Top videos by outbound volume"
              description="Raw routed demand. This catches content that consistently earns clicks at scale."
            >
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Video</th>
                    <th>Impr.</th>
                    <th>Clicks</th>
                    <th>CTR</th>
                    <th>Avg rank</th>
                    <th>Queries</th>
                  </tr>
                </thead>
                <tbody>
                  <ContentTableRows rows={data.content.topVideosByClicks} />
                </tbody>
              </table>
            </AnalyticsTableCard>

            <AnalyticsTableCard
              eyebrow="Content"
              title="Top videos by CTR"
              description="Rate-based leaders with an impression floor. This is the better read on preference."
              footer={`Minimum ${data.content.minImpressions} impressions`}
            >
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Video</th>
                    <th>Impr.</th>
                    <th>Clicks</th>
                    <th>CTR</th>
                    <th>Avg rank</th>
                    <th>Queries</th>
                  </tr>
                </thead>
                <tbody>
                  <ContentTableRows rows={data.content.topVideosByCtr} />
                </tbody>
              </table>
            </AnalyticsTableCard>

            <AnalyticsTableCard
              eyebrow="Clip preference"
              title="Best-returning segments"
              description="Returned result slices that outperform their exposure after controlling for impression floor."
              footer={`Minimum ${data.content.minResultImpressions} impressions`}
            >
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Result</th>
                    <th>Impr.</th>
                    <th>Clicks</th>
                    <th>CTR</th>
                    <th>Avg rank</th>
                    <th>Queries</th>
                  </tr>
                </thead>
                <tbody>
                  <ContentTableRows rows={data.content.topResultsByCtr} />
                </tbody>
              </table>
            </AnalyticsTableCard>

            <AnalyticsTableCard
              eyebrow="Gap finder"
              title="High-impression, low-click videos"
              description="Likely retrieval or snippet candidates: frequently shown, rarely chosen."
              footer={`Minimum ${data.content.minImpressions} impressions`}
            >
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Video</th>
                    <th>Impr.</th>
                    <th>Clicks</th>
                    <th>CTR</th>
                    <th>Avg rank</th>
                    <th>Queries</th>
                  </tr>
                </thead>
                <tbody>
                  <ContentTableRows rows={data.content.highImpressionLowClickVideos} />
                </tbody>
              </table>
            </AnalyticsTableCard>
          </section>

          <section className="grid gap-3 xl:grid-cols-[1.1fr_1.1fr_0.9fr]">
            <AnalyticsTableCard
              eyebrow="Creators"
              title="Top creators by routed clicks"
              description="Which creators are getting the largest absolute outbound demand from Cerul."
            >
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Creator</th>
                    <th>Impr.</th>
                    <th>Clicks</th>
                    <th>CTR</th>
                    <th>Videos</th>
                  </tr>
                </thead>
                <tbody>
                  <CreatorTableRows rows={data.creators.topCreatorsByClicks} />
                </tbody>
              </table>
            </AnalyticsTableCard>

            <AnalyticsTableCard
              eyebrow="Creators"
              title="Top creators by CTR"
              description="Creators whose returned videos are chosen at the highest rate once exposure clears the floor."
              footer={`Minimum ${data.creators.minImpressions} impressions`}
            >
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Creator</th>
                    <th>Impr.</th>
                    <th>Clicks</th>
                    <th>CTR</th>
                    <th>Videos</th>
                  </tr>
                </thead>
                <tbody>
                  <CreatorTableRows rows={data.creators.topCreatorsByCtr} />
                </tbody>
              </table>
            </AnalyticsTableCard>

            <AnalyticsTableCard
              eyebrow="Share delta"
              title="Creators beating their exposure share"
              description="Positive share delta means this creator wins more outbound intent than their share of impressions would predict."
            >
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Creator</th>
                    <th>Impr.</th>
                    <th>Clicks</th>
                    <th>CTR</th>
                    <th>Videos</th>
                    <th>Share Δ</th>
                  </tr>
                </thead>
                <tbody>
                  <CreatorTableRows rows={data.creators.creatorShareLeaders} showShare />
                </tbody>
              </table>
            </AnalyticsTableCard>
          </section>

          <section className="grid gap-3 xl:grid-cols-2">
            <AnalyticsTableCard
              eyebrow="Search quality"
              title="Top queries by demand"
              description="The highest recurring query themes in the current window."
            >
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Query</th>
                    <th>Searches</th>
                    <th>Impr.</th>
                    <th>Clicks</th>
                    <th>CTR</th>
                  </tr>
                </thead>
                <tbody>
                  <QueryTableRows rows={data.searchQuality.topQueries} />
                </tbody>
              </table>
            </AnalyticsTableCard>

            <AnalyticsTableCard
              eyebrow="Search quality"
              title="Zero-result queries"
              description="Demand signals with no returned inventory. Useful for ingestion and indexing priorities."
            >
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Query</th>
                    <th>Searches</th>
                    <th>Impr.</th>
                    <th>Clicks</th>
                    <th>0-result</th>
                  </tr>
                </thead>
                <tbody>
                  <QueryTableRows rows={data.searchQuality.zeroResultQueries} showZeroResults />
                </tbody>
              </table>
            </AnalyticsTableCard>

            <AnalyticsTableCard
              eyebrow="Search quality"
              title="High-impression, low-click queries"
              description="Queries where Cerul is returning results but not earning selection."
              footer={`Minimum ${data.searchQuality.minQueryImpressions} impressions`}
            >
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Query</th>
                    <th>Searches</th>
                    <th>Impr.</th>
                    <th>Clicks</th>
                    <th>CTR</th>
                  </tr>
                </thead>
                <tbody>
                  <QueryTableRows rows={data.searchQuality.highImpressionLowClickQueries} />
                </tbody>
              </table>
            </AnalyticsTableCard>

            <AnalyticsTableCard
              eyebrow="Search quality"
              title="Strongest outbound queries"
              description="Queries whose result sets convert especially well once they clear the exposure floor."
              footer={`Minimum ${data.searchQuality.minQueryImpressions} impressions`}
            >
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Query</th>
                    <th>Searches</th>
                    <th>Impr.</th>
                    <th>Clicks</th>
                    <th>CTR</th>
                  </tr>
                </thead>
                <tbody>
                  <QueryTableRows rows={data.searchQuality.strongestQueries} />
                </tbody>
              </table>
            </AnalyticsTableCard>
          </section>

          <div className="grid gap-3 xl:grid-cols-[1fr_1.4fr]">
            <AnalyticsTableCard
              eyebrow="Position effect"
              title="Rank baseline CTR"
              description="Use this as the fairness baseline for rank-adjusted comparisons."
            >
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Impr.</th>
                    <th>Clicks</th>
                    <th>CTR</th>
                  </tr>
                </thead>
                <tbody>
                  <RankBaselineRows rows={data.searchQuality.rankBaselines} />
                </tbody>
              </table>
            </AnalyticsTableCard>

            <AnalyticsTableCard
              eyebrow="Feedback"
              title="Playground preference snapshot"
              description="Explicit likes and dislikes from the dashboard playground. Useful for evaluation, not a substitute for live CTR."
            >
              <div className="grid gap-3 md:grid-cols-4">
                {[
                  { label: "Total feedback", value: formatAdminMetricValue(data.feedback.summary.totalFeedback) },
                  { label: "Likes", value: formatAdminMetricValue(data.feedback.summary.likes) },
                  { label: "Dislikes", value: formatAdminMetricValue(data.feedback.summary.dislikes) },
                  { label: "Like rate", value: formatAdminMetricValue(data.feedback.summary.likeRate, { kind: "percent" }) },
                ].map((item) => (
                  <div key={item.label} className="rounded-[22px] border border-[var(--border)] bg-white/70 px-4 py-4">
                    <p className="text-xs uppercase tracking-[0.14em] text-[var(--foreground-tertiary)]">{item.label}</p>
                    <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-[var(--foreground)]">{item.value}</p>
                  </div>
                ))}
              </div>
            </AnalyticsTableCard>
          </div>

          <section className="grid gap-3 xl:grid-cols-3">
            <AnalyticsTableCard
              eyebrow="Feedback"
              title="Most liked videos"
              description="Video-level preference in playground feedback."
            >
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Video</th>
                    <th>Likes</th>
                    <th>Dislikes</th>
                    <th>Net</th>
                  </tr>
                </thead>
                <tbody>
                  <FeedbackVideoRows rows={data.feedback.topVideosByLikes} />
                </tbody>
              </table>
            </AnalyticsTableCard>

            <AnalyticsTableCard
              eyebrow="Feedback"
              title="Most liked results"
              description="Result-level winners in explicit playground review."
            >
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Result</th>
                    <th>Type</th>
                    <th>Likes</th>
                    <th>Dislikes</th>
                    <th>Net</th>
                  </tr>
                </thead>
                <tbody>
                  <FeedbackResultRows rows={data.feedback.topResultsByLikes} />
                </tbody>
              </table>
            </AnalyticsTableCard>

            <AnalyticsTableCard
              eyebrow="Feedback"
              title="Most disliked results"
              description="Useful for spotting weak snippets, confusing clips, or poor retrieval matches."
            >
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Result</th>
                    <th>Type</th>
                    <th>Likes</th>
                    <th>Dislikes</th>
                    <th>Net</th>
                  </tr>
                </thead>
                <tbody>
                  <FeedbackResultRows rows={data.feedback.topResultsByDislikes} />
                </tbody>
              </table>
            </AnalyticsTableCard>
          </section>
        </>
      ) : (
        <DashboardState
          action={
            <button className="button-primary" onClick={() => void refresh()} type="button">
              Retry
            </button>
          }
          description="No analytics payload returned."
          title="No data available"
        />
      )}
    </AdminLayout>
  );
}
