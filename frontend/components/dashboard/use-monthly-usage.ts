"use client";

import { useEffect, useState } from "react";
import {
  getApiErrorMessage,
  type DashboardMonthlyUsage,
  usage,
} from "@/lib/api";

type UseMonthlyUsageResult = {
  data: DashboardMonthlyUsage | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

export function useMonthlyUsage(): UseMonthlyUsageResult {
  const [data, setData] = useState<DashboardMonthlyUsage | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadUsage(options?: { preserveData?: boolean }) {
    if (!options?.preserveData) {
      setIsLoading(true);
    }

    setError(null);

    try {
      const nextUsage = await usage.getMonthly();
      setData(nextUsage);
    } catch (nextError) {
      setError(getApiErrorMessage(nextError, "Failed to load monthly usage."));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadUsage();
  }, []);

  return {
    data,
    isLoading,
    error,
    refresh: async () => {
      await loadUsage({ preserveData: data !== null });
    },
  };
}
