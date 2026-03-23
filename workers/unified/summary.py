from __future__ import annotations

import asyncio
import os
import re
from typing import Any, Mapping, Sequence

DEFAULT_GEMINI_FLASH_SUMMARY_MODEL = "gemini-2.0-flash"

SUMMARY_PROMPT_TEMPLATE = """You are generating one retrieval summary for a video.

Write 2 short sentences in plain text.
- Focus on what the video is about and what evidence appears on screen.
- Mention the speaker or creator only if it helps retrieval.
- Avoid bullet points, markdown, or filler.
- Keep it concise and concrete.

Title: {title}
Description: {description}
Source: {source}
Duration seconds: {duration_seconds}
Transcript excerpt: {transcript_excerpt}
Visual excerpt: {visual_excerpt}
"""


class GeminiFlashSummaryGenerator:
    def __init__(
        self,
        *,
        api_key: str | None = None,
        model_name: str = DEFAULT_GEMINI_FLASH_SUMMARY_MODEL,
        client: Any | None = None,
    ) -> None:
        self._api_key = (api_key or os.getenv("GEMINI_API_KEY", "")).strip()
        self._model_name = model_name
        self._client = client
        self._sdk_types: Any | None = None

    def available(self) -> bool:
        return self._client is not None or bool(self._api_key)

    async def summarize(
        self,
        *,
        title: str,
        description: str,
        source: str,
        duration_seconds: int | None,
        transcript_excerpt: str,
        visual_excerpt: str,
        max_words: int = 72,
    ) -> str | None:
        if not self.available():
            return None

        prompt = SUMMARY_PROMPT_TEMPLATE.format(
            title=title.strip() or "Untitled video",
            description=description.strip() or "(none)",
            source=source.strip() or "unknown",
            duration_seconds=duration_seconds if duration_seconds is not None else "unknown",
            transcript_excerpt=transcript_excerpt.strip() or "(none)",
            visual_excerpt=visual_excerpt.strip() or "(none)",
        )
        return await asyncio.to_thread(
            self._summarize_sync,
            prompt,
            max_words,
        )

    def _summarize_sync(self, prompt: str, max_words: int) -> str | None:
        client = self._get_client()
        config = {"temperature": 0.2}
        sdk_types = self._get_sdk_types()
        if sdk_types is not None:
            config = sdk_types.GenerateContentConfig(temperature=0.2)

        response = client.models.generate_content(
            model=self._model_name,
            contents=prompt,
            config=config,
        )
        summary = _extract_generated_text(response)
        return _normalize_summary_text(summary, max_words=max_words)

    def _get_client(self) -> Any:
        if self._client is not None:
            return self._client
        if not self._api_key:
            raise RuntimeError("GEMINI_API_KEY is required for summary generation.")
        genai_module = self._load_sdk()[0]
        self._client = genai_module.Client(api_key=self._api_key)
        return self._client

    def _get_sdk_types(self) -> Any | None:
        try:
            return self._load_sdk()[1]
        except RuntimeError:
            if self._client is not None:
                return None
            raise

    def _load_sdk(self) -> tuple[Any, Any]:
        if self._sdk_types is not None:
            from google import genai

            return genai, self._sdk_types

        try:
            from google import genai
            from google.genai import types
        except ImportError as exc:
            raise RuntimeError(
                "GeminiFlashSummaryGenerator requires google-genai. "
                "Install workers/requirements.txt."
            ) from exc

        self._sdk_types = types
        return genai, types


def _extract_generated_text(response: Any) -> str:
    direct_text = getattr(response, "text", None)
    if isinstance(direct_text, str) and direct_text.strip():
        return direct_text.strip()
    if isinstance(response, Mapping) and isinstance(response.get("text"), str):
        return str(response["text"]).strip()

    candidates = getattr(response, "candidates", None)
    if candidates is None and isinstance(response, Mapping):
        candidates = response.get("candidates")
    if not isinstance(candidates, Sequence) or isinstance(candidates, (str, bytes)):
        raise ValueError("Gemini summary response did not include text.")

    parts: list[str] = []
    for candidate in candidates:
        content = getattr(candidate, "content", None)
        if content is None and isinstance(candidate, Mapping):
            content = candidate.get("content")
        content_parts = getattr(content, "parts", None)
        if content_parts is None and isinstance(content, Mapping):
            content_parts = content.get("parts")
        if not isinstance(content_parts, Sequence) or isinstance(
            content_parts, (str, bytes)
        ):
            continue
        for part in content_parts:
            text = getattr(part, "text", None)
            if text is None and isinstance(part, Mapping):
                text = part.get("text")
            if isinstance(text, str) and text.strip():
                parts.append(text.strip())

    joined = " ".join(parts).strip()
    if not joined:
        raise ValueError("Gemini summary response did not include text.")
    return joined


def _normalize_summary_text(text: str, *, max_words: int) -> str | None:
    normalized = re.sub(r"\s+", " ", text).strip()
    normalized = re.sub(r"^[#>*`\-\d.\s]+", "", normalized).strip()
    if not normalized:
        return None

    words = normalized.split()
    if len(words) > max_words:
        normalized = " ".join(words[:max_words]).rstrip(" ,;:")
    if normalized and normalized[-1] not in ".!?":
        normalized += "."
    return normalized
