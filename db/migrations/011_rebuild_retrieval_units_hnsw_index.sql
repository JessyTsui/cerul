-- Rebuild the retrieval_units HNSW index using halfvec so 3072-dim
-- embeddings remain indexable under pgvector's HNSW dimension limit.
-- DROP INDEX CONCURRENTLY cleans up invalid leftovers from previously failed
-- concurrent index builds before recreating the index with the same name.
-- This migration must stay outside an explicit transaction block.
DROP INDEX CONCURRENTLY IF EXISTS idx_retrieval_units_embedding_hnsw;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_retrieval_units_embedding_hnsw
ON retrieval_units
USING hnsw ((embedding::halfvec(3072)) halfvec_cosine_ops)
WITH (m = 16, ef_construction = 200);
