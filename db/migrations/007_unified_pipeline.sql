BEGIN;

CREATE TABLE IF NOT EXISTS videos (
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
    creator TEXT,
    has_captions BOOLEAN NOT NULL DEFAULT FALSE,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (source, source_video_id)
);

CREATE INDEX IF NOT EXISTS idx_videos_source_published
    ON videos (source, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_videos_duration
    ON videos (duration_seconds);

CREATE TABLE IF NOT EXISTS retrieval_units (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    video_id UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    unit_type TEXT NOT NULL CHECK (unit_type IN ('summary', 'speech', 'visual')),
    unit_index INTEGER NOT NULL DEFAULT 0 CHECK (unit_index >= 0),
    timestamp_start DOUBLE PRECISION,
    timestamp_end DOUBLE PRECISION,
    content_text TEXT NOT NULL,
    transcript TEXT,
    visual_desc TEXT,
    visual_type TEXT,
    keyframe_url TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    embedding VECTOR(3072) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (video_id, unit_type, unit_index),
    CHECK (
        timestamp_start IS NULL
        OR timestamp_end IS NULL
        OR timestamp_end >= timestamp_start
    )
);

CREATE INDEX IF NOT EXISTS idx_ru_video ON retrieval_units (video_id);
CREATE INDEX IF NOT EXISTS idx_ru_unit_type ON retrieval_units (unit_type);

CREATE TABLE IF NOT EXISTS video_access (
    video_id UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    owner_id TEXT REFERENCES user_profiles(id) ON DELETE CASCADE,
    owner_scope TEXT GENERATED ALWAYS AS (COALESCE(owner_id, '__public__')) STORED,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (video_id, owner_scope)
);

CREATE INDEX IF NOT EXISTS idx_video_access_owner ON video_access (owner_id);

CREATE TABLE IF NOT EXISTS tracking_links (
    short_id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL,
    result_rank SMALLINT NOT NULL CHECK (result_rank >= 0),
    unit_id UUID NOT NULL REFERENCES retrieval_units(id) ON DELETE CASCADE,
    video_id UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    target_url TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tracking_links_request
    ON tracking_links (request_id);

CREATE TABLE IF NOT EXISTS tracking_events (
    id BIGSERIAL PRIMARY KEY,
    short_id TEXT NOT NULL REFERENCES tracking_links(short_id) ON DELETE CASCADE,
    event_type TEXT NOT NULL CHECK (
        event_type IN ('redirect', 'page_view', 'outbound_click')
    ),
    request_id TEXT,
    result_rank SMALLINT,
    unit_id UUID,
    video_id UUID,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    referrer TEXT,
    user_agent TEXT,
    ip_hash TEXT
);

CREATE INDEX IF NOT EXISTS idx_tracking_events_short
    ON tracking_events (short_id);
CREATE INDEX IF NOT EXISTS idx_tracking_events_request
    ON tracking_events (request_id);
CREATE INDEX IF NOT EXISTS idx_tracking_events_video_time
    ON tracking_events (video_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_tracking_events_event_type
    ON tracking_events (event_type, occurred_at DESC);

ALTER TABLE usage_events
    ALTER COLUMN search_type DROP NOT NULL;
ALTER TABLE usage_events
    DROP CONSTRAINT IF EXISTS usage_events_search_type_check;
ALTER TABLE usage_events
    ADD CONSTRAINT usage_events_search_type_check
    CHECK (
        search_type IS NULL
        OR search_type IN ('broll', 'knowledge', 'unified')
    );

ALTER TABLE query_logs
    ALTER COLUMN search_type DROP NOT NULL;
ALTER TABLE query_logs
    DROP CONSTRAINT IF EXISTS query_logs_search_type_check;
ALTER TABLE query_logs
    ADD CONSTRAINT query_logs_search_type_check
    CHECK (
        search_type IS NULL
        OR search_type IN ('broll', 'knowledge', 'unified')
    );

ALTER TABLE processing_jobs
    DROP CONSTRAINT IF EXISTS processing_jobs_track_check;
ALTER TABLE processing_jobs
    ADD CONSTRAINT processing_jobs_track_check
    CHECK (track IN ('broll', 'knowledge', 'unified'));

INSERT INTO videos (
    id,
    source,
    source_video_id,
    source_url,
    video_url,
    thumbnail_url,
    title,
    description,
    speaker,
    published_at,
    duration_seconds,
    license,
    creator,
    has_captions,
    metadata,
    created_at,
    updated_at
)
SELECT
    kv.id,
    kv.source,
    kv.source_video_id,
    kv.source_url,
    kv.video_url,
    kv.thumbnail_url,
    kv.title,
    kv.description,
    kv.speaker,
    kv.published_at,
    kv.duration_seconds,
    kv.license,
    COALESCE(kv.metadata->>'creator', kv.speaker),
    FALSE,
    kv.metadata,
    kv.created_at,
    kv.updated_at
FROM knowledge_videos AS kv
ON CONFLICT (source, source_video_id) DO UPDATE
SET
    source_url = EXCLUDED.source_url,
    video_url = EXCLUDED.video_url,
    thumbnail_url = EXCLUDED.thumbnail_url,
    title = EXCLUDED.title,
    description = EXCLUDED.description,
    speaker = EXCLUDED.speaker,
    published_at = EXCLUDED.published_at,
    duration_seconds = EXCLUDED.duration_seconds,
    license = EXCLUDED.license,
    creator = EXCLUDED.creator,
    metadata = EXCLUDED.metadata,
    updated_at = NOW();

INSERT INTO video_access (video_id, owner_id, created_at)
SELECT kv.id, NULL, kv.created_at
FROM knowledge_videos AS kv
ON CONFLICT (video_id, owner_scope) DO NOTHING;

INSERT INTO retrieval_units (
    id,
    video_id,
    unit_type,
    unit_index,
    timestamp_start,
    timestamp_end,
    content_text,
    transcript,
    visual_desc,
    visual_type,
    keyframe_url,
    metadata,
    embedding,
    created_at,
    updated_at
)
SELECT
    ks.id,
    ks.video_id,
    'speech',
    ks.segment_index,
    ks.timestamp_start,
    ks.timestamp_end,
    trim(
        both E'\n' from concat_ws(
            E'\n',
            kv.title,
            ks.transcript_text,
            CASE
                WHEN ks.visual_description IS NOT NULL AND ks.visual_description <> ''
                    THEN '[Visual content: ' || ks.visual_description || ']'
                ELSE NULL
            END,
            CASE
                WHEN ks.visual_text_content IS NOT NULL AND ks.visual_text_content <> ''
                    THEN '[Visible text: ' || ks.visual_text_content || ']'
                ELSE NULL
            END
        )
    ),
    ks.transcript_text,
    COALESCE(ks.visual_description, ks.visual_summary),
    ks.visual_type,
    kv.thumbnail_url,
    ks.metadata,
    ks.embedding,
    ks.created_at,
    ks.updated_at
FROM knowledge_segments AS ks
JOIN knowledge_videos AS kv ON kv.id = ks.video_id
WHERE ks.embedding IS NOT NULL
ON CONFLICT (video_id, unit_type, unit_index) DO UPDATE
SET
    timestamp_start = EXCLUDED.timestamp_start,
    timestamp_end = EXCLUDED.timestamp_end,
    content_text = EXCLUDED.content_text,
    transcript = EXCLUDED.transcript,
    visual_desc = EXCLUDED.visual_desc,
    visual_type = EXCLUDED.visual_type,
    keyframe_url = EXCLUDED.keyframe_url,
    metadata = EXCLUDED.metadata,
    embedding = EXCLUDED.embedding,
    updated_at = NOW();

COMMIT;
