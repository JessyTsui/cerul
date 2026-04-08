"use client";

import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/dashboard/dashboard-layout";
import { DashboardNotice, DashboardState } from "@/components/dashboard/dashboard-state";
import { queryLogs, getApiErrorMessage } from "@/lib/api";
import { getAdminQueryLog, listAdminQueryLogs } from "@/lib/admin-api";
import { AdminLayout } from "@/components/admin/admin-layout";
import { QueryLogDetailDrawer } from "./query-log-detail-drawer";
import { QueryLogsFilterBar } from "./query-logs-filter-bar";
import { QueryLogsTable } from "./query-logs-table";
import {
  hasActiveQueryLogFilters,
  type QueryLogDetail,
  type QueryLogListResult,
  type QueryLogScope,
} from "./types";
import {
  parseQueryLogFiltersFromSearchParams,
  serializeQueryLogFiltersToSearchParams,
  useQueryLogsUrlState,
} from "./use-query-logs-url-state";

type QueryLogsExplorerProps = {
  mode: QueryLogScope;
  currentPath: string;
  title: string;
  description: string;
  failedQueryBanner: boolean;
};

function LoadingPanel() {
  return (
    <section className="surface-elevated rounded-[30px] px-5 py-5">
      <div className="animate-pulse space-y-4">
        <div className="h-4 w-40 rounded-full bg-[rgba(36,29,21,0.08)]" />
        <div className="h-24 rounded-[22px] bg-[rgba(36,29,21,0.08)]" />
        <div className="h-72 rounded-[22px] bg-[rgba(36,29,21,0.08)]" />
      </div>
    </section>
  );
}

export function QueryLogsExplorer({
  mode,
  currentPath,
  title,
  description,
  failedQueryBanner,
}: QueryLogsExplorerProps) {
  const isAdmin = mode === "admin";
  const {
    urlFilters,
    selectedRequestId,
    commitFilter,
    selectRequest,
    setOffset,
    resetFilters,
  } = useQueryLogsUrlState(currentPath);
  const [dataState, setDataState] = useState<{
    filterKey: string | null;
    data: QueryLogListResult | null;
  }>({
    filterKey: null,
    data: null,
  });
  const [errorState, setErrorState] = useState<{
    filterKey: string | null;
    message: string | null;
  }>({
    filterKey: null,
    message: null,
  });
  const [refreshTick, setRefreshTick] = useState(0);
  // `hasFilters` controls a few cosmetic things in the filter bar (e.g. the
  // "{N} matches" badge label and the bottom hint text), but it does NOT
  // gate fetching anymore. The page should always load the most recent
  // queries on mount — empty filter == "show me the latest", not
  // "wait for me to type something". `LIMIT N ORDER BY created_at DESC`
  // hits `idx_query_logs_created_at` and is O(N), perfectly safe to
  // default-load.
  const hasFilters = hasActiveQueryLogFilters(urlFilters);
  const filterKey = serializeQueryLogFiltersToSearchParams(urlFilters, null).toString();

  useEffect(() => {
    let cancelled = false;
    const loader = isAdmin ? listAdminQueryLogs : queryLogs.list;
    const currentFilters = parseQueryLogFiltersFromSearchParams(new URLSearchParams(filterKey));

    void loader(currentFilters)
      .then((next) => {
        if (!cancelled) {
          setDataState({
            filterKey,
            data: next,
          });
          setErrorState({
            filterKey,
            message: null,
          });
        }
      })
      .catch((nextError: unknown) => {
        if (!cancelled) {
          setErrorState({
            filterKey,
            message: getApiErrorMessage(nextError, "Failed to load query logs."),
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [filterKey, isAdmin, refreshTick]);

  const Layout = isAdmin ? AdminLayout : DashboardLayout;
  const currentData = dataState.filterKey === filterKey ? dataState.data : null;
  const currentError = errorState.filterKey === filterKey ? errorState.message : null;
  const isLoading = currentData == null && currentError == null;
  const activeData = currentData ?? {
    items: [],
    total: 0,
    limit: urlFilters.limit,
    offset: urlFilters.offset,
    appliedDefaultWindow: false,
  };
  const fetchDetail = isAdmin ? getAdminQueryLog : queryLogs.get;
  const filterBarKey = filterKey;

  return (
    <Layout currentPath={currentPath} title={title} description={description} actions={null}>
      {currentError && currentData ? (
        <DashboardNotice
          title="Showing the last successful query list"
          description={currentError}
          tone="error"
        />
      ) : null}

      <QueryLogsFilterBar
        key={filterBarKey}
        filters={urlFilters}
        appliedDefaultWindow={activeData.appliedDefaultWindow}
        failedQueryBanner={failedQueryBanner}
        showUserIdFilter={isAdmin}
        total={activeData.total}
        isLoading={isLoading}
        hasActiveFilters={hasFilters}
        commitFilter={commitFilter}
        selectRequest={selectRequest}
        resetFilters={resetFilters}
      />

      {isLoading && !currentData ? (
        <LoadingPanel />
      ) : currentError && !currentData ? (
        <DashboardState
          title="Query logs could not be loaded"
          description={currentError}
          tone="error"
          action={
            <button className="button-primary" type="button" onClick={() => setRefreshTick((value) => value + 1)}>
              Retry
            </button>
          }
        />
      ) : activeData.items.length === 0 ? (
        <DashboardState
          title="No matching query logs"
          description="Try widening the time range, clearing the exact request ID, or removing a restrictive client/source filter."
          action={
            <button className="button-primary" type="button" onClick={resetFilters}>
              Clear filters
            </button>
          }
        />
      ) : (
        <QueryLogsTable
          items={activeData.items}
          total={activeData.total}
          limit={activeData.limit}
          offset={activeData.offset}
          showUserColumn={isAdmin}
          selectedRequestId={selectedRequestId}
          onSelectRequest={(requestId) => selectRequest(requestId)}
          onPageChange={setOffset}
        />
      )}

      <QueryLogDetailDrawer
        selectedRequestId={selectedRequestId}
        showUserColumn={isAdmin}
        fetchDetail={fetchDetail as (requestId: string) => Promise<QueryLogDetail>}
        onClose={() => selectRequest(null)}
      />
    </Layout>
  );
}
