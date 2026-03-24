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
    USING (
        CASE
            WHEN embedding IS NULL THEN NULL
            WHEN vector_dims(embedding) = 3072 THEN embedding::VECTOR(3072)
            ELSE (
                '['
                || trim(both '[]' from embedding::text)
                || ','
                || array_to_string(
                    array_fill(
                        0::DOUBLE PRECISION,
                        ARRAY[3072 - vector_dims(embedding)]
                    ),
                    ','
                )
                || ']'
            )::VECTOR(3072)
        END
    );

CREATE INDEX idx_knowledge_segments_embedding
    ON knowledge_segments
    USING hnsw ((embedding::halfvec(3072)) halfvec_cosine_ops);

COMMIT;
