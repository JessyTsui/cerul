import Stripe from "stripe";

import type { AppConfig } from "../types";
import type { DatabaseClient } from "../db/client";
import { getBillingProduct, normalizePlanCode } from "./billing-catalog";
import { monthlyCreditLimitForTier } from "./billing";

const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing", "past_due"]);

export class StripeServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StripeServiceError";
  }
}

export class StripeWebhookVerificationError extends StripeServiceError {
  constructor(message: string) {
    super(message);
    this.name = "StripeWebhookVerificationError";
  }
}

export type CheckoutSessionInput = {
  userId: string;
  email: string;
  stripeCustomerId?: string | null;
  productCode?: string | null;
};

function requireSetting(name: string, value: string | null): string {
  if (!value) {
    throw new StripeServiceError(`${name} is not configured.`);
  }
  return value;
}

function stripeClient(config: AppConfig): Stripe {
  return new Stripe(requireSetting("STRIPE_SECRET_KEY", config.stripe.secretKey), {
    apiVersion: "2025-08-27.basil"
  });
}

function rowsAffected(commandStatus: string): number {
  const parts = commandStatus.trim().split(/\s+/);
  const last = parts.at(-1);
  return last ? Number.parseInt(last, 10) || 0 : 0;
}

function webBaseUrl(config: AppConfig): string {
  return config.public.webBaseUrl.replace(/\/+$/, "");
}

function sessionMetadata(input: CheckoutSessionInput, productCode: string): Record<string, string> {
  return {
    user_id: input.userId,
    product_code: productCode
  };
}

export function createCheckoutSession(config: AppConfig, input: CheckoutSessionInput): Promise<string> | string {
  const product = getBillingProduct(config, input.productCode ?? "monthly");
  if (!product) {
    throw new StripeServiceError(`Unknown billing product: ${input.productCode ?? "monthly"}`);
  }
  if (!product.stripePriceId) {
    throw new StripeServiceError(`Stripe price is not configured for ${product.code}.`);
  }

  const client = stripeClient(config);
  const metadata = sessionMetadata(input, product.code);
  const payload: Stripe.Checkout.SessionCreateParams = {
    mode: product.kind === "subscription" ? "subscription" : "payment",
    line_items: [
      {
        price: requireSetting(`stripe price for ${product.code}`, product.stripePriceId),
        quantity: 1
      }
    ],
    allow_promotion_codes: product.allowPromotionCodes,
    client_reference_id: input.userId,
    metadata,
    success_url: `${webBaseUrl(config)}/dashboard/settings?checkout=success&product=${product.code}`,
    cancel_url: `${webBaseUrl(config)}/pricing?checkout=cancelled&product=${product.code}`
  };

  if (product.kind === "subscription") {
    payload.subscription_data = {
      metadata
    };
  } else {
    payload.payment_intent_data = {
      metadata
    };
  }

  if (input.stripeCustomerId) {
    payload.customer = input.stripeCustomerId;
  } else {
    payload.customer_email = input.email;
  }

  return client.checkout.sessions.create(payload).then((session) => {
    if (!session.url) {
      throw new StripeServiceError("Stripe checkout session did not return a URL.");
    }
    return String(session.url);
  }).catch((error: any) => {
    throw new StripeServiceError(error?.message || "Stripe checkout session creation failed.");
  });
}

export function createPortalSession(config: AppConfig, stripeCustomerId: string): Promise<string> | string {
  const client = stripeClient(config);
  return client.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: `${webBaseUrl(config)}/dashboard/settings`
  }).then((session) => {
    if (!session.url) {
      throw new StripeServiceError("Stripe billing portal did not return a URL.");
    }
    return String(session.url);
  }).catch((error: any) => {
    throw new StripeServiceError(error?.message || "Stripe billing portal session creation failed.");
  });
}

export function constructWebhookEvent(config: AppConfig, payload: string, signatureHeader: string | null): Record<string, unknown> {
  if (!signatureHeader) {
    throw new StripeWebhookVerificationError("Missing Stripe-Signature header.");
  }
  try {
    const client = stripeClient(config);
    return client.webhooks.constructEvent(
      payload,
      signatureHeader,
      requireSetting("STRIPE_WEBHOOK_SECRET", config.stripe.webhookSecret)
    ) as unknown as Record<string, unknown>;
  } catch (error: any) {
    if (String(error?.message ?? "").toLowerCase().includes("signature")) {
      throw new StripeWebhookVerificationError("Invalid Stripe signature.");
    }
    throw new StripeWebhookVerificationError("Invalid Stripe payload.");
  }
}

export function subscriptionTier(subscription: Record<string, unknown>): { tier: string; monthlyCreditLimit: number } {
  const status = String(subscription.status ?? "").toLowerCase();
  const tier = ACTIVE_SUBSCRIPTION_STATUSES.has(status) ? "monthly" : "free";
  return {
    tier,
    monthlyCreditLimit: monthlyCreditLimitForTier(tier)
  };
}

export async function activateCheckoutSubscription(
  db: DatabaseClient,
  userId: string,
  stripeCustomerId?: string | null,
  subscriptionId?: string | null
): Promise<Record<string, unknown>> {
  const tier = "monthly";
  const monthlyCreditLimit = monthlyCreditLimitForTier(tier);
  const commandStatus = await db.execute(
    `
      UPDATE user_profiles
      SET tier = $1,
          monthly_credit_limit = $2,
          stripe_customer_id = COALESCE($3, stripe_customer_id),
          stripe_subscription_id = COALESCE($4, stripe_subscription_id),
          updated_at = NOW()
      WHERE id = $5
    `,
    tier,
    monthlyCreditLimit,
    stripeCustomerId ?? null,
    subscriptionId ?? null,
    userId
  );
  if (rowsAffected(commandStatus) === 0) {
    throw new StripeServiceError("No matching user profile found for checkout session completion.");
  }
  return {
    tier,
    plan_code: normalizePlanCode(tier),
    monthly_credit_limit: monthlyCreditLimit
  };
}

export async function syncSubscriptionStatus(
  db: DatabaseClient,
  stripeCustomerId: string,
  subscription: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const { tier, monthlyCreditLimit } = subscriptionTier(subscription);
  const subscriptionId = subscription.id == null ? null : String(subscription.id);
  const commandStatus = await db.execute(
    `
      UPDATE user_profiles
      SET tier = $1,
          monthly_credit_limit = $2,
          stripe_customer_id = $3,
          stripe_subscription_id = COALESCE($4, stripe_subscription_id),
          updated_at = NOW()
      WHERE stripe_customer_id = $3
    `,
    tier,
    monthlyCreditLimit,
    stripeCustomerId,
    subscriptionId
  );
  const updatedRows = rowsAffected(commandStatus);
  if (updatedRows === 0) {
    throw new StripeServiceError("No matching user profile found for Stripe customer.");
  }
  return {
    tier,
    plan_code: normalizePlanCode(tier),
    monthly_credit_limit: monthlyCreditLimit,
    updated_rows: updatedRows
  };
}
