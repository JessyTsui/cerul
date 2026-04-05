import { Hono } from "hono";

import type { DatabaseClient } from "../db/client";
import {
  fulfillAutoRechargePayment,
  fulfillTopupCheckout,
  fulfillSubscriptionInvoice,
  recordFailedInvoice,
  reverseBillingOrderByPaymentIntent
} from "../services/billing";
import {
  activateCheckoutSubscription,
  constructWebhookEvent,
  StripeServiceError,
  StripeWebhookVerificationError,
  syncSubscriptionStatus
} from "../services/stripe";
import { sendBillingNotification } from "../services/transactional-email";
import { apiError } from "../utils/http";

async function fetchLoggedEvent(db: DatabaseClient, stripeEventId: string): Promise<Record<string, unknown> | null> {
  return db.fetchrow(
    `
      SELECT stripe_event_id, processed_at
      FROM stripe_events
      WHERE stripe_event_id = $1
    `,
    stripeEventId
  );
}

async function insertLoggedEvent(
  db: DatabaseClient,
  stripeEventId: string,
  eventType: string,
  payload: string
): Promise<Record<string, unknown> | null> {
  return db.fetchrow(
    `
      INSERT INTO stripe_events (stripe_event_id, event_type, payload)
      VALUES ($1, $2, $3)
      ON CONFLICT (stripe_event_id) DO NOTHING
      RETURNING stripe_event_id, processed_at
    `,
    stripeEventId,
    eventType,
    payload
  );
}

async function markEventProcessed(db: DatabaseClient, stripeEventId: string): Promise<void> {
  await db.execute(
    `
      UPDATE stripe_events
      SET processed_at = NOW()
      WHERE stripe_event_id = $1
    `,
    stripeEventId
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value != null ? value as Record<string, unknown> : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asInteger(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(Math.trunc(parsed), 0) : 0;
}

function stripeCreatedAt(value: unknown): Date | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return new Date(parsed * 1000);
}

function sumDiscounts(value: unknown): number {
  if (!Array.isArray(value)) {
    return 0;
  }
  return value.reduce((sum, item) => sum + asInteger(asRecord(item).amount), 0);
}

function extractInvoicePeriod(invoice: Record<string, unknown>): { periodStart: string; periodEnd: string } {
  const lines = Array.isArray(asRecord(invoice.lines).data) ? asRecord(invoice.lines).data as unknown[] : [];
  const firstLine = lines.find((line) => typeof line === "object" && line != null) as Record<string, unknown> | undefined;
  const period = firstLine ? asRecord(firstLine.period) : {};
  const startSeconds = Number(period.start);
  const endSeconds = Number(period.end);
  const createdAt = stripeCreatedAt(invoice.created) ?? new Date();

  if (Number.isFinite(startSeconds) && Number.isFinite(endSeconds)) {
    const periodStart = new Date(startSeconds * 1000).toISOString().slice(0, 10);
    const periodEnd = new Date(Math.max(endSeconds * 1000 - 1000, startSeconds * 1000)).toISOString().slice(0, 10);
    return { periodStart, periodEnd };
  }

  const year = createdAt.getUTCFullYear();
  const month = createdAt.getUTCMonth();
  const periodStart = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
  const periodEnd = new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10);
  return { periodStart, periodEnd };
}

function isCheckoutComplete(checkoutSession: Record<string, unknown>): boolean {
  return asString(checkoutSession.status) === "complete";
}

function isPaymentCheckoutPaid(checkoutSession: Record<string, unknown>): boolean {
  return asString(checkoutSession.payment_status) === "paid";
}

function isSubscriptionCheckoutReady(checkoutSession: Record<string, unknown>): boolean {
  const paymentStatus = asString(checkoutSession.payment_status);
  return paymentStatus === "paid" || paymentStatus === "no_payment_required";
}

