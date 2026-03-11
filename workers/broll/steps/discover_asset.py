import asyncio
from collections.abc import Mapping
from typing import Any

from workers.common.pipeline import PipelineContext, PipelineStep
from workers.common.sources import PexelsClient, PixabayClient


class DiscoverAssetStep(PipelineStep):
    step_name = "DiscoverAssetStep"
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
    _pixabay_int_option_names = ("page", "min_width", "min_height")
    _pixabay_bool_option_names = ("safesearch", "editors_choice")

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
        requested_sources = self._normalize_sources(
            context.conf.get("sources", ["pexels", "pixabay"])
        )

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
            coroutines.append(
                client.search_videos(
                    **self._build_search_kwargs(
                        source_name=source_name,
                        query=query,
                        per_page=per_page,
                        conf=context.conf,
                    )
                )
            )

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

    def _normalize_sources(self, raw_sources: Any) -> list[str]:
        if raw_sources is None:
            return ["pexels", "pixabay"]
        if isinstance(raw_sources, str):
            return [raw_sources]
        return [str(source) for source in raw_sources]

    def _build_search_kwargs(
        self,
        *,
        source_name: str,
        query: str,
        per_page: int,
        conf: Mapping[str, Any],
    ) -> dict[str, Any]:
        search_kwargs: dict[str, Any] = {
            "query": query,
            "per_page": per_page,
        }

        if source_name != "pixabay":
            return search_kwargs

        pixabay_options: dict[str, Any] = {}
        raw_pixabay_options = conf.get("pixabay_search_options", {})
        if isinstance(raw_pixabay_options, Mapping):
            pixabay_options.update(
                {
                    str(key): value
                    for key, value in raw_pixabay_options.items()
                    if str(key) in self._pixabay_option_names
                }
            )

        for option_name in self._pixabay_option_names:
            if option_name in conf:
                pixabay_options[option_name] = conf[option_name]

            prefixed_option_name = f"pixabay_{option_name}"
            if prefixed_option_name in conf:
                pixabay_options[option_name] = conf[prefixed_option_name]

        search_kwargs.update(
            {
                key: normalized_value
                for key, value in pixabay_options.items()
                if (
                    normalized_value := self._normalize_pixabay_option_value(
                        option_name=key,
                        value=value,
                    )
                )
                is not None
            }
        )
        return search_kwargs

    def _normalize_pixabay_option_value(
        self,
        *,
        option_name: str,
        value: Any,
    ) -> Any:
        if value is None:
            return None

        if option_name in self._pixabay_int_option_names:
            return self._coerce_int_option(value)

        if option_name in self._pixabay_bool_option_names:
            return self._coerce_bool_option(value)

        normalized_value = str(value).strip()
        return normalized_value or None

    def _coerce_int_option(self, value: Any) -> int | None:
        if isinstance(value, bool):
            return None
        if isinstance(value, int):
            return value

        try:
            return int(str(value).strip())
        except (TypeError, ValueError):
            return None

    def _coerce_bool_option(self, value: Any) -> bool | None:
        if isinstance(value, bool):
            return value
        if isinstance(value, (int, float)) and value in (0, 1):
            return bool(value)

        normalized_value = str(value).strip().lower()
        if normalized_value in {"1", "true", "yes", "on"}:
            return True
        if normalized_value in {"0", "false", "no", "off"}:
            return False
        return None
