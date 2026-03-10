import os
from typing import Any

import httpx


class PexelsClient:
    base_url = "https://api.pexels.com/videos/search"

    def __init__(self, api_key: str | None = None, timeout: float = 30.0) -> None:
        self._api_key = api_key or os.getenv("PEXELS_API_KEY")
        self._timeout = timeout

    async def search_videos(
        self,
        query: str,
        per_page: int = 50,
    ) -> list[dict[str, Any]]:
        if not self._api_key:
            raise RuntimeError("PEXELS_API_KEY is required to query Pexels.")

        async with httpx.AsyncClient(timeout=self._timeout) as client:
            response = await client.get(
                self.base_url,
                params={"query": query, "per_page": per_page},
                headers={"Authorization": self._api_key},
            )

        response.raise_for_status()
        payload = response.json()
        return payload.get("videos", [])
