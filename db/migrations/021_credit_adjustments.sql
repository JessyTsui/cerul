BEGIN;

ALTER TABLE user_profiles
    ALTER COLUMN monthly_credit_limit SET DEFAULT 300;

ALTER TABLE user_profiles
    ADD COLUMN IF NOT EXISTS has_payment_method_on_file BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE api_keys
    ADD COLUMN IF NOT EXISTS raw_key TEXT;

UPDATE user_profiles
SET monthly_credit_limit = 300
WHERE tier = 'free';

UPDATE user_profiles
SET has_payment_method_on_file = TRUE
WHERE stripe_subscription_id IS NOT NULL
   OR EXISTS (
       SELECT 1
       FROM billing_orders
       WHERE billing_orders.user_id = user_profiles.id
         AND billing_orders.order_kind = 'subscription'
         AND billing_orders.status = 'paid'
         AND billing_orders.stripe_customer_id IS NOT NULL
   );

COMMIT;
