from workers.broll.repository import BrollAssetRepository
from workers.common.pipeline import PipelineContext, PipelineStep


class PersistBrollAssetStep(PipelineStep):
    step_name = "PersistBrollAssetStep"

    def __init__(self, repository: BrollAssetRepository | None = None) -> None:
        self._repository = repository

    async def _process(self, context: PipelineContext) -> None:
        repository = self._repository or context.conf.get("repository")
        if repository is None:
            raise RuntimeError("A B-roll asset repository is required.")

        frame_paths = context.data.get("frame_paths", {})
        embeddings = context.data.get("embeddings", {})
        persisted_assets: list[dict[str, object]] = []

        for asset in context.data.get("assets", []):
            asset_id = asset["id"]
            embedding = embeddings.get(asset_id)
            if embedding is None:
                continue

            persisted_asset = await repository.upsert_broll_asset(
                asset=asset,
                embedding=embedding,
                frame_path=frame_paths.get(asset_id),
            )
            persisted_assets.append(persisted_asset)

        context.data["persisted_assets"] = persisted_assets
        context.data["indexed_assets_count"] = len(persisted_assets)
