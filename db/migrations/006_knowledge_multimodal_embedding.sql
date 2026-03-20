BEGIN;

DROP INDEX IF EXISTS idx_knowledge_segments_embedding;

ALTER TABLE knowledge_segments
    ADD COLUMN IF NOT EXISTS has_visual_embedding BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS visual_type TEXT,
    ADD COLUMN IF NOT EXISTS visual_description TEXT,
    ADD COLUMN IF NOT EXISTS visual_text_content TEXT,
    ADD COLUMN IF NOT EXISTS visual_entities TEXT[];

UPDATE knowledge_segments
SET
    has_visual_embedding = COALESCE(has_visual_embedding, FALSE),
    visual_description = COALESCE(NULLIF(visual_description, ''), visual_summary)
WHERE visual_summary IS NOT NULL;

ALTER TABLE knowledge_segments
    ALTER COLUMN embedding TYPE VECTOR(3072)
    USING NULL::VECTOR(3072);

COMMIT;
