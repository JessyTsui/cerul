import os
import re
import xml.etree.ElementTree as ET
from collections.abc import Sequence
from typing import Any

import httpx

_DURATION_RE = re.compile(
    r"^P"
    r"(?:(?P<days>\d+)D)?"
    r"(?:T"
    r"(?:(?P<hours>\d+)H)?"
    r"(?:(?P<minutes>\d+)M)?"
    r"(?:(?P<seconds>\d+)S)?"
    r")?$"
)


class YouTubeClient:
    base_url = "https://www.googleapis.com/youtube/v3"

    def __init__(
        self,
        api_key: str | None = None,
        timeout: float = 30.0,
        proxy: str | None = None,
    ) -> None:
        self._api_key = api_key or os.getenv("YOUTUBE_API_KEY")
        self._timeout = timeout
        self._proxy = proxy or os.getenv("YTDLP_PROXY") or os.getenv("HTTPS_PROXY") or os.getenv("HTTP_PROXY") or None

    async def get_channels_info(
        self,
        channel_ids: list[str],
    ) -> dict[str, dict[str, Any]]:
        """Batch-fetch channel snippet + statistics for a list of channel IDs.

        Returns a dict keyed by channel_id with thumbnail_url, description,
        custom_url, country, subscriber_count, video_count, view_count.
        """
        result: dict[str, dict[str, Any]] = {}
        for batch in self._chunked(channel_ids, 50):
            payload = await self._get_json(
                "channels",
                {
                    "id": ",".join(batch),
                    "part": "snippet,statistics,brandingSettings",
                },
            )
            for item in payload.get("items", []):
                cid = item.get("id", "")
                snippet = item.get("snippet") or {}
                statistics = item.get("statistics") or {}
                branding = item.get("brandingSettings") or {}
                branding_channel = branding.get("channel") or {}
                thumbnail_url = self._pick_thumbnail_url(snippet.get("thumbnails"))
                keywords = self._parse_channel_keywords(
                    branding_channel.get("keywords")
                )
                result[cid] = {
                    "thumbnail_url": thumbnail_url,
                    "description": (self._coerce_string(snippet.get("description")) or ""),
                    "custom_url": self._coerce_string(snippet.get("customUrl")),
                    "country": self._coerce_string(snippet.get("country")),
                    "subscriber_count": self._coerce_int(statistics.get("subscriberCount")),
                    "video_count": self._coerce_int(statistics.get("videoCount")),
                    "view_count": self._coerce_int(statistics.get("viewCount")),
                    "keywords": keywords,
                }
        return result

    async def get_video_metadata(self, video_id: str) -> dict[str, Any]:
        video_id = video_id.strip()
        if not video_id:
            raise ValueError("video_id is required.")

        payload = await self._get_json(
            "videos",
            {
                "id": video_id,
                "part": "snippet,contentDetails,status,statistics",
            },
        )
        items = payload.get("items", [])
        if not items:
            raise LookupError(f"YouTube video not found: {video_id}")

        return self._normalize_video(items[0])

    async def search_videos(
        self,
        query: str,
        max_results: int = 25,
        *,
        published_after: str | None = None,
        relevance_language: str | None = None,
        video_duration: str | None = None,
        event_type: str | None = None,
    ) -> list[dict[str, Any]]:
        query = query.strip()
        if not query:
            raise ValueError("query is required.")
        if max_results <= 0:
            raise ValueError("max_results must be greater than 0.")

        ordered_video_ids = await self._search_video_ids(
            {
                "eventType": event_type,
                "order": "relevance",
                "publishedAfter": published_after,
                "q": query,
                "relevanceLanguage": relevance_language,
                "videoDuration": video_duration,
            },
            max_results=max_results,
        )
        return await self._get_videos_by_ids(ordered_video_ids)

    async def search_channel_videos(
        self,
        channel_id: str,
        max_results: int = 25,
    ) -> list[dict[str, Any]]:
        channel_id = channel_id.strip()
        if not channel_id:
            raise ValueError("channel_id is required.")
        if max_results <= 0:
            raise ValueError("max_results must be greater than 0.")

        ordered_video_ids = await self._search_video_ids(
            {
                "channelId": channel_id,
                "order": "date",
            },
            max_results=max_results,
        )
        return await self._get_videos_by_ids(ordered_video_ids)

    async def _search_video_ids(
        self,
        params: dict[str, Any],
        *,
        max_results: int,
    ) -> list[str]:
        ordered_video_ids: list[str] = []
        seen_video_ids: set[str] = set()
        next_page_token: str | None = None

        while len(ordered_video_ids) < max_results:
            remaining = max_results - len(ordered_video_ids)
            payload = await self._get_json(
                "search",
                {
                    "maxResults": min(remaining, 50),
                    "pageToken": next_page_token,
                    "part": "snippet",
                    "type": "video",
                    **params,
                },
            )
            items = payload.get("items", [])
            for item in items:
                video_id = self._extract_video_id(item)
                if video_id is None or video_id in seen_video_ids:
                    continue
                seen_video_ids.add(video_id)
                ordered_video_ids.append(video_id)
                if len(ordered_video_ids) >= max_results:
                    break

            next_page_token = self._coerce_string(payload.get("nextPageToken"))
            if next_page_token is None:
                break

        return ordered_video_ids

    async def _get_videos_by_ids(
        self,
        ordered_video_ids: list[str],
    ) -> list[dict[str, Any]]:
        if not ordered_video_ids:
            return []

        normalized_by_id = {
            metadata["source_video_id"]: metadata
            for video_id_batch in self._chunked(ordered_video_ids, 50)
            for item in (
                await self._get_json(
                    "videos",
                    {
                        "id": ",".join(video_id_batch),
                        "part": "snippet,contentDetails,status,statistics",
                    },
                )
            ).get("items", [])
            for metadata in [self._normalize_video(item)]
        }
        return [
            normalized_by_id[video_id]
            for video_id in ordered_video_ids
            if video_id in normalized_by_id
        ]

    async def _get_json(
        self,
        endpoint: str,
        params: dict[str, Any],
    ) -> dict[str, Any]:
        api_key = (self._api_key or "").strip()
        if not api_key:
            raise RuntimeError("YOUTUBE_API_KEY is required to query YouTube.")

        request_params = dict(params)
        request_params["key"] = api_key
        request_params = {
            key: value for key, value in request_params.items() if value is not None
        }

        async with httpx.AsyncClient(timeout=self._timeout, proxy=self._proxy) as client:
            response = await client.get(f"{self.base_url}/{endpoint}", params=request_params)

        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict):
            raise ValueError("Unexpected YouTube API response payload.")
        return payload

    def _normalize_video(self, payload: dict[str, Any]) -> dict[str, Any]:
        video_id = self._extract_video_id(payload)
        if video_id is None:
            raise ValueError("YouTube payload is missing a video id.")

        snippet = payload.get("snippet") or {}
        content_details = payload.get("contentDetails") or {}
        status = payload.get("status") or {}
        statistics = payload.get("statistics") or {}
        watch_url = self._build_watch_url(video_id)
        duration_seconds = self._parse_duration_seconds(content_details.get("duration"))

        channel_title = self._coerce_string(snippet.get("channelTitle"))
        return {
            "source": "youtube",
            "source_video_id": video_id,
            "video_id": video_id,
            "source_url": watch_url,
            "video_url": watch_url,
            "thumbnail_url": self._pick_thumbnail_url(snippet.get("thumbnails")),
            "title": self._coerce_string(snippet.get("title")) or video_id,
            "description": self._coerce_string(snippet.get("description")) or "",
            "speaker": channel_title,
            "creator": channel_title,
            "channel_title": channel_title,
            "channel_id": self._coerce_string(snippet.get("channelId")),
            "published_at": self._coerce_string(snippet.get("publishedAt")),
            "duration": duration_seconds,
            "duration_seconds": duration_seconds,
            "view_count": self._coerce_int(statistics.get("viewCount")),
            "like_count": self._coerce_int(statistics.get("likeCount")),
            "license": self._normalize_license(status.get("license")),
            "privacy_status": self._coerce_string(status.get("privacyStatus")),
            "embeddable": status.get("embeddable"),
            "live_broadcast_content": self._coerce_string(
                snippet.get("liveBroadcastContent")
            ),
            "tags": self._coerce_tags(snippet.get("tags")),
        }

    def _extract_video_id(self, payload: dict[str, Any]) -> str | None:
        raw_id = payload.get("id")
        if isinstance(raw_id, str) and raw_id:
            return raw_id
        if isinstance(raw_id, dict):
            nested_video_id = raw_id.get("videoId")
            if isinstance(nested_video_id, str) and nested_video_id:
                return nested_video_id
        return None

    def _pick_thumbnail_url(self, thumbnails: Any) -> str | None:
        if not isinstance(thumbnails, dict):
            return None

        for key in ("maxres", "standard", "high", "medium", "default"):
            item = thumbnails.get(key)
            if isinstance(item, dict):
                url = self._coerce_string(item.get("url"))
                if url:
                    return url
        return None

    def _parse_duration_seconds(self, raw_duration: Any) -> int:
        duration = self._coerce_string(raw_duration)
        if not duration:
            return 0

        match = _DURATION_RE.fullmatch(duration)
        if match is None:
            raise ValueError(f"Unsupported YouTube duration format: {duration}")

        parts = {key: int(value or "0") for key, value in match.groupdict().items()}
        return (
            parts["days"] * 86400
            + parts["hours"] * 3600
            + parts["minutes"] * 60
            + parts["seconds"]
        )

    def _normalize_license(self, raw_license: Any) -> str:
        license_value = self._coerce_string(raw_license)
        if license_value == "creativeCommon":
            return "creative-commons"
        if license_value == "youtube":
            return "standard-youtube-license"
        return license_value or "standard-youtube-license"

    def _coerce_tags(self, raw_tags: Any) -> list[str]:
        if not isinstance(raw_tags, Sequence) or isinstance(raw_tags, (str, bytes)):
            return []
        return [tag.strip() for tag in raw_tags if isinstance(tag, str) and tag.strip()]

    def _coerce_string(self, value: Any) -> str | None:
        if not isinstance(value, str):
            return None
        stripped = value.strip()
        return stripped or None

    def _coerce_int(self, value: Any) -> int | None:
        if isinstance(value, bool):
            return None
        if isinstance(value, int):
            return value
        if isinstance(value, str):
            stripped = value.strip()
            if not stripped:
                return None
            try:
                return int(stripped)
            except ValueError:
                return None
        return None

    def _build_watch_url(self, video_id: str) -> str:
        return f"https://www.youtube.com/watch?v={video_id}"

    async def get_rss_video_ids(self, channel_id: str) -> list[str]:
        """Fetch the latest video IDs from a channel's RSS feed (free, no quota)."""
        url = f"https://www.youtube.com/feeds/videos.xml?channel_id={channel_id}"
        async with httpx.AsyncClient(timeout=self._timeout, proxy=self._proxy) as client:
            response = await client.get(url)
        response.raise_for_status()
        root = ET.fromstring(response.text)

        ns = {"atom": "http://www.w3.org/2005/Atom", "yt": "http://www.youtube.com/xml/schemas/2015"}
        video_ids: list[str] = []
        for entry in root.findall("atom:entry", ns):
            vid_el = entry.find("yt:videoId", ns)
            if vid_el is not None and vid_el.text:
                video_ids.append(vid_el.text.strip())
        return video_ids

    def _parse_channel_keywords(self, raw: Any) -> list[str]:
        """Parse YouTube channel keywords string into a list."""
        if not isinstance(raw, str) or not raw.strip():
            return []
        keywords: list[str] = []
        for match in re.finditer(r'"([^"]+)"|(\S+)', raw):
            keyword = (match.group(1) or match.group(2) or "").strip()
            if keyword:
                keywords.append(keyword)
        return keywords

    def _chunked(self, values: list[str], size: int) -> list[list[str]]:
        return [values[index : index + size] for index in range(0, len(values), size)]
