from __future__ import annotations

import logging
import os
from typing import Any, Mapping, Protocol, Sequence

import httpx

logger = logging.getLogger(__name__)

DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1"
DEFAULT_ANSWER_MODEL = "gpt-4o"
DEFAULT_TIMEOUT_SECONDS = 30.0


class AnswerBackend(Protocol):
    async def generate_answer(
        self,
        query: str,
        segments: Sequence[Mapping[str, Any]],
    ) -> str: ...


class OpenAICompatibleAnswerBackend:
    def __init__(
        self,
        *,
        api_key: str | None = None,
        base_url: str = DEFAULT_OPENAI_BASE_URL,
        model_name: str = DEFAULT_ANSWER_MODEL,
        timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
    ) -> None:
        self.api_key = (api_key or os.getenv("OPENAI_API_KEY", "")).strip()
        self.base_url = base_url.rstrip("/")
        self.model_name = model_name
        self.timeout_seconds = timeout_seconds

    async def generate_answer(
        self,
        query: str,
        segments: Sequence[Mapping[str, Any]],
    ) -> str:
        if not self.api_key:
            raise RuntimeError("OPENAI_API_KEY is not set.")

        prompt = build_answer_prompt(query=query, segments=segments)
        payload = {
            "model": self.model_name,
            "temperature": 0.2,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "You answer knowledge search queries using only the provided video "
                        "segments. Cite claims inline with timestamp references in the exact "
                        "format [Video Title, m:ss-m:ss] or [Video Title, h:mm:ss-h:mm:ss]."
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
        content = _extract_message_content(response_payload).strip()
        if not content:
            raise ValueError("Answer generation returned an empty response.")
        return content


class AnswerGenerator:
    def __init__(
        self,
        *,
        backend: AnswerBackend | None = None,
    ) -> None:
        self.backend = backend or OpenAICompatibleAnswerBackend()

    async def generate(
        self,
        query: str,
        segments: Sequence[Mapping[str, Any]],
    ) -> str | None:
        if not segments:
            return None

        try:
            return await self.backend.generate_answer(query, segments)
        except Exception as exc:
            logger.warning("Knowledge answer generation failed: %s", exc)
            return None


def build_answer_prompt(
    *,
    query: str,
    segments: Sequence[Mapping[str, Any]],
) -> str:
    segment_blocks = []
    for index, segment in enumerate(segments, start=1):
        segment_blocks.append(
            "\n".join(
                [
                    f"Segment {index}:",
                    f"Video title: {_coerce_text(segment.get('title')) or 'Untitled video'}",
                    f"Segment title: {_coerce_text(segment.get('segment_title')) or 'Untitled segment'}",
                    f"Speaker: {_coerce_text(segment.get('speaker')) or 'Unknown speaker'}",
                    (
                        "Timestamp range: "
                        f"{_format_timestamp_range(segment.get('timestamp_start'), segment.get('timestamp_end'))}"
                    ),
                    "Transcript:",
                    _truncate_text(_coerce_text(segment.get("transcript_text")), limit=3000)
                    or "N/A",
                    "Visual description:",
                    _truncate_text(
                        _coerce_text(segment.get("visual_summary") or segment.get("description")),
                        limit=1200,
                    )
                    or "N/A",
                ]
            )
        )

    joined_segments = "\n\n".join(segment_blocks)
    return (
        "User query:\n"
        f"{query}\n\n"
        "Retrieved evidence segments:\n"
        f"{joined_segments}\n\n"
        "Write a concise synthesized answer grounded only in these segments.\n"
        "Every factual claim must include at least one timestamp citation.\n"
        "If the evidence is incomplete, say that explicitly instead of guessing."
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


def _format_timestamp_range(start: Any, end: Any) -> str:
    return f"{_format_timestamp(start)}-{_format_timestamp(end)}"


def _format_timestamp(value: Any) -> str:
    total_seconds = max(int(float(value or 0.0)), 0)
    hours, remainder = divmod(total_seconds, 3600)
    minutes, seconds = divmod(remainder, 60)
    if hours:
        return f"{hours}:{minutes:02d}:{seconds:02d}"
    return f"{minutes}:{seconds:02d}"


def _coerce_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _truncate_text(value: str, *, limit: int) -> str:
    if len(value) <= limit:
        return value
    return value[: limit - 3].rstrip() + "..."