async function processStripeEvent(db: DatabaseClient, config: any, event: Record<string, unknown>): Promise<void> {
  const eventType = String(event.type ?? "");
  const eventObject = asRecord(asRecord(event.data).object);

  if (eventType === "checkout.session.completed" || eventType === "checkout.session.async_payment_succeeded") {
    const metadata = asRecord(eventObject.metadata);
    const mode = asString(eventObject.mode) ?? "";
    if (mode === "setup") {
      if (!isCheckoutComplete(eventObject)) {
        return;
      }
      const stripeCustomerId = asString(eventObject.customer);
      if (!stripeCustomerId) {
        return;
      }
      await db.execute(
        `
          UPDATE user_profiles
          SET
              has_payment_method_on_file = TRUE,
              updated_at = NOW()
          WHERE stripe_customer_id = $1
        `,
        stripeCustomerId
      );
      return;
    }

    const userId = asString(metadata.user_id) ?? asString(eventObject.client_reference_id);
    if (!userId) {
      return;
    }

    if (mode === "subscription") {
      if (!isCheckoutComplete(eventObject) || !isSubscriptionCheckoutReady(eventObject)) {
        return;
      }
      await activateCheckoutSubscription(
        db,
        userId,
        asString(eventObject.customer),
        asString(eventObject.subscription)
      );
      await db.execute(
        `
          UPDATE user_profiles
          SET
              has_payment_method_on_file = TRUE,
              updated_at = NOW()
          WHERE id = $1
        `,
        userId
      );
      return;
    }

    if (mode === "payment") {
      if (!isPaymentCheckoutPaid(eventObject)) {
        return;
      }
      const quantity = Number(metadata.quantity) || 1000;
      const notification = await fulfillTopupCheckout(db, {
        userId,
        credits: quantity,
        stripeCheckoutSessionId: String(eventObject.id ?? ""),
        stripeCustomerId: asString(eventObject.customer),
        stripePaymentIntentId: asString(eventObject.payment_intent),
        currency: asString(eventObject.currency),
        grossAmountCents: asInteger(eventObject.amount_subtotal ?? eventObject.amount_total),
        discountAmountCents: asInteger(asRecord(eventObject.total_details).amount_discount),
        netAmountCents: asInteger(eventObject.amount_total),
        occurredAt: stripeCreatedAt(eventObject.created)
      });
      if (notification) {
        void sendBillingNotification(config, notification).catch((error) => {
          console.error("[billing] Failed to send top-up email:", error);
        });
      }
    }
    return;
  }

  if (eventType === "invoice.paid") {
    const stripeCustomerId = asString(eventObject.customer);
    if (!stripeCustomerId) {
      return;
    }
    await db.execute(
      `
        UPDATE user_profiles
        SET
            has_payment_method_on_file = TRUE,
            updated_at = NOW()
        WHERE stripe_customer_id = $1
      `,
      stripeCustomerId
    );
    await syncSubscriptionStatus(db, stripeCustomerId, {
      id: asString(eventObject.subscription),
      status: "active"
    });
    const { periodStart, periodEnd } = extractInvoicePeriod(eventObject);
    const notification = await fulfillSubscriptionInvoice(db, {
      stripeInvoiceId: String(eventObject.id ?? ""),
      stripeCustomerId,
      stripeSubscriptionId: asString(eventObject.subscription),
      stripePaymentIntentId: asString(eventObject.payment_intent),
      currency: asString(eventObject.currency),
      grossAmountCents: asInteger(eventObject.subtotal ?? eventObject.amount_due ?? eventObject.amount_paid),
      discountAmountCents: sumDiscounts(eventObject.total_discount_amounts),
      netAmountCents: asInteger(eventObject.amount_paid ?? eventObject.amount_due),
      periodStart,
      periodEnd,
      occurredAt: stripeCreatedAt(eventObject.created),
      metadata: {
        billing_reason: asString(eventObject.billing_reason)
      }
    });
    if (notification) {
      void sendBillingNotification(config, notification).catch((error) => {
        console.error("[billing] Failed to send subscription email:", error);
      });
    }
    return;
  }

  if (eventType === "invoice.payment_failed") {
    const stripeCustomerId = asString(eventObject.customer);
    if (!stripeCustomerId) {
      return;
    }
    await recordFailedInvoice(db, {
      stripeInvoiceId: String(eventObject.id ?? ""),
      stripeCustomerId,
      stripeSubscriptionId: asString(eventObject.subscription),
      stripePaymentIntentId: asString(eventObject.payment_intent),
      currency: asString(eventObject.currency),
      grossAmountCents: asInteger(eventObject.subtotal ?? eventObject.amount_due),
      discountAmountCents: sumDiscounts(eventObject.total_discount_amounts),
      netAmountCents: asInteger(eventObject.amount_due),
      metadata: {
        billing_reason: asString(eventObject.billing_reason)
      }
    });
    return;
  }

  if (eventType === "customer.subscription.deleted" || eventType === "customer.subscription.updated") {
    const stripeCustomerId = asString(eventObject.customer);
    if (!stripeCustomerId) {
      return;
    }
    await syncSubscriptionStatus(db, stripeCustomerId, eventObject);
    return;
  }

  if (eventType === "payment_intent.succeeded") {
    const metadata = asRecord(eventObject.metadata);
    if (asString(metadata.type) === "auto_recharge") {
      const userId = asString(metadata.user_id);
      const quantity = Number(metadata.quantity) || 1000;
      if (userId) {
        const amount = asInteger(eventObject.amount_received ?? eventObject.amount);
        const notification = await fulfillAutoRechargePayment(db, {
          userId,
          stripePaymentIntentId: String(eventObject.id ?? ""),
          stripeCustomerId: asString(eventObject.customer),
          quantity,
          currency: asString(eventObject.currency),
          grossAmountCents: amount,
          discountAmountCents: 0,
          netAmountCents: amount,
          occurredAt: stripeCreatedAt(eventObject.created)
        });
        if (notification) {
          void sendBillingNotification(config, notification).catch((error) => {
            console.error("[billing] Failed to send auto-recharge email:", error);
          });
        }
      }
    }
    return;
  }

  if (eventType === "charge.refunded") {
    const paymentIntentId = asString(eventObject.payment_intent);
    if (paymentIntentId) {
      await reverseBillingOrderByPaymentIntent(db, paymentIntentId, "refunded");
    }
    return;
  }

  if (eventType === "charge.dispute.created" || eventType === "charge.dispute.funds_withdrawn") {
    const paymentIntentId = asString(asRecord(eventObject.payment_intent).id) ?? asString(eventObject.payment_intent);
    if (paymentIntentId) {
      await reverseBillingOrderByPaymentIntent(db, paymentIntentId, "disputed");
    }
  }
}

