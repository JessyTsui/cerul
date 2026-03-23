import asyncio
import logging
import os
from typing import Any

import httpx


class PixabayClient:
    base_url = "https://pixabay.com/api/videos/"

    def __init__(
        self,
        api_key: str | None = None,
        timeout: float = 30.0,
        max_retries: int = 2,
    ) -> None:
        self._api_key = api_key or os.getenv("PIXABAY_API_KEY")
        self._timeout = timeout
        self._max_retries = max_retries
        self._logger = logging.getLogger(__name__)

    async def search_videos(
        self,
        query: str,
        per_page: int = 50,
        *,
        page: int = 1,
        order: str = "popular",
        safesearch: bool = True,
        video_type: str = "film",
        category: str | None = None,
        editors_choice: bool | None = None,
        min_width: int | None = None,
        min_height: int | None = None,
        lang: str | None = None,
    ) -> list[dict[str, Any]]:
        if not self._api_key:
            raise RuntimeError("PIXABAY_API_KEY is required to query Pixabay.")
        if not query.strip():
            raise ValueError("Pixabay search requires a non-empty query.")
        if per_page < 1:
            raise ValueError("Pixabay search requires per_page >= 1.")
        if page < 1:
            raise ValueError("Pixabay search requires page >= 1.")

        params = self._build_search_params(
            query=query,
            per_page=per_page,
            page=page,
            order=order,
            safesearch=safesearch,
            video_type=video_type,
            category=category,
            editors_choice=editors_choice,
            min_width=min_width,
            min_height=min_height,
            lang=lang,
        )

        async with httpx.AsyncClient(timeout=self._timeout) as client:
            response = await self._request_with_retry(client=client, params=params)

        response.raise_for_status()
        payload = response.json()
        hits = payload.get("hits", [])
        if not isinstance(hits, list):
            raise ValueError("Pixabay response payload is missing a valid hits list.")
        return [hit for hit in hits if isinstance(hit, dict)]

    async def get_video(self, video_id: str) -> dict[str, Any]:
        if not self._api_key:
            raise RuntimeError("PIXABAY_API_KEY is required to query Pixabay.")

        async with httpx.AsyncClient(timeout=self._timeout) as client:
            response = await self._request_with_retry(
                client=client,
                params={"key": self._api_key, "id": video_id},
            )

        response.raise_for_status()
        payload = response.json()
        hits = payload.get("hits", [])
        if not isinstance(hits, list) or not hits:
            raise LookupError(f"Pixabay video not found: {video_id}")
        first_hit = hits[0]
        if not isinstance(first_hit, dict):
            raise ValueError("Pixabay video details payload is invalid.")
        return first_hit

    async def _request_with_retry(
        self,
        *,
        client: httpx.AsyncClient,
        params: dict[str, Any],
    ) -> httpx.Response:
        for attempt in range(self._max_retries + 1):
            response = await client.get(
                self.base_url,
                params=params,
            )
            status_code = getattr(response, "status_code", httpx.codes.OK)
            if status_code != httpx.codes.TOO_MANY_REQUESTS:
                return response

            if attempt >= self._max_retries:
                return response

            retry_after = _resolve_retry_after(
                getattr(response, "headers", {}).get("retry-after"),
                default_seconds=float(attempt + 1),
            )
            self._logger.warning(
                "Pixabay rate limit hit for query=%s page=%s, sleeping %.2fs before retry.",
                params.get("q"),
                params.get("page", 1),
                retry_after,
            )
            await asyncio.sleep(retry_after)

        raise RuntimeError("Unexpected Pixabay retry loop exit.")

    def _build_search_params(
        self,
        *,
        query: str,
        per_page: int,
        page: int,
        order: str,
        safesearch: bool,
        video_type: str,
        category: str | None,
        editors_choice: bool | None,
        min_width: int | None,
        min_height: int | None,
        lang: str | None,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {
            "key": self._api_key,
            "q": query,
            "per_page": per_page,
            "page": page,
            "order": order,
            "safesearch": str(safesearch).lower(),
            "video_type": video_type,
        }

        optional_params = {
            "category": category,
            "editors_choice": (
                None
                if editors_choice is None
                else str(editors_choice).lower()
            ),
            "min_width": min_width,
            "min_height": min_height,
            "lang": lang,
        }
        params.update(
            {
                key: value
                for key, value in optional_params.items()
                if value is not None
            }
        )
        return params


def _resolve_retry_after(
    header_value: str | None,
    *,
    default_seconds: float,
) -> float:
    if header_value is None:
        return default_seconds

    try:
        return max(float(header_value), 0.0)
    except ValueError:
        return default_seconds
