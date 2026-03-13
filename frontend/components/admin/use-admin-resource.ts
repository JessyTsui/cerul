"use client";

import { useCallback, useEffect, useState } from "react";
import type { AdminRange } from "@/lib/admin-api";
import { getApiErrorMessage } from "@/lib/api";

type UseAdminResourceOptions<T> = {
  range: AdminRange;
  loader: (range: AdminRange) => Promise<T>;
  errorMessage: string;
};

type UseAdminResourceResult<T> = {
  data: T | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

export function useAdminResource<T>({
  range,
  loader,
  errorMessage,
}: UseAdminResourceOptions<T>): UseAdminResourceResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (options?: { preserveData?: boolean }) => {
      if (!options?.preserveData) {
        setIsLoading(true);
      }

      setError(null);

      try {
        const nextData = await loader(range);
        setData(nextData);
      } catch (nextError) {
        setError(getApiErrorMessage(nextError, errorMessage));
      } finally {
        setIsLoading(false);
      }
    },
    [errorMessage, loader, range],
  );

  useEffect(() => {
    void load();
  }, [load]);

  return {
    data,
    isLoading,
    error,
    refresh: async () => {
      await load({ preserveData: data !== null });
    },
  };
}
