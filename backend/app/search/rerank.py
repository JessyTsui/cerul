from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Any, Mapping, Protocol, Sequence

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)

DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1"
DEFAULT_RERANK_MODEL = "gpt-4o-mini"
DEFAULT_TIMEOUT_SECONDS = 15.0


class RerankerBackend(Protocol):
    async def score_relevance(
        self,
        query: str,
        candidate: Mapping[str, Any],
    ) -> float: ...


class OpenAICompatibleRerankerBackend:
    def __init__(
        self,
        *,
        api_key: str | None = None,
        base_url: str = DEFAULT_OPENAI_BASE_URL,
        model_name: str = DEFAULT_RERANK_MODEL,
        timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
        prompt_template: str | None = None,
    ) -> None:
        settings = get_settings()
        self.api_key = (api_key or os.getenv("OPENAI_API_KEY", "")).strip()
        self.base_url = base_url.rstrip("/")
        self.model_name = model_name
        self.timeout_seconds = timeout_seconds
        self.prompt_template = prompt_template or settings.knowledge.rerank_prompt_template

    async def score_relevance(
        self,
        query: str,
        candidate: Mapping[str, Any],
    ) -> float:
        if not self.api_key:
            raise RuntimeError("OPENAI_API_KEY is not set.")

        prompt = build_rerank_prompt(
            query=query,
            candidate=candidate,
            template_name=self.prompt_template,
        )
        payload = {
            "model": self.model_name,
            "temperature": 0,
            "response_format": {"type": "json_object"},
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "You score how relevant a video segment is to a search query. "
                        "Return JSON with a single numeric field named score from 0 to 10."
                    ),
                },
                {
                    "role": "user",
                    "content": prompt,
                },
            ],
        }

        async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
            response = await client.post(
                f"{self.base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )

        response.raise_for_status()
        response_payload = response.json()
        content = _extract_message_content(response_payload)
        parsed_content = json.loads(content)
        if not isinstance(parsed_content, dict) or "score" not in parsed_content:
            raise ValueError("Reranker response did not include a score field.")

        return _clamp_llm_score(float(parsed_content["score"]))


class LLMReranker:
    def __init__(
        self,
        *,
        backend: RerankerBackend | None = None,
        top_n: int | None = None,
    ) -> None:
        settings = get_settings()
        self.backend = backend or OpenAICompatibleRerankerBackend()
        self.top_n = top_n or settings.knowledge.rerank_top_n

    async def rerank(
        self,
        query: str,
        candidates: Sequence[Mapping[str, Any]],
        top_n: int | None = None,
    ) -> list[dict[str, Any]]:
        if not candidates:
            return []

        candidate_limit = min(top_n or self.top_n, len(candidates))
        rerank_candidates = [dict(candidate) for candidate in candidates[:candidate_limit]]
        remaining_candidates = [dict(candidate) for candidate in candidates[candidate_limit:]]

        try:
            llm_scores = await asyncio.gather(
                *[
                    self.backend.score_relevance(query, candidate)
                    for candidate in rerank_candidates
                ]
            )
        except Exception as exc:
            logger.warning(
                "Knowledge reranking failed; falling back to vector score ordering: %s",
                exc,
            )
            return sorted(
                [dict(candidate) for candidate in candidates],
                key=lambda candidate: float(candidate.get("score", 0.0)),
                reverse=True,
            )

        scored_candidates: list[tuple[dict[str, Any], float, int]] = []
        for index, (candidate, llm_score) in enumerate(zip(rerank_candidates, llm_scores)):
            normalized_score = max(0.0, min(llm_score / 10.0, 1.0))
            candidate["llm_score"] = llm_score
            candidate["rerank_score"] = normalized_score
            scored_candidates.append((candidate, normalized_score, index))

        scored_candidates.sort(key=lambda item: (-item[1], item[2]))
        ordered_candidates = [candidate for candidate, _, _ in scored_candidates]
        return ordered_candidates + remaining_candidates


def build_rerank_prompt(
    *,
    query: str,
    candidate: Mapping[str, Any],
    template_name: str = "default",
) -> str:
    transcript_text = _truncate_text(
        _coerce_text(candidate.get("transcript_text") or candidate.get("description")),
        limit=2500,
    )
    visual_description = _truncate_text(
        _coerce_text(candidate.get("visual_summary") or candidate.get("description")),
        limit=1000,
    )
    video_title = _coerce_text(candidate.get("title"))
    speaker = _coerce_text(candidate.get("speaker")) or "Unknown speaker"
    segment_title = _coerce_text(candidate.get("segment_title"))

    if template_name != "default":
        logger.debug("Unknown rerank prompt template '%s'; using default.", template_name)

    return (
        "Search query:\n"
        f"{query}\n\n"
        "Candidate segment:\n"
        f"Video title: {video_title or 'Untitled video'}\n"
        f"Segment title: {segment_title or 'Untitled segment'}\n"
        f"Speaker: {speaker}\n"
        f"Transcript:\n{transcript_text or 'N/A'}\n\n"
        f"Visual description:\n{visual_description or 'N/A'}\n\n"
        "Score how useful this segment is for answering the search query.\n"
        "Use 0 for irrelevant and 10 for highly relevant evidence.\n"
        'Return JSON only, for example: {"score": 8.5}.'
    )


def _extract_message_content(payload: Mapping[str, Any]) -> str:
    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices:
        raise ValueError("LLM response did not include choices.")

    first_choice = choices[0]
    if not isinstance(first_choice, Mapping):
        raise ValueError("LLM choice payload is malformed.")

    message = first_choice.get("message")
    if not isinstance(message, Mapping):
        raise ValueError("LLM response did not include a message.")

    content = message.get("content")
    if isinstance(content, str):
        return content

    if isinstance(content, list):
        text_fragments = []
        for item in content:
            if isinstance(item, Mapping) and isinstance(item.get("text"), str):
                text_fragments.append(item["text"])
        joined_content = "".join(text_fragments).strip()
        if joined_content:
            return joined_content

    raise ValueError("LLM response did not include message content.")


def _clamp_llm_score(score: float) -> float:
    return max(0.0, min(score, 10.0))


def _coerce_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _truncate_text(value: str, *, limit: int) -> str:
    if len(value) <= limit:
        return value
    return value[: limit - 3].rstrip() + "..."
