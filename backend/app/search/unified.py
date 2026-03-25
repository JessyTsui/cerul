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

        candidate_limit_per_type = min(max(request.max_results * 8, 24), 120)
        candidate_limit = candidate_limit_per_type * len(allowed_unit_types)
        candidate_rows = await self._fetch_unit_rows(
            filters=request.filters,
            query_vector=resolved_query_vector,
            unit_type=None,
            user_id=user_id,
            limit=candidate_limit,
            allowed_unit_types=allowed_unit_types,
        )

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
                    "transcript": row.get("transcript_text"),
                    "visual_desc": (
                        row.get("visual_description")
                        or row.get("visual_summary")
                    ),
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
        unit_type: str | None,
        user_id: str,
        limit: int,
        allowed_unit_types: Sequence[str] | None = None,
    ) -> list[dict[str, Any]]:
        params: list[Any] = [vector_to_literal(query_vector)]
        conditions: list[str] = []

        if allowed_unit_types is not None:
            normalized_unit_types = [value for value in allowed_unit_types if value]
            if not normalized_unit_types:
                raise ValueError("allowed_unit_types must contain at least one value")
            params.append(normalized_unit_types)
            conditions.append(f"ru.unit_type = ANY(${len(params)}::text[])")
        elif unit_type is not None:
            params.append(unit_type)
            conditions.append(f"ru.unit_type = ${len(params)}")
        else:
            raise ValueError("unit_type or allowed_unit_types must be provided")

        params.append(user_id)
        user_id_param = len(params)
        conditions.append(
            "EXISTS ("
            "SELECT 1 FROM video_access AS va "
            "WHERE va.video_id = ru.video_id "
            f"AND (va.owner_id IS NULL OR va.owner_id = ${user_id_param})"
            ")"
        )

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
        distance_sql = (
            f"(ru.embedding::halfvec({DEFAULT_KNOWLEDGE_VECTOR_DIMENSION}) <=> "
            f"($1::vector({DEFAULT_KNOWLEDGE_VECTOR_DIMENSION}))"
            f"::halfvec({DEFAULT_KNOWLEDGE_VECTOR_DIMENSION}))"
        )
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
                1 - {distance_sql} AS score,
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
            ORDER BY {distance_sql}
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
        by_id: dict[str, dict[str, Any]] = {}
        for row in rows:
            row_id = str(row.get("id") or "")
            if not row_id or row_id in by_id:
                continue
            by_id[row_id] = dict(row)

        segment_key_map: dict[str, dict[str, Any]] = {}
        for row in by_id.values():
            video_id = str(row.get("video_id") or "")
            timestamp_start = row.get("timestamp_start")
            timestamp_end = row.get("timestamp_end")
            if video_id and timestamp_start is not None and timestamp_end is not None:
                segment_key = (
                    f"{video_id}:{float(timestamp_start):.2f}-{float(timestamp_end):.2f}"
                )
            else:
                segment_key = str(row.get("id") or "")

            existing = segment_key_map.get(segment_key)
            if existing is None:
                segment_key_map[segment_key] = row
                continue

            existing_score = float(existing.get("score", 0.0) or 0.0)
            new_score = float(row.get("score", 0.0) or 0.0)
            if new_score > existing_score:
                merged = dict(row)
                self._merge_segment_fields(merged, existing)
                segment_key_map[segment_key] = merged
                continue

            self._merge_segment_fields(existing, row)

        return list(segment_key_map.values())

    def _merge_segment_fields(
        self,
        target: dict[str, Any],
        source: dict[str, Any],
    ) -> None:
        if not target.get("transcript_text") and source.get("transcript_text"):
            target["transcript_text"] = source["transcript_text"]
        if not target.get("visual_description") and source.get("visual_description"):
            target["visual_description"] = source["visual_description"]
        if not target.get("visual_summary") and source.get("visual_summary"):
            target["visual_summary"] = source["visual_summary"]
        if not target.get("visual_text_content") and source.get("visual_text_content"):
            target["visual_text_content"] = source["visual_text_content"]

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
        value = row.get("transcript_text")
        if not value:
            value = (
                row.get("visual_description")
                or row.get("visual_summary")
                or row.get("visual_text_content")
                or row.get("content_text")
                or row.get("description")
            )
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
