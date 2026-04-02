"use client";

import { useEffect, useState } from "react";
import { queryLogs, type QueryLogEntry } from "@/lib/api";
import { formatNumber, type UsageChartPoint } from "@/lib/dashboard";
import { DashboardLayout } from "./dashboard-layout";
import { DashboardSkeleton, DashboardState } from "./dashboard-state";
import { UsageChart } from "./usage-chart";
import { useMonthlyUsage } from "./use-monthly-usage";

/* ── Icons ────────────────────────────────────────────── */

function IconSearch({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} />
    </svg>
  );
}

function IconBolt({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24">
      <path d="M13.5 2.75 6.75 13.5h4.5l-.75 7.75 6.75-10.75h-4.5l.75-7.75Z" fill="currentColor" />
    </svg>
  );
}

function IconChevron({ className, open }: { className?: string; open: boolean }) {
  return (
    <svg className={`${className ?? ""} transition-transform duration-200 ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path d="m19.5 8.25-7.5 7.5-7.5-7.5" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} />
    </svg>
  );
}

function IconSparkles({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} />
    </svg>
  );
}

/* ── Helpers ───────────────────────────────────────────── */

function formatRelativeTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const diffMin = Math.floor((Date.now() - date.getTime()) / 60_000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function scorePercent(score: number | null): number {
  if (score == null) return 0;
  return Math.round(Math.max(0, Math.min(1, score)) * 100);
}

function scoreColor(pct: number): string {
  if (pct >= 80) return "var(--success)";
  if (pct >= 50) return "var(--brand-bright)";
  return "var(--foreground-tertiary)";
}

/* ── Query Row ─────────────────────────────────────────── */

function QueryRow({ log }: { log: QueryLogEntry }) {
  const [open, setOpen] = useState(false);
  const hasDetails = log.answerText || log.results.length > 0;
  const previewResults = log.results.slice(0, 3);
  const moreCount = log.results.length - 3;

  return (
    <div
      className={`rounded-[16px] border border-[var(--border)] bg-white/60 transition ${hasDetails ? "cursor-pointer hover:border-[var(--border-strong)] hover:bg-white/80" : ""}`}
      onClick={() => hasDetails && setOpen((v) => !v)}
      role={hasDetails ? "button" : undefined}
      tabIndex={hasDetails ? 0 : undefined}
      onKeyDown={hasDetails ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen((v) => !v); } } : undefined}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-4 pt-3.5 pb-1">
        <IconSearch className="h-3.5 w-3.5 shrink-0 text-[var(--brand-bright)]" />
        <p className="min-w-0 flex-1 truncate text-sm text-[var(--foreground)]">{log.queryText}</p>
        <span className="flex shrink-0 items-center gap-1 text-[11px] text-[var(--foreground-tertiary)]">
          {formatRelativeTime(log.createdAt)}
          <span className="mx-0.5">·</span>
          <IconBolt className="h-3 w-3" />{log.creditsUsed}
        </span>
        {hasDetails && <IconChevron className="h-3.5 w-3.5 shrink-0 text-[var(--foreground-tertiary)]" open={open} />}
      </div>

      {/* Thumbnail preview row — always visible */}
      {previewResults.length > 0 && (
        <div className="flex items-center gap-2 px-4 pb-3.5 pt-2">
          {previewResults.map((result) => (
            <div key={result.rank} className="relative h-14 w-24 shrink-0 overflow-hidden rounded-[8px] border border-[var(--border)] bg-[rgba(36,29,21,0.03)]">
              {result.thumbnailUrl ? (
                // Result thumbnails are remote content returned by the API, so we intentionally skip next/image optimization here.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={result.thumbnailUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-[10px] text-[var(--foreground-tertiary)]">
                  {result.title ? result.title.slice(0, 12) : `#${result.rank + 1}`}
                </span>
              )}
            </div>
          ))}
          {moreCount > 0 && (
            <span className="text-[11px] text-[var(--foreground-tertiary)]">+{moreCount} more</span>
          )}
          {previewResults.length === 0 && (
            <span className="text-[11px] text-[var(--foreground-tertiary)]">{log.resultCount} results</span>
          )}
        </div>
      )}
      {previewResults.length === 0 && (
        <div className="px-4 pb-3.5 pt-0.5">
          <span className="text-[11px] text-[var(--foreground-tertiary)]">{log.resultCount} results</span>
        </div>
      )}

      {/* Expanded details */}
      {open && hasDetails && (
        <div className="animate-fade-in space-y-3 border-t border-[var(--border)] bg-[var(--background-elevated)] px-4 py-4" style={{ borderRadius: "0 0 16px 16px" }}>
          {/* Answer */}
          {log.answerText && (
            <div className="rounded-[12px] border border-[var(--border-brand)] bg-[var(--brand-subtle)] px-4 py-3">
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--brand-bright)]">
                <IconSparkles className="h-3 w-3" />
                AI Answer
              </div>
              <p className="text-[13px] leading-relaxed text-[var(--foreground)]">{log.answerText}</p>
            </div>
          )}

          {/* Full results */}
          {log.results.length > 0 && (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {log.results.map((result) => {
                const pct = scorePercent(result.score);
                return (
                  <a
                    key={result.rank}
                    href={result.targetUrl ?? "#"}
                    target="_blank"
                    rel="noreferrer"
                    className="group flex gap-2.5 rounded-[10px] border border-[var(--border)] bg-white/60 p-2 transition hover:border-[var(--border-strong)] hover:bg-white/90"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {result.thumbnailUrl ? (
                      // Result thumbnails are remote content returned by the API, so we intentionally skip next/image optimization here.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={result.thumbnailUrl} alt="" className="h-10 w-16 shrink-0 rounded-[5px] object-cover" />
                    ) : (
                      <span className="flex h-10 w-16 shrink-0 items-center justify-center rounded-[5px] bg-[rgba(36,29,21,0.05)] text-[11px] font-semibold text-[var(--foreground-tertiary)]">
                        #{result.rank + 1}
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12px] font-medium text-[var(--foreground)] group-hover:text-[var(--brand-bright)]">
                        {result.title || "Untitled"}
                      </p>
                      <p className="truncate text-[10px] text-[var(--foreground-tertiary)]">{result.source}</p>
                      {result.score != null && (
                        <div className="mt-1 flex items-center gap-1.5">
                          <div className="h-1 flex-1 overflow-hidden rounded-full bg-[rgba(36,29,21,0.06)]">
                            <div className="h-full rounded-full" style={{ width: `${Math.max(pct, 4)}%`, background: scoreColor(pct) }} />
                          </div>
                          <span className="text-[9px] tabular-nums" style={{ color: scoreColor(pct) }}>{pct}%</span>
                        </div>
                      )}
                    </div>
                  </a>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Main screen ──────────────────────────────────────── */

export function DashboardUsageScreen() {
  const { data: usageData } = useMonthlyUsage();
  const [logs, setLogs] = useState<QueryLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const pageSize = 20;

  async function loadLogs(offset: number) {
    setIsLoading(true);
    setError(null);
    try {
      const result = await queryLogs.list({ limit: pageSize, offset });
      setLogs(result.items);
      setTotal(result.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load query history.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadLogs(page * pageSize);
  }, [page]);

  // Build last-30-days chart data regardless of billing period
  const chartData: UsageChartPoint[] = (() => {
    if (!usageData) return [];
    const byDate = new Map(usageData.dailyBreakdown.map((d) => [d.date, d]));
    const days: UsageChartPoint[] = [];
    const fmt = new Intl.DateTimeFormat("en-US", { month: "numeric", day: "numeric", timeZone: "UTC" });
    const fmtFull = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - i);
      const key = d.toISOString().slice(0, 10);
      const entry = byDate.get(key);
      days.push({
        date: key,
        shortLabel: fmt.format(d),
        fullLabel: fmtFull.format(d),
        creditsUsed: entry?.creditsUsed ?? 0,
        requestCount: entry?.requestCount ?? 0,
      });
    }
    return days;
  })();
  const totalPages = Math.ceil(total / pageSize);

  return (
    <DashboardLayout
      currentPath="/dashboard/usage"
      title="Usage"
      description="Credit consumption and query history."
      actions={null}
    >
      {/* ── Summary strip ─────────────────────────────── */}
      {usageData && (
        <div className="grid grid-cols-3 gap-4">
          <div className="surface-elevated dashboard-card flex items-center gap-3 rounded-[20px] px-5 py-4">
            <IconBolt className="h-5 w-5 shrink-0 text-[var(--brand-bright)]" />
            <div>
              <p className="text-xs text-[var(--foreground-tertiary)]">Credits used</p>
              <p className="text-xl font-semibold tabular-nums text-[var(--foreground)]">{formatNumber(usageData.creditsUsed)}</p>
            </div>
          </div>
          <div className="surface-elevated dashboard-card flex items-center gap-3 rounded-[20px] px-5 py-4">
            <IconSearch className="h-5 w-5 shrink-0 text-[var(--accent-bright)]" />
            <div>
              <p className="text-xs text-[var(--foreground-tertiary)]">Total queries</p>
              <p className="text-xl font-semibold tabular-nums text-[var(--foreground)]">{formatNumber(total)}</p>
            </div>
          </div>
          <div className="surface-elevated dashboard-card flex items-center gap-3 rounded-[20px] px-5 py-4">
            <IconSparkles className="h-5 w-5 shrink-0 text-[var(--foreground-tertiary)]" />
            <div>
              <p className="text-xs text-[var(--foreground-tertiary)]">Spendable credits</p>
              <p className="text-xl font-semibold tabular-nums text-[var(--foreground)]">
                {formatNumber(usageData.walletBalance)}
              </p>
              <p className="text-xs text-[var(--foreground-tertiary)]">
                Free today: {formatNumber(usageData.dailyFreeRemaining)} / {formatNumber(usageData.dailyFreeLimit)}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Chart ─────────────────────────────────────── */}
      {chartData.length > 0 && (
        <UsageChart
          title="Daily Activity"
          description="Credit consumption over the current billing period."
          data={chartData}
        />
      )}

      {/* ── Query history ─────────────────────────────── */}
      {isLoading && logs.length === 0 ? (
        <DashboardSkeleton />
      ) : error ? (
        <DashboardState
          title="Could not load query history"
          description={error}
          tone="error"
          action={<button className="button-primary" onClick={() => void loadLogs(page * pageSize)} type="button">Retry</button>}
        />
      ) : logs.length === 0 ? (
        <DashboardState
          title="No queries yet"
          description="Your API query history will appear here once you start making search requests."
        />
      ) : (
        <section>
          <div className="mb-3 flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <IconSearch className="h-4 w-4 text-[var(--foreground-tertiary)]" />
              <h2 className="text-base font-semibold text-[var(--foreground)]">Query History</h2>
            </div>
            <span className="text-xs text-[var(--foreground-tertiary)]">{formatNumber(total)} total</span>
          </div>

          <div className="space-y-3">
            {logs.map((log) => (
              <QueryRow key={log.requestId} log={log} />
            ))}
          </div>

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between px-1">
              <button
                type="button"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                className="rounded-[12px] border border-[var(--border)] bg-white/70 px-3 py-1.5 text-sm text-[var(--foreground-secondary)] transition hover:bg-white disabled:opacity-40"
              >
                Previous
              </button>
              <span className="text-xs text-[var(--foreground-tertiary)]">Page {page + 1} of {totalPages}</span>
              <button
                type="button"
                disabled={page >= totalPages - 1}
                onClick={() => setPage((p) => p + 1)}
                className="rounded-[12px] border border-[var(--border)] bg-white/70 px-3 py-1.5 text-sm text-[var(--foreground-secondary)] transition hover:bg-white disabled:opacity-40"
              >
                Next
              </button>
            </div>
          )}
        </section>
      )}
    </DashboardLayout>
  );
}
