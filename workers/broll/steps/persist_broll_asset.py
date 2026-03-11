from workers.broll.repository import BrollAssetRepositoryProtocol
from workers.common.pipeline import PipelineContext, PipelineStep


class PersistBrollAssetStep(PipelineStep):
    step_name = "PersistBrollAssetStep"

    def __init__(self, repository: BrollAssetRepositoryProtocol | None = None) -> None:
        self._repository = repository

    async def _process(self, context: PipelineContext) -> None:
        repository = self._repository or context.conf.get("repository")
        if repository is None:
            raise RuntimeError("A B-roll asset repository is required.")

        frame_paths = context.data.get("frame_paths", {})
        embeddings = context.data.get("embeddings", {})
        assets_to_store: list[dict[str, object]] = []
        embeddings_to_store: list[list[float]] = []
        persisted_assets: list[dict[str, object]] = []

        for asset in context.data.get("assets", []):
            asset_id = asset["id"]
            embedding = embeddings.get(asset_id)
            if embedding is None:
                continue

            assets_to_store.append(asset)
            embeddings_to_store.append(list(embedding))
            persisted_asset = dict(asset)
            persisted_asset["embedding"] = list(embedding)
            persisted_asset["frame_path"] = frame_paths.get(asset_id)
            persisted_assets.append(persisted_asset)

        indexed_count = await repository.store_assets_batch(
            assets_to_store,
            embeddings_to_store,
        )
        context.data["persisted_assets"] = persisted_assets
        context.data["indexed_assets_count"] = indexed_count
