BEGIN;

ALTER TABLE user_profiles
    ADD COLUMN IF NOT EXISTS billing_hold BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE user_profiles
    DROP CONSTRAINT IF EXISTS user_profiles_tier_check;

ALTER TABLE user_profiles
    ADD CONSTRAINT user_profiles_tier_check
    CHECK (tier IN ('free', 'monthly', 'builder', 'pro', 'enterprise'));

CREATE TABLE IF NOT EXISTS billing_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    order_kind TEXT NOT NULL CHECK (order_kind IN ('subscription', 'topup')),
    product_code TEXT NOT NULL,
    plan_code TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'failed', 'refunded', 'disputed', 'needs_review')),
    currency TEXT NOT NULL DEFAULT 'usd',
    gross_amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (gross_amount_cents >= 0),
    discount_amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (discount_amount_cents >= 0),
    net_amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (net_amount_cents >= 0),
    credits_granted INTEGER NOT NULL DEFAULT 0 CHECK (credits_granted >= 0),
    stripe_checkout_session_id TEXT UNIQUE,
    stripe_invoice_id TEXT UNIQUE,
    stripe_payment_intent_id TEXT,
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    fulfilled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_billing_orders_user_created_at
    ON billing_orders (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_billing_orders_customer_created_at
    ON billing_orders (stripe_customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_billing_orders_payment_intent
    ON billing_orders (stripe_payment_intent_id);

CREATE TABLE IF NOT EXISTS referral_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL UNIQUE REFERENCES user_profiles(id) ON DELETE CASCADE,
    code TEXT NOT NULL UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_referral_codes_code_active
    ON referral_codes (code, is_active);

CREATE TABLE IF NOT EXISTS referral_redemptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    referral_code_id UUID NOT NULL REFERENCES referral_codes(id) ON DELETE CASCADE,
    referrer_user_id TEXT NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    referee_user_id TEXT NOT NULL UNIQUE REFERENCES user_profiles(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('pending', 'awarded', 'reversed')),
    first_paid_order_id UUID REFERENCES billing_orders(id) ON DELETE SET NULL,
    first_paid_at TIMESTAMPTZ,
    reward_ready_at TIMESTAMPTZ,
    awarded_at TIMESTAMPTZ,
    reversed_at TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_referral_redemptions_referrer_status
    ON referral_redemptions (referrer_user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_referral_redemptions_reward_ready
    ON referral_redemptions (status, reward_ready_at);

CREATE TABLE IF NOT EXISTS credit_grants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    billing_order_id UUID REFERENCES billing_orders(id) ON DELETE SET NULL,
    referral_redemption_id UUID REFERENCES referral_redemptions(id) ON DELETE SET NULL,
    grant_key TEXT UNIQUE,
    grant_type TEXT NOT NULL CHECK (grant_type IN ('free_monthly', 'subscription_monthly', 'paid_topup', 'promo_bonus', 'referral_bonus', 'manual_adjustment')),
    plan_code TEXT,
    total_credits INTEGER NOT NULL CHECK (total_credits >= 0),
    remaining_credits INTEGER NOT NULL CHECK (remaining_credits >= 0),
    expires_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'reversed', 'expired')),
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (remaining_credits <= total_credits)
);

CREATE INDEX IF NOT EXISTS idx_credit_grants_user_active_expiry
    ON credit_grants (user_id, status, expires_at, created_at);

CREATE INDEX IF NOT EXISTS idx_credit_grants_order
    ON credit_grants (billing_order_id);

CREATE TABLE IF NOT EXISTS credit_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    grant_id UUID REFERENCES credit_grants(id) ON DELETE SET NULL,
    billing_order_id UUID REFERENCES billing_orders(id) ON DELETE SET NULL,
    request_id TEXT,
    kind TEXT NOT NULL CHECK (kind IN ('grant', 'debit', 'refund', 'reversal', 'expire', 'manual_adjustment')),
    amount INTEGER NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_transactions_user_created_at
    ON credit_transactions (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_credit_transactions_request_kind
    ON credit_transactions (request_id, kind);

COMMIT;
