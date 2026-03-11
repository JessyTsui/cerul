from __future__ import annotations

from typing import Any, Sequence

from app.embedding.base import EmbeddingBackend
from app.embedding.gemini import GeminiEmbeddingBackend
from app.search.base import (
    DEFAULT_BROLL_VECTOR_DIMENSION,
    mmr_diversify,
    parse_vector,
    resolve_mmr_lambda,
    resolve_query_vector,
    vector_to_literal,
)
from app.search.models import BrollFilters, SearchRequest, SearchResult


class BrollSearchService:
    def __init__(
        self,
        db: Any,
        *,
        embedding_backend: EmbeddingBackend | None = None,
        mmr_lambda: float | None = None,
    ) -> None:
        self.db = db
        self.embedding_backend = embedding_backend or GeminiEmbeddingBackend()
        self.mmr_lambda = resolve_mmr_lambda(mmr_lambda)

    def build_query(
        self,
        request: SearchRequest,
        query_vector: Sequence[float],
    ) -> tuple[str, list[Any]]:
        filters = request.filters if isinstance(request.filters, BrollFilters) else None
        params: list[Any] = [vector_to_literal(query_vector)]
        conditions = ["TRUE"]

        if filters is not None and filters.min_duration is not None:
            params.append(filters.min_duration)
            conditions.append(f"duration_seconds >= ${len(params)}")

        if filters is not None and filters.max_duration is not None:
            params.append(filters.max_duration)
            conditions.append(f"duration_seconds <= ${len(params)}")

        if filters is not None and filters.source is not None:
            params.append(filters.source)
            conditions.append(f"source = ${len(params)}")

        params.append(min(request.max_results * 4, 50))
        sql = f"""
            SELECT
                source_asset_id AS id,
                title,
                description,
                video_url,
                thumbnail_url,
                duration_seconds AS duration,
                source,
                license,
                embedding::text AS embedding,
                1 - (embedding <=> $1::vector) AS score
            FROM broll_assets
            WHERE {' AND '.join(conditions)}
            ORDER BY embedding <=> $1::vector
            LIMIT ${len(params)}
        """
        return sql, params

    async def search(
        self,
        request: SearchRequest,
        query_vector: Sequence[float] | None = None,
    ) -> list[SearchResult]:
        resolved_query_vector = resolve_query_vector(
            query=request.query,
            search_type="broll",
            expected_dimension=DEFAULT_BROLL_VECTOR_DIMENSION,
            embedding_backend=self.embedding_backend,
            query_vector=query_vector,
        )
        sql, params = self.build_query(request, resolved_query_vector)
        rows = await self._fetch_rows(request, sql, params)
        results = [self._row_to_result(row) for row in rows]
        embeddings = [parse_vector(row.get("embedding")) for row in rows]
        relevance_scores = [float(row.get("score", 0.0)) for row in rows]
        return mmr_diversify(
            results,
            embeddings,
            limit=request.max_results,
            lambda_multiplier=self.mmr_lambda,
            relevance_scores=relevance_scores,
        )

    async def _fetch_rows(
        self,
        request: SearchRequest,
        sql: str,
        params: Sequence[Any],
    ) -> list[dict[str, Any]]:
        return list(await self.db.fetch(sql, *params))

    def _row_to_result(self, row: dict[str, Any]) -> SearchResult:
        return SearchResult(
            id=row["id"],
            score=max(float(row["score"]), 0.0),
            title=row["title"],
            description=row["description"],
            video_url=row["video_url"],
            thumbnail_url=row["thumbnail_url"],
            duration=int(row["duration"]),
            source=row["source"],
            license=row["license"],
        )
