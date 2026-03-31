import type { DatabaseClient } from "../db/client";
import { randomHex } from "../utils/crypto";
import {
  BONUS_CREDIT_EXPIRY_DAYS,
  getBillingProductDefinition,
  includedCreditsForPlan,
  normalizePlanCode,
  PAID_TOPUP_EXPIRY_DAYS,
  REFERRAL_BONUS_CREDITS,
  REFERRAL_REWARD_DELAY_DAYS,
  type BillingPlanCode,
  type BillingProductCode
} from "./billing-catalog";

export class InsufficientCreditsError extends Error {
  constructor(message = "No spendable credits remain.") {
    super(message);
    this.name = "InsufficientCreditsError";
  }
}

export class BillingHoldError extends Error {
  constructor(message = "Billing account requires manual review.") {
    super(message);
    this.name = "BillingHoldError";
  }
}

export const DEFAULT_MONTHLY_CREDIT_LIMITS: Record<string, number> = {
  free: 1_000,
  monthly: 5_000,
  builder: 10_000,
  pro: 10_000,
  enterprise: 100_000
};

export const TIER_KEY_LIMITS: Record<string, number> = {
  free: 1,
  monthly: 5,
  builder: 5,
  pro: 5,
  enterprise: 25
};

const PAID_TIERS = new Set(["monthly", "builder", "pro", "enterprise"]);
const BONUS_GRANT_TYPES = new Set(["promo_bonus", "referral_bonus", "manual_adjustment"]);
const INCLUDED_GRANT_TYPES = new Set(["free_monthly", "subscription_monthly"]);
const TOPUP_GRANT_TYPES = new Set(["paid_topup"]);
const CREDIT_EXPIRY_WINDOW_DAYS = 30;

type CreditGrantType =
  | "free_monthly"
  | "subscription_monthly"
  | "paid_topup"
  | "promo_bonus"
  | "referral_bonus"
  | "manual_adjustment";

type CreditTransactionKind =
  | "grant"
  | "debit"
  | "refund"
  | "reversal"
  | "expire"
  | "manual_adjustment";

type BillingOrderKind = "subscription" | "topup";
type BillingOrderStatus = "pending" | "paid" | "failed" | "refunded" | "disputed" | "needs_review";

type UserBillingProfile = {
  id: string;
  email: string | null;
  tier: string;
  monthly_credit_limit: number;
  rate_limit_per_sec: number;
  billing_hold: boolean;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
};

type MonthlyUsageRow = {
  credits_used: number;
  request_count: number;
};

type CreditBreakdown = {
  included_remaining: number;
  topup_remaining: number;
  bonus_remaining: number;
};

type ExpiringCreditSummary = {
  grant_type: string;
  credits: number;
  expires_at: string;
};

type CreditWalletSummary = {
  wallet_balance: number;
  credit_breakdown: CreditBreakdown;
  expiring_credits: ExpiringCreditSummary[];
};

type ReferralCodeRecord = {
  id: string;
  code: string;
  is_active: boolean;
};

type ReferralRedemptionRecord = {
  id: string;
  referrer_user_id: string;
  referee_user_id: string;
  status: string;
  reward_ready_at: string | null;
  awarded_at: string | null;
  referee_code: string | null;
};

type CreateGrantInput = {
  userId: string;
  grantKey: string;
  grantType: CreditGrantType;
  planCode: BillingPlanCode | null;
  totalCredits: number;
  expiresAt: Date | null;
  billingOrderId?: string | null;
  referralRedemptionId?: string | null;
  metadata?: Record<string, unknown>;
};

type OrderUpsertInput = {
  userId: string;
  orderKind: BillingOrderKind;
  productCode: string;
  planCode: BillingPlanCode;
  status: BillingOrderStatus;
  currency: string;
  grossAmountCents: number;
  discountAmountCents: number;
  netAmountCents: number;
  stripeCheckoutSessionId?: string | null;
  stripeInvoiceId?: string | null;
  stripePaymentIntentId?: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  fulfilledAt?: Date | null;
  metadata?: Record<string, unknown>;
};

export type CheckoutTopupInput = {
  userId: string;
  productCode: BillingProductCode;
  stripeCheckoutSessionId: string;
  stripeCustomerId: string | null;
  stripePaymentIntentId: string | null;
  currency: string | null;
  grossAmountCents: number;
  discountAmountCents: number;
  netAmountCents: number;
  occurredAt?: Date | null;
  metadata?: Record<string, unknown>;
};

export type SubscriptionInvoiceInput = {
  stripeInvoiceId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string | null;
  stripePaymentIntentId: string | null;
  currency: string | null;
  grossAmountCents: number;
  discountAmountCents: number;
  netAmountCents: number;
  periodStart: string;
  periodEnd: string;
  occurredAt?: Date | null;
  metadata?: Record<string, unknown>;
};

type BillingCatalogState = {
  plan_code: BillingPlanCode;
  wallet_balance: number;
  credit_breakdown: CreditBreakdown;
  expiring_credits: ExpiringCreditSummary[];
  referral: {
    code: string;
    bonus_credits: number;
    reward_delay_days: number;
    redeemed_code: string | null;
    status: string | null;
  };
};

function addDays(reference: Date, days: number): Date {
  return new Date(reference.getTime() + days * 24 * 60 * 60 * 1000);
}

function endOfBillingPeriod(periodEnd: string): Date {
  return new Date(`${periodEnd}T23:59:59.999Z`);
}

