from __future__ import annotations

import logging
import time
from typing import Any, Sequence

from app.embedding.base import EmbeddingBackend
from app.embedding.gemini import GeminiEmbeddingBackend
from app.search.answer import AnswerGenerator
from app.search.base import (
    DEFAULT_KNOWLEDGE_VECTOR_DIMENSION,
    mmr_diversify,
    parse_vector,
    resolve_mmr_lambda,
    resolve_query_vector,
    vector_to_literal,
)
from app.search.models import KnowledgeFilters, KnowledgeResult, SearchRequest
from app.search.rerank import LLMReranker

logger = logging.getLogger(__name__)


class KnowledgeSearchService:
    def __init__(
        self,
        db: Any,
        *,
        embedding_backend: EmbeddingBackend | None = None,
        reranker: LLMReranker | None = None,
        answer_generator: AnswerGenerator | None = None,
        mmr_lambda: float | None = None,
    ) -> None:
        self.db = db
        self.embedding_backend = embedding_backend or GeminiEmbeddingBackend()
        self.reranker = reranker or LLMReranker()
        self.answer_generator = answer_generator or AnswerGenerator()
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
                ks.id::text AS id,
                kv.title,
                ks.title AS segment_title,
                ks.description,
                ks.transcript_text,
                ks.visual_summary,
                kv.video_url,
                kv.thumbnail_url,
                kv.duration_seconds AS duration,
                kv.source,
                kv.license,
                kv.speaker,
                kv.published_at,
                ks.timestamp_start,
                ks.timestamp_end,
                ks.embedding::text AS embedding,
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
        resolved_query_vector = await resolve_query_vector(
            query=request.query,
            search_type="knowledge",
            expected_dimension=DEFAULT_KNOWLEDGE_VECTOR_DIMENSION,
            embedding_backend=self.embedding_backend,
            query_vector=query_vector,
        )
        sql, params = self.build_query(request, resolved_query_vector)
        rows = await self._fetch_rows(request, sql, params)
        if not rows:
            return []

        rerank_started_at = time.perf_counter()
        reranked_rows = await self.reranker.rerank(request.query, rows)
        logger.info(
            "Reranked %d knowledge candidates in %.2f ms",
            min(len(rows), getattr(self.reranker, "top_n", len(rows))),
            (time.perf_counter() - rerank_started_at) * 1000,
        )

        selected_rows = self._diversify_rows(reranked_rows, limit=request.max_results)

        answer: str | None = None
        if request.include_answer and selected_rows:
            answer_started_at = time.perf_counter()
            answer = await self.answer_generator.generate(request.query, selected_rows)
            logger.info(
                "Generated knowledge answer from %d segments in %.2f ms",
                len(selected_rows),
                (time.perf_counter() - answer_started_at) * 1000,
            )

        return [self._row_to_result(row, answer=answer) for row in selected_rows]

    async def _fetch_rows(
        self,
        request: SearchRequest,
        sql: str,
        params: Sequence[Any],
    ) -> list[dict[str, Any]]:
        return list(await self.db.fetch(sql, *params))

    def _diversify_rows(
        self,
        rows: list[dict[str, Any]],
        *,
        limit: int,
    ) -> list[dict[str, Any]]:
        embeddings = [parse_vector(row.get("embedding")) for row in rows]
        relevance_scores = [
            float(row.get("rerank_score", row.get("score", 0.0)))
            for row in rows
        ]
        return mmr_diversify(
            rows,
            embeddings,
            limit=limit,
            lambda_multiplier=self.mmr_lambda,
            relevance_scores=relevance_scores,
        )

    def _row_to_result(
        self,
        row: dict[str, Any],
        *,
        answer: str | None = None,
    ) -> KnowledgeResult:
        return KnowledgeResult(
            id=row["id"],
            score=max(float(row.get("rerank_score", row.get("score", 0.0))), 0.0),
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
