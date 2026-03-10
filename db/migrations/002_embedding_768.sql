BEGIN;

DROP INDEX IF EXISTS idx_broll_assets_embedding;
DROP INDEX IF EXISTS idx_knowledge_segments_embedding;

ALTER TABLE broll_assets
    ALTER COLUMN embedding TYPE VECTOR(768)
    USING NULL::VECTOR(768);

ALTER TABLE knowledge_segments
    ALTER COLUMN embedding TYPE VECTOR(768)
    USING NULL::VECTOR(768);

CREATE INDEX idx_broll_assets_embedding
    ON broll_assets USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

CREATE INDEX idx_knowledge_segments_embedding
    ON knowledge_segments USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

COMMIT;
