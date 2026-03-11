from typing import Any

from workers.broll.repository import BrollAssetRepositoryProtocol
from workers.common.pipeline import PipelineContext, PipelineStep


class FetchAssetMetadataStep(PipelineStep):
    step_name = "FetchAssetMetadataStep"

    def __init__(self, repository: BrollAssetRepositoryProtocol | None = None) -> None:
        self._repository = repository

    async def _process(self, context: PipelineContext) -> None:
        repository = self._repository or context.conf.get("repository")
        if repository is None:
            raise RuntimeError("A B-roll asset repository is required.")

        normalized_assets: list[dict[str, Any]] = []
        metadata_errors: dict[str, str] = {}
        duplicate_asset_count = 0
        seen_asset_keys: set[tuple[str, str]] = set()

        for index, raw_asset in enumerate(context.data.get("raw_assets", [])):
            try:
                source = raw_asset["source"]
                payload = raw_asset["payload"]
                if not isinstance(payload, dict):
                    raise TypeError("Asset payload must be a dictionary.")
                asset = self._normalize_asset(source, payload)
                if not asset.get("video_url"):
                    raise ValueError("Asset payload is missing a usable video_url.")
            except (KeyError, TypeError, ValueError) as exc:
                metadata_errors[self._asset_error_key(raw_asset, index)] = str(exc)
                continue

            asset_key = (asset["source"], asset["source_asset_id"])
            if asset_key in seen_asset_keys:
                duplicate_asset_count += 1
                continue

            seen_asset_keys.add(asset_key)
            normalized_assets.append(asset)

        existing_asset_ids = await repository.bulk_check_existing(normalized_assets)
        assets = [
            asset for asset in normalized_assets if asset["id"] not in existing_asset_ids
        ]
        skipped_existing_count = len(normalized_assets) - len(assets)

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
        selected_video = self._pick_pixabay_video_variant(payload)
        tags = self._normalize_tags(payload.get("tags"))
        return {
            "id": f"pixabay_{source_asset_id}",
            "source": "pixabay",
            "source_asset_id": source_asset_id,
            "source_url": payload.get("pageURL") or self._pick_pixabay_video_url(payload),
            "thumbnail_url": self._pick_pixabay_thumbnail_url(
                payload,
                selected_video=selected_video,
            ),
            "video_url": selected_video.get("url") if selected_video else None,
            "duration": payload.get("duration"),
            "title": payload.get("title") or self._build_tag_title(
                tags,
                fallback=f"Pixabay video {source_asset_id}",
            ),
            "tags": tags,
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
        selected_video = self._pick_pixabay_video_variant(payload)
        if selected_video is None:
            return None
        video_url = selected_video.get("url")
        return str(video_url) if video_url else None

    def _pick_pixabay_thumbnail_url(
        self,
        payload: dict[str, Any],
        *,
        selected_video: dict[str, Any] | None = None,
    ) -> str | None:
        preferred_video = selected_video or self._pick_pixabay_video_variant(payload)
        if preferred_video is not None and preferred_video.get("thumbnail"):
            return str(preferred_video["thumbnail"])

        for video in self._iter_pixabay_video_variants(payload):
            if video.get("thumbnail"):
                return str(video["thumbnail"])

        return self._build_pixabay_thumbnail_url(payload.get("picture_id"))

    def _build_pixabay_thumbnail_url(self, picture_id: str | None) -> str | None:
        if not picture_id:
            return None
        return f"https://i.vimeocdn.com/video/{picture_id}_640x360.jpg"

    def _pick_pixabay_video_variant(
        self,
        payload: dict[str, Any],
    ) -> dict[str, Any] | None:
        for video in self._iter_pixabay_video_variants(payload):
            if video.get("url"):
                return video
        return None

    def _iter_pixabay_video_variants(self, payload: dict[str, Any]) -> list[dict[str, Any]]:
        videos = payload.get("videos") or {}
        if not isinstance(videos, dict):
            return []

        ranked_videos: list[tuple[tuple[int, int, int, int], dict[str, Any]]] = []
        size_order = {"tiny": 0, "small": 1, "medium": 2, "large": 3}
        for size_name, video in videos.items():
            if not isinstance(video, dict):
                continue

            ranked_videos.append(
                (
                    (
                        1 if video.get("url") else 0,
                        (video.get("width") or 0) * (video.get("height") or 0),
                        size_order.get(str(size_name), -1),
                        1 if video.get("thumbnail") else 0,
                    ),
                    video,
                )
            )

        ranked_videos.sort(key=lambda item: item[0], reverse=True)
        return [video for _, video in ranked_videos]

    def _normalize_tags(self, raw_tags: Any) -> list[str]:
        if raw_tags is None:
            return []
        if isinstance(raw_tags, str):
            return [tag.strip() for tag in raw_tags.split(",") if tag.strip()]
        if isinstance(raw_tags, list):
            return [str(tag).strip() for tag in raw_tags if str(tag).strip()]
        return [str(raw_tags).strip()]

    def _build_tag_title(self, tags: list[str], fallback: str) -> str:
        if not tags:
            return fallback
        return " ".join(tags[:3]).title()

    def _asset_error_key(self, raw_asset: Any, index: int) -> str:
        if not isinstance(raw_asset, dict):
            return f"asset_{index}"

        source = raw_asset.get("source", "unknown")
        payload = raw_asset.get("payload", {})
        if isinstance(payload, dict) and payload.get("id") is not None:
            return f"{source}:{payload['id']}"
        return f"{source}:{index}"
