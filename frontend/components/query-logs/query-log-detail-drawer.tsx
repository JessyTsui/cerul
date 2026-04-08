"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ApiClientError, getApiErrorMessage } from "@/lib/api";
import { QueryLogSurfaceBadge } from "./query-log-row";
import type { QueryLogDetail } from "./types";

type QueryLogDetailDrawerProps = {
  selectedRequestId: string | null;
  showUserColumn: boolean;
  fetchDetail: (requestId: string) => Promise<QueryLogDetail>;
  onClose: () => void;
};

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    year: "numeric",
  });
}

function formatLatency(value: number | null): string {
  if (value == null) {
    return "—";
  }
  return value < 1000 ? `${Math.round(value)}ms` : `${(value / 1000).toFixed(2)}s`;
}

// query_logs.filters is jsonb with default '{}'. Most /v1/search callers
// don't pass filters so `detail.filters` is usually an empty object, which
// stringifies to the literal "{}" and renders as a suspiciously empty box.
// Only show the raw JSON block when there's actual content.
function hasQueryLogFilters(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value !== "object") return false;
  if (Array.isArray(value)) return value.length > 0;
  return Object.keys(value as Record<string, unknown>).length > 0;
}

export function QueryLogDetailDrawer({
  selectedRequestId,
  showUserColumn,
  fetchDetail,
  onClose,
}: QueryLogDetailDrawerProps) {
  const [state, setState] = useState<{
    requestId: string | null;
    detail: QueryLogDetail | null;
    error: string | null;
    isNotFound: boolean;
  }>({
    requestId: null,
    detail: null,
    error: null,
    isNotFound: false,
  });

  useEffect(() => {
    if (!selectedRequestId) {
      return undefined;
    }

    let cancelled = false;

    void fetchDetail(selectedRequestId)
      .then((next) => {
        if (cancelled) return;
        setState({
          requestId: selectedRequestId,
          detail: next,
          error: null,
          isNotFound: false,
        });
      })
      .catch((nextError: unknown) => {
        if (cancelled) return;
        if (nextError instanceof ApiClientError && nextError.status === 404) {
          setState({
            requestId: selectedRequestId,
            detail: null,
            error: null,
            isNotFound: true,
          });
          return;
        }
        setState({
          requestId: selectedRequestId,
          detail: null,
          error: getApiErrorMessage(nextError, "Failed to load query log detail."),
          isNotFound: false,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [fetchDetail, selectedRequestId]);

  useEffect(() => {
    if (!selectedRequestId) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, selectedRequestId]);

  const detail = state.requestId === selectedRequestId ? state.detail : null;
  const error = state.requestId === selectedRequestId ? state.error : null;
  const isNotFound = state.requestId === selectedRequestId ? state.isNotFound : false;
  const isLoading = Boolean(selectedRequestId) && detail == null && error == null && !isNotFound;

  if (typeof document === "undefined" || !selectedRequestId) {
    return null;
  }

  return createPortal(
    // We use `soft-theme-vars` (NOT the full `soft-theme`) here.
    //
    // createPortal escapes the React ancestry and mounts under <body>,
    // bypassing the `.soft-theme` wrapper that AdminAppShell /
    // DashboardAppShell apply. Without any light-theme class the CSS
    // variables fall back to the `:root` dark theme defaults.
    //
    // BUT applying full `.soft-theme` to this full-viewport root is
    // wrong — `.soft-theme` also carries `position: relative`, an opaque
    // radial-gradient background, and `::before/::after` decorative
    // layers that would cover the underlying page and fight Tailwind's
    // `fixed` positioning. `.soft-theme-vars` is a palette-only variant
    // that only declares the CSS custom properties, so children resolve
    // to the light tokens without any of the full-screen side effects.
    <div className="soft-theme-vars fixed inset-0 z-[120]">
      <button
        type="button"
        aria-label="Close query log detail"
        className="absolute inset-0 bg-[rgba(9,16,29,0.28)] backdrop-blur-[2px]"
        onClick={onClose}
      />
      <aside className="absolute inset-y-0 right-0 w-full max-w-[540px] border-l border-[var(--border)] bg-[rgba(255,252,247,0.96)] shadow-[0_24px_80px_rgba(15,23,42,0.22)] backdrop-blur-xl">
        <div className="flex h-full flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-6 py-5">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                Query detail
              </p>
              <h2 className="mt-2 text-xl font-semibold tracking-[-0.03em] text-[var(--foreground)]">
                {selectedRequestId}
              </h2>
            </div>
            <button
              type="button"
              className="rounded-full border border-[var(--border)] bg-white/72 px-3 py-1.5 text-sm text-[var(--foreground-secondary)] transition hover:border-[var(--border-strong)] hover:bg-white"
              onClick={onClose}
            >
              Close
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
            {isLoading ? (
              <div className="space-y-4 animate-pulse">
                <div className="h-5 w-32 rounded-full bg-[rgba(36,29,21,0.08)]" />
                <div className="h-24 rounded-[22px] bg-[rgba(36,29,21,0.08)]" />
                <div className="h-32 rounded-[22px] bg-[rgba(36,29,21,0.08)]" />
                <div className="h-48 rounded-[22px] bg-[rgba(36,29,21,0.08)]" />
              </div>
            ) : isNotFound ? (
              <div className="rounded-[24px] border border-[rgba(191,91,70,0.2)] bg-[rgba(191,91,70,0.08)] px-5 py-5">
                <p className="text-base font-semibold text-[var(--foreground)]">Not found</p>
                <p className="mt-2 text-sm leading-6 text-[var(--foreground-secondary)]">
                  This request may have errored before logging, or it may no longer be visible from your current scope.
                </p>
              </div>
            ) : error ? (
              <div className="rounded-[24px] border border-[rgba(191,91,70,0.2)] bg-[rgba(191,91,70,0.08)] px-5 py-5">
                <p className="text-base font-semibold text-[var(--foreground)]">Could not load detail</p>
                <p className="mt-2 text-sm leading-6 text-[var(--foreground-secondary)]">{error}</p>
              </div>
            ) : detail ? (
              <div className="space-y-5">
                <section className="surface-elevated rounded-[26px] px-5 py-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <QueryLogSurfaceBadge surface={detail.searchSurface} />
                    {detail.includeAnswer ? <span className="badge badge-success">answer enabled</span> : null}
                    {detail.clientSource ? <span className="badge">{detail.clientSource}</span> : null}
                  </div>
                  <p className="mt-4 text-lg font-semibold leading-8 text-[var(--foreground)]">
                    {detail.queryText || "Untitled query"}
                  </p>
                  <div className="mt-4 grid gap-3 text-sm text-[var(--foreground-secondary)] sm:grid-cols-2">
                    <p>Created: {formatDateTime(detail.createdAt)}</p>
                    <p>Latency: {formatLatency(detail.latencyMs)}</p>
                    <p>Results: {detail.resultCount}</p>
                    <p>Credits: {detail.creditsUsed ?? "—"}</p>
                    <p>Max results: {detail.maxResults}</p>
                    {detail.apiKeyId ? <p className="truncate">API key: {detail.apiKeyId}</p> : null}
                    {showUserColumn ? (
                      <>
                        <p className="truncate">User ID: {detail.userId}</p>
                        <p className="truncate">User email: {detail.userEmail ?? "deleted user"}</p>
                      </>
                    ) : null}
                  </div>
                </section>

                {detail.answerText ? (
                  <section className="rounded-[24px] border border-[var(--border-brand)] bg-[var(--brand-subtle)] px-5 py-5">
                    <div className="flex items-center gap-2">
                      <span aria-hidden className="text-base leading-none">✨</span>
                      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--brand-bright)]">
                        AI Answer
                      </p>
                    </div>
                    <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-[var(--foreground)]">
                      {detail.answerText}
                    </p>
                  </section>
                ) : null}

                <section className="surface-elevated rounded-[26px] px-5 py-5">
                  <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                    Filters
                  </p>
                  {hasQueryLogFilters(detail.filters) ? (
                    <pre className="mt-3 overflow-x-auto rounded-[18px] bg-[rgba(255,255,255,0.68)] p-4 text-xs leading-6 text-[var(--foreground-secondary)]">
                      {JSON.stringify(detail.filters, null, 2)}
                    </pre>
                  ) : (
                    <p className="mt-3 text-sm text-[var(--foreground-secondary)]">
                      No filters were applied to this query.
                    </p>
                  )}
                </section>

                <section className="surface-elevated rounded-[26px] px-5 py-5">
                  <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                    Results preview
                  </p>
                  {detail.resultsPreview.length === 0 ? (
                    <p className="mt-3 text-sm text-[var(--foreground-secondary)]">No result preview was stored for this request.</p>
                  ) : (
                    <div className="mt-4 space-y-3">
                      {detail.resultsPreview.map((preview) => (
                        <a
                          key={`${preview.rank}-${preview.targetUrl ?? preview.title}`}
                          href={preview.targetUrl ?? "#"}
                          target="_blank"
                          rel="noreferrer"
                          className="flex gap-3 rounded-[18px] border border-[var(--border)] bg-white/72 p-3 transition hover:border-[var(--border-strong)] hover:bg-white"
                        >
                          <div className="flex h-16 w-24 shrink-0 items-center justify-center overflow-hidden rounded-[14px] bg-[rgba(36,29,21,0.04)] text-[10px] text-[var(--foreground-tertiary)]">
                            {preview.thumbnailUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={preview.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                            ) : (
                              <span>#{preview.rank}</span>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="badge">{preview.rank}</span>
                              {preview.score != null ? <span className="badge badge-success">{Math.round(preview.score * 100)}%</span> : null}
                            </div>
                            <p className="mt-2 truncate text-sm font-medium text-[var(--foreground)]">
                              {preview.title || "Untitled result"}
                            </p>
                            <p className="mt-1 truncate text-xs text-[var(--foreground-tertiary)]">
                              {preview.source || "Unknown source"}
                            </p>
                          </div>
                        </a>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            ) : null}
          </div>
        </div>
      </aside>
    </div>,
    document.body,
  );
}
