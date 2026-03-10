from __future__ import annotations

from typing import Any, Sequence

from app.search.base import (
    DEFAULT_BROLL_VECTOR_DIMENSION,
    build_placeholder_vector,
    mmr_diversify,
    resolve_mmr_lambda,
    vector_to_literal,
)
from app.search.models import BrollFilters, SearchRequest, SearchResult


class BrollSearchService:
    def __init__(self, db: Any, *, mmr_lambda: float | None = None) -> None:
        self.db = db
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
            conditions.append(f"duration >= ${len(params)}")

        if filters is not None and filters.max_duration is not None:
            params.append(filters.max_duration)
            conditions.append(f"duration <= ${len(params)}")

        if filters is not None and filters.source is not None:
            params.append(filters.source)
            conditions.append(f"source = ${len(params)}")

        params.append(min(request.max_results * 4, 50))
        sql = f"""
            SELECT
                id,
                title,
                description,
                video_url,
                thumbnail_url,
                duration,
                source,
                license,
                embedding,
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
        resolved_query_vector = list(
            query_vector or build_placeholder_vector(
                request.query,
                DEFAULT_BROLL_VECTOR_DIMENSION,
            )
        )
        sql, params = self.build_query(request, resolved_query_vector)
        rows = await self._fetch_rows(request, sql, params)
        results = [self._row_to_result(row) for row in rows]
        embeddings = [row.get("embedding") for row in rows]
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
        filters = request.filters if isinstance(request.filters, BrollFilters) else None
        limit = min(request.max_results * 4, 50)

        if hasattr(self.db, "search_broll_assets"):
            return await self.db.search_broll_assets(
                min_duration=None if filters is None else filters.min_duration,
                max_duration=None if filters is None else filters.max_duration,
                source=None if filters is None else filters.source,
                limit=limit,
            )

        if hasattr(self.db, "fetch"):
            return list(await self.db.fetch(sql, *params))

        return []

    def _row_to_result(self, row: dict[str, Any]) -> SearchResult:
        return SearchResult(
            id=row["id"],
            score=float(row["score"]),
            title=row["title"],
            description=row["description"],
            video_url=row["video_url"],
            thumbnail_url=row["thumbnail_url"],
            duration=int(row["duration"]),
            source=row["source"],
            license=row["license"],
        )
