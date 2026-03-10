from __future__ import annotations

from typing import Any, Sequence

from app.search.base import (
    DEFAULT_KNOWLEDGE_VECTOR_DIMENSION,
    build_placeholder_vector,
    mmr_diversify,
    resolve_mmr_lambda,
    vector_to_literal,
)
from app.search.models import KnowledgeFilters, KnowledgeResult, SearchRequest


class KnowledgeSearchService:
    def __init__(self, db: Any, *, mmr_lambda: float | None = None) -> None:
        self.db = db
        self.mmr_lambda = resolve_mmr_lambda(mmr_lambda)

    def build_query(
        self,
        request: SearchRequest,
        query_vector: Sequence[float],
    ) -> tuple[str, list[Any]]:
        filters = request.filters if isinstance(request.filters, KnowledgeFilters) else None
        params: list[Any] = [vector_to_literal(query_vector)]
        conditions = ["TRUE"]

        if filters is not None and filters.speaker is not None:
            params.append(filters.speaker)
            conditions.append(f"kv.speaker = ${len(params)}")

        if filters is not None and filters.published_after is not None:
            params.append(filters.published_after)
            conditions.append(f"kv.published_at >= ${len(params)}")

        params.append(min(request.max_results * 4, 50))
        sql = f"""
            SELECT
                ks.id,
                kv.title,
                ks.description,
                kv.video_url,
                kv.thumbnail_url,
                kv.duration,
                kv.source,
                kv.license,
                kv.speaker,
                kv.published_at,
                ks.timestamp_start,
                ks.timestamp_end,
                ks.embedding,
                1 - (ks.embedding <=> $1::vector) AS score
            FROM knowledge_segments AS ks
            JOIN knowledge_videos AS kv
                ON kv.id = ks.video_id
            WHERE {' AND '.join(conditions)}
            ORDER BY ks.embedding <=> $1::vector
            LIMIT ${len(params)}
        """
        return sql, params

    async def search(
        self,
        request: SearchRequest,
        query_vector: Sequence[float] | None = None,
    ) -> list[KnowledgeResult]:
        resolved_query_vector = list(
            query_vector or build_placeholder_vector(
                request.query,
                DEFAULT_KNOWLEDGE_VECTOR_DIMENSION,
            )
        )
        sql, params = self.build_query(request, resolved_query_vector)
        rows = await self._fetch_rows(request, sql, params)
        rows = self._placeholder_rerank(rows)
        results = [self._row_to_result(request, row) for row in rows]
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
        filters = request.filters if isinstance(request.filters, KnowledgeFilters) else None
        limit = min(request.max_results * 4, 50)

        if hasattr(self.db, "search_knowledge_segments"):
            return await self.db.search_knowledge_segments(
                speaker=None if filters is None else filters.speaker,
                published_after=None if filters is None else filters.published_after,
                limit=limit,
            )

        if hasattr(self.db, "fetch"):
            return list(await self.db.fetch(sql, *params))

        return []

    def _placeholder_rerank(self, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return sorted(rows, key=lambda row: row.get("score", 0.0), reverse=True)

    def _placeholder_answer(self, query: str, row: dict[str, Any]) -> str:
        return (
            f"Potential answer for '{query}' based on {row['title']} "
            f"from {row['timestamp_start']:.0f}s to {row['timestamp_end']:.0f}s."
        )

    def _row_to_result(
        self,
        request: SearchRequest,
        row: dict[str, Any],
    ) -> KnowledgeResult:
        answer: str | None = None
        if request.include_answer:
            answer = self._placeholder_answer(request.query, row)

        return KnowledgeResult(
            id=row["id"],
            score=float(row["score"]),
            title=row["title"],
            description=row["description"],
            video_url=row["video_url"],
            thumbnail_url=row["thumbnail_url"],
            duration=int(row["duration"]),
            source=row["source"],
            license=row["license"],
            timestamp_start=float(row["timestamp_start"]),
            timestamp_end=float(row["timestamp_end"]),
            answer=answer,
        )
