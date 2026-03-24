from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import re
import signal
import sys
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT_DIR = Path(__file__).resolve().parents[1]

if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

import asyncpg

from workers.common.sources import PexelsClient, PixabayClient, YouTubeClient

logger = logging.getLogger(__name__)

DEFAULT_GEMINI_FLASH_MODEL = "gemini-2.0-flash"
YOUTUBE_SEARCH_RELEVANCE_PROMPT_TEMPLATE = """You are filtering YouTube search results for a video index.

Target topic:
{description}

Original search query:
{query}

Keep only videos that are clearly and substantially about the target topic based on the title and description.
Reject videos that are generic, weakly related, or primarily about another topic.

Reply with comma-separated item numbers only, like: 1,3,5
Reply with NONE if no items are relevant.

{video_list}
"""


@dataclass(frozen=True)
class ContentSource:
    id: str
    slug: str
    track: str
    source_type: str
    config: dict[str, Any]
    sync_cursor: str | None
    is_active: bool
    cursor_storage: str


class ContentScheduler:
    _pixabay_option_names = (
        "page",
        "order",
        "safesearch",
        "video_type",
        "category",
        "editors_choice",
        "min_width",
        "min_height",
        "lang",
    )

    def __init__(
        self,
        *,
        youtube_client: YouTubeClient | None = None,
        pexels_client: PexelsClient | None = None,
        pixabay_client: PixabayClient | None = None,
        gemini_client: Any | None = None,
        gemini_model_name: str = DEFAULT_GEMINI_FLASH_MODEL,
        logger: logging.Logger | None = None,
    ) -> None:
        self._youtube_client = youtube_client or YouTubeClient()
        self._pexels_client = pexels_client or PexelsClient()
        self._pixabay_client = pixabay_client or PixabayClient()
        self._gemini_client = gemini_client
        self._gemini_model_name = gemini_model_name
        self._logger = logger or logging.getLogger(__name__)
        self._shutdown_event = asyncio.Event()

    async def run_once(self, db: Any) -> dict[str, dict[str, int]]:
        rows = await db.fetch(
            """
            SELECT *
            FROM content_sources
            WHERE is_active = TRUE
            """
        )
        summary: dict[str, dict[str, int]] = {}

        for row in rows:
            source = self._normalize_source(row)
            if source is None:
                continue
            if not source.is_active:
                continue

            summary[source.slug] = {"discovered": 0, "new_jobs": 0, "skipped": 0}

            try:
                discovered_items = await self._discover_items(source)
                new_jobs = 0
                skipped = 0

                for item in discovered_items:
                    source_item_id = self._get_source_item_id(source, item)
                    job_exists = await db.fetchval(
                        """
                        SELECT 1
                        FROM processing_jobs
                        WHERE source_id = $1
                          AND input_payload->>'source_item_id' = $2
                        LIMIT 1
                        """,
                        source.id,
                        source_item_id,
                    )
                    if job_exists:
                        skipped += 1
                        continue

                    payload = self._build_input_payload(source, item, source_item_id)
                    await db.execute(
                        """
                        INSERT INTO processing_jobs (
                            track,
                            source_id,
                            job_type,
                            status,
                            input_payload
                        )
                        VALUES ($1, $2, $3, 'pending', $4::jsonb)
                        """,
                        "unified",
                        source.id,
                        self._get_job_type(source),
                        json.dumps(payload, default=str),
                    )
                    new_jobs += 1

                if discovered_items:
                    latest_cursor = self._get_latest_cursor(source, discovered_items)
                    if latest_cursor is not None:
                        await self._update_sync_cursor(
                            db,
                            source_id=source.id,
                            cursor=latest_cursor,
                            cursor_storage=source.cursor_storage,
                        )

                summary[source.slug] = {
                    "discovered": len(discovered_items),
                    "new_jobs": new_jobs,
                    "skipped": skipped,
                }
            except Exception:
                self._logger.exception(
                    "Failed to process content source '%s'.",
                    source.slug,
                )
                continue

        return summary

    async def run_loop(self, db: Any, interval_seconds: int = 300) -> None:
        self._shutdown_event.clear()
        loop = asyncio.get_running_loop()
        registered_signals: list[signal.Signals] = []

        def _request_shutdown(signal_name: str) -> None:
            self._logger.info("Received %s. Shutting down scheduler loop.", signal_name)
            self._shutdown_event.set()

        for signum in (signal.SIGTERM, signal.SIGINT):
            try:
                loop.add_signal_handler(
                    signum,
                    _request_shutdown,
                    signum.name,
                )
                registered_signals.append(signum)
            except (NotImplementedError, RuntimeError):
                continue

        try:
            while not self._shutdown_event.is_set():
                summary = await self.run_once(db)
                self._logger.info("Content discovery summary: %s", summary)

                if self._shutdown_event.is_set():
                    break

                try:
                    await asyncio.wait_for(
                        self._shutdown_event.wait(),
                        timeout=interval_seconds,
                    )
                except asyncio.TimeoutError:
                    continue
        finally:
            for signum in registered_signals:
                try:
                    loop.remove_signal_handler(signum)
                except RuntimeError:
                    continue

    def request_shutdown(self) -> None:
        self._shutdown_event.set()

    async def _discover_items(self, source: ContentSource) -> list[dict[str, Any]]:
        if source.track == "knowledge" and source.source_type == "youtube":
            return await self._discover_youtube_items(source)
        if source.track == "broll" and source.source_type == "pexels":
            return await self._discover_pexels_items(source)
        if source.track == "broll" and source.source_type == "pixabay":
            return await self._discover_pixabay_items(source)
        if source.track == "unified" and source.source_type == "youtube":
            return await self._discover_youtube_items(source)
        if source.track == "unified" and source.source_type == "pexels":
            return await self._discover_pexels_items(source)
        if source.track == "unified" and source.source_type == "pixabay":
            return await self._discover_pixabay_items(source)
        if source.source_type == "youtube_search":
            return await self._discover_youtube_search_items(source)
        raise ValueError(
            f"Unsupported content source '{source.slug}' "
            f"({source.track}/{source.source_type})."
        )

    async def _discover_youtube_items(
        self,
        source: ContentSource,
    ) -> list[dict[str, Any]]:
        channel_id = self._require_config_value(source, "channel_id")
        max_results = self._coerce_int(source.config.get("max_results"), default=25)
        videos = await self._youtube_client.search_channel_videos(
            channel_id,
            max_results=max_results,
        )
        if source.sync_cursor is None:
            return videos

        cursor_dt = self._parse_datetime(source.sync_cursor)
        if cursor_dt is None:
            self._logger.warning(
                "Ignoring invalid sync_cursor for source '%s': %s",
                source.slug,
                source.sync_cursor,
            )
            return videos

        filtered_videos: list[dict[str, Any]] = []
        for video in videos:
            published_at = self._parse_datetime(
                self._coerce_string(video.get("published_at"))
            )
            if published_at is None:
                continue
            if published_at > cursor_dt:
                filtered_videos.append(video)
        return filtered_videos

    async def _discover_youtube_search_items(
        self,
        source: ContentSource,
    ) -> list[dict[str, Any]]:
        query = self._require_config_value(source, "query")
        max_results = self._coerce_int(source.config.get("max_results"), default=20)
        published_after = source.sync_cursor if source.sync_cursor else None
        if (
            published_after is not None
            and self._parse_datetime(published_after) is None
        ):
            self._logger.warning(
                "Ignoring invalid sync_cursor for source '%s': %s",
                source.slug,
                source.sync_cursor,
            )
            published_after = None

        relevance_language = self._coerce_string(
            source.config.get("relevance_language")
        )
        videos = await self._youtube_client.search_videos(
            query,
            max_results=max_results,
            published_after=published_after,
            relevance_language=relevance_language,
            event_type="completed",
        )

        self._logger.info(
            "YouTube search '%s' returned %d videos.",
            query,
            len(videos),
        )
        filtered = self._apply_youtube_search_filters(source, videos)
        self._logger.info(
            "After hard filter: %d/%d videos remain.",
            len(filtered),
            len(videos),
        )

        if self._coerce_bool(source.config.get("llm_filter")) and filtered:
            filtered = await self._apply_llm_relevance_filter(source, filtered)
            self._logger.info("After LLM filter: %d videos remain.", len(filtered))

        return filtered

    async def _discover_pexels_items(
        self,
        source: ContentSource,
    ) -> list[dict[str, Any]]:
        query = self._require_config_value(source, "query")
        per_page = self._coerce_int(source.config.get("per_page"), default=50)
        items = await self._pexels_client.search_videos(query, per_page=per_page)
        return self._filter_items_by_id(source, items)

    async def _discover_pixabay_items(
        self,
        source: ContentSource,
    ) -> list[dict[str, Any]]:
        query = self._require_config_value(source, "query")
        per_page = self._coerce_int(source.config.get("per_page"), default=50)
        search_kwargs: dict[str, Any] = {
            "query": query,
            "per_page": per_page,
        }
        for option_name in self._pixabay_option_names:
            if option_name in source.config:
                search_kwargs[option_name] = source.config[option_name]

        items = await self._pixabay_client.search_videos(**search_kwargs)
        return self._filter_items_by_id(source, items)

    def _filter_items_by_id(
        self,
        source: ContentSource,
        items: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        if source.sync_cursor is None:
            return items

        filtered_items: list[dict[str, Any]] = []
        for item in items:
            source_item_id = self._get_source_item_id(source, item)
            if self._is_after_cursor(source_item_id, source.sync_cursor):
                filtered_items.append(item)
        return filtered_items

    def _apply_youtube_search_filters(
        self,
        source: ContentSource,
        videos: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        config = source.config
        max_duration = self._coerce_int(
            config.get("max_duration_seconds"),
            default=4 * 60 * 60,
        )
        min_duration = self._coerce_int(
            config.get("min_duration_seconds"),
            default=60,
        )
        min_views = self._coerce_int(config.get("min_view_count"), default=0)
        channel_allowlist = self._coerce_string_set(config.get("channel_allowlist"))
        channel_blocklist = self._coerce_string_set(config.get("channel_blocklist"))

        filtered: list[dict[str, Any]] = []
        for video in videos:
            duration = self._coerce_int(
                video.get("duration_seconds") or video.get("duration"),
                default=0,
            )
            if duration < min_duration or duration > max_duration:
                continue

            live_status = (
                self._coerce_string(video.get("live_broadcast_content")) or "none"
            ).lower()
            if live_status != "none":
                continue

            view_count = self._coerce_int(video.get("view_count"), default=0)
            if view_count < min_views:
                continue

            channel_id = self._coerce_string(video.get("channel_id")) or ""
            if channel_blocklist and channel_id in channel_blocklist:
                continue
            if channel_allowlist and channel_id not in channel_allowlist:
                continue

            filtered.append(video)

        return filtered

    async def _apply_llm_relevance_filter(
        self,
        source: ContentSource,
        videos: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        client = self._gemini_client
        if client is None:
            api_key = os.getenv("GEMINI_API_KEY", "").strip()
            if not api_key:
                self._logger.warning("GEMINI_API_KEY not set, skipping LLM filter.")
                return videos
            try:
                from google import genai
            except ImportError:
                self._logger.warning(
                    "google-genai not installed, skipping LLM filter."
                )
                return videos

            client = genai.Client(api_key=api_key)
            self._gemini_client = client

        description = (
            self._coerce_string(source.config.get("llm_filter_description"))
            or self._coerce_string(source.config.get("query"))
            or source.slug
        )
        prompt = self._build_youtube_search_relevance_prompt(
            description=description,
            query=self._require_config_value(source, "query"),
            videos=videos,
        )

        try:
            response = await asyncio.to_thread(
                client.models.generate_content,
                model=self._gemini_model_name,
                contents=prompt,
                config={"temperature": 0},
            )
            answer = _extract_generated_text(response)
            if answer is None:
                self._logger.warning(
                    "LLM relevance filter returned no text, returning all videos."
                )
                return videos

            relevant_indices = self._parse_llm_relevant_indices(answer, len(videos))
            if relevant_indices is None:
                self._logger.warning(
                    "Could not parse LLM relevance filter response %r, returning all videos.",
                    answer,
                )
                return videos

            return [videos[index] for index in relevant_indices]
        except Exception:
            self._logger.exception("LLM relevance filter failed, returning all videos.")
            return videos

    def _build_youtube_search_relevance_prompt(
        self,
        *,
        description: str,
        query: str,
        videos: list[dict[str, Any]],
    ) -> str:
        video_sections: list[str] = []
        for index, video in enumerate(videos, start=1):
            title = self._coerce_string(video.get("title")) or "Untitled video"
            raw_description = self._coerce_string(video.get("description")) or ""
            video_description = raw_description[:200] or "(none)"
            video_sections.append(
                f"{index}. Title: {title}\n"
                f"   Description: {video_description}"
            )

        return YOUTUBE_SEARCH_RELEVANCE_PROMPT_TEMPLATE.format(
            description=description,
            query=query,
            video_list="\n\n".join(video_sections),
        )

    def _parse_llm_relevant_indices(
        self,
        answer: str,
        total_videos: int,
    ) -> list[int] | None:
        normalized = answer.strip()
        if not normalized:
            return None

        if re.sub(r"[^A-Za-z]+", "", normalized).upper() == "NONE":
            return []

        relevant_indices: set[int] = set()
        for match in re.findall(r"\d+", normalized):
            index = int(match) - 1
            if 0 <= index < total_videos:
                relevant_indices.add(index)

        if not relevant_indices:
            return None
        return sorted(relevant_indices)

    def _build_input_payload(
        self,
        source: ContentSource,
        item: dict[str, Any],
        source_item_id: str,
    ) -> dict[str, Any]:
        payload_source = (
            "youtube"
            if source.source_type == "youtube_search"
            else source.source_type
        )
        payload: dict[str, Any] = {
            "track": "unified",
            "discovery_track": source.track,
            "source_slug": source.slug,
            "source_type": source.source_type,
            "source_item_id": source_item_id,
            "source": payload_source,
            "source_video_id": source_item_id,
            "url": self._resolve_item_url(source, item, source_item_id),
            "owner_id": None,
            "item": dict(item),
        }
        if source.track == "knowledge":
            payload["source_metadata"] = dict(item)
        if source.config.get("query") is not None:
            payload["query"] = self._coerce_string(source.config.get("query"))
        if source.config.get("category") is not None:
            payload["category"] = self._coerce_string(source.config.get("category"))
        return payload

    def _get_job_type(self, source: ContentSource) -> str:
        return "index_video"

    def _get_latest_cursor(
        self,
        source: ContentSource,
        items: list[dict[str, Any]],
    ) -> str | None:
        if source.source_type in ("youtube", "youtube_search"):
            latest_item = max(
                items,
                key=lambda item: self._parse_datetime(
                    self._coerce_string(item.get("published_at"))
                )
                or datetime.min.replace(tzinfo=timezone.utc),
            )
            return self._coerce_string(latest_item.get("published_at"))

        latest_item = max(
            items,
            key=lambda item: self._cursor_sort_key(
                self._get_source_item_id(source, item)
            ),
        )
        return self._get_source_item_id(source, latest_item)

    async def _update_sync_cursor(
        self,
        db: Any,
        *,
        source_id: str,
        cursor: str,
        cursor_storage: str,
    ) -> None:
        if cursor_storage == "metadata":
            await db.execute(
                """
                UPDATE content_sources
                SET metadata = jsonb_set(
                    COALESCE(metadata, '{}'::jsonb),
                    '{sync_cursor}',
                    to_jsonb($1::text),
                    true
                )
                WHERE id = $2
                """,
                cursor,
                source_id,
            )
            return

        await db.execute(
            """
            UPDATE content_sources
            SET sync_cursor = $1
            WHERE id = $2
            """,
            cursor,
            source_id,
        )

    def _normalize_source(self, row: Any) -> ContentSource | None:
        source_row = dict(row)
        config_value = self._coerce_mapping(source_row.get("config"))
        metadata_value = self._coerce_mapping(source_row.get("metadata"))
        raw_config = config_value if config_value else metadata_value
        config = dict(raw_config) if raw_config else {}

        slug = self._coerce_string(source_row.get("slug"))
        track = self._coerce_string(source_row.get("track"))
        source_id = self._coerce_string(source_row.get("id"))
        if slug is None or track is None or source_id is None:
            self._logger.warning("Skipping malformed content source row: %s", source_row)
            return None

        if track not in {"broll", "knowledge", "unified"}:
            self._logger.warning(
                "Skipping unsupported content source '%s' with track '%s'.",
                slug,
                track,
            )
            return None

        source_type = (
            self._coerce_string(source_row.get("source_type"))
            or self._coerce_string(config.get("source_type"))
            or self._infer_source_type(track, slug, source_row, config)
        )
        if source_type is None:
            self._logger.warning(
                "Skipping content source '%s' because source_type could not be inferred.",
                slug,
            )
            return None

        sync_cursor = self._coerce_string(source_row.get("sync_cursor")) or self._coerce_string(
            config.get("sync_cursor")
        )
        cursor_storage = "column" if "sync_cursor" in source_row else "metadata"
        return ContentSource(
            id=source_id,
            slug=slug,
            track=track,
            source_type=source_type,
            config=config,
            sync_cursor=sync_cursor,
            is_active=bool(source_row.get("is_active", True)),
            cursor_storage=cursor_storage,
        )

    def _infer_source_type(
        self,
        track: str,
        slug: str,
        row: dict[str, Any],
        config: dict[str, Any],
    ) -> str | None:
        for candidate_key in ("provider", "source", "source_name"):
            candidate = self._coerce_string(config.get(candidate_key))
            if candidate:
                return candidate

        base_url = self._coerce_string(row.get("base_url")) or ""
        slug_lower = slug.lower()
        base_url_lower = base_url.lower()

        if track == "knowledge":
            return "youtube"
        if "pexels" in slug_lower or "pexels" in base_url_lower:
            return "pexels"
        if "pixabay" in slug_lower or "pixabay" in base_url_lower:
            return "pixabay"
        return None

    def _resolve_item_url(
        self,
        source: ContentSource,
        item: dict[str, Any],
        source_item_id: str,
    ) -> str:
        if source.source_type in ("youtube", "youtube_search"):
            return (
                self._coerce_string(item.get("source_url"))
                or self._coerce_string(item.get("video_url"))
                or f"https://www.youtube.com/watch?v={source_item_id}"
            )
        if source.source_type == "pexels":
            return (
                self._coerce_string(item.get("url"))
                or self._coerce_string(item.get("source_url"))
                or self._coerce_string(item.get("video_url"))
                or f"https://www.pexels.com/video/{source_item_id}/"
            )
        if source.source_type == "pixabay":
            return (
                self._coerce_string(item.get("pageURL"))
                or self._coerce_string(item.get("source_url"))
                or self._coerce_string(item.get("video_url"))
                or f"https://pixabay.com/videos/id-{source_item_id}/"
            )
        raise ValueError(
            f"Discovered item for source '{source.slug}' has unsupported source_type "
            f"'{source.source_type}'."
        )

    def _get_source_item_id(
        self,
        source: ContentSource,
        item: dict[str, Any],
    ) -> str:
        if source.source_type in ("youtube", "youtube_search"):
            source_item_id = self._coerce_string(
                item.get("source_video_id") or item.get("video_id") or item.get("id")
            )
        else:
            raw_identifier = item.get("id")
            source_item_id = self._coerce_string(raw_identifier)
            if source_item_id is None and raw_identifier is not None:
                source_item_id = str(raw_identifier)

        if source_item_id is None:
            raise ValueError(
                f"Discovered item for source '{source.slug}' is missing a source id."
            )
        return source_item_id

    def _require_config_value(self, source: ContentSource, key: str) -> str:
        value = self._coerce_string(source.config.get(key))
        if value is None:
            raise ValueError(f"Content source '{source.slug}' is missing config.{key}.")
        return value

    def _is_after_cursor(self, source_item_id: str, sync_cursor: str) -> bool:
        current_value = self._cursor_sort_key(source_item_id)
        cursor_value = self._cursor_sort_key(sync_cursor)
        return current_value > cursor_value

    def _cursor_sort_key(self, value: str) -> tuple[int, Any]:
        try:
            return (1, int(value))
        except (TypeError, ValueError):
            return (0, value)

    def _coerce_int(self, value: Any, *, default: int) -> int:
        if isinstance(value, bool):
            return default
        if isinstance(value, int):
            return value
        if value is None:
            return default
        try:
            return int(str(value).strip())
        except (TypeError, ValueError):
            return default

    def _coerce_string(self, value: Any) -> str | None:
        if isinstance(value, str):
            stripped = value.strip()
            return stripped or None
        if value is None:
            return None
        return str(value)

    def _coerce_mapping(self, value: Any) -> dict[str, Any] | None:
        if isinstance(value, dict):
            return dict(value)
        if not isinstance(value, str):
            return None

        try:
            decoded = json.loads(value)
        except json.JSONDecodeError:
            return None
        if isinstance(decoded, dict):
            return {str(key): item for key, item in decoded.items()}
        return None

    def _coerce_bool(self, value: Any, *, default: bool = False) -> bool:
        if isinstance(value, bool):
            return value
        if isinstance(value, (int, float)):
            return bool(value)
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized in {"1", "true", "yes", "on"}:
                return True
            if normalized in {"0", "false", "no", "off"}:
                return False
        return default

    def _coerce_string_set(self, value: Any) -> set[str]:
        if isinstance(value, str):
            raw_items: Sequence[Any] = value.split(",")
        elif isinstance(value, Sequence) and not isinstance(value, (str, bytes)):
            raw_items = value
        else:
            return set()

        normalized_items: set[str] = set()
        for item in raw_items:
            normalized = self._coerce_string(item)
            if normalized is not None:
                normalized_items.add(normalized)
        return normalized_items

    def _parse_datetime(self, value: str | None) -> datetime | None:
        if value is None:
            return None
        normalized_value = value.replace("Z", "+00:00")
        try:
            parsed = datetime.fromisoformat(normalized_value)
        except ValueError:
            return None
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)


def _extract_generated_text(response: Any) -> str | None:
    direct_text = getattr(response, "text", None)
    if isinstance(direct_text, str) and direct_text.strip():
        return direct_text.strip()
    if isinstance(response, Mapping):
        mapping_text = response.get("text")
        if isinstance(mapping_text, str) and mapping_text.strip():
            return mapping_text.strip()

    candidates = getattr(response, "candidates", None)
    if candidates is None and isinstance(response, Mapping):
        candidates = response.get("candidates")
    if not isinstance(candidates, Sequence) or isinstance(candidates, (str, bytes)):
        return None

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
    return joined or None


async def main() -> None:
    parser = argparse.ArgumentParser(
        description="Run the Cerul content discovery scheduler.",
    )
    parser.add_argument(
        "--once",
        action="store_true",
        help="Run a single discovery scan and exit.",
    )
    parser.add_argument(
        "--interval-seconds",
        type=int,
        default=300,
        help="Polling interval in loop mode.",
    )
    parser.add_argument(
        "--database-url",
        help="Optional asyncpg DSN. Falls back to DATABASE_URL.",
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )

    database_url = (args.database_url or os.getenv("DATABASE_URL") or "").strip()
    if not database_url:
        raise RuntimeError("DATABASE_URL is required.")

    connection = await asyncpg.connect(database_url)
    scheduler = ContentScheduler()

    try:
        if args.once:
            summary = await scheduler.run_once(connection)
            logger.info("Content discovery summary: %s", summary)
        else:
            await scheduler.run_loop(connection, interval_seconds=args.interval_seconds)
    finally:
        await connection.close()


if __name__ == "__main__":
    asyncio.run(main())
