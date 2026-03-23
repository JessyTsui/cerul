import os
import asyncio
import logging
from typing import Any

import httpx


class PexelsClient:
    base_url = "https://api.pexels.com/videos/search"
    details_url = "https://api.pexels.com/videos/videos"

    def __init__(
        self,
        api_key: str | None = None,
        timeout: float = 30.0,
        max_retries: int = 2,
    ) -> None:
        self._api_key = api_key or os.getenv("PEXELS_API_KEY")
        self._timeout = timeout
        self._max_retries = max_retries
        self._logger = logging.getLogger(__name__)

    async def search_videos(
        self,
        query: str,
        per_page: int = 50,
        *,
        page: int = 1,
    ) -> list[dict[str, Any]]:
        if not self._api_key:
            raise RuntimeError("PEXELS_API_KEY is required to query Pexels.")
        if not query.strip():
            raise ValueError("Pexels search requires a non-empty query.")
        if per_page < 1:
            raise ValueError("Pexels search requires per_page >= 1.")
        if page < 1:
            raise ValueError("Pexels search requires page >= 1.")

        async with httpx.AsyncClient(timeout=self._timeout) as client:
            response = await self._request_with_retry(
                client=client,
                params={"query": query, "per_page": per_page, "page": page},
            )

        response.raise_for_status()
        payload = response.json()
        return payload.get("videos", [])

    async def get_video(self, video_id: str) -> dict[str, Any]:
        if not self._api_key:
            raise RuntimeError("PEXELS_API_KEY is required to query Pexels.")

        async with httpx.AsyncClient(timeout=self._timeout) as client:
            response = await client.get(
                f"{self.details_url}/{video_id}",
                headers={"Authorization": self._api_key},
            )

        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict):
            raise ValueError("Pexels video details payload is invalid.")
        return payload

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
                headers={"Authorization": self._api_key},
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
                "Pexels rate limit hit for query=%s page=%s, sleeping %.2fs before retry.",
                params.get("query"),
                params.get("page", 1),
                retry_after,
            )
            await asyncio.sleep(retry_after)

        raise RuntimeError("Unexpected Pexels retry loop exit.")


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
