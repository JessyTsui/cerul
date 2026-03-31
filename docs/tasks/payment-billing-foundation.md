# Payment Billing Foundation

## Summary

Cerul now uses a credits-based billing model across the public API, dashboard, pricing page, and API docs.

Public packaging:

- `Free`: 1,000 included credits per month
- `Monthly`: $30/month with 5,000 included credits
- `Top-up 1,000`: $8 one-time
- `Top-up 5,000`: $36 one-time
- `Top-up 20,000`: $120 one-time
- `Enterprise`: custom

Consumption rules:

- standard search: `1 credit`
- `include_answer=true`: `2 credits`
- spend order: bonus credits -> current included credits -> paid top-ups
- no automatic postpaid overage in v1

## Why This Exists

The previous implementation mixed marketing tiers with a much narrower backend model:

- pricing pages described `Pay as you go` and `Monthly`
- backend Stripe config only supported one subscription price
- usage accounting was still modeled as a single monthly limit
- there was no internal ledger for top-ups, promo-driven grants, or referrals

This foundation moves Cerul to a ledger-backed billing system while keeping Stripe responsible only for payment collection, subscription lifecycle, and discount handling.

## What Changed

### Catalog and plan model

- public-facing plan codes are now `free`, `monthly`, and `enterprise`
- legacy `builder` and `pro` remain readable aliases for compatibility, but new flows normalize to `monthly`
- billing products are catalog-driven instead of hardcoded around a single subscription

### Internal billing ledger

New tables:

- `billing_orders`
- `credit_grants`
- `credit_transactions`
- `referral_codes`
- `referral_redemptions`

New rules:

- included monthly credits expire at the current billing period end
- promo and referral bonus credits expire after 90 days
- paid top-up credits expire after 12 months
- expired grants are zeroed before balance calculations
- refunds and disputes reverse remaining grant balance and can place the user under `billing_hold`

### Stripe responsibilities

Stripe is used for:

- subscription checkout
- one-time top-up checkout
- promotion code application
- customer portal
- payment lifecycle webhooks

Cerul is responsible for:

- internal credit balances
- grant creation and spending
- referral ownership and reward timing
- refund/dispute reconciliation rules

### Referral model

- each user gets one Cerul referral code
- a user can redeem only one referral code
- self-referral is blocked
- rewards only become eligible after the first paid order with net amount `> 0`
- rewards are granted after a 7-day wait window
- inviter and invitee each receive `500` bonus credits

## API and Dashboard Changes

### New dashboard endpoints

- `GET /dashboard/billing/catalog`
- `POST /dashboard/billing/checkout`
- `POST /dashboard/billing/referrals/redeem`

### Updated responses

`GET /v1/usage` and dashboard usage payloads now expose:

- `plan_code`
- `wallet_balance`
- `credit_breakdown`
- `expiring_credits`
- `billing_hold`

The dashboard settings and usage screens now separate:

- included monthly credits
- paid top-up balance
- bonus/referral balance

## Stripe Event Handling

Handled webhook categories:

- `checkout.session.completed`
- `invoice.paid`
- `invoice.payment_failed`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `charge.refunded`
- dispute events that imply charge withdrawal

The implementation remains idempotent by reusing `stripe_events` as the event processing ledger.

## Configuration

Required billing environment variables:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_MONTHLY_PRICE_ID`
- `STRIPE_TOPUP_1000_PRICE_ID`
- `STRIPE_TOPUP_5000_PRICE_ID`
- `STRIPE_TOPUP_20000_PRICE_ID`

These are wired through:

- `.env.example`
- `api/src/config.ts`
- `api/wrangler.toml`
- `scripts/dev.sh`
- `workers/common/config/settings.py`

## Implementation Outline

### 1. Database

Run the new migration:

- `db/migrations/013_billing_foundation.sql`

This creates the billing ledger tables and extends `user_profiles` with `billing_hold` while broadening tier compatibility.

### 2. Backend services

Core billing logic lives in:

- `api/src/services/billing-catalog.ts`
- `api/src/services/billing.ts`
- `api/src/services/stripe.ts`

Responsibilities:

- product catalog and plan normalization
- credit grant creation and spend ordering
- wallet balance calculation
- referral issuance and reward scheduling
- Stripe checkout session construction
- subscription status syncing

### 3. Routes

Updated routes:

- `api/src/routes/dashboard.ts`
- `api/src/routes/usage.ts`
- `api/src/routes/search.ts`
- `api/src/routes/webhooks.ts`
- `api/src/middleware/auth.ts`

Responsibilities:

- use wallet balance instead of only monthly usage rows
- expose catalog and referral flows
- block requests when no spendable credits remain
- keep search refunds best-effort and idempotent

### 4. Frontend

Updated surfaces:

- `frontend/app/pricing/page.tsx`
- `frontend/components/dashboard/settings-screen.tsx`
- `frontend/components/dashboard/usage-screen.tsx`
- `frontend/components/dashboard/overview-screen.tsx`
- `frontend/lib/api.ts`
- `frontend/lib/site.ts`
- `frontend/lib/docs.ts`

Responsibilities:

- present credits as the single billing unit
- show top-up products separately from plans
- display wallet breakdown and expiring credits
- allow referral redemption from settings

### 5. Docs

Updated public docs:

- pricing copy
- usage examples
- search response wording
- API reference usage payload examples

## Rollout Checklist

1. Apply database migration `013_billing_foundation.sql`.
2. Create the Stripe prices for monthly and top-up products.
3. Set the new Stripe price environment variables in every environment.
4. Point Stripe webhooks at the deployed API.
5. Validate end-to-end in Stripe test mode:
   - monthly checkout
   - monthly renewal via `invoice.paid`
   - top-up checkout
   - promotion code discount
   - referral redemption and delayed reward
   - refund and dispute handling
6. Confirm the dashboard shows the correct wallet breakdown after each scenario.

## Validation

Local validation used for this change:

- `npm --prefix api run check`
- `pnpm --dir frontend exec tsc --noEmit`
- `pnpm --dir frontend test`

## Notes

- Referral rewards are granted lazily when billing flows run after the 7-day wait window, instead of requiring a dedicated scheduler in v1.
- Postpaid overage is intentionally out of scope for this version. When wallet balance reaches zero, requests are blocked until the user tops up or receives a new monthly grant.
