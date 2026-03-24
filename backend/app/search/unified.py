from __future__ import annotations

from dataclasses import dataclass
import logging
import secrets
import time
from pathlib import Path
from typing import Any, Sequence
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from app.config import get_settings
from app.embedding import create_embedding_backend
from app.embedding.base import EmbeddingBackend
from app.search.answer import AnswerGenerator
from app.search.base import (
    DEFAULT_KNOWLEDGE_VECTOR_DIMENSION,
    mmr_diversify,
    parse_vector,
    resolve_mmr_lambda,
    resolve_query_vector,
    vector_to_literal,
)
from app.search.models import SearchRequest, SearchResult, UnifiedFilters
from app.search.rerank import LLMReranker

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class SearchExecution:
    results: list[SearchResult]
    answer: str | None
    tracking_links: list[dict[str, Any]]


class UnifiedSearchService:
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
        self.embedding_backend = embedding_backend or create_embedding_backend(
            output_dimension=DEFAULT_KNOWLEDGE_VECTOR_DIMENSION
        )
        self.reranker = reranker or LLMReranker()
        self.answer_generator = answer_generator or AnswerGenerator()
        self.mmr_lambda = resolve_mmr_lambda(mmr_lambda)

    async def search(
        self,
        request: SearchRequest,
        *,
        user_id: str,
        request_id: str,
        query_vector: Sequence[float] | None = None,
        image_path: Path | None = None,
    ) -> SearchExecution:
        resolved_query_vector = await resolve_query_vector(
            query=request.query,
            image_path=image_path,
            search_type="unified",
            expected_dimension=DEFAULT_KNOWLEDGE_VECTOR_DIMENSION,
            embedding_backend=self.embedding_backend,
            query_vector=query_vector,
        )

        allowed_unit_types = ["speech", "visual"]
        if request.include_summary:
            allowed_unit_types.insert(0, "summary")

        candidate_limit = min(max(request.max_results * 8, 24), 120)
        candidate_rows: list[dict[str, Any]] = []
        for unit_type in allowed_unit_types:
            rows = await self._fetch_unit_rows(
                filters=request.filters,
                query_vector=resolved_query_vector,
                unit_type=unit_type,
                user_id=user_id,
                limit=candidate_limit,
            )
            candidate_rows.extend(rows)

        candidate_rows = self._dedupe_rows(candidate_rows)
        if not candidate_rows:
            return SearchExecution(results=[], answer=None, tracking_links=[])
        candidate_rows.sort(
            key=lambda row: float(row.get("score", 0.0)),
            reverse=True,
        )

        if request.ranking_mode == "rerank" and request.query:
            rerank_started_at = time.perf_counter()
            reranked_rows = await self.reranker.rerank(request.query, candidate_rows)
            logger.info(
                "Reranked %d unified candidates in %.2f ms",
                min(len(candidate_rows), getattr(self.reranker, "top_n", len(candidate_rows))),
                (time.perf_counter() - rerank_started_at) * 1000,
            )

            diversified_rows = self._diversify_rows(
                reranked_rows,
                limit=request.max_results * 3,
            )
            selected_rows = self._cap_per_video(diversified_rows, limit=2)[: request.max_results]
        else:
            selected_rows = candidate_rows[: request.max_results]

        answer: str | None = None
        if request.include_answer and selected_rows:
            answer_started_at = time.perf_counter()
            answer = await self.answer_generator.generate(
                request.query or "Image search query",
                selected_rows,
            )
            logger.info(
                "Generated unified answer from %d units in %.2f ms",
                len(selected_rows),
                (time.perf_counter() - answer_started_at) * 1000,
            )

        tracking_links: list[dict[str, Any]] = []
        results: list[SearchResult] = []
        for rank, row in enumerate(selected_rows):
            short_id = secrets.token_urlsafe(6).replace("-", "").replace("_", "")[:8]
            tracking_url = self._build_tracking_url(short_id)
            target_url = self._build_target_url(row)
            tracking_links.append(
                {
                    "short_id": short_id,
                    "request_id": request_id,
                    "result_rank": rank,
                    "unit_id": row["id"],
                    "video_id": row["video_id"],
                    "target_url": target_url,
                    "title": str(row.get("title") or ""),
                    "thumbnail_url": row.get("thumbnail_url"),
                    "source": str(row.get("source") or ""),
                    "speaker": row.get("speaker"),
                    "unit_type": str(row.get("unit_type") or "speech"),
                    "timestamp_start": self._coerce_optional_float(row.get("timestamp_start")),
                    "timestamp_end": self._coerce_optional_float(row.get("timestamp_end")),
                    "transcript": row.get("transcript"),
                    "visual_desc": row.get("visual_desc"),
                    "keyframe_url": row.get("keyframe_url"),
                }
            )
            results.append(
                SearchResult(
                    id=str(row["id"]),
                    score=self._clamp_score(row.get("score")),
                    rerank_score=self._clamp_optional_score(row.get("rerank_score")),
                    url=tracking_url,
                    title=str(row.get("title") or ""),
                    snippet=self._build_snippet(row),
                    thumbnail_url=row.get("thumbnail_url"),
                    keyframe_url=row.get("keyframe_url"),
                    duration=int(row.get("duration") or 0),
                    source=str(row.get("source") or ""),
                    speaker=row.get("speaker"),
                    timestamp_start=self._coerce_optional_float(row.get("timestamp_start")),
                    timestamp_end=self._coerce_optional_float(row.get("timestamp_end")),
                    unit_type=str(row.get("unit_type") or "speech"),  # type: ignore[arg-type]
                )
            )

        return SearchExecution(
            results=results,
            answer=answer,
            tracking_links=tracking_links,
        )

    async def _fetch_unit_rows(
        self,
        *,
        filters: UnifiedFilters | None,
        query_vector: Sequence[float],
        unit_type: str,
        user_id: str,
        limit: int,
    ) -> list[dict[str, Any]]:
        params: list[Any] = [
            vector_to_literal(query_vector),
            unit_type,
            user_id,
        ]
        conditions = [
            "ru.unit_type = $2",
            (
                "EXISTS ("
                "SELECT 1 FROM video_access AS va "
                "WHERE va.video_id = ru.video_id "
                "AND (va.owner_id IS NULL OR va.owner_id = $3)"
                ")"
            ),
        ]

        if filters is not None and filters.speaker is not None:
            params.append(filters.speaker)
            conditions.append(f"v.speaker = ${len(params)}")

        if filters is not None and filters.published_after is not None:
            params.append(filters.published_after)
            conditions.append(f"v.published_at >= ${len(params)}")

        if filters is not None and filters.min_duration is not None:
            params.append(filters.min_duration)
            conditions.append(f"v.duration_seconds >= ${len(params)}")

        if filters is not None and filters.max_duration is not None:
            params.append(filters.max_duration)
            conditions.append(f"v.duration_seconds <= ${len(params)}")

        if filters is not None and filters.source is not None:
            params.append(filters.source)
            conditions.append(f"v.source = ${len(params)}")

        params.append(limit)
        sql = f"""
            SELECT
                ru.id::text AS id,
                v.id::text AS video_id,
                ru.unit_type,
                ru.unit_index,
                ru.content_text,
                ru.transcript AS transcript_text,
                ru.visual_desc AS visual_description,
                ru.visual_desc AS visual_summary,
                ru.metadata->>'visual_text_content' AS visual_text_content,
                ru.metadata->>'segment_title' AS segment_title,
                ru.visual_type,
                ru.keyframe_url,
                ru.timestamp_start,
                ru.timestamp_end,
                ru.embedding::text AS embedding,
                1 - (ru.embedding <=> $1::vector) AS score,
                v.title,
                v.description,
                v.source,
                v.source_url,
                v.video_url,
                v.thumbnail_url,
                v.duration_seconds AS duration,
                v.speaker,
                v.license,
                v.creator,
                v.published_at
            FROM retrieval_units AS ru
            JOIN videos AS v
                ON v.id = ru.video_id
            WHERE {' AND '.join(conditions)}
            ORDER BY ru.embedding <=> $1::vector
            LIMIT ${len(params)}
        """
        return [dict(row) for row in await self.db.fetch(sql, *params)]

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

    def _dedupe_rows(self, rows: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
        deduped: list[dict[str, Any]] = []
        seen_ids: set[str] = set()
        for row in rows:
            row_id = str(row.get("id") or "")
            if not row_id or row_id in seen_ids:
                continue
            seen_ids.add(row_id)
            deduped.append(row)
        return deduped

    def _cap_per_video(
        self,
        rows: Sequence[dict[str, Any]],
        *,
        limit: int,
    ) -> list[dict[str, Any]]:
        selected: list[dict[str, Any]] = []
        counts_by_video: dict[str, int] = {}
        for row in rows:
            video_id = str(row.get("video_id") or "")
            if not video_id:
                continue
            count = counts_by_video.get(video_id, 0)
            if count >= limit:
                continue
            counts_by_video[video_id] = count + 1
            selected.append(row)
        return selected

    def _build_tracking_url(self, short_id: str) -> str:
        base_url = get_settings().public.web_base_url.rstrip("/")
        return f"{base_url}/v/{short_id}"

    def _build_target_url(self, row: dict[str, Any]) -> str:
        target_url = str(row.get("source_url") or row.get("video_url") or "").strip()
        if not target_url:
            return get_settings().public.web_base_url.rstrip("/")

        timestamp_start = self._coerce_optional_float(row.get("timestamp_start"))
        if timestamp_start is None:
            return target_url

        source = str(row.get("source") or "").strip().lower()
        if source == "youtube":
            parsed = urlparse(target_url)
            query_params = dict(parse_qsl(parsed.query, keep_blank_values=True))
            query_params["t"] = str(max(int(timestamp_start), 0))
            return urlunparse(parsed._replace(query=urlencode(query_params)))
        return target_url

    def _build_snippet(self, row: dict[str, Any]) -> str:
        unit_type = str(row.get("unit_type") or "speech")
        if unit_type == "visual":
            value = (
                row.get("visual_description")
                or row.get("visual_summary")
                or row.get("visual_text_content")
                or row.get("content_text")
            )
        elif unit_type == "summary":
            value = row.get("content_text") or row.get("description")
        else:
            value = row.get("transcript_text") or row.get("content_text") or row.get("description")
        return self._truncate_text(str(value or "").strip(), limit=220)

    def _coerce_optional_float(self, value: Any) -> float | None:
        if value is None:
            return None
        return float(value)

    def _clamp_score(self, value: Any) -> float:
        return min(max(float(value or 0.0), 0.0), 1.0)

    def _clamp_optional_score(self, value: Any) -> float | None:
        if value is None:
            return None
        return self._clamp_score(value)

    def _truncate_text(self, value: str, *, limit: int) -> str:
        if len(value) <= limit:
            return value
        return value[: limit - 3].rstrip() + "..."