export function createWebhookRouter(): any {
  const router = new Hono();

  router.post("/stripe", async (c: any) => {
    const db = c.get("db") as DatabaseClient;
    const config = c.get("config");
    const payload = await c.req.raw.text();
    let event: Record<string, unknown>;
    try {
      event = constructWebhookEvent(config, payload, c.req.header("stripe-signature") ?? null);
    } catch (error) {
      if (error instanceof StripeWebhookVerificationError) {
        apiError(400, error.message);
      }
      throw error;
    }

    const stripeEventId = String(event.id ?? "").trim();
    const eventType = String(event.type ?? "").trim();
    if (!stripeEventId || !eventType) {
      apiError(400, "Stripe event is missing required identifiers.");
    }

    const existing = await fetchLoggedEvent(db, stripeEventId);
    if (existing?.processed_at != null) {
      return c.json({ status: "duplicate", duplicate: true });
    }

    return db.transaction(async (tx) => {
      const inserted = await insertLoggedEvent(tx, stripeEventId, eventType, payload);
      if (inserted == null) {
        const lockedEvent = await tx.fetchrow(
          `SELECT stripe_event_id, processed_at FROM stripe_events WHERE stripe_event_id = $1 FOR UPDATE`,
          stripeEventId
        );
        if (lockedEvent?.processed_at != null) {
          return c.json({ status: "duplicate", duplicate: true });
        }
      }

      try {
        await processStripeEvent(tx, config, event);
      } catch (error) {
        if (error instanceof StripeServiceError) {
          apiError(409, error.message);
        }
        throw error;
      }

      await markEventProcessed(tx, stripeEventId);
      return c.json({ status: "ok", duplicate: false });
    });
  });

  return router;
}
