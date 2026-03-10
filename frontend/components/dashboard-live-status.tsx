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
    <div className="rounded-[22px] border border-[var(--line)] bg-white/76 px-4 py-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
          Live system state
        </p>
        <button
          type="button"
          onClick={() => void refreshStatus()}
          className="rounded-full border border-[var(--line)] bg-white px-3 py-1 text-xs font-medium text-[var(--foreground)] transition hover:border-[rgba(10,142,216,0.24)]"
        >
          {refreshing ? "Refreshing" : "Refresh"}
        </button>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-lg font-semibold">{status.health}</p>
          <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
            {status.summary}
          </p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold ${
            status.health === "Healthy"
              ? "bg-emerald-100 text-emerald-700"
              : "bg-amber-100 text-amber-700"
          }`}
        >
          {status.freshness}
        </span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-[18px] bg-slate-900/4 px-3 py-3">
          <p className="font-mono text-xs uppercase tracking-[0.14em] text-[var(--muted)]">
            Active workers
          </p>
          <p className="mt-2 text-xl font-semibold">{status.activeWorkers}</p>
        </div>
        <div className="rounded-[18px] bg-slate-900/4 px-3 py-3">
          <p className="font-mono text-xs uppercase tracking-[0.14em] text-[var(--muted)]">
            Queue depth
          </p>
          <p className="mt-2 text-xl font-semibold">{status.queueDepth}</p>
        </div>
      </div>
      <p className="mt-4 text-xs text-[var(--muted)]">Updated {status.updatedAt}</p>
    </div>
  );
}
