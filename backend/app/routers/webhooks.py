"""Webhook endpoints for provider callbacks."""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any, Mapping, cast

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel

from ..billing import stripe_service
from ..db import get_db

router = APIRouter(prefix="/webhooks", tags=["webhooks"])


class StripeWebhookResponse(BaseModel):
    status: str
    duplicate: bool = False


def _record_to_dict(record: Any | None) -> dict[str, Any] | None:
    if record is None:
        return None
    if isinstance(record, Mapping):
        return dict(record)
    return cast(dict[str, Any], dict(record))


@asynccontextmanager
async def transaction_scope(db: Any):
    transaction = getattr(db, "transaction", None)
    if transaction is None:
        yield
        return

    async with transaction():
        yield


async def fetch_logged_event(
    db: Any,
    stripe_event_id: str,
    *,
    for_update: bool = False,
) -> dict[str, Any] | None:
    lock_clause = " FOR UPDATE" if for_update else ""
    row = await db.fetchrow(
        f"""
        SELECT stripe_event_id, processed_at
        FROM stripe_events
        WHERE stripe_event_id = $1
        {lock_clause}
        """,
        stripe_event_id,
    )
    return _record_to_dict(row)


async def insert_logged_event(
    db: Any,
    *,
    stripe_event_id: str,
    event_type: str,
    payload: str,
) -> dict[str, Any] | None:
    row = await db.fetchrow(
        """
        INSERT INTO stripe_events (stripe_event_id, event_type, payload)
        VALUES ($1, $2, $3)
        ON CONFLICT (stripe_event_id) DO NOTHING
        RETURNING stripe_event_id, processed_at
        """,
        stripe_event_id,
        event_type,
        payload,
    )
    return _record_to_dict(row)


async def mark_event_processed(db: Any, stripe_event_id: str) -> None:
    await db.execute(
        """
        UPDATE stripe_events
        SET processed_at = NOW()
        WHERE stripe_event_id = $1
        """,
        stripe_event_id,
    )


async def process_stripe_event(db: Any, event: Mapping[str, Any]) -> None:
    event_type = str(event.get("type") or "")
    event_object = cast(
        dict[str, Any],
        ((event.get("data") or {}).get("object") or {}),
    )

    if event_type == "checkout.session.completed":
        metadata = cast(dict[str, Any], event_object.get("metadata") or {})
        user_id = cast(str | None, metadata.get("user_id") or event_object.get("client_reference_id"))
        if not user_id:
            return

        await stripe_service.activate_checkout_subscription(
            db,
            user_id=user_id,
            stripe_customer_id=cast(str | None, event_object.get("customer")),
            subscription_id=cast(str | None, event_object.get("subscription")),
        )
        return

    if event_type in {"customer.subscription.deleted", "customer.subscription.updated"}:
        stripe_customer_id = cast(str | None, event_object.get("customer"))
        if not stripe_customer_id:
            return

        await stripe_service.sync_subscription_status(
            db,
            stripe_customer_id,
            event_object,
        )


@router.post("/stripe", response_model=StripeWebhookResponse)
async def handle_stripe_webhook(
    request: Request,
    db: Any = Depends(get_db),
) -> StripeWebhookResponse:
    payload = await request.body()

    try:
        event = stripe_service.construct_webhook_event(
            payload,
            request.headers.get("Stripe-Signature"),
        )
    except stripe_service.StripeWebhookVerificationError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    stripe_event_id = cast(str | None, event.get("id"))
    event_type = cast(str | None, event.get("type"))
    if not stripe_event_id or not event_type:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Stripe event is missing required identifiers.",
        )

    existing = await fetch_logged_event(db, stripe_event_id)
    if existing and existing.get("processed_at") is not None:
        return StripeWebhookResponse(status="duplicate", duplicate=True)

    async with transaction_scope(db):
        inserted = await insert_logged_event(
            db,
            stripe_event_id=stripe_event_id,
            event_type=event_type,
            payload=payload.decode("utf-8"),
        )
        if inserted is None:
            locked_event = await fetch_logged_event(
                db,
                stripe_event_id,
                for_update=True,
            )
            if locked_event and locked_event.get("processed_at") is not None:
                return StripeWebhookResponse(status="duplicate", duplicate=True)

        try:
            await process_stripe_event(db, event)
        except stripe_service.StripeServiceError as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=str(exc),
            ) from exc

        await mark_event_processed(db, stripe_event_id)

    return StripeWebhookResponse(status="ok", duplicate=False)
