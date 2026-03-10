import os
from typing import Any

import httpx


class PixabayClient:
    base_url = "https://pixabay.com/api/videos/"

    def __init__(self, api_key: str | None = None, timeout: float = 30.0) -> None:
        self._api_key = api_key or os.getenv("PIXABAY_API_KEY")
        self._timeout = timeout

    async def search_videos(
        self,
        query: str,
        per_page: int = 50,
    ) -> list[dict[str, Any]]:
        if not self._api_key:
            raise RuntimeError("PIXABAY_API_KEY is required to query Pixabay.")

        async with httpx.AsyncClient(timeout=self._timeout) as client:
            response = await client.get(
                self.base_url,
                params={"key": self._api_key, "q": query, "per_page": per_page},
            )

        response.raise_for_status()
        payload = response.json()
        return payload.get("hits", [])