function normalizeInteger(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(Math.trunc(parsed), 0) : fallback;
}

function toIsoString(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
}

function safeMetadata(input: Record<string, unknown> | undefined): string {
  return JSON.stringify(input ?? {});
}

function rowsAffected(commandStatus: string): number {
  const parts = commandStatus.trim().split(/\s+/);
  const last = parts.at(-1);
  return last ? Number.parseInt(last, 10) || 0 : 0;
}

export function currentBillingPeriod(referenceDate?: Date): [string, string] {
  const today = referenceDate ?? new Date();
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth();
  const periodStart = new Date(Date.UTC(year, month, 1));
  const periodEnd = new Date(Date.UTC(year, month + 1, 0));
  return [periodStart.toISOString().slice(0, 10), periodEnd.toISOString().slice(0, 10)];
}

export function keyLimitForTier(tier: string | null | undefined): number {
  const normalized = (tier ?? "free").trim().toLowerCase();
  return TIER_KEY_LIMITS[normalized] ?? TIER_KEY_LIMITS.free;
}

export function monthlyCreditLimitForTier(tier: string | null | undefined): number {
  const normalized = (tier ?? "free").trim().toLowerCase();
  return DEFAULT_MONTHLY_CREDIT_LIMITS[normalized] ?? DEFAULT_MONTHLY_CREDIT_LIMITS.free;
}

export function isPaidTier(tier: string | null | undefined): boolean {
  return PAID_TIERS.has((tier ?? "free").trim().toLowerCase());
}

export function calculateCreditCost(searchType: string | null | undefined, includeAnswer: boolean): number {
  const normalized = (searchType ?? "unified").trim().toLowerCase();
  if (["broll", "knowledge", "unified"].includes(normalized)) {
    return includeAnswer ? 2 : 1;
  }
  throw new Error(`Unsupported search_type: ${searchType}`);
}

async function fetchUserBillingProfile(db: DatabaseClient, userId: string): Promise<UserBillingProfile> {
  const row = await db.fetchrow<UserBillingProfile>(
    `
      SELECT
          id,
          email,
          tier,
          monthly_credit_limit,
          rate_limit_per_sec,
          billing_hold,
          stripe_customer_id,
          stripe_subscription_id
      FROM user_profiles
      WHERE id = $1
    `,
    userId
  );
  if (row == null) {
    throw new Error(`Unknown user profile for ${userId}`);
  }
  return {
    ...row,
    email: row.email == null ? null : String(row.email),
    tier: String(row.tier ?? "free"),
    monthly_credit_limit: normalizeInteger(row.monthly_credit_limit, monthlyCreditLimitForTier(row.tier)),
    rate_limit_per_sec: normalizeInteger(row.rate_limit_per_sec, 0),
    billing_hold: Boolean(row.billing_hold),
    stripe_customer_id: row.stripe_customer_id == null ? null : String(row.stripe_customer_id),
    stripe_subscription_id: row.stripe_subscription_id == null ? null : String(row.stripe_subscription_id)
  };
}

async function expireElapsedCreditGrants(db: DatabaseClient, userId: string): Promise<void> {
  await db.execute(
    `
      UPDATE credit_grants
      SET
          remaining_credits = 0,
          status = 'expired',
          updated_at = NOW()
      WHERE user_id = $1
        AND status = 'active'
        AND remaining_credits > 0
        AND expires_at IS NOT NULL
        AND expires_at <= NOW()
    `,
    userId
  );
}

