from __future__ import annotations

import asyncio
import hashlib
import logging
import math
from pathlib import Path
from typing import Sequence, TypeVar

from app.config import get_settings
from app.embedding.base import EmbeddingBackend

T = TypeVar("T")
logger = logging.getLogger(__name__)

DEFAULT_MMR_LAMBDA = 0.75
# Placeholder query vectors must stay aligned with each track's stored schema.
DEFAULT_BROLL_VECTOR_DIMENSION = 768
DEFAULT_KNOWLEDGE_VECTOR_DIMENSION = 3072


def resolve_mmr_lambda(override: float | None = None) -> float:
    candidate = override
    if candidate is None:
        candidate = get_settings().search.mmr_lambda

    if candidate is None or not 0.0 <= candidate <= 1.0:
        return DEFAULT_MMR_LAMBDA
    return candidate


def build_placeholder_vector(seed_text: str, dimension: int) -> list[float]:
    if dimension <= 0:
        raise ValueError("dimension must be positive")

    values: list[float] = []
    counter = 0
    while len(values) < dimension:
        digest = hashlib.sha256(f"{seed_text}:{counter}".encode("utf-8")).digest()
        counter += 1
        for index in range(0, len(digest), 4):
            chunk = digest[index : index + 4]
            raw_value = int.from_bytes(chunk, byteorder="big", signed=False)
            values.append((raw_value / 0xFFFFFFFF) * 2.0 - 1.0)
            if len(values) == dimension:
                break

    norm = math.sqrt(sum(value * value for value in values))
    if norm == 0:
        return [0.0] * dimension
    return [value / norm for value in values]


async def resolve_query_vector(
    *,
    query: str | None = None,
    image_path: Path | None = None,
    search_type: str,
    expected_dimension: int,
    embedding_backend: EmbeddingBackend,
    query_vector: Sequence[float] | None = None,
) -> list[float]:
    if query_vector is None:
        if image_path is not None:
            embed_query_with_image = getattr(embedding_backend, "embed_query_with_image", None)
            if not callable(embed_query_with_image):
                raise ValueError("Embedding backend does not support image queries.")
            resolved_vector = [
                float(value)
                for value in await asyncio.to_thread(
                    embed_query_with_image,
                    query,
                    image_path=image_path,
                )
            ]
            vector_source = f"{embedding_backend.name} multimodal"
        elif query:
            resolved_vector = [
                float(value)
                for value in await asyncio.to_thread(embedding_backend.embed_query, query)
            ]
            vector_source = embedding_backend.name
        else:
            raise ValueError("No query input provided.")
    else:
        resolved_vector = [float(value) for value in query_vector]
        vector_source = "request override"

    if len(resolved_vector) != expected_dimension:
        raise ValueError(
            "Query embedding dimension mismatch: "
            f"expected {expected_dimension}, got {len(resolved_vector)}."
        )

    logger.info(
        "Resolved %s query vector with %d dimensions via %s",
        search_type,
        len(resolved_vector),
        vector_source,
    )
    return resolved_vector


def vector_to_literal(vector: Sequence[float]) -> str:
    return "[" + ",".join(f"{value:.8f}" for value in vector) + "]"


def parse_vector(raw_value: Sequence[float] | str | None) -> list[float] | None:
    if raw_value is None:
        return None

    if isinstance(raw_value, str):
        clean_value = raw_value.strip()
        if clean_value.startswith("[") and clean_value.endswith("]"):
            clean_value = clean_value[1:-1]
        if not clean_value:
            return []
        return [float(component) for component in clean_value.split(",")]

    return [float(component) for component in raw_value]


def cosine_similarity(left: Sequence[float], right: Sequence[float]) -> float:
    if len(left) != len(right):
        return 0.0
    numerator = sum(left_value * right_value for left_value, right_value in zip(left, right))
    left_norm = math.sqrt(sum(value * value for value in left))
    right_norm = math.sqrt(sum(value * value for value in right))
    if left_norm == 0 or right_norm == 0:
        return 0.0
    return numerator / (left_norm * right_norm)


def mmr_diversify(
    candidates: Sequence[T],
    embeddings: Sequence[Sequence[float] | None],
    *,
    limit: int,
    lambda_multiplier: float = DEFAULT_MMR_LAMBDA,
    relevance_scores: Sequence[float] | None = None,
) -> list[T]:
    if limit <= 0 or not candidates:
        return []

    selection_limit = min(limit, len(candidates))
    selected_indexes: list[int] = []
    remaining_indexes = list(range(len(candidates)))

    while remaining_indexes and len(selected_indexes) < selection_limit:
        best_index: int | None = None
        best_score = float("-inf")

        for candidate_index in remaining_indexes:
            candidate_embedding = embeddings[candidate_index]
            relevance = (
                relevance_scores[candidate_index]
                if relevance_scores is not None
                else 1.0
            )

            diversity_penalty = 0.0
            if selected_indexes and candidate_embedding is not None:
                similarities = [
                    cosine_similarity(candidate_embedding, embeddings[selected_index])
                    for selected_index in selected_indexes
                    if embeddings[selected_index] is not None
                ]
                diversity_penalty = max(similarities, default=0.0)

            mmr_score = (
                lambda_multiplier * relevance
                - (1.0 - lambda_multiplier) * diversity_penalty
            )
            if mmr_score > best_score:
                best_score = mmr_score
                best_index = candidate_index

        if best_index is None:
            break
        selected_indexes.append(best_index)
        remaining_indexes.remove(best_index)

    return [candidates[index] for index in selected_indexes]
