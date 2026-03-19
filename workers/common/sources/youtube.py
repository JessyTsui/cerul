import os
import re
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

    async def get_video_metadata(self, video_id: str) -> dict[str, Any]:
        video_id = video_id.strip()
        if not video_id:
            raise ValueError("video_id is required.")

        payload = await self._get_json(
            "videos",
            {
                "id": video_id,
                "part": "snippet,contentDetails,status",
            },
        )
        items = payload.get("items", [])
        if not items:
            raise LookupError(f"YouTube video not found: {video_id}")

        return self._normalize_video(items[0])

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

        ordered_video_ids: list[str] = []
        seen_video_ids: set[str] = set()
        next_page_token: str | None = None

        while len(ordered_video_ids) < max_results:
            remaining = max_results - len(ordered_video_ids)
            payload = await self._get_json(
                "search",
                {
                    "channelId": channel_id,
                    "maxResults": min(remaining, 50),
                    "order": "date",
                    "pageToken": next_page_token,
                    "part": "snippet",
                    "type": "video",
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
                        "part": "snippet,contentDetails,status",
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

    def _build_watch_url(self, video_id: str) -> str:
        return f"https://www.youtube.com/watch?v={video_id}"

    def _chunked(self, values: list[str], size: int) -> list[list[str]]:
        return [values[index : index + size] for index in range(0, len(values), size)]
