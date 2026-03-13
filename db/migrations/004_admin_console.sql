BEGIN;

ALTER TABLE user_profiles
    ADD COLUMN IF NOT EXISTS console_role TEXT;

UPDATE user_profiles
SET console_role = 'user'
WHERE console_role IS NULL OR btrim(console_role) = '';

ALTER TABLE user_profiles
    ALTER COLUMN console_role SET DEFAULT 'user';

ALTER TABLE user_profiles
    ALTER COLUMN console_role SET NOT NULL;

ALTER TABLE user_profiles
    DROP CONSTRAINT IF EXISTS user_profiles_console_role_check;

ALTER TABLE user_profiles
    ADD CONSTRAINT user_profiles_console_role_check
    CHECK (console_role IN ('user', 'operator', 'admin'));

CREATE INDEX IF NOT EXISTS idx_user_profiles_console_role
    ON user_profiles (console_role);

CREATE TABLE IF NOT EXISTS admin_metric_targets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    metric_name TEXT NOT NULL,
    scope_type TEXT NOT NULL DEFAULT 'global',
    scope_key TEXT NOT NULL DEFAULT '',
    range_key TEXT NOT NULL DEFAULT '7d',
    comparison_mode TEXT NOT NULL DEFAULT 'at_least',
    target_value DOUBLE PRECISION NOT NULL CHECK (target_value >= 0),
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE admin_metric_targets
    DROP CONSTRAINT IF EXISTS admin_metric_targets_scope_type_check;

ALTER TABLE admin_metric_targets
    ADD CONSTRAINT admin_metric_targets_scope_type_check
    CHECK (scope_type IN ('global', 'track', 'source'));

ALTER TABLE admin_metric_targets
    DROP CONSTRAINT IF EXISTS admin_metric_targets_range_key_check;

ALTER TABLE admin_metric_targets
    ADD CONSTRAINT admin_metric_targets_range_key_check
    CHECK (range_key IN ('today', '7d', '30d'));

ALTER TABLE admin_metric_targets
    DROP CONSTRAINT IF EXISTS admin_metric_targets_comparison_mode_check;

ALTER TABLE admin_metric_targets
    ADD CONSTRAINT admin_metric_targets_comparison_mode_check
    CHECK (comparison_mode IN ('at_least', 'at_most'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_metric_targets_metric_scope
    ON admin_metric_targets (metric_name, scope_type, scope_key, range_key);

CREATE INDEX IF NOT EXISTS idx_admin_metric_targets_scope
    ON admin_metric_targets (scope_type, scope_key, metric_name);

CREATE INDEX IF NOT EXISTS idx_query_logs_created_at
    ON query_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_usage_events_occurred_at
    ON usage_events (occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_processing_jobs_status_updated_at
    ON processing_jobs (status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_processing_jobs_source_created_at
    ON processing_jobs (source_id, created_at DESC);

COMMIT;
