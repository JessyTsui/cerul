"use client";

import type { DashboardMonthlyUsage } from "@/lib/api";
import { useDashboardUsageContext } from "./dashboard-usage-context";

type UseMonthlyUsageResult = {
  data: DashboardMonthlyUsage | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

export function useMonthlyUsage(): UseMonthlyUsageResult {
  const context = useDashboardUsageContext();

  if (context) {
    return context;
  }

  throw new Error("useMonthlyUsage must be used within DashboardUsageProvider.");
}
