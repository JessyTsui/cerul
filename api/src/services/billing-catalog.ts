import type { AppConfig } from "../types";

export type BillingPlanCode = "free" | "monthly" | "enterprise";
export type BillingProductCode =
  | "monthly"
  | "topup_1000"
  | "topup_5000"
  | "topup_20000";
export type BillingProductKind = "subscription" | "topup";

type StripePriceKey =
  | "monthlyPriceId"
  | "topup1000PriceId"
  | "topup5000PriceId"
  | "topup20000PriceId";

type BillingProductTemplate = {
  code: BillingProductCode;
  name: string;
  description: string;
  kind: BillingProductKind;
  planCode: BillingPlanCode;
  credits: number;
  amountCents: number;
  cadence: string;
  allowPromotionCodes: boolean;
  stripePriceKey: StripePriceKey;
};

export type BillingCatalogProduct = {
  code: BillingProductCode;
  name: string;
  description: string;
  kind: BillingProductKind;
  planCode: BillingPlanCode;
  credits: number;
  amountCents: number;
  currency: string;
  priceDisplay: string;
  cadence: string;
  allowPromotionCodes: boolean;
  stripePriceId: string | null;
  isConfigured: boolean;
};

const BILLING_PRODUCTS: readonly BillingProductTemplate[] = [
  {
    code: "monthly",
    name: "Monthly",
    description: "Recurring subscription with 5,000 included credits every billing cycle.",
    kind: "subscription",
    planCode: "monthly",
    credits: 5_000,
    amountCents: 3_000,
    cadence: "per month",
    allowPromotionCodes: true,
    stripePriceKey: "monthlyPriceId"
  },
  {
    code: "topup_1000",
    name: "Top-up 1,000",
    description: "One-time prepaid credits for bursty workloads.",
    kind: "topup",
    planCode: "monthly",
    credits: 1_000,
    amountCents: 800,
    cadence: "one time",
    allowPromotionCodes: true,
    stripePriceKey: "topup1000PriceId"
  },
  {
    code: "topup_5000",
    name: "Top-up 5,000",
    description: "Prepaid credits with a better effective rate for repeat usage.",
    kind: "topup",
    planCode: "monthly",
    credits: 5_000,
    amountCents: 3_600,
    cadence: "one time",
    allowPromotionCodes: true,
    stripePriceKey: "topup5000PriceId"
  },
  {
    code: "topup_20000",
    name: "Top-up 20,000",
    description: "High-volume prepaid credits at the best self-serve rate.",
    kind: "topup",
    planCode: "monthly",
    credits: 20_000,
    amountCents: 12_000,
    cadence: "one time",
    allowPromotionCodes: true,
    stripePriceKey: "topup20000PriceId"
  }
] as const;

export function normalizePlanCode(value: string | null | undefined): BillingPlanCode {
  const normalized = (value ?? "free").trim().toLowerCase();
  if (normalized === "enterprise") {
    return "enterprise";
  }
  if (normalized === "monthly" || normalized === "builder" || normalized === "pro") {
    return "monthly";
  }
  return "free";
}

function formatPrice(amountCents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amountCents / 100);
}

function toCatalogProduct(config: AppConfig, product: BillingProductTemplate): BillingCatalogProduct {
  const stripePriceId = config.stripe[product.stripePriceKey] ?? null;
  return {
    code: product.code,
    name: product.name,
    description: product.description,
    kind: product.kind,
    planCode: product.planCode,
    credits: product.credits,
    amountCents: product.amountCents,
    currency: "usd",
    priceDisplay: formatPrice(product.amountCents),
    cadence: product.cadence,
    allowPromotionCodes: product.allowPromotionCodes,
    stripePriceId,
    isConfigured: Boolean(stripePriceId)
  };
}

export function listBillingProducts(config: AppConfig): BillingCatalogProduct[] {
  return BILLING_PRODUCTS.map((product) => toCatalogProduct(config, product));
}

export function getBillingProduct(
  config: AppConfig,
  code: BillingProductCode | string | null | undefined
): BillingCatalogProduct | null {
  const normalized = (code ?? "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  const product = BILLING_PRODUCTS.find((candidate) => candidate.code === normalized);
  return product ? toCatalogProduct(config, product) : null;
}

export function getBillingProductDefinition(
  code: BillingProductCode | string | null | undefined
): BillingProductTemplate | null {
  const normalized = (code ?? "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  return BILLING_PRODUCTS.find((candidate) => candidate.code === normalized) ?? null;
}

export function includedCreditsForPlan(planCode: BillingPlanCode): number {
  if (planCode === "free") {
    return 1_000;
  }
  if (planCode === "monthly") {
    return 5_000;
  }
  return 100_000;
}

export const REFERRAL_BONUS_CREDITS = 500;
export const REFERRAL_REWARD_DELAY_DAYS = 7;
export const BONUS_CREDIT_EXPIRY_DAYS = 90;
export const PAID_TOPUP_EXPIRY_DAYS = 365;
