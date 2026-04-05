import type { AppConfig } from "../types";

export type BillingPlanCode = "free" | "pro" | "enterprise";

export type BillingCatalogProduct = {
  code: string;
  name: string;
  description: string;
  planCode: BillingPlanCode;
  includedCredits: number;
  amountCents: number;
  currency: string;
  priceDisplay: string;
  cadence: string;
  overageRatePer1K: number | null;
  stripePriceId: string | null;
  isConfigured: boolean;
};

export function normalizePlanCode(value: string | null | undefined): BillingPlanCode {
  const normalized = (value ?? "free").trim().toLowerCase();
  if (normalized === "enterprise") {
    return "enterprise";
  }
  if (normalized === "pro" || normalized === "monthly" || normalized === "builder") {
    return "pro";
  }
  return "free";
}

function formatPrice(amountCents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: amountCents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2
  }).format(amountCents / 100);
}

export function getProProduct(config: AppConfig): BillingCatalogProduct {
  const stripePriceId = config.stripe.proPriceId ?? null;
  return {
    code: "pro",
    name: "Pro",
    description: "5,000 included credits per month. Top up at $8/1K when you need more.",
    planCode: "pro",
    includedCredits: 5_000,
    amountCents: 2_990,
    currency: "usd",
    priceDisplay: formatPrice(2_990),
    cadence: "per month",
    overageRatePer1K: 800,
    stripePriceId,
    isConfigured: Boolean(stripePriceId)
  };
}

export function includedCreditsForPlan(planCode: BillingPlanCode): number {
  if (planCode === "free") {
    return 300;
  }
  if (planCode === "pro") {
    return 5_000;
  }
  return 100_000;
}

export const TOPUP_RATE_PER_1K_CENTS = 800;
export const TOPUP_CREDIT_STEP = 100;
export const TOPUP_STEP_PRICE_CENTS = (TOPUP_RATE_PER_1K_CENTS * TOPUP_CREDIT_STEP) / 1_000;
export const SIGNUP_BONUS_CREDITS = 100;
export const FREE_DAILY_SEARCHES = 10;

export const REFERRAL_INVITEE_BONUS = 100;
export const REFERRAL_INVITER_BONUS = 200;
export const REFERRAL_REWARD_DELAY_DAYS = 0;
export const BONUS_CREDIT_EXPIRY_DAYS = 90;
export const MAX_REFERRALS_PER_USER = 100;
export const REFERRAL_CODE_MIN_LENGTH = 4;
export const REFERRAL_CODE_MAX_LENGTH = 20;

export function topupLineItemQuantity(quantityCredits: number): number {
  return Math.max(Math.round(quantityCredits / TOPUP_CREDIT_STEP), 1);
}

export function topupAmountCents(quantityCredits: number): number {
  return topupLineItemQuantity(quantityCredits) * TOPUP_STEP_PRICE_CENTS;
}
