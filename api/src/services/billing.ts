import type { DatabaseClient } from "../db/client";
import type { AppConfig } from "../types";
import Stripe from "stripe";
import { randomHex } from "../utils/crypto";
import { sendBillingNotification, type BillingEmailNotification } from "./transactional-email";
import {
  BONUS_CREDIT_EXPIRY_DAYS,
  FREE_DAILY_SEARCHES,
  includedCreditsForPlan,
  MAX_REFERRALS_PER_USER,
  normalizePlanCode,
  REFERRAL_BONUS_CREDITS,
  REFERRAL_CODE_MAX_LENGTH,
  REFERRAL_CODE_MIN_LENGTH,
  REFERRAL_REWARD_DELAY_DAYS,
  SIGNUP_BONUS_CREDITS,
  topupAmountCents,
  type BillingPlanCode
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
  free: 0,
  pro: 5_000,
  enterprise: 100_000
};

export const TIER_KEY_LIMITS: Record<string, number> = {
  free: 1,
  pro: 5,
  enterprise: 25
};

const PAID_TIERS = new Set(["pro", "enterprise"]);
const BONUS_GRANT_TYPES = new Set(["promo_bonus", "referral_bonus", "manual_adjustment"]);
const INCLUDED_GRANT_TYPES = new Set(["free_monthly", "subscription_monthly"]);
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
  auto_recharge_enabled: boolean;
  auto_recharge_threshold: number;
  auto_recharge_quantity: number;
};

type MonthlyUsageRow = {
  credits_used: number;
  request_count: number;
};

type CreditBreakdown = {
  included_remaining: number;
  bonus_remaining: number;
  paid_remaining: number;
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

export type TopupInput = {
  userId: string;
  credits: number;
  stripeCheckoutSessionId: string;
  stripeCustomerId: string | null;
  stripePaymentIntentId: string | null;
  currency: string | null;
  grossAmountCents: number;
  discountAmountCents: number;
  netAmountCents: number;
  occurredAt?: Date | null;
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
    max_referrals: number;
    total_referred: number;
    total_credits_earned: number;
    referrals: Array<{
      referee_email: string;
      status: string;
      created_at: string;
      credits_earned: number;
    }>;
  };
};

type SearchUsageInput = {
  userId: string;
  apiKeyId: string;
  requestId: string;
  searchType: string;
  includeAnswer: boolean;
};

function addDays(reference: Date, days: number): Date {
  return new Date(reference.getTime() + days * 24 * 60 * 60 * 1000);
}

