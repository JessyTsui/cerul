import asyncio
from collections.abc import Mapping
from typing import Any

from workers.common.pipeline import PipelineContext, PipelineStep
from workers.common.sources import PexelsClient, PixabayClient


class DiscoverAssetStep(PipelineStep):
    step_name = "DiscoverAssetStep"

    def __init__(
        self,
        pexels_client: PexelsClient | None = None,
        pixabay_client: PixabayClient | None = None,
    ) -> None:
        self._pexels_client = pexels_client
        self._pixabay_client = pixabay_client

    async def _process(self, context: PipelineContext) -> None:
        query = context.data.get("query") or context.data.get("category")
        if not query:
            raise ValueError("B-roll discovery requires query or category input.")

        per_page = int(context.conf.get("per_page", 50))
        requested_sources = list(context.conf.get("sources", ["pexels", "pixabay"]))

        clients: Mapping[str, Any] = {
            "pexels": self._pexels_client or context.conf.get("pexels_client"),
            "pixabay": self._pixabay_client or context.conf.get("pixabay_client"),
        }

        coroutines: list[Any] = []
        source_names: list[str] = []
        for source_name in requested_sources:
            client = clients.get(source_name)
            if client is None:
                continue
            source_names.append(source_name)
            coroutines.append(client.search_videos(query=query, per_page=per_page))

        if not coroutines:
            raise RuntimeError("No content source clients are configured for discovery.")

        discovered_assets: list[dict[str, Any]] = []
        warnings: dict[str, str] = {}
        results = await asyncio.gather(*coroutines, return_exceptions=True)

        for source_name, result in zip(source_names, results, strict=True):
            if isinstance(result, Exception):
                warnings[source_name] = str(result)
                continue

            discovered_assets.extend(
                {"source": source_name, "payload": payload} for payload in result
            )

        if not discovered_assets and len(warnings) == len(source_names):
            details = "; ".join(
                f"{source_name}: {message}"
                for source_name, message in warnings.items()
            )
            raise RuntimeError(
                f"Unable to discover assets from the configured providers. {details}"
            )

        context.data["raw_assets"] = discovered_assets
        context.data["discovered_assets_count"] = len(discovered_assets)
        if warnings:
            context.data["discovery_warnings"] = warnings
