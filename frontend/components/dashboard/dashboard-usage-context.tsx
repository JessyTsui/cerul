"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  getApiErrorMessage,
  type DashboardMonthlyUsage,
  usage,
} from "@/lib/api";

type DashboardUsageContextValue = {
  data: DashboardMonthlyUsage | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

const DashboardUsageContext = createContext<DashboardUsageContextValue | null>(null);

type DashboardUsageProviderProps = {
  children: ReactNode;
};

export function DashboardUsageProvider({
  children,
}: DashboardUsageProviderProps) {
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

  return (
    <DashboardUsageContext.Provider
      value={{
        data,
        isLoading,
        error,
        refresh: async () => {
          await loadUsage({ preserveData: data !== null });
        },
      }}
    >
      {children}
    </DashboardUsageContext.Provider>
  );
}

export function useDashboardUsageContext(): DashboardUsageContextValue | null {
  return useContext(DashboardUsageContext);
}
