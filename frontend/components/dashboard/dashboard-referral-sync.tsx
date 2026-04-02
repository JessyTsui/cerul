"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { billing, getApiErrorMessage } from "@/lib/api";
import {
  normalizeReferralCode,
  PENDING_REFERRAL_CODE_STORAGE_KEY,
} from "@/lib/referral";
import { useDashboardUsageContext } from "./dashboard-usage-context";

function readStoredReferralCode(): string | null {
  try {
    return normalizeReferralCode(
      window.localStorage.getItem(PENDING_REFERRAL_CODE_STORAGE_KEY),
    );
  } catch {
    return null;
  }
}

function clearStoredReferralCode(): void {
  try {
    window.localStorage.removeItem(PENDING_REFERRAL_CODE_STORAGE_KEY);
  } catch {
    // Ignore localStorage access issues.
  }
}

function shouldClearPendingReferral(message: string): boolean {
  return /already been redeemed|cannot redeem your own|not found|maximum number of uses/i.test(
    message,
  );
}

export function DashboardReferralSync() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const usageContext = useDashboardUsageContext();
  const handledCodeRef = useRef<string | null>(null);

  useEffect(() => {
    const queryCode = normalizeReferralCode(searchParams.get("ref"));
    if (!queryCode) {
      return;
    }

    try {
      window.localStorage.setItem(PENDING_REFERRAL_CODE_STORAGE_KEY, queryCode);
    } catch {
      // Ignore localStorage access issues.
    }
  }, [searchParams]);

  useEffect(() => {
    const queryCode = normalizeReferralCode(searchParams.get("ref"));
    const pendingCode = queryCode ?? readStoredReferralCode();

    if (!pendingCode || handledCodeRef.current === pendingCode) {
      return;
    }

    handledCodeRef.current = pendingCode;
    let cancelled = false;

    const clearReferralQuery = () => {
      if (!queryCode) {
        return;
      }

      const nextParams = new URLSearchParams(searchParams.toString());
      nextParams.delete("ref");
      const nextQuery = nextParams.toString();
      window.history.replaceState(
        {},
        "",
        nextQuery ? `${pathname}?${nextQuery}` : pathname,
      );
    };

    void billing
      .getCatalog()
      .then(async (catalog) => {
        if (cancelled) {
          return;
        }

        const ownCode = normalizeReferralCode(catalog.referral.code);
        const redeemedCode = normalizeReferralCode(catalog.referral.redeemedCode);
        if (redeemedCode || ownCode === pendingCode) {
          clearStoredReferralCode();
          clearReferralQuery();
          return;
        }

        await billing.redeemReferral(pendingCode);
        if (cancelled) {
          return;
        }

        clearStoredReferralCode();
        clearReferralQuery();
        await usageContext?.refresh();
        router.refresh();
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        const message = getApiErrorMessage(
          error,
          "Unable to redeem referral code.",
        );
        if (shouldClearPendingReferral(message)) {
          clearStoredReferralCode();
          clearReferralQuery();
        } else {
          handledCodeRef.current = null;
        }
        console.error("[referral] Failed to redeem pending referral:", message);
      });

    return () => {
      cancelled = true;
    };
  }, [pathname, router, searchParams, usageContext]);

  return null;
}
