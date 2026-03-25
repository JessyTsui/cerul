-- HNSW index for cosine similarity search on retrieval_units embeddings.
-- CONCURRENTLY avoids long write locks, so this migration must not run
-- inside an explicit transaction block.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_retrieval_units_embedding_hnsw
ON retrieval_units
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 200);
