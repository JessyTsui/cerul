from typing import Any

from workers.broll.repository import BrollAssetRepository
from workers.common.pipeline import PipelineContext, PipelineStep


class FetchAssetMetadataStep(PipelineStep):
    step_name = "FetchAssetMetadataStep"

    def __init__(self, repository: BrollAssetRepository | None = None) -> None:
        self._repository = repository

    async def _process(self, context: PipelineContext) -> None:
        repository = self._repository or context.conf.get("repository")
        if repository is None:
            raise RuntimeError("A B-roll asset repository is required.")

        assets: list[dict[str, Any]] = []
        metadata_errors: dict[str, str] = {}
        skipped_existing_count = 0
        duplicate_asset_count = 0
        seen_asset_keys: set[tuple[str, str]] = set()

        for index, raw_asset in enumerate(context.data.get("raw_assets", [])):
            try:
                source = raw_asset["source"]
                payload = raw_asset["payload"]
                if not isinstance(payload, dict):
                    raise TypeError("Asset payload must be a dictionary.")
                asset = self._normalize_asset(source, payload)
            except (KeyError, TypeError, ValueError) as exc:
                metadata_errors[self._asset_error_key(raw_asset, index)] = str(exc)
                continue

            asset_key = (asset["source"], asset["source_asset_id"])
            if asset_key in seen_asset_keys:
                duplicate_asset_count += 1
                continue

            seen_asset_keys.add(asset_key)

            if await repository.asset_exists(asset["source"], asset["source_asset_id"]):
                skipped_existing_count += 1
                continue

            assets.append(asset)

        context.data["assets"] = assets
        context.data["new_assets_count"] = len(assets)
        context.data["skipped_existing_count"] = skipped_existing_count
        context.data["duplicate_asset_count"] = duplicate_asset_count
        if metadata_errors:
            context.data["metadata_errors"] = metadata_errors

    def _normalize_asset(self, source: str, payload: dict[str, Any]) -> dict[str, Any]:
        if source == "pexels":
            return self._normalize_pexels_asset(payload)
        if source == "pixabay":
            return self._normalize_pixabay_asset(payload)
        raise ValueError(f"Unsupported asset source: {source}")

    def _normalize_pexels_asset(self, payload: dict[str, Any]) -> dict[str, Any]:
        source_asset_id = str(payload["id"])
        return {
            "id": f"pexels_{source_asset_id}",
            "source": "pexels",
            "source_asset_id": source_asset_id,
            "source_url": payload.get("url") or self._pick_pexels_video_url(payload),
            "thumbnail_url": payload.get("image"),
            "video_url": self._pick_pexels_video_url(payload),
            "duration": payload.get("duration"),
            "title": payload.get("title") or f"Pexels video {source_asset_id}",
            "tags": self._normalize_tags(payload.get("tags")),
            "license": payload.get("license") or "Pexels License",
            "creator": (payload.get("user") or {}).get("name"),
        }

    def _normalize_pixabay_asset(self, payload: dict[str, Any]) -> dict[str, Any]:
        source_asset_id = str(payload["id"])
        picture_id = payload.get("picture_id")
        return {
            "id": f"pixabay_{source_asset_id}",
            "source": "pixabay",
            "source_asset_id": source_asset_id,
            "source_url": payload.get("pageURL") or self._pick_pixabay_video_url(payload),
            "thumbnail_url": self._build_pixabay_thumbnail_url(picture_id),
            "video_url": self._pick_pixabay_video_url(payload),
            "duration": payload.get("duration"),
            "title": payload.get("title") or f"Pixabay video {source_asset_id}",
            "tags": self._normalize_tags(payload.get("tags")),
            "license": payload.get("license") or "Pixabay License",
            "creator": payload.get("user"),
        }

    def _pick_pexels_video_url(self, payload: dict[str, Any]) -> str | None:
        video_files = payload.get("video_files") or []
        if not video_files:
            return None

        ranked_video_files = sorted(
            (video_file for video_file in video_files if video_file.get("link")),
            key=lambda video_file: (
                (video_file.get("width") or 0) * (video_file.get("height") or 0),
                str(video_file.get("quality") or ""),
            ),
            reverse=True,
        )
        return ranked_video_files[0]["link"] if ranked_video_files else None

    def _pick_pixabay_video_url(self, payload: dict[str, Any]) -> str | None:
        videos = payload.get("videos") or {}
        for size in ("large", "medium", "small", "tiny"):
            video = videos.get(size) or {}
            if video.get("url"):
                return video["url"]
        return None

    def _build_pixabay_thumbnail_url(self, picture_id: str | None) -> str | None:
        if not picture_id:
            return None
        return f"https://i.vimeocdn.com/video/{picture_id}_640x360.jpg"

    def _normalize_tags(self, raw_tags: Any) -> list[str]:
        if raw_tags is None:
            return []
        if isinstance(raw_tags, str):
            return [tag.strip() for tag in raw_tags.split(",") if tag.strip()]
        if isinstance(raw_tags, list):
            return [str(tag).strip() for tag in raw_tags if str(tag).strip()]
        return [str(raw_tags).strip()]

    def _asset_error_key(self, raw_asset: Any, index: int) -> str:
        if not isinstance(raw_asset, dict):
            return f"asset_{index}"

        source = raw_asset.get("source", "unknown")
        payload = raw_asset.get("payload", {})
        if isinstance(payload, dict) and payload.get("id") is not None:
            return f"{source}:{payload['id']}"
        return f"{source}:{index}"
