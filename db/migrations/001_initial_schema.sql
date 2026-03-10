BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE user_profiles (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE,
    display_name TEXT,
    tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'builder', 'pro', 'enterprise')),
    monthly_credit_limit INTEGER NOT NULL DEFAULT 1000 CHECK (monthly_credit_limit >= 0),
    rate_limit_per_sec INTEGER NOT NULL DEFAULT 1 CHECK (rate_limit_per_sec >= 0),
    stripe_customer_id TEXT UNIQUE,
    stripe_subscription_id TEXT UNIQUE,
    billing_email TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_profiles_tier ON user_profiles (tier);

CREATE TABLE api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE,
    prefix TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_api_keys_user_created_at ON api_keys (user_id, created_at DESC);
CREATE INDEX idx_api_keys_active_user ON api_keys (user_id) WHERE is_active = TRUE;

CREATE TABLE usage_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id TEXT NOT NULL UNIQUE,
    user_id TEXT NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    api_key_id UUID REFERENCES api_keys(id) ON DELETE SET NULL,
    search_type TEXT NOT NULL CHECK (search_type IN ('broll', 'knowledge')),
    include_answer BOOLEAN NOT NULL DEFAULT FALSE,
    credits_used INTEGER NOT NULL CHECK (credits_used >= 0),
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_usage_events_user_occurred_at ON usage_events (user_id, occurred_at DESC);
CREATE INDEX idx_usage_events_api_key_occurred_at ON usage_events (api_key_id, occurred_at DESC);

CREATE TABLE usage_monthly (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    credits_limit INTEGER NOT NULL CHECK (credits_limit >= 0),
    credits_used INTEGER NOT NULL DEFAULT 0 CHECK (credits_used >= 0),
    request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, period_start),
    CHECK (period_end >= period_start)
);

CREATE INDEX idx_usage_monthly_user_period ON usage_monthly (user_id, period_start DESC);

CREATE TABLE stripe_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stripe_event_id TEXT NOT NULL UNIQUE,
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    processed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_stripe_events_type_created_at ON stripe_events (event_type, created_at DESC);

CREATE TABLE query_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id TEXT NOT NULL UNIQUE,
    user_id TEXT NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    api_key_id UUID REFERENCES api_keys(id) ON DELETE SET NULL,
    search_type TEXT NOT NULL CHECK (search_type IN ('broll', 'knowledge')),
    query_text TEXT NOT NULL,
    filters JSONB NOT NULL DEFAULT '{}'::JSONB,
    max_results INTEGER NOT NULL CHECK (max_results > 0),
    include_answer BOOLEAN NOT NULL DEFAULT FALSE,
    result_count INTEGER NOT NULL DEFAULT 0 CHECK (result_count >= 0),
    latency_ms INTEGER CHECK (latency_ms >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_query_logs_user_created_at ON query_logs (user_id, created_at DESC);
CREATE INDEX idx_query_logs_search_type_created_at ON query_logs (search_type, created_at DESC);

CREATE TABLE content_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug TEXT NOT NULL UNIQUE,
    track TEXT NOT NULL CHECK (track IN ('broll', 'knowledge', 'shared')),
    display_name TEXT NOT NULL,
    base_url TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_content_sources_track_active ON content_sources (track, is_active);

CREATE TABLE processing_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    track TEXT NOT NULL CHECK (track IN ('broll', 'knowledge')),
    source_id UUID REFERENCES content_sources(id) ON DELETE SET NULL,
    job_type TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed')),
    input_payload JSONB NOT NULL DEFAULT '{}'::JSONB,
    error_message TEXT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_processing_jobs_track_status_created_at
    ON processing_jobs (track, status, created_at DESC);
CREATE INDEX idx_processing_jobs_source_status ON processing_jobs (source_id, status);

CREATE TABLE processing_job_steps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES processing_jobs(id) ON DELETE CASCADE,
    step_name TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped')),
    artifacts JSONB NOT NULL DEFAULT '{}'::JSONB,
    error_message TEXT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (job_id, step_name)
);

CREATE INDEX idx_processing_job_steps_job_status
    ON processing_job_steps (job_id, status, created_at DESC);

CREATE TABLE broll_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source TEXT NOT NULL,
    source_asset_id TEXT NOT NULL,
    source_url TEXT,
    video_url TEXT NOT NULL,
    thumbnail_url TEXT,
    duration_seconds INTEGER CHECK (duration_seconds >= 0),
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    tags TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
    license TEXT,
    creator TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    embedding VECTOR(512),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (source, source_asset_id)
);

CREATE INDEX idx_broll_assets_source_duration ON broll_assets (source, duration_seconds);
CREATE INDEX idx_broll_assets_tags ON broll_assets USING GIN (tags);
CREATE INDEX idx_broll_assets_embedding
    ON broll_assets USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

CREATE TABLE knowledge_videos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source TEXT NOT NULL,
    source_video_id TEXT NOT NULL,
    source_url TEXT,
    video_url TEXT NOT NULL,
    thumbnail_url TEXT,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    speaker TEXT,
    published_at TIMESTAMPTZ,
    duration_seconds INTEGER CHECK (duration_seconds >= 0),
    license TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (source, source_video_id)
);

CREATE INDEX idx_knowledge_videos_source_published_at
    ON knowledge_videos (source, published_at DESC);
CREATE INDEX idx_knowledge_videos_speaker_published_at
    ON knowledge_videos (speaker, published_at DESC);

CREATE TABLE knowledge_segments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    video_id UUID NOT NULL REFERENCES knowledge_videos(id) ON DELETE CASCADE,
    segment_index INTEGER NOT NULL CHECK (segment_index >= 0),
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    transcript_text TEXT NOT NULL,
    visual_summary TEXT,
    timestamp_start DOUBLE PRECISION NOT NULL CHECK (timestamp_start >= 0),
    timestamp_end DOUBLE PRECISION NOT NULL CHECK (timestamp_end >= timestamp_start),
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    embedding VECTOR(1536),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (video_id, segment_index)
);

CREATE INDEX idx_knowledge_segments_video_timestamp
    ON knowledge_segments (video_id, timestamp_start);
CREATE INDEX idx_knowledge_segments_embedding
    ON knowledge_segments USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

COMMIT;