function utcDayBounds(referenceDate?: Date): { start: Date; end: Date } {
  const start = new Date(referenceDate ?? new Date());
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
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

function stripeClient(config: AppConfig): Stripe {
  if (!config.stripe.secretKey) {
    throw new Error("STRIPE_SECRET_KEY is not configured.");
  }
  return new Stripe(config.stripe.secretKey, {
    apiVersion: "2025-08-27.basil"
  });
}

function rowsAffected(commandStatus: string): number {
  const parts = commandStatus.trim().split(/\s+/);
  const last = parts.at(-1);
  return last ? Number.parseInt(last, 10) || 0 : 0;
}

async function acquireTransactionLock(db: DatabaseClient, scope: string): Promise<void> {
  await db.fetchrow(
    `
      SELECT pg_advisory_xact_lock(hashtext($1)) AS locked
    `,
    scope
  );
}

function referralRewardReadyAt(reference = new Date()): Date {
  return REFERRAL_REWARD_DELAY_DAYS > 0
    ? addDays(reference, REFERRAL_REWARD_DELAY_DAYS)
    : reference;
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
          stripe_subscription_id,
          auto_recharge_enabled,
          auto_recharge_threshold,
          auto_recharge_quantity
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
    stripe_subscription_id: row.stripe_subscription_id == null ? null : String(row.stripe_subscription_id),
    auto_recharge_enabled: Boolean(row.auto_recharge_enabled),
    auto_recharge_threshold: normalizeInteger(row.auto_recharge_threshold, 100),
    auto_recharge_quantity: Math.max(normalizeInteger(row.auto_recharge_quantity, 1_000), 1_000)
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
  if (planCode !== "free" && planCode !== "pro" && planCode !== "enterprise") {
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
    bonus_remaining: 0,
    paid_remaining: 0
  };
  const expiringCredits: ExpiringCreditSummary[] = [];
  const expiringCutoff = addDays(new Date(), CREDIT_EXPIRY_WINDOW_DAYS).toISOString();
  let walletBalance = 0;

  for (const grant of grants) {
    const remainingCredits = normalizeInteger(grant.remaining_credits, 0);
    walletBalance += remainingCredits;
    if (BONUS_GRANT_TYPES.has(String(grant.grant_type))) {
      breakdown.bonus_remaining += remainingCredits;
    } else if (INCLUDED_GRANT_TYPES.has(String(grant.grant_type))) {
      breakdown.included_remaining += remainingCredits;
    } else if (String(grant.grant_type) === "paid_topup") {
      breakdown.paid_remaining += remainingCredits;
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
    wallet_balance: walletBalance,
    credit_breakdown: breakdown,
    expiring_credits: expiringCredits.slice(0, 5)
  };
}

function generateReferralCode(): string {
  return `CRL${randomHex(4).toUpperCase()}`;
}

const REFERRAL_CODE_PATTERN = /^[A-Za-z0-9_-]+$/;

function isUniqueViolation(error: unknown): boolean {
  return Boolean((error as { code?: string } | null | undefined)?.code === "23505");
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
    try {
      const inserted = await db.fetchrow<ReferralCodeRecord>(
        `
          INSERT INTO referral_codes (user_id, code, is_active)
          VALUES ($1, $2, TRUE)
          ON CONFLICT (user_id)
          DO UPDATE SET updated_at = referral_codes.updated_at
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
    } catch (error) {
      if (isUniqueViolation(error)) {
        continue;
      }
      throw error;
    }
  }

  const recovered = await db.fetchrow<ReferralCodeRecord>(
    `
      SELECT id, code, is_active
      FROM referral_codes
      WHERE user_id = $1
    `,
    userId
  );
  if (recovered) {
    return {
      id: String(recovered.id),
      code: String(recovered.code),
      is_active: Boolean(recovered.is_active)
    };
  }

  throw new Error(`Unable to generate referral code for ${userId}`);
}

export async function updateReferralCode(
  db: DatabaseClient,
  userId: string,
  newCode: string
): Promise<ReferralCodeRecord> {
  const trimmed = newCode.trim();
  if (trimmed.length < REFERRAL_CODE_MIN_LENGTH || trimmed.length > REFERRAL_CODE_MAX_LENGTH) {
    throw new Error(`Code must be ${REFERRAL_CODE_MIN_LENGTH}–${REFERRAL_CODE_MAX_LENGTH} characters.`);
  }
  if (!REFERRAL_CODE_PATTERN.test(trimmed)) {
    throw new Error("Code may only contain letters, numbers, hyphens, and underscores.");
  }

  const normalized = trimmed.toUpperCase();

  const conflict = await db.fetchrow<{ user_id: string }>(
    `SELECT user_id FROM referral_codes WHERE code = $1`,
    normalized
  );
  if (conflict && String(conflict.user_id) !== userId) {
    throw new Error("This code is already taken.");
  }

  let updated: ReferralCodeRecord | null = null;
  try {
    updated = await db.fetchrow<ReferralCodeRecord>(
      `
        UPDATE referral_codes
        SET code = $2, updated_at = NOW()
        WHERE user_id = $1
        RETURNING id, code, is_active
      `,
      userId,
      normalized
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new Error("This code is already taken.");
    }
    throw error;
  }
  if (!updated) {
    throw new Error("Referral code not found for this user.");
  }
  return { id: String(updated.id), code: String(updated.code), is_active: Boolean(updated.is_active) };
}

export async function fetchReferralStats(
  db: DatabaseClient,
  userId: string
): Promise<{ totalReferred: number; totalCreditsEarned: number; referrals: Array<{ refereeEmail: string; status: string; createdAt: string; creditsEarned: number }> }> {
  const referralCode = await db.fetchrow<{ id: string }>(
    `SELECT id FROM referral_codes WHERE user_id = $1`,
    userId
  );
  if (!referralCode) {
    return { totalReferred: 0, totalCreditsEarned: 0, referrals: [] };
  }

  const rows = await db.fetch<{
    status: string;
    created_at: string;
    referee_email: string | null;
    credits_earned: number;
  }>(
    `
      SELECT
          rr.status,
          rr.created_at,
          u.email AS referee_email,
          COALESCE(
            (SELECT SUM(cg.total_credits) FROM credit_grants cg
             WHERE cg.referral_redemption_id = rr.id
               AND cg.user_id = $2),
            0
          )::int AS credits_earned
      FROM referral_redemptions rr
      JOIN "user" u ON u.id = rr.referee_user_id
      WHERE rr.referrer_user_id = $2
        AND rr.referral_code_id = $1::uuid
      ORDER BY rr.created_at DESC
    `,
    referralCode.id,
    userId
  );

  const totalCreditsEarned = rows.reduce((sum, r) => sum + Number(r.credits_earned ?? 0), 0);

  return {
    totalReferred: rows.length,
    totalCreditsEarned,
    referrals: rows.map((r) => ({
      refereeEmail: r.referee_email ? maskEmail(String(r.referee_email)) : "***",
      status: String(r.status),
      createdAt: String(r.created_at),
      creditsEarned: Number(r.credits_earned ?? 0),
    })),
  };
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "***";
  const visible = local.slice(0, 2);
  return `${visible}***@${domain}`;
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

  const existing = await db.fetchrow<{ id: string; first_paid_order_id: string | null; status: string }>(
    `
      SELECT id, first_paid_order_id, status
      FROM referral_redemptions
      WHERE referee_user_id = $1
      FOR UPDATE
    `,
    refereeUserId
  );
  if (!existing || existing.first_paid_order_id || String(existing.status) !== "pending") {
    return;
  }

  await db.execute(
    `
      UPDATE referral_redemptions
      SET
          first_paid_order_id = $2::uuid,
          first_paid_at = NOW(),
          reward_ready_at = $3,
          updated_at = NOW()
      WHERE id = $1::uuid
    `,
    existing.id,
    billingOrderId,
    referralRewardReadyAt()
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
  if (!input.stripeCheckoutSessionId && !input.stripeInvoiceId && !input.stripePaymentIntentId) {
    throw new Error("A billing order must include a Stripe checkout session id, invoice id, or payment intent id.");
  }

  if (!input.stripeCheckoutSessionId && !input.stripeInvoiceId && input.stripePaymentIntentId) {
    await db.fetchrow(
      `
        SELECT pg_advisory_xact_lock(hashtext($1)) AS locked
      `,
      input.stripePaymentIntentId
    );

    const existing = await db.fetchrow<{ id: string }>(
      `
        SELECT id
        FROM billing_orders
        WHERE stripe_payment_intent_id = $1
        FOR UPDATE
      `,
      input.stripePaymentIntentId
    );

    if (!existing) {
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
        input.stripePaymentIntentId,
        input.stripeCustomerId ?? null,
        input.stripeSubscriptionId ?? null,
        input.fulfilledAt ?? null,
        safeMetadata(input.metadata)
      );
      if (!inserted) {
        throw new Error(`Failed to create billing order for payment intent ${input.stripePaymentIntentId}`);
      }
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
            stripe_customer_id = COALESCE($7, stripe_customer_id),
            stripe_subscription_id = COALESCE($8, stripe_subscription_id),
            fulfilled_at = COALESCE($9, fulfilled_at),
            metadata = CASE
              WHEN metadata = '{}'::jsonb THEN $10::jsonb
              ELSE metadata || $10::jsonb
            END,
            updated_at = NOW()
        WHERE stripe_payment_intent_id = $1
      `,
      input.stripePaymentIntentId,
      input.status,
      input.currency,
      input.grossAmountCents,
      input.discountAmountCents,
      input.netAmountCents,
      input.stripeCustomerId ?? null,
      input.stripeSubscriptionId ?? null,
      input.fulfilledAt ?? null,
      safeMetadata(input.metadata)
    );
    if (rowsAffected(commandStatus) === 0) {
      throw new Error(`Failed to upsert billing order for stripe_payment_intent_id ${input.stripePaymentIntentId}`);
    }

    return { id: String(existing.id), inserted: false };
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

async function linkStripeCustomerToUser(
  db: DatabaseClient,
  userId: string,
  stripeCustomerId: string | null | undefined
): Promise<void> {
  const normalizedStripeCustomerId = stripeCustomerId == null ? null : String(stripeCustomerId).trim();
  if (!normalizedStripeCustomerId) {
    return;
  }

  await db.execute(
    `
      UPDATE user_profiles
      SET
          stripe_customer_id = COALESCE(stripe_customer_id, $2),
          updated_at = NOW()
      WHERE id = $1
    `,
    userId,
    normalizedStripeCustomerId
  );
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

export async function grantSignupBonus(db: DatabaseClient, userId: string): Promise<void> {
  await createCreditGrant(db, {
    userId,
    grantKey: `signup_bonus:${userId}`,
    grantType: "promo_bonus",
    planCode: "free",
    totalCredits: SIGNUP_BONUS_CREDITS,
    expiresAt: null,
    metadata: {
      reason: "signup_bonus"
    }
  });
}

export async function fulfillTopupCheckout(db: DatabaseClient, input: TopupInput): Promise<BillingEmailNotification | null> {
  return db.transaction(async (tx) => {
    await awardDueReferralCredits(tx);
    await linkStripeCustomerToUser(tx, input.userId, input.stripeCustomerId);
    const profile = await fetchUserBillingProfile(tx, input.userId);
    const planCode = normalizePlanCode(profile.tier);

    const order = await upsertBillingOrder(tx, {
      userId: input.userId,
      orderKind: "topup",
      productCode: "topup",
      planCode,
      status: "paid",
      currency: defaultCurrency(input.currency),
      grossAmountCents: normalizeInteger(input.grossAmountCents, 0),
      discountAmountCents: normalizeInteger(input.discountAmountCents, 0),
      netAmountCents: normalizeInteger(input.netAmountCents, 0),
      stripeCheckoutSessionId: input.stripeCheckoutSessionId,
      stripePaymentIntentId: input.stripePaymentIntentId,
      stripeCustomerId: input.stripeCustomerId,
      stripeSubscriptionId: null,
      fulfilledAt: input.occurredAt ?? new Date(),
      metadata: {
        credits: input.credits
      }
    });

    const grant = await createCreditGrant(tx, {
      userId: input.userId,
      billingOrderId: order.id,
      grantKey: `topup:${input.stripeCheckoutSessionId}`,
      grantType: "paid_topup",
      planCode,
      totalCredits: input.credits,
      expiresAt: null,
      metadata: {
        stripe_checkout_session_id: input.stripeCheckoutSessionId
      }
    });
    await setOrderCreditsGranted(tx, order.id, input.credits);
    await markReferralReadyForOrder(tx, input.userId, order.id, normalizeInteger(input.netAmountCents, 0));

    if (!grant.inserted || !profile.email) {
      return null;
    }

    return {
      kind: "topup_received",
      to: profile.email,
      credits: input.credits,
      amountCents: normalizeInteger(input.netAmountCents, 0)
    };
  });
}

type AutoRechargeFulfillmentInput = {
  userId: string;
  stripePaymentIntentId: string;
  stripeCustomerId: string | null;
  quantity: number;
  currency: string | null;
  grossAmountCents: number;
  discountAmountCents: number;
  netAmountCents: number;
  occurredAt?: Date | null;
};

export async function fulfillAutoRechargePayment(
  db: DatabaseClient,
  input: AutoRechargeFulfillmentInput
): Promise<BillingEmailNotification | null> {
  return db.transaction(async (tx) => {
    await linkStripeCustomerToUser(tx, input.userId, input.stripeCustomerId);
    const profile = await fetchUserBillingProfile(tx, input.userId);
    const planCode = normalizePlanCode(profile.tier);
    const order = await upsertBillingOrder(tx, {
      userId: input.userId,
      orderKind: "topup",
      productCode: "auto_recharge",
      planCode,
      status: "paid",
      currency: defaultCurrency(input.currency),
      grossAmountCents: normalizeInteger(input.grossAmountCents, 0),
      discountAmountCents: normalizeInteger(input.discountAmountCents, 0),
      netAmountCents: normalizeInteger(input.netAmountCents, 0),
      stripePaymentIntentId: input.stripePaymentIntentId,
      stripeCustomerId: input.stripeCustomerId,
      fulfilledAt: input.occurredAt ?? new Date(),
      metadata: {
        auto_recharge: true,
        quantity: input.quantity
      }
    });

    const grant = await createCreditGrant(tx, {
      userId: input.userId,
      billingOrderId: order.id,
      grantKey: `auto_recharge:${input.stripePaymentIntentId}`,
      grantType: "paid_topup",
      planCode,
      totalCredits: input.quantity,
      expiresAt: null,
      metadata: {
        auto_recharge: true,
        stripe_payment_intent_id: input.stripePaymentIntentId
      }
    });
    await setOrderCreditsGranted(tx, order.id, input.quantity);

    if (!grant.inserted || !profile.email) {
      return null;
    }

    return {
      kind: "auto_recharge_received",
      to: profile.email,
      credits: input.quantity,
      amountCents: normalizeInteger(input.netAmountCents, 0)
    };
  });
}

export async function fulfillSubscriptionInvoice(db: DatabaseClient, input: SubscriptionInvoiceInput): Promise<BillingEmailNotification | null> {
  return db.transaction(async (tx) => {
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
      productCode: "pro",
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

    const grant = await createCreditGrant(tx, {
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

    if (!grant.inserted || !profile.email) {
      return null;
    }

    return {
      kind: "subscription_activated",
      to: profile.email,
      includedCredits,
      amountCents: normalizeInteger(input.netAmountCents, 0),
      periodStart: input.periodStart,
      periodEnd: input.periodEnd
    };
  });
}

export async function maybeAutoRecharge(
  db: DatabaseClient,
  config: AppConfig,
  userId: string
): Promise<{ triggered: boolean; error?: string }> {
  let notification: BillingEmailNotification | null = null;
  try {
    const result = await db.transaction(async (tx) => {
      await acquireTransactionLock(tx, `auto_recharge:${userId}`);

      const profile = await fetchUserBillingProfile(tx, userId);
      if (!profile.auto_recharge_enabled || !profile.stripe_customer_id) {
        return { triggered: false as const };
      }

      const wallet = await fetchCreditWalletSummary(tx, userId);
      if (wallet.wallet_balance >= profile.auto_recharge_threshold) {
        return { triggered: false as const };
      }

      const recentRecharge = await tx.fetchrow<{ id: string }>(
        `
          SELECT id
          FROM billing_orders
          WHERE user_id = $1
            AND order_kind = 'topup'
            AND status = 'pending'
            AND created_at > NOW() - INTERVAL '5 minutes'
          LIMIT 1
          FOR UPDATE
        `,
        userId
      );
      if (recentRecharge) {
        return { triggered: false as const };
      }

      const stripe = stripeClient(config);
      const quantity = Math.max(Math.round(profile.auto_recharge_quantity / 100) * 100, 1_000);
      const totalAmount = topupAmountCents(quantity);
      if (totalAmount <= 0) {
        return { triggered: false as const, error: "Stripe auto-recharge amount is invalid." };
      }

      const paymentIntent = await stripe.paymentIntents.create({
        amount: totalAmount,
        currency: "usd",
        customer: profile.stripe_customer_id,
        off_session: true,
        confirm: true,
        metadata: {
          user_id: userId,
          type: "auto_recharge",
          quantity: String(quantity)
        }
      });

      await upsertBillingOrder(tx, {
        userId,
        orderKind: "topup",
        productCode: "auto_recharge",
        planCode: normalizePlanCode(profile.tier),
        status: paymentIntent.status === "succeeded" ? "paid" : "pending",
        currency: defaultCurrency(paymentIntent.currency),
        grossAmountCents: totalAmount,
        discountAmountCents: 0,
        netAmountCents: totalAmount,
        stripePaymentIntentId: paymentIntent.id,
        stripeCustomerId: profile.stripe_customer_id,
        fulfilledAt: paymentIntent.status === "succeeded" ? new Date() : null,
        metadata: {
          auto_recharge: true,
          quantity
        }
      });

      if (paymentIntent.status === "succeeded") {
        notification = await fulfillAutoRechargePayment(tx, {
          userId,
          stripePaymentIntentId: paymentIntent.id,
          stripeCustomerId: profile.stripe_customer_id,
          quantity,
          currency: paymentIntent.currency,
          grossAmountCents: totalAmount,
          discountAmountCents: 0,
          netAmountCents: totalAmount,
          occurredAt: new Date()
        });
      }

      return {
        triggered: paymentIntent.status === "succeeded",
        error: paymentIntent.status === "succeeded"
          ? undefined
          : "Stripe auto-recharge requires additional payment confirmation."
      };
    });

    if (notification) {
      void sendBillingNotification(config, notification).catch((error) => {
        console.error("[billing] Failed to send auto-recharge email:", error);
      });
    }

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Auto-recharge failed.";
    console.error("[billing] Auto-recharge failed:", message);
    return { triggered: false, error: message };
  }
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
    productCode: "pro",
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
        FOR UPDATE
      `,
      normalizedCode
    );
    if (!referralCode || !referralCode.is_active) {
      throw new Error("Referral code not found.");
    }
    if (String(referralCode.user_id) === refereeUserId) {
      throw new Error("You cannot redeem your own referral code.");
    }

    // Check referral cap for the referrer
    const referrerCount = await tx.fetchval<number>(
      `SELECT COUNT(*)::int FROM referral_redemptions WHERE referrer_user_id = $1`,
      referralCode.user_id
    );
    if (Number(referrerCount ?? 0) >= MAX_REFERRALS_PER_USER) {
      throw new Error("This referral code has reached its maximum number of uses.");
    }

    // Insert redemption
    const redemption = await tx.fetchrow<{ id: string }>(
      `
        INSERT INTO referral_redemptions (
            referral_code_id,
            referrer_user_id,
            referee_user_id,
            status,
            reward_ready_at,
            metadata
        )
        VALUES ($1::uuid, $2, $3, 'pending', NOW(), $4::jsonb)
        RETURNING id
      `,
      referralCode.id,
      referralCode.user_id,
      refereeUserId,
      safeMetadata({ code: normalizedCode })
    );

    if (!redemption) {
      throw new Error("Failed to create referral redemption.");
    }

    // Award credits immediately to both parties
    const expiresAt = addDays(new Date(), BONUS_CREDIT_EXPIRY_DAYS);
    await createCreditGrant(tx, {
      userId: String(referralCode.user_id),
      grantKey: `referral_bonus:${redemption.id}:referrer`,
      grantType: "referral_bonus",
      planCode: null,
      totalCredits: REFERRAL_BONUS_CREDITS,
      expiresAt,
      referralRedemptionId: String(redemption.id),
      metadata: { role: "referrer" }
    });
    await createCreditGrant(tx, {
      userId: refereeUserId,
      grantKey: `referral_bonus:${redemption.id}:referee`,
      grantType: "referral_bonus",
      planCode: null,
      totalCredits: REFERRAL_BONUS_CREDITS,
      expiresAt,
      referralRedemptionId: String(redemption.id),
      metadata: { role: "referee" }
    });

    // Mark as awarded immediately
    await tx.execute(
      `UPDATE referral_redemptions SET status = 'awarded', awarded_at = NOW(), updated_at = NOW() WHERE id = $1::uuid`,
      redemption.id
    );

    return {
      code: normalizedCode,
      status: "awarded"
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
    const stats = await fetchReferralStats(tx, userId);

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
        status: redemption?.status ?? null,
        max_referrals: MAX_REFERRALS_PER_USER,
        total_referred: stats.totalReferred,
        total_credits_earned: stats.totalCreditsEarned,
        referrals: stats.referrals.map((r) => ({
          referee_email: r.refereeEmail,
          status: r.status,
          created_at: r.createdAt,
          credits_earned: r.creditsEarned,
        })),
      }
    };
  });
}

async function insertUsageEvent(
  db: DatabaseClient,
  input: {
    requestId: string;
    userId: string;
    apiKeyId: string;
    searchType: string;
    includeAnswer: boolean;
    creditsUsed: number;
  }
): Promise<{ creditsUsed: number; inserted: boolean }> {
  const existingUsage = await db.fetchrow<{ credits_used: number }>(
    `
      SELECT credits_used
      FROM usage_events
      WHERE request_id = $1
    `,
    input.requestId
  );
  if (existingUsage) {
    return {
      creditsUsed: Number(existingUsage.credits_used ?? 0),
      inserted: false
    };
  }

  const insertedUsage = await db.fetchrow<{ credits_used: number }>(
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
    input.requestId,
    input.userId,
    input.apiKeyId,
    input.searchType,
    input.includeAnswer,
    input.creditsUsed
  );
  if (insertedUsage == null) {
    const usageRow = await db.fetchrow<{ credits_used: number }>(
      `
        SELECT credits_used
        FROM usage_events
        WHERE request_id = $1
      `,
      input.requestId
    );
    return {
      creditsUsed: Number(usageRow?.credits_used ?? 0),
      inserted: false
    };
  }

  return {
    creditsUsed: Number(insertedUsage.credits_used ?? 0),
    inserted: true
  };
}

async function incrementMonthlyUsage(
  db: DatabaseClient,
  input: {
    userId: string;
    periodStart: string;
    periodEnd: string;
    creditsLimit: number;
    creditsUsed: number;
  }
): Promise<void> {
  await db.execute(
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
    input.userId,
    input.periodStart,
    input.periodEnd,
    input.creditsLimit,
    input.creditsUsed
  );
}

export async function fetchDailySearchAllowance(
  db: DatabaseClient,
  userId: string,
  referenceDate?: Date
): Promise<{ limit: number; searchesToday: number; remaining: number }> {
  const { start, end } = utcDayBounds(referenceDate);
  const row = await db.fetchrow<{ count: number }>(
    `
      SELECT COUNT(*)::int AS count
      FROM usage_events
      WHERE user_id = $1
        AND occurred_at >= $2
        AND occurred_at < $3
    `,
    userId,
    start.toISOString(),
    end.toISOString()
  );

  const searchesToday = normalizeInteger(row?.count, 0);
  return {
    limit: FREE_DAILY_SEARCHES,
    searchesToday,
    remaining: Math.max(FREE_DAILY_SEARCHES - searchesToday, 0)
  };
}

async function consumeSearchUsage(
  db: DatabaseClient,
  input: SearchUsageInput,
  options: { allowDailyFree: boolean }
): Promise<number> {
  return db.transaction(async (tx) => {
    await ensureCurrentPeriodGrant(tx, input.userId);
    await awardDueReferralCredits(tx);

    const profile = await fetchUserBillingProfile(tx, input.userId);
    if (profile.billing_hold) {
      throw new BillingHoldError();
    }

    const creditsUsed = calculateCreditCost(input.searchType, input.includeAnswer);
    const [periodStart, periodEnd] = currentBillingPeriod();
    let chargedCredits = creditsUsed;

    const existingUsage = await tx.fetchrow<{ credits_used: number }>(
      `
        SELECT credits_used
        FROM usage_events
        WHERE request_id = $1
      `,
      input.requestId
    );
    if (existingUsage) {
      return normalizeInteger(existingUsage.credits_used, 0);
    }

    if (options.allowDailyFree) {
      const { start, end } = utcDayBounds();
      await acquireTransactionLock(tx, `daily_free:${input.userId}:${start.toISOString().slice(0, 10)}`);
      const dailyCount = await tx.fetchrow<{ count: number }>(
        `
          SELECT COUNT(*)::int AS count
          FROM usage_events
          WHERE user_id = $1
            AND occurred_at >= $2
            AND occurred_at < $3
        `,
        input.userId,
        start.toISOString(),
        end.toISOString()
      );
      if (normalizeInteger(dailyCount?.count, 0) < FREE_DAILY_SEARCHES) {
        chargedCredits = 0;
      }
    }

    const usageEvent = await insertUsageEvent(tx, {
      requestId: input.requestId,
      userId: input.userId,
      apiKeyId: input.apiKeyId,
      searchType: input.searchType,
      includeAnswer: input.includeAnswer,
      creditsUsed: chargedCredits
    });

    if (!usageEvent.inserted) {
      return usageEvent.creditsUsed;
    }

    if (chargedCredits > 0) {
      const grants = await fetchActiveGrantBalances(tx, input.userId);
      let remainingCost = chargedCredits;
      const totalAvailable = grants.reduce(
        (sum, grant) => sum + normalizeInteger(grant.remaining_credits, 0),
        0
      );

      if (totalAvailable < chargedCredits) {
        throw new InsufficientCreditsError();
      }

      for (const grant of grants) {
        const availableCredits = normalizeInteger(grant.remaining_credits, 0);
        if (availableCredits <= 0 || remainingCost <= 0) {
          continue;
        }

        const deducted = Math.min(availableCredits, remainingCost);
        await tx.execute(
          `
            UPDATE credit_grants
            SET
                remaining_credits = GREATEST(remaining_credits - $2, 0),
                updated_at = NOW()
            WHERE id = $1::uuid
          `,
          grant.id,
          deducted
        );
        await insertCreditTransaction(tx, {
          userId: input.userId,
          grantId: String(grant.id),
          requestId: input.requestId,
          kind: "debit",
          amount: -deducted,
          metadata: {
            search_type: input.searchType,
            include_answer: input.includeAnswer
          }
        });
        remainingCost -= deducted;
      }

      if (remainingCost > 0) {
        throw new InsufficientCreditsError();
      }
    }

    await incrementMonthlyUsage(tx, {
      userId: input.userId,
      periodStart,
      periodEnd,
      creditsLimit: normalizeInteger(profile.monthly_credit_limit, monthlyCreditLimitForTier(profile.tier)),
      creditsUsed: chargedCredits
    });

    return chargedCredits;
  });
}

export async function consumeSearchCredits(
  db: DatabaseClient,
  userId: string,
  apiKeyId: string,
  requestId: string,
  searchType: string,
  includeAnswer: boolean
): Promise<number> {
  return consumeSearchUsage(
    db,
    {
      requestId,
      userId,
      apiKeyId,
      searchType,
      includeAnswer,
    },
    { allowDailyFree: true }
  );
}

export async function recordFreeSearchUsage(
  db: DatabaseClient,
  userId: string,
  apiKeyId: string,
  requestId: string,
  searchType: string,
  includeAnswer: boolean
): Promise<number> {
  return consumeSearchUsage(
    db,
    {
      userId,
      apiKeyId,
      requestId,
      searchType,
      includeAnswer
    },
    { allowDailyFree: true }
  );
}

export async function deductCredits(
  db: DatabaseClient,
  userId: string,
  apiKeyId: string,
  requestId: string,
  searchType: string,
  includeAnswer: boolean
): Promise<number> {
  return consumeSearchUsage(
    db,
    {
      userId,
      apiKeyId,
      requestId,
      searchType,
      includeAnswer
    },
    { allowDailyFree: false }
  );
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
