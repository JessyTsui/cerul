"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getApiErrorMessage,
  jobs,
  type DashboardJobList,
  type DashboardJobStats,
  type JobListParams,
} from "@/lib/api";

type UseJobStatsResult = {
  data: DashboardJobStats | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

type UseJobListResult = {
  data: DashboardJobList | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

function getParamsKey(params: JobListParams): string {
  return JSON.stringify({
    status: params.status ?? null,
    track: params.track ?? null,
    limit: params.limit ?? null,
    offset: params.offset ?? null,
  });
}

export function useJobStats(): UseJobStatsResult {
  const [data, setData] = useState<DashboardJobStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadStats = useCallback(async (options?: { preserveData?: boolean }) => {
    if (!options?.preserveData) {
      setIsLoading(true);
    }

    setError(null);

    try {
      const nextStats = await jobs.getStats();
      setData(nextStats);
    } catch (nextError) {
      setError(getApiErrorMessage(nextError, "Failed to load job stats."));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  return {
    data,
    isLoading,
    error,
    refresh: async () => {
      await loadStats({ preserveData: data !== null });
    },
  };
}

export function useJobList(params: JobListParams = {}): UseJobListResult {
  const [data, setData] = useState<DashboardJobList | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const normalizedParams = useMemo(
    () => ({
      status: params.status,
      track: params.track,
      limit: params.limit,
      offset: params.offset,
    }),
    [params.limit, params.offset, params.status, params.track],
  );
  const paramsKey = useMemo(() => getParamsKey(normalizedParams), [normalizedParams]);

  const loadJobs = useCallback(
    async (options?: { preserveData?: boolean }) => {
      if (!options?.preserveData) {
        setIsLoading(true);
      }

      setError(null);

      try {
        const nextJobs = await jobs.list(normalizedParams);
        setData(nextJobs);
      } catch (nextError) {
        setError(getApiErrorMessage(nextError, "Failed to load jobs."));
      } finally {
        setIsLoading(false);
      }
    },
    [normalizedParams],
  );

  useEffect(() => {
    void loadJobs();
  }, [loadJobs, paramsKey]);

  return {
    data,
    isLoading,
    error,
    refresh: async () => {
      await loadJobs({ preserveData: data !== null });
    },
  };
}