async function insertCreditTransaction(
  db: DatabaseClient,
  input: {
    userId: string;
    grantId?: string | null;
    billingOrderId?: string | null;
    requestId?: string | null;
    kind: CreditTransactionKind;
    amount: number;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  await db.execute(
    `
      INSERT INTO credit_transactions (
          user_id,
          grant_id,
          billing_order_id,
          request_id,
          kind,
          amount,
          metadata
      )
      VALUES ($1, $2::uuid, $3::uuid, $4, $5, $6, $7::jsonb)
    `,
    input.userId,
    input.grantId ?? null,
    input.billingOrderId ?? null,
    input.requestId ?? null,
    input.kind,
    input.amount,
    safeMetadata(input.metadata)
  );
}

async function createCreditGrant(db: DatabaseClient, input: CreateGrantInput): Promise<{ id: string; inserted: boolean }> {
  const inserted = await db.fetchrow<{ id: string }>(
    `
      INSERT INTO credit_grants (
          user_id,
          billing_order_id,
          referral_redemption_id,
          grant_key,
          grant_type,
          plan_code,
          total_credits,
          remaining_credits,
          expires_at,
          metadata
      )
      VALUES ($1, $2::uuid, $3::uuid, $4, $5, $6, $7, $7, $8, $9::jsonb)
      ON CONFLICT (grant_key) DO NOTHING
      RETURNING id
    `,
    input.userId,
    input.billingOrderId ?? null,
    input.referralRedemptionId ?? null,
    input.grantKey,
    input.grantType,
    input.planCode,
    input.totalCredits,
    input.expiresAt,
    safeMetadata(input.metadata)
  );

  if (inserted) {
    await insertCreditTransaction(db, {
      userId: input.userId,
      grantId: String(inserted.id),
      billingOrderId: input.billingOrderId ?? null,
      kind: "grant",
      amount: input.totalCredits,
      metadata: {
        grant_key: input.grantKey,
        grant_type: input.grantType,
        ...(input.metadata ?? {})
      }
    });
    return { id: String(inserted.id), inserted: true };
  }

  const existing = await db.fetchrow<{ id: string }>(
    `
      SELECT id
      FROM credit_grants
      WHERE grant_key = $1
    `,
    input.grantKey
  );
  if (!existing) {
    throw new Error(`Failed to resolve credit grant for key ${input.grantKey}`);
  }
  return { id: String(existing.id), inserted: false };
}

async function ensureCurrentPeriodGrant(
  db: DatabaseClient,
  userId: string,
  referenceDate?: Date
): Promise<void> {
  const profile = await fetchUserBillingProfile(db, userId);
  const planCode = normalizePlanCode(profile.tier);
  if (planCode !== "free" && planCode !== "monthly" && planCode !== "enterprise") {
    return;
  }

  const [periodStart, periodEnd] = currentBillingPeriod(referenceDate);
  const totalCredits = normalizeInteger(
    profile.monthly_credit_limit,
    includedCreditsForPlan(planCode)
  );
  if (totalCredits <= 0) {
    return;
  }

  const grantType: CreditGrantType = planCode === "free" ? "free_monthly" : "subscription_monthly";
  await createCreditGrant(db, {
    userId,
    grantKey: `${grantType}:${userId}:${periodStart}`,
    grantType,
    planCode,
    totalCredits,
    expiresAt: endOfBillingPeriod(periodEnd),
    metadata: {
      period_start: periodStart,
      period_end: periodEnd
    }
  });
}

async function fetchActiveGrantBalances(db: DatabaseClient, userId: string): Promise<Array<{
  id: string;
  grant_type: string;
  remaining_credits: number;
  total_credits: number;
  expires_at: string | null;
}>> {
  return db.fetch(
    `
      SELECT
          id,
          grant_type,
          remaining_credits,
          total_credits,
          expires_at
      FROM credit_grants
      WHERE user_id = $1
        AND status = 'active'
        AND remaining_credits > 0
        AND (expires_at IS NULL OR expires_at > NOW())
      ORDER BY
          CASE
            WHEN grant_type IN ('promo_bonus', 'referral_bonus', 'manual_adjustment') THEN 0
            WHEN grant_type IN ('free_monthly', 'subscription_monthly') THEN 1
            WHEN grant_type = 'paid_topup' THEN 2
            ELSE 3
          END ASC,
          COALESCE(expires_at, 'infinity'::timestamptz) ASC,
          created_at ASC
      FOR UPDATE
    `,
    userId
  );
}

async function fetchCreditWalletSummary(db: DatabaseClient, userId: string): Promise<CreditWalletSummary> {
  await expireElapsedCreditGrants(db, userId);

  const grants = await db.fetch<{
    grant_type: string;
    remaining_credits: number;
    expires_at: string | null;
  }>(
    `
      SELECT grant_type, remaining_credits, expires_at
      FROM credit_grants
      WHERE user_id = $1
        AND status = 'active'
        AND remaining_credits > 0
        AND (expires_at IS NULL OR expires_at > NOW())
      ORDER BY COALESCE(expires_at, 'infinity'::timestamptz) ASC, created_at ASC
    `,
    userId
  );

  const breakdown: CreditBreakdown = {
    included_remaining: 0,
    topup_remaining: 0,
    bonus_remaining: 0
  };
  const expiringCredits: ExpiringCreditSummary[] = [];
  const expiringCutoff = addDays(new Date(), CREDIT_EXPIRY_WINDOW_DAYS).toISOString();

  for (const grant of grants) {
    const remainingCredits = normalizeInteger(grant.remaining_credits, 0);
    if (BONUS_GRANT_TYPES.has(String(grant.grant_type))) {
      breakdown.bonus_remaining += remainingCredits;
    } else if (TOPUP_GRANT_TYPES.has(String(grant.grant_type))) {
      breakdown.topup_remaining += remainingCredits;
    } else if (INCLUDED_GRANT_TYPES.has(String(grant.grant_type))) {
      breakdown.included_remaining += remainingCredits;
    }

    const expiresAt = toIsoString(grant.expires_at);
    if (expiresAt && expiresAt <= expiringCutoff) {
      expiringCredits.push({
        grant_type: String(grant.grant_type),
        credits: remainingCredits,
        expires_at: expiresAt
      });
    }
  }

  return {
    wallet_balance: breakdown.included_remaining + breakdown.topup_remaining + breakdown.bonus_remaining,
    credit_breakdown: breakdown,
    expiring_credits: expiringCredits.slice(0, 5)
  };
}

function generateReferralCode(): string {
  return `CRL${randomHex(4).toUpperCase()}`;
}

export async function ensureReferralCode(db: DatabaseClient, userId: string): Promise<ReferralCodeRecord> {
  const existing = await db.fetchrow<ReferralCodeRecord>(
    `
      SELECT id, code, is_active
      FROM referral_codes
      WHERE user_id = $1
    `,
    userId
  );
  if (existing) {
    return {
      id: String(existing.id),
      code: String(existing.code),
      is_active: Boolean(existing.is_active)
    };
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateReferralCode();
    const inserted = await db.fetchrow<ReferralCodeRecord>(
      `
        INSERT INTO referral_codes (user_id, code, is_active)
        VALUES ($1, $2, TRUE)
        ON CONFLICT (code) DO NOTHING
        RETURNING id, code, is_active
      `,
      userId,
      code
    );
    if (inserted) {
      return {
        id: String(inserted.id),
        code: String(inserted.code),
        is_active: Boolean(inserted.is_active)
      };
    }
  }

  throw new Error(`Unable to generate referral code for ${userId}`);
}

async function fetchReferralRedemption(db: DatabaseClient, refereeUserId: string): Promise<ReferralRedemptionRecord | null> {
  const row = await db.fetchrow<ReferralRedemptionRecord>(
    `
      SELECT
          rr.id,
          rr.referrer_user_id,
          rr.referee_user_id,
          rr.status,
          rr.reward_ready_at,
          rr.awarded_at,
          rc.code AS referee_code
      FROM referral_redemptions AS rr
      JOIN referral_codes AS rc ON rc.id = rr.referral_code_id
      WHERE rr.referee_user_id = $1
    `,
    refereeUserId
  );
  return row
    ? {
        ...row,
        id: String(row.id),
        referrer_user_id: String(row.referrer_user_id),
        referee_user_id: String(row.referee_user_id),
        status: String(row.status),
        reward_ready_at: row.reward_ready_at == null ? null : String(row.reward_ready_at),
        awarded_at: row.awarded_at == null ? null : String(row.awarded_at),
        referee_code: row.referee_code == null ? null : String(row.referee_code)
      }
    : null;
}

async function markReferralReadyForOrder(
  db: DatabaseClient,
  refereeUserId: string,
  billingOrderId: string,
  netAmountCents: number
): Promise<void> {
  if (netAmountCents <= 0) {
    return;
  }

  const existing = await db.fetchrow<{ id: string; first_paid_order_id: string | null }>(
    `
      SELECT id, first_paid_order_id
      FROM referral_redemptions
      WHERE referee_user_id = $1
      FOR UPDATE
    `,
    refereeUserId
  );
  if (!existing || existing.first_paid_order_id) {
    return;
  }

  await db.execute(
    `
      UPDATE referral_redemptions
      SET
          first_paid_order_id = $2::uuid,
          first_paid_at = NOW(),
          reward_ready_at = NOW() + INTERVAL '7 days',
          updated_at = NOW()
      WHERE id = $1::uuid
    `,
    existing.id,
    billingOrderId
  );
}

async function awardDueReferralCredits(db: DatabaseClient): Promise<void> {
  const dueRedemptions = await db.fetch<{
    id: string;
    referrer_user_id: string;
    referee_user_id: string;
  }>(
    `
      SELECT id, referrer_user_id, referee_user_id
      FROM referral_redemptions
      WHERE status = 'pending'
        AND reward_ready_at IS NOT NULL
        AND reward_ready_at <= NOW()
      ORDER BY reward_ready_at ASC
      FOR UPDATE
    `
  );

  for (const redemption of dueRedemptions) {
    const expiresAt = addDays(new Date(), BONUS_CREDIT_EXPIRY_DAYS);
    await createCreditGrant(db, {
      userId: String(redemption.referrer_user_id),
      grantKey: `referral_bonus:${redemption.id}:referrer`,
      grantType: "referral_bonus",
      planCode: null,
      totalCredits: REFERRAL_BONUS_CREDITS,
      expiresAt,
      referralRedemptionId: String(redemption.id),
      metadata: {
        role: "referrer"
      }
    });
    await createCreditGrant(db, {
      userId: String(redemption.referee_user_id),
      grantKey: `referral_bonus:${redemption.id}:referee`,
      grantType: "referral_bonus",
      planCode: null,
      totalCredits: REFERRAL_BONUS_CREDITS,
      expiresAt,
      referralRedemptionId: String(redemption.id),
      metadata: {
        role: "referee"
      }
    });
    await db.execute(
      `
        UPDATE referral_redemptions
        SET
            status = 'awarded',
            awarded_at = COALESCE(awarded_at, NOW()),
            updated_at = NOW()
        WHERE id = $1::uuid
      `,
      redemption.id
    );
  }
}

async function upsertBillingOrder(db: DatabaseClient, input: OrderUpsertInput): Promise<{ id: string; inserted: boolean }> {
  if (!input.stripeCheckoutSessionId && !input.stripeInvoiceId) {
    throw new Error("A billing order must include a Stripe checkout session id or invoice id.");
  }

  const uniqueColumn = input.stripeInvoiceId ? "stripe_invoice_id" : "stripe_checkout_session_id";
  const uniqueValue = input.stripeInvoiceId ?? input.stripeCheckoutSessionId ?? null;
  const inserted = await db.fetchrow<{ id: string }>(
    `
      INSERT INTO billing_orders (
          user_id,
          order_kind,
          product_code,
          plan_code,
          status,
          currency,
          gross_amount_cents,
          discount_amount_cents,
          net_amount_cents,
          stripe_checkout_session_id,
          stripe_invoice_id,
          stripe_payment_intent_id,
          stripe_customer_id,
          stripe_subscription_id,
          fulfilled_at,
          metadata
      )
      VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10,
          $11,
          $12,
          $13,
          $14,
          $15,
          $16::jsonb
      )
      ON CONFLICT (${uniqueColumn}) DO NOTHING
      RETURNING id
    `,
    input.userId,
    input.orderKind,
    input.productCode,
    input.planCode,
    input.status,
    input.currency,
    input.grossAmountCents,
    input.discountAmountCents,
    input.netAmountCents,
    input.stripeCheckoutSessionId ?? null,
    input.stripeInvoiceId ?? null,
    input.stripePaymentIntentId ?? null,
    input.stripeCustomerId ?? null,
    input.stripeSubscriptionId ?? null,
    input.fulfilledAt ?? null,
    safeMetadata(input.metadata)
  );

  if (inserted) {
    return { id: String(inserted.id), inserted: true };
  }

  const commandStatus = await db.execute(
    `
      UPDATE billing_orders
      SET
          status = $2,
          currency = $3,
          gross_amount_cents = $4,
          discount_amount_cents = $5,
          net_amount_cents = $6,
          stripe_payment_intent_id = COALESCE($7, stripe_payment_intent_id),
          stripe_customer_id = COALESCE($8, stripe_customer_id),
          stripe_subscription_id = COALESCE($9, stripe_subscription_id),
          fulfilled_at = COALESCE($10, fulfilled_at),
          metadata = CASE
            WHEN metadata = '{}'::jsonb THEN $11::jsonb
            ELSE metadata || $11::jsonb
          END,
          updated_at = NOW()
      WHERE ${uniqueColumn} = $1
    `,
    uniqueValue,
    input.status,
    input.currency,
    input.grossAmountCents,
    input.discountAmountCents,
    input.netAmountCents,
    input.stripePaymentIntentId ?? null,
    input.stripeCustomerId ?? null,
    input.stripeSubscriptionId ?? null,
    input.fulfilledAt ?? null,
    safeMetadata(input.metadata)
  );
  if (rowsAffected(commandStatus) === 0) {
    throw new Error(`Failed to upsert billing order for ${uniqueColumn} ${uniqueValue}`);
  }

  const existing = await db.fetchrow<{ id: string }>(
    `
      SELECT id
      FROM billing_orders
      WHERE ${uniqueColumn} = $1
    `,
    uniqueValue
  );
  if (!existing) {
    throw new Error(`Billing order disappeared for ${uniqueColumn} ${uniqueValue}`);
  }
  return { id: String(existing.id), inserted: false };
}

async function setOrderCreditsGranted(db: DatabaseClient, orderId: string, creditsGranted: number): Promise<void> {
  await db.execute(
    `
      UPDATE billing_orders
      SET
          credits_granted = GREATEST(credits_granted, $2),
          fulfilled_at = COALESCE(fulfilled_at, NOW()),
          updated_at = NOW()
      WHERE id = $1::uuid
    `,
    orderId,
    creditsGranted
  );
}

function defaultCurrency(value: string | null | undefined): string {
  const normalized = (value ?? "usd").trim().toLowerCase();
  return normalized || "usd";
}

export async function fulfillTopupCheckout(db: DatabaseClient, input: CheckoutTopupInput): Promise<void> {
  const product = getBillingProductDefinition(input.productCode);
  if (!product || product.kind !== "topup") {
    throw new Error(`Unsupported top-up product: ${input.productCode}`);
  }

  await db.transaction(async (tx) => {
    await awardDueReferralCredits(tx);
    await expireElapsedCreditGrants(tx, input.userId);

    const profile = await fetchUserBillingProfile(tx, input.userId);
    const planCode = normalizePlanCode(profile.tier);
    const order = await upsertBillingOrder(tx, {
      userId: input.userId,
      orderKind: "topup",
      productCode: product.code,
      planCode,
      status: "paid",
      currency: defaultCurrency(input.currency),
      grossAmountCents: normalizeInteger(input.grossAmountCents, product.amountCents),
      discountAmountCents: normalizeInteger(input.discountAmountCents, 0),
      netAmountCents: normalizeInteger(input.netAmountCents, product.amountCents),
      stripeCheckoutSessionId: input.stripeCheckoutSessionId,
      stripePaymentIntentId: input.stripePaymentIntentId,
      stripeCustomerId: input.stripeCustomerId,
      stripeSubscriptionId: null,
      fulfilledAt: input.occurredAt ?? new Date(),
      metadata: input.metadata
    });

    await createCreditGrant(tx, {
      userId: input.userId,
      billingOrderId: order.id,
      grantKey: `paid_topup:${input.stripeCheckoutSessionId}`,
      grantType: "paid_topup",
      planCode,
      totalCredits: product.credits,
      expiresAt: addDays(input.occurredAt ?? new Date(), PAID_TOPUP_EXPIRY_DAYS),
      metadata: {
        product_code: product.code,
        stripe_checkout_session_id: input.stripeCheckoutSessionId,
        ...(input.metadata ?? {})
      }
    });
    await setOrderCreditsGranted(tx, order.id, product.credits);
    await markReferralReadyForOrder(tx, input.userId, order.id, normalizeInteger(input.netAmountCents, product.amountCents));
  });
}

async function resolveUserIdByCustomer(db: DatabaseClient, stripeCustomerId: string): Promise<string | null> {
  const row = await db.fetchrow<{ id: string }>(
    `
      SELECT id
      FROM user_profiles
      WHERE stripe_customer_id = $1
    `,
    stripeCustomerId
  );
  return row ? String(row.id) : null;
}

export async function fulfillSubscriptionInvoice(db: DatabaseClient, input: SubscriptionInvoiceInput): Promise<void> {
  await db.transaction(async (tx) => {
    await awardDueReferralCredits(tx);

    const userId = await resolveUserIdByCustomer(tx, input.stripeCustomerId);
    if (!userId) {
      throw new Error(`No user profile found for Stripe customer ${input.stripeCustomerId}`);
    }
    const profile = await fetchUserBillingProfile(tx, userId);
    const planCode = normalizePlanCode(profile.tier);
    const includedCredits = normalizeInteger(profile.monthly_credit_limit, includedCreditsForPlan(planCode));
    const order = await upsertBillingOrder(tx, {
      userId,
      orderKind: "subscription",
      productCode: "monthly",
      planCode,
      status: "paid",
      currency: defaultCurrency(input.currency),
      grossAmountCents: normalizeInteger(input.grossAmountCents, 0),
      discountAmountCents: normalizeInteger(input.discountAmountCents, 0),
      netAmountCents: normalizeInteger(input.netAmountCents, 0),
      stripeInvoiceId: input.stripeInvoiceId,
      stripePaymentIntentId: input.stripePaymentIntentId,
      stripeCustomerId: input.stripeCustomerId,
      stripeSubscriptionId: input.stripeSubscriptionId,
      fulfilledAt: input.occurredAt ?? new Date(),
      metadata: {
        period_start: input.periodStart,
        period_end: input.periodEnd,
        ...(input.metadata ?? {})
      }
    });

    await createCreditGrant(tx, {
      userId,
      billingOrderId: order.id,
      grantKey: `subscription_monthly:${userId}:${input.periodStart}`,
      grantType: "subscription_monthly",
      planCode,
      totalCredits: includedCredits,
      expiresAt: endOfBillingPeriod(input.periodEnd),
      metadata: {
        period_start: input.periodStart,
        period_end: input.periodEnd,
        stripe_invoice_id: input.stripeInvoiceId,
        ...(input.metadata ?? {})
      }
    });
    await setOrderCreditsGranted(tx, order.id, includedCredits);
    await markReferralReadyForOrder(tx, userId, order.id, normalizeInteger(input.netAmountCents, 0));
  });
}

export async function recordFailedInvoice(db: DatabaseClient, input: {
  stripeInvoiceId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string | null;
  stripePaymentIntentId: string | null;
  currency: string | null;
  grossAmountCents: number;
  discountAmountCents: number;
  netAmountCents: number;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const userId = await resolveUserIdByCustomer(db, input.stripeCustomerId);
  if (!userId) {
    return;
  }
  const profile = await fetchUserBillingProfile(db, userId);
  await upsertBillingOrder(db, {
    userId,
    orderKind: "subscription",
    productCode: "monthly",
    planCode: normalizePlanCode(profile.tier),
    status: "failed",
    currency: defaultCurrency(input.currency),
    grossAmountCents: normalizeInteger(input.grossAmountCents, 0),
    discountAmountCents: normalizeInteger(input.discountAmountCents, 0),
    netAmountCents: normalizeInteger(input.netAmountCents, 0),
    stripeInvoiceId: input.stripeInvoiceId,
    stripePaymentIntentId: input.stripePaymentIntentId,
    stripeCustomerId: input.stripeCustomerId,
    stripeSubscriptionId: input.stripeSubscriptionId,
    metadata: input.metadata
  });
}

async function setBillingHold(db: DatabaseClient, userId: string, hold: boolean): Promise<void> {
  await db.execute(
    `
      UPDATE user_profiles
      SET billing_hold = $2,
          updated_at = NOW()
      WHERE id = $1
    `,
    userId,
    hold
  );
}

export async function reverseBillingOrderByPaymentIntent(
  db: DatabaseClient,
  stripePaymentIntentId: string,
  status: "refunded" | "disputed"
): Promise<void> {
  await db.transaction(async (tx) => {
    const order = await tx.fetchrow<{
      id: string;
      user_id: string;
      status: string;
    }>(
      `
        SELECT id, user_id, status
        FROM billing_orders
        WHERE stripe_payment_intent_id = $1
        FOR UPDATE
      `,
      stripePaymentIntentId
    );
    if (!order) {
      return;
    }
    if (order.status === "refunded" || order.status === "disputed" || order.status === "needs_review") {
      return;
    }

    const grants = await tx.fetch<{
      id: string;
      remaining_credits: number;
      total_credits: number;
    }>(
      `
        SELECT id, remaining_credits, total_credits
        FROM credit_grants
        WHERE billing_order_id = $1::uuid
        FOR UPDATE
      `,
      order.id
    );

    let requiresManualReview = false;
    for (const grant of grants) {
      const remainingCredits = normalizeInteger(grant.remaining_credits, 0);
      const totalCredits = normalizeInteger(grant.total_credits, 0);
      if (remainingCredits < totalCredits) {
        requiresManualReview = true;
      }
      await tx.execute(
        `
          UPDATE credit_grants
          SET
              remaining_credits = 0,
              status = 'reversed',
              updated_at = NOW()
          WHERE id = $1::uuid
        `,
        grant.id
      );
      if (remainingCredits > 0) {
        await insertCreditTransaction(tx, {
          userId: String(order.user_id),
          grantId: String(grant.id),
          billingOrderId: String(order.id),
          kind: "reversal",
          amount: -remainingCredits,
          metadata: {
            reason: status
          }
        });
      }
    }

    await tx.execute(
      `
        UPDATE billing_orders
        SET
            status = $2,
            updated_at = NOW()
        WHERE id = $1::uuid
      `,
      order.id,
      requiresManualReview ? "needs_review" : status
    );

    if (requiresManualReview) {
      await setBillingHold(tx, String(order.user_id), true);
    }
  });
}

export async function redeemReferralCode(
  db: DatabaseClient,
  refereeUserId: string,
  code: string
): Promise<{ code: string; status: string }> {
  const normalizedCode = code.trim().toUpperCase();
  if (!normalizedCode) {
    throw new Error("Referral code must not be empty.");
  }

  return db.transaction(async (tx) => {
    await ensureReferralCode(tx, refereeUserId);
    const existing = await fetchReferralRedemption(tx, refereeUserId);
    if (existing) {
      throw new Error("A referral code has already been redeemed for this account.");
    }

    const referralCode = await tx.fetchrow<{
      id: string;
      user_id: string;
      code: string;
      is_active: boolean;
    }>(
      `
        SELECT id, user_id, code, is_active
        FROM referral_codes
        WHERE code = $1
      `,
      normalizedCode
    );
    if (!referralCode || !referralCode.is_active) {
      throw new Error("Referral code not found.");
    }
    if (String(referralCode.user_id) === refereeUserId) {
      throw new Error("You cannot redeem your own referral code.");
    }

    await tx.execute(
      `
        INSERT INTO referral_redemptions (
            referral_code_id,
            referrer_user_id,
            referee_user_id,
            status,
            metadata
        )
        VALUES ($1::uuid, $2, $3, 'pending', $4::jsonb)
      `,
      referralCode.id,
      referralCode.user_id,
      refereeUserId,
      safeMetadata({ code: normalizedCode })
    );

    return {
      code: normalizedCode,
      status: "pending"
    };
  });
}

export async function fetchBillingCatalogState(
  db: DatabaseClient,
  userId: string
): Promise<BillingCatalogState> {
  return db.transaction(async (tx) => {
    await ensureCurrentPeriodGrant(tx, userId);
    await awardDueReferralCredits(tx);
    const profile = await fetchUserBillingProfile(tx, userId);
    const referralCode = await ensureReferralCode(tx, userId);
    const wallet = await fetchCreditWalletSummary(tx, userId);
    const redemption = await fetchReferralRedemption(tx, userId);

    return {
      plan_code: normalizePlanCode(profile.tier),
      wallet_balance: wallet.wallet_balance,
      credit_breakdown: wallet.credit_breakdown,
      expiring_credits: wallet.expiring_credits,
      referral: {
        code: referralCode.code,
        bonus_credits: REFERRAL_BONUS_CREDITS,
        reward_delay_days: REFERRAL_REWARD_DELAY_DAYS,
        redeemed_code: redemption?.referee_code ?? null,
        status: redemption?.status ?? null
      }
    };
  });
}

export async function deductCredits(
  db: DatabaseClient,
  userId: string,
  apiKeyId: string,
  requestId: string,
  searchType: string,
  includeAnswer: boolean
): Promise<number> {
  return db.transaction(async (tx) => {
    await ensureCurrentPeriodGrant(tx, userId);
    await awardDueReferralCredits(tx);

    const profile = await fetchUserBillingProfile(tx, userId);
    if (profile.billing_hold) {
      throw new BillingHoldError();
    }

    const creditsUsed = calculateCreditCost(searchType, includeAnswer);
    const [periodStart, periodEnd] = currentBillingPeriod();

    const existingUsage = await tx.fetchrow<{ credits_used: number }>(
      `
        SELECT credits_used
        FROM usage_events
        WHERE request_id = $1
      `,
      requestId
    );
    if (existingUsage) {
      return Number(existingUsage.credits_used ?? 0);
    }

    const availableGrants = await fetchActiveGrantBalances(tx, userId);
    const totalAvailable = availableGrants.reduce(
      (sum, grant) => sum + normalizeInteger(grant.remaining_credits, 0),
      0
    );
    if (totalAvailable < creditsUsed) {
      throw new InsufficientCreditsError();
    }

    const insertedUsage = await tx.fetchrow<{ credits_used: number }>(
      `
        INSERT INTO usage_events (
            request_id,
            user_id,
            api_key_id,
            search_type,
            include_answer,
            credits_used
        )
        VALUES ($1, $2, $3::uuid, $4, $5, $6)
        ON CONFLICT (request_id) DO NOTHING
        RETURNING credits_used
      `,
      requestId,
      userId,
      apiKeyId,
      searchType,
      includeAnswer,
      creditsUsed
    );
    if (insertedUsage == null) {
      const usageRow = await tx.fetchrow<{ credits_used: number }>(
        `
          SELECT credits_used
          FROM usage_events
          WHERE request_id = $1
        `,
        requestId
      );
      return Number(usageRow?.credits_used ?? 0);
    }

    let remainingToSpend = creditsUsed;
    for (const grant of availableGrants) {
      if (remainingToSpend <= 0) {
        break;
      }
      const spendable = Math.min(normalizeInteger(grant.remaining_credits, 0), remainingToSpend);
      if (spendable <= 0) {
        continue;
      }
      await tx.execute(
        `
          UPDATE credit_grants
          SET
              remaining_credits = GREATEST(remaining_credits - $2, 0),
              updated_at = NOW()
          WHERE id = $1::uuid
        `,
        grant.id,
        spendable
      );
      await insertCreditTransaction(tx, {
        userId,
        grantId: String(grant.id),
        requestId,
        kind: "debit",
        amount: -spendable,
        metadata: {
          search_type: searchType,
          include_answer: includeAnswer
        }
      });
      remainingToSpend -= spendable;
    }

    if (remainingToSpend > 0) {
      throw new InsufficientCreditsError();
    }

    await tx.execute(
      `
        INSERT INTO usage_monthly (
            user_id,
            period_start,
            period_end,
            credits_limit,
            credits_used,
            request_count
        )
        VALUES ($1, $2, $3, $4, $5, 1)
        ON CONFLICT (user_id, period_start)
        DO UPDATE SET
            period_end = EXCLUDED.period_end,
            credits_limit = EXCLUDED.credits_limit,
            credits_used = usage_monthly.credits_used + EXCLUDED.credits_used,
            request_count = usage_monthly.request_count + EXCLUDED.request_count,
            updated_at = NOW()
      `,
      userId,
      periodStart,
      periodEnd,
      normalizeInteger(profile.monthly_credit_limit, monthlyCreditLimitForTier(profile.tier)),
      creditsUsed
    );

    return creditsUsed;
  });
}

export async function refundCredits(db: DatabaseClient, requestId: string): Promise<number> {
  return db.transaction(async (tx) => {
    const deletedUsage = await tx.fetchrow<{
      user_id: string;
      credits_used: number;
      occurred_at: string;
    }>(
      `
        DELETE FROM usage_events
        WHERE request_id = $1
        RETURNING user_id, credits_used, occurred_at
      `,
      requestId
    );
    if (deletedUsage == null) {
      return 0;
    }

    const debitRows = await tx.fetch<{
      grant_id: string | null;
      amount: number;
    }>(
      `
        SELECT grant_id, amount
        FROM credit_transactions
        WHERE request_id = $1
          AND kind = 'debit'
        ORDER BY created_at DESC
      `,
      requestId
    );

    for (const row of debitRows) {
      if (!row.grant_id) {
        continue;
      }
      const credits = Math.abs(Number(row.amount ?? 0));
      if (credits <= 0) {
        continue;
      }
      await tx.execute(
        `
          UPDATE credit_grants
          SET
              remaining_credits = LEAST(total_credits, remaining_credits + $2),
              status = CASE WHEN status = 'reversed' THEN status ELSE 'active' END,
              updated_at = NOW()
          WHERE id = $1::uuid
        `,
        row.grant_id,
        credits
      );
      await insertCreditTransaction(tx, {
        userId: String(deletedUsage.user_id),
        grantId: String(row.grant_id),
        requestId,
        kind: "refund",
        amount: credits,
        metadata: {
          reason: "search_failure"
        }
      });
    }

    const occurredAt = new Date(String(deletedUsage.occurred_at));
    const [periodStart, periodEnd] = currentBillingPeriod(occurredAt);
    await tx.execute(
      `
        UPDATE usage_monthly
        SET
            credits_used = GREATEST(usage_monthly.credits_used - $4, 0),
            request_count = GREATEST(usage_monthly.request_count - 1, 0),
            updated_at = NOW()
        WHERE user_id = $1
          AND period_start = $2
          AND period_end = $3
      `,
      deletedUsage.user_id,
      periodStart,
      periodEnd,
      normalizeInteger(deletedUsage.credits_used, 0)
    );
    return normalizeInteger(deletedUsage.credits_used, 0);
  });
}

export async function fetchUsageSummary(
  db: DatabaseClient,
  userId: string,
  referenceDate?: Date
): Promise<Record<string, unknown>> {
  return db.transaction(async (tx) => {
    await ensureCurrentPeriodGrant(tx, userId, referenceDate);
    await awardDueReferralCredits(tx);

    const profile = await fetchUserBillingProfile(tx, userId);
    const [periodStart, periodEnd] = currentBillingPeriod(referenceDate);
    const summary = (await tx.fetchrow<MonthlyUsageRow>(
      `
        SELECT
            COALESCE(credits_used, 0) AS credits_used,
            COALESCE(request_count, 0) AS request_count
        FROM usage_monthly
        WHERE user_id = $1
          AND period_start = $2
          AND period_end = $3
      `,
      userId,
      periodStart,
      periodEnd
    )) ?? { credits_used: 0, request_count: 0 };
    const wallet = await fetchCreditWalletSummary(tx, userId);

    return {
      tier: profile.tier,
      plan_code: normalizePlanCode(profile.tier),
      credits_limit: normalizeInteger(profile.monthly_credit_limit, monthlyCreditLimitForTier(profile.tier)),
      credits_used: normalizeInteger(summary.credits_used, 0),
      credits_remaining: wallet.wallet_balance,
      wallet_balance: wallet.wallet_balance,
      credit_breakdown: wallet.credit_breakdown,
      expiring_credits: wallet.expiring_credits,
      rate_limit_per_sec: normalizeInteger(profile.rate_limit_per_sec, 0),
      billing_hold: profile.billing_hold,
      period_start: periodStart,
      period_end: periodEnd
    };
  });
}

export function calculateCreditsRemaining(usageSummary: Record<string, unknown>): number {
  if (typeof usageSummary.wallet_balance === "number") {
    return Math.max(usageSummary.wallet_balance, 0);
  }
  if (typeof usageSummary.credits_remaining === "number") {
    return Math.max(usageSummary.credits_remaining, 0);
  }
  return Math.max(
    Number(usageSummary.credits_limit ?? 0) - Number(usageSummary.credits_used ?? 0),
    0
  );
}

export async function countActiveApiKeys(db: DatabaseClient, userId: string): Promise<number> {
  const row = await db.fetchrow<{ active_count: number }>(
    `
      SELECT COUNT(*) AS active_count
      FROM api_keys
      WHERE user_id = $1 AND is_active = TRUE
    `,
    userId
  );
  return Number(row?.active_count ?? 0);
}
