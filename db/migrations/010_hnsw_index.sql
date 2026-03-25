-- HNSW index for cosine similarity search on retrieval_units embeddings.
-- retrieval_units stores 3072-dim vectors, so cast to halfvec to stay within
-- pgvector's HNSW dimension limit while preserving ANN search support.
-- DROP INDEX CONCURRENTLY cleans up invalid leftovers from previously failed
-- concurrent index builds before recreating the index with the same name.
-- CONCURRENTLY avoids long write locks, so this migration must not run
-- inside an explicit transaction block.
DROP INDEX CONCURRENTLY IF EXISTS idx_retrieval_units_embedding_hnsw;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_retrieval_units_embedding_hnsw
ON retrieval_units
USING hnsw ((embedding::halfvec(3072)) halfvec_cosine_ops)
WITH (m = 16, ef_construction = 200);
