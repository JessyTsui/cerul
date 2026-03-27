import { Hono } from "hono";

import type { DatabaseClient } from "../db/client";
import { activateCheckoutSubscription, constructWebhookEvent, StripeServiceError, StripeWebhookVerificationError, syncSubscriptionStatus } from "../services/stripe";
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

async function processStripeEvent(db: DatabaseClient, event: Record<string, unknown>): Promise<void> {
  const eventType = String(event.type ?? "");
  const eventObject = (event.data as any)?.object ?? {};

  if (eventType === "checkout.session.completed") {
    const metadata = eventObject.metadata ?? {};
    const userId = String(metadata.user_id ?? eventObject.client_reference_id ?? "").trim();
    if (!userId) {
      return;
    }
    await activateCheckoutSubscription(
      db,
      userId,
      eventObject.customer == null ? null : String(eventObject.customer),
      eventObject.subscription == null ? null : String(eventObject.subscription)
    );
    return;
  }

  if (eventType === "customer.subscription.deleted" || eventType === "customer.subscription.updated") {
    const stripeCustomerId = String(eventObject.customer ?? "").trim();
    if (!stripeCustomerId) {
      return;
    }
    await syncSubscriptionStatus(db, stripeCustomerId, eventObject);
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
        await processStripeEvent(tx, event);
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
