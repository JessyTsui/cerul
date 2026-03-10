"use client";

import { useEffect, useState } from "react";
import type { LiveStatus } from "@/lib/demo-api";

type DashboardLiveStatusProps = {
  initialStatus: LiveStatus;
};

async function fetchDashboardStatus(): Promise<LiveStatus> {
  const response = await fetch("/api/demo/dashboard", {
    method: "GET",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Failed to refresh dashboard status");
  }

  const payload = (await response.json()) as { liveStatus: LiveStatus };
  return payload.liveStatus;
}

export function DashboardLiveStatus({ initialStatus }: DashboardLiveStatusProps) {
  const [status, setStatus] = useState(initialStatus);
  const [refreshing, setRefreshing] = useState(false);

  async function refreshStatus() {
    setRefreshing(true);

    try {
      setStatus(await fetchDashboardStatus());
    } catch {
      // Keep the previous state if refresh fails.
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    const interval = window.setInterval(() => {
      void refreshStatus();
    }, 30000);

    return () => window.clearInterval(interval);
  }, []);

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-xs uppercase tracking-[0.1em] text-[var(--foreground-tertiary)]">
          Live system state
        </p>
        <button
          type="button"
          onClick={() => void refreshStatus()}
          className="rounded-md border border-[var(--border)] bg-[var(--surface-elevated)] px-2.5 py-1 text-xs font-medium text-[var(--foreground-secondary)] transition hover:border-[var(--brand)] hover:text-[var(--foreground)]"
        >
          {refreshing ? (
            <span className="flex items-center gap-1">
              <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Refreshing
            </span>
          ) : (
            "Refresh"
          )}
        </button>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-lg font-semibold text-white">{status.health}</p>
          <p className="mt-1 text-sm text-[var(--foreground-tertiary)]">
            {status.summary}
          </p>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
            status.health === "Healthy"
              ? "bg-emerald-500/15 text-emerald-400"
              : "bg-amber-500/15 text-amber-400"
          }`}
        >
          {status.freshness}
        </span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-lg bg-[var(--surface-elevated)] px-3 py-3">
          <p className="font-mono text-xs uppercase tracking-[0.1em] text-[var(--foreground-tertiary)]">
            Active workers
          </p>
          <p className="mt-2 text-xl font-bold text-white">{status.activeWorkers}</p>
        </div>
        <div className="rounded-lg bg-[var(--surface-elevated)] px-3 py-3">
          <p className="font-mono text-xs uppercase tracking-[0.1em] text-[var(--foreground-tertiary)]">
            Queue depth
          </p>
          <p className="mt-2 text-xl font-bold text-white">{status.queueDepth}</p>
        </div>
      </div>
      <p className="mt-4 text-xs text-[var(--foreground-tertiary)]">Updated {status.updatedAt}</p>
    </div>
  );
}
