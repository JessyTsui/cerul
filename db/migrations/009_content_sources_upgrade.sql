BEGIN;

ALTER TABLE content_sources
    ADD COLUMN IF NOT EXISTS source_type TEXT,
    ADD COLUMN IF NOT EXISTS config JSONB,
    ADD COLUMN IF NOT EXISTS sync_cursor TEXT;

UPDATE content_sources
SET config = CASE
    WHEN jsonb_typeof(metadata) = 'object' THEN metadata
    ELSE '{}'::JSONB
END
WHERE config IS NULL
   OR config = '{}'::JSONB;

UPDATE content_sources
SET source_type = COALESCE(
    NULLIF(BTRIM(source_type), ''),
    NULLIF(BTRIM(metadata->>'source_type'), ''),
    NULLIF(BTRIM(metadata->>'provider'), ''),
    NULLIF(BTRIM(metadata->>'source'), ''),
    NULLIF(BTRIM(metadata->>'source_name'), ''),
    CASE
        WHEN track = 'knowledge' THEN 'youtube'
        WHEN LOWER(COALESCE(slug, '')) LIKE '%youtube%'
            OR LOWER(COALESCE(base_url, '')) LIKE '%youtube%'
        THEN 'youtube'
        WHEN LOWER(COALESCE(slug, '')) LIKE '%pexels%'
            OR LOWER(COALESCE(base_url, '')) LIKE '%pexels%'
        THEN 'pexels'
        WHEN LOWER(COALESCE(slug, '')) LIKE '%pixabay%'
            OR LOWER(COALESCE(base_url, '')) LIKE '%pixabay%'
        THEN 'pixabay'
        ELSE NULL
    END
)
WHERE source_type IS NULL
   OR BTRIM(source_type) = '';

UPDATE content_sources
SET sync_cursor = NULLIF(BTRIM(metadata->>'sync_cursor'), '')
WHERE sync_cursor IS NULL
   OR BTRIM(sync_cursor) = '';

UPDATE content_sources
SET config = '{}'::JSONB
WHERE config IS NULL;

ALTER TABLE content_sources
    ALTER COLUMN config SET DEFAULT '{}'::JSONB,
    ALTER COLUMN config SET NOT NULL;

ALTER TABLE content_sources
    DROP CONSTRAINT IF EXISTS content_sources_track_check;
ALTER TABLE content_sources
    ADD CONSTRAINT content_sources_track_check
    CHECK (track IN ('broll', 'knowledge', 'shared', 'unified'));

ALTER TABLE processing_jobs
    DROP CONSTRAINT IF EXISTS processing_jobs_track_check;
ALTER TABLE processing_jobs
    ADD CONSTRAINT processing_jobs_track_check
    CHECK (track IN ('broll', 'knowledge', 'unified'));

COMMIT;
