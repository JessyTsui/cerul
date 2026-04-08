"use client";

import { useEffect, useState } from "react";
import { DashboardNotice } from "@/components/dashboard/dashboard-state";
import type { QueryLogFilters } from "./types";

type QueryLogsFilterBarProps = {
  filters: QueryLogFilters;
  appliedDefaultWindow: boolean;
  failedQueryBanner: boolean;
  showUserIdFilter: boolean;
  total: number;
  isLoading: boolean;
  hasActiveFilters: boolean;
  commitFilter: (next: Partial<QueryLogFilters>) => void;
  selectRequest: (requestId: string | null, nextFilters?: Partial<QueryLogFilters>) => void;
  resetFilters: () => void;
};

function inputClassName(disabled = false): string {
  return [
    "h-10 w-full rounded-[12px] border border-[var(--border)] bg-white/78 px-3 text-sm text-[var(--foreground)] outline-none transition placeholder:text-[var(--foreground-tertiary)] focus:border-[var(--border-brand)]",
    disabled ? "cursor-not-allowed opacity-45" : "",
  ].join(" ").trim();
}

function toDateTimeLocalValue(value?: string): string {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const offsetMinutes = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offsetMinutes * 60_000);
  return local.toISOString().slice(0, 16);
}

function fromDateTimeLocalValue(value: string): string | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

export function QueryLogsFilterBar({
  filters,
  appliedDefaultWindow,
  failedQueryBanner,
  showUserIdFilter,
  total,
  isLoading,
  hasActiveFilters,
  commitFilter,
  selectRequest,
  resetFilters,
}: QueryLogsFilterBarProps) {
  const [requestId, setRequestId] = useState(filters.requestId ?? "");
  const [userId, setUserId] = useState(filters.userId ?? "");
  const [query, setQuery] = useState(filters.query ?? "");
  const normalizedRequestId = requestId.trim() || undefined;
  const normalizedUserId = userId.trim() || undefined;
  const normalizedQuery = query.trim() || undefined;
  const isExactLookup = Boolean(normalizedRequestId);

  useEffect(() => {
    if (
      normalizedRequestId === filters.requestId
      && normalizedUserId === filters.userId
      && normalizedQuery === filters.query
    ) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      commitFilter({
        requestId: normalizedRequestId,
        userId: normalizedUserId,
        query: normalizedQuery,
      });
    }, 300);

    return () => window.clearTimeout(timer);
  }, [
    commitFilter,
    filters.query,
    filters.requestId,
    filters.userId,
    normalizedQuery,
    normalizedRequestId,
    normalizedUserId,
  ]);

  return (
    <section className="space-y-4">
      {failedQueryBanner ? (
        <DashboardNotice
          title="Search coverage"
          description="Only successfully logged queries are searchable today. If a request errored before persistence, its request ID will not appear here yet."
        />
      ) : null}

      <article className="surface-elevated rounded-[30px] px-5 py-5">
        <div className="flex flex-col gap-3 border-b border-[var(--border)] pb-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
              Filter query logs
            </p>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--foreground-secondary)]">
              Paste a request ID for an exact lookup, or slice by user, query text, surface, client source, and time range.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {appliedDefaultWindow ? (
              <span className="badge">
                Showing last 30 days
              </span>
            ) : null}
            {hasActiveFilters ? (
              <span className="badge badge-success">
                {isLoading ? "Loading…" : `${total} matches`}
              </span>
            ) : null}
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="space-y-2">
            <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--foreground-tertiary)]">
              Request ID
            </span>
            <input
              className={inputClassName()}
              value={requestId}
              placeholder="req_..."
              onChange={(event) => setRequestId(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  selectRequest(normalizedRequestId ?? null, {
                    requestId: normalizedRequestId,
                    userId: normalizedUserId,
                    query: normalizedQuery,
                  });
                }
              }}
            />
          </label>

          {showUserIdFilter ? (
            <label className="space-y-2">
              <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--foreground-tertiary)]">
                User ID
              </span>
              <input
                className={inputClassName(isExactLookup)}
                disabled={isExactLookup}
                value={userId}
                placeholder="user UUID"
                onChange={(event) => setUserId(event.target.value)}
              />
            </label>
          ) : null}

          <label className="space-y-2">
            <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--foreground-tertiary)]">
              Surface
            </span>
            <select
              className={inputClassName(isExactLookup)}
              disabled={isExactLookup}
              value={filters.surface ?? ""}
              onChange={(event) => commitFilter({ surface: event.target.value ? (event.target.value as QueryLogFilters["surface"]) : undefined })}
            >
              <option value="">All surfaces</option>
              <option value="api">api</option>
              <option value="playground">playground</option>
              <option value="mcp">mcp</option>
            </select>
          </label>

          <label className="space-y-2">
            <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--foreground-tertiary)]">
              Client source
            </span>
            <input
              className={inputClassName(isExactLookup)}
              disabled={isExactLookup}
              value={filters.clientSource ?? ""}
              placeholder="cli / curl / app"
              onChange={(event) => commitFilter({ clientSource: event.target.value || undefined })}
            />
          </label>

          <label className="space-y-2 md:col-span-2 xl:col-span-2">
            <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--foreground-tertiary)]">
              Query text
            </span>
            <input
              className={inputClassName(isExactLookup)}
              disabled={isExactLookup}
              value={query}
              placeholder="Search in query text (substring)"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>

          <label className="space-y-2">
            <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--foreground-tertiary)]">
              From
            </span>
            <input
              type="datetime-local"
              className={inputClassName(isExactLookup)}
              disabled={isExactLookup}
              value={toDateTimeLocalValue(filters.from)}
              onChange={(event) => commitFilter({ from: fromDateTimeLocalValue(event.target.value) })}
            />
          </label>

          <label className="space-y-2">
            <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--foreground-tertiary)]">
              To
            </span>
            <input
              type="datetime-local"
              className={inputClassName(isExactLookup)}
              disabled={isExactLookup}
              value={toDateTimeLocalValue(filters.to)}
              onChange={(event) => commitFilter({ to: fromDateTimeLocalValue(event.target.value) })}
            />
          </label>
        </div>

        <div className="mt-5 flex flex-col gap-3 border-t border-[var(--border)] pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2 text-sm text-[var(--foreground-secondary)]">
            {isExactLookup ? (
              <span>Exact ID lookup is active. Other filters are disabled until you clear the request ID.</span>
            ) : hasActiveFilters ? (
              <span>Filters stay in the URL so you can refresh, share, and return with browser history intact.</span>
            ) : (
              <span>Showing the most recent queries. Use any filter above to narrow the list.</span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-full border border-[var(--border)] bg-white/72 px-4 py-2 text-sm text-[var(--foreground-secondary)] transition hover:border-[var(--border-strong)] hover:bg-white"
              onClick={resetFilters}
            >
              Reset
            </button>
            <button
              type="button"
              className="button-primary"
              onClick={() => {
                selectRequest(normalizedRequestId ?? null, {
                  requestId: normalizedRequestId,
                  userId: normalizedUserId,
                  query: normalizedQuery,
                });
              }}
            >
              Open exact match
            </button>
          </div>
        </div>
      </article>
    </section>
  );
}
