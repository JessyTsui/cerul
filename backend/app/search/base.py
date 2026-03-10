from __future__ import annotations

import hashlib
import math
import os
from typing import Sequence, TypeVar

T = TypeVar("T")

DEFAULT_MMR_LAMBDA = 0.75
DEFAULT_BROLL_VECTOR_DIMENSION = 512
DEFAULT_KNOWLEDGE_VECTOR_DIMENSION = 1536


def resolve_mmr_lambda(override: float | None = None) -> float:
    candidate = override
    if candidate is None:
        configured = os.getenv("MMR_LAMBDA")
        if configured is None:
            return DEFAULT_MMR_LAMBDA
        try:
            candidate = float(configured)
        except ValueError:
            return DEFAULT_MMR_LAMBDA

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


def vector_to_literal(vector: Sequence[float]) -> str:
    return "[" + ",".join(f"{value:.8f}" for value in vector) + "]"


def cosine_similarity(left: Sequence[float], right: Sequence[float]) -> float:
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
