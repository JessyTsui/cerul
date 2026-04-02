import Stripe from "stripe";

import type { AppConfig } from "../types";
import type { DatabaseClient } from "../db/client";
import {
  normalizePlanCode,
  TOPUP_CREDIT_STEP,
  TOPUP_STEP_PRICE_CENTS,
  topupLineItemQuantity
} from "./billing-catalog";
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

export function createCheckoutSession(
  config: AppConfig,
  userId: string,
  email: string,
  stripeCustomerId?: string | null
): Promise<string> | string {
  const client = stripeClient(config);
  const metadata = { user_id: userId };
  const payload: Stripe.Checkout.SessionCreateParams = {
    mode: "subscription",
    line_items: [
      {
        price: requireSetting("STRIPE_PRO_PRICE_ID", config.stripe.proPriceId),
        quantity: 1
      }
    ],
    allow_promotion_codes: true,
    client_reference_id: userId,
    metadata,
    subscription_data: { metadata },
    success_url: `${webBaseUrl(config)}/dashboard?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${webBaseUrl(config)}/pricing?checkout=cancelled`
  };

  if (stripeCustomerId) {
    payload.customer = stripeCustomerId;
  } else {
    payload.customer_email = email;
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

export function createTopupCheckoutSession(
  config: AppConfig,
  input: { userId: string; email: string; stripeCustomerId?: string | null; quantity: number }
): Promise<string> {
  const client = stripeClient(config);
  const lineItemQuantity = topupLineItemQuantity(input.quantity);
  const metadata = {
    user_id: input.userId,
    type: "topup",
    quantity: String(input.quantity)
  };
  const payload: Stripe.Checkout.SessionCreateParams = {
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: {
            name: "Cerul Credits",
            description: `${TOPUP_CREDIT_STEP} credits per unit`
          },
          unit_amount: TOPUP_STEP_PRICE_CENTS
        },
        quantity: lineItemQuantity
      }
    ],
    client_reference_id: input.userId,
    metadata,
    payment_intent_data: { metadata },
    success_url: `${webBaseUrl(config)}/dashboard/settings?checkout=success&type=topup&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${webBaseUrl(config)}/dashboard/settings?checkout=cancelled`
  };

  if (input.stripeCustomerId) {
    payload.customer = input.stripeCustomerId;
  } else {
    payload.customer_email = input.email;
    payload.customer_creation = "always";
  }

  return client.checkout.sessions.create(payload).then((session) => {
    if (!session.url) {
      throw new StripeServiceError("Stripe top-up checkout session did not return a URL.");
    }
    return String(session.url);
  }).catch((error: any) => {
    throw new StripeServiceError(error?.message || "Stripe top-up checkout session creation failed.");
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

export async function listPaymentMethods(config: AppConfig, stripeCustomerId: string): Promise<Array<{
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  isDefault: boolean;
}>> {
  const client = stripeClient(config);
  const [methods, customer] = await Promise.all([
    client.paymentMethods.list({ customer: stripeCustomerId, type: "card", limit: 10 }),
    client.customers.retrieve(stripeCustomerId),
  ]);
  const defaultPmId = (customer as Stripe.Customer).invoice_settings?.default_payment_method;
  return methods.data.map((pm) => ({
    id: pm.id,
    brand: pm.card?.brand ?? "unknown",
    last4: pm.card?.last4 ?? "****",
    expMonth: pm.card?.exp_month ?? 0,
    expYear: pm.card?.exp_year ?? 0,
    isDefault: pm.id === defaultPmId,
  }));
}

export function createSetupSession(config: AppConfig, stripeCustomerId: string): Promise<string> {
  const client = stripeClient(config);
  return client.checkout.sessions.create({
    customer: stripeCustomerId,
    mode: "setup",
    payment_method_types: ["card"],
    success_url: `${webBaseUrl(config)}/dashboard/billing?tab=payment`,
    cancel_url: `${webBaseUrl(config)}/dashboard/billing?tab=payment`,
  }).then((session) => {
    if (!session.url) throw new StripeServiceError("Stripe setup session did not return a URL.");
    return String(session.url);
  }).catch((error: any) => {
    throw new StripeServiceError(error?.message || "Stripe setup session creation failed.");
  });
}

export function retrieveCheckoutSession(config: AppConfig, checkoutSessionId: string): Promise<Stripe.Checkout.Session> {
  const client = stripeClient(config);
  return client.checkout.sessions.retrieve(checkoutSessionId).catch((error: any) => {
    throw new StripeServiceError(error?.message || "Stripe checkout session lookup failed.");
  });
}

export function retrieveInvoice(config: AppConfig, invoiceId: string): Promise<Stripe.Invoice> {
  const client = stripeClient(config);
  return client.invoices.retrieve(invoiceId).catch((error: any) => {
    throw new StripeServiceError(error?.message || "Stripe invoice lookup failed.");
  });
}

export function retrieveSubscription(config: AppConfig, subscriptionId: string): Promise<Stripe.Subscription> {
  const client = stripeClient(config);
  return client.subscriptions.retrieve(subscriptionId).catch((error: any) => {
    throw new StripeServiceError(error?.message || "Stripe subscription lookup failed.");
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
  const tier = ACTIVE_SUBSCRIPTION_STATUSES.has(status) ? "pro" : "free";
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
  const tier = "pro";
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
