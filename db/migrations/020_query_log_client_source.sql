BEGIN;

ALTER TABLE query_logs
    ADD COLUMN IF NOT EXISTS client_source TEXT;

ALTER TABLE query_logs
    DROP CONSTRAINT IF EXISTS query_logs_search_surface_check;

ALTER TABLE query_logs
    ADD CONSTRAINT query_logs_search_surface_check
    CHECK (
        search_surface IS NULL
        OR search_surface IN ('api', 'playground', 'mcp')
    );

CREATE INDEX IF NOT EXISTS idx_query_logs_client_source_created_at
    ON query_logs (client_source, created_at DESC);

COMMIT;
