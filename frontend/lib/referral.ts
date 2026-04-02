export const PENDING_REFERRAL_CODE_STORAGE_KEY = "cerul.pendingReferralCode";

export function normalizeReferralCode(value: unknown): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim().toUpperCase()
    : null;
}

export function buildReferralPath(code: string): string {
  return `/ref/${encodeURIComponent(code)}`;
}

export function buildReferralUrl(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, "")}${buildReferralPath(code)}`;
}
