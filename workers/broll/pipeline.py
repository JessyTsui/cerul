from collections.abc import Mapping
from typing import Any

from backend.app.embedding import EmbeddingBackend, create_embedding_backend
from workers.common.pipeline import PipelineContext, PipelineExecutor
from workers.common.sources import PexelsClient, PixabayClient

from .repository import (
    BrollAssetRepositoryProtocol,
    resolve_default_broll_repository,
)
from .steps import (
    DiscoverAssetStep,
    DownloadPreviewFrameStep,
    FetchAssetMetadataStep,
    GenerateEmbeddingStep,
    MarkJobCompletedStep,
    PersistBrollAssetStep,
)

DEFAULT_BROLL_STEP_TIMEOUTS: dict[str, float] = {
    "DiscoverAssetStep": 90.0,
    "FetchAssetMetadataStep": 120.0,
    "DownloadPreviewFrameStep": 180.0,
    "GenerateEmbeddingStep": 300.0,
    "PersistBrollAssetStep": 120.0,
}
DEFAULT_BROLL_EMBEDDING_DIMENSION = 768

DEFAULT_BROLL_TIMEOUT_GUIDANCE: dict[str, str] = {
    "DiscoverAssetStep": "Check upstream source reachability and search provider quotas.",
    "FetchAssetMetadataStep": "Metadata enrichment is taking too long; inspect upstream API health.",
    "DownloadPreviewFrameStep": "Preview frame download stalled; check source media reachability or proxy settings.",
    "GenerateEmbeddingStep": "Embedding generation stalled; verify the embedding provider and outbound network path.",
    "PersistBrollAssetStep": "Database persistence stalled; inspect Postgres health and any lock contention.",
}


class BrollIndexingPipeline:
    def __init__(
        self,
        repository: BrollAssetRepositoryProtocol | None = None,
        embedding_backend: EmbeddingBackend | None = None,
        pexels_client: PexelsClient | None = None,
        pixabay_client: PixabayClient | None = None,
        temp_dir_root: str | None = None,
        db_url: str | None = None,
    ) -> None:
        self._repository = repository or resolve_default_broll_repository(db_url)
        self._embedding_backend = embedding_backend or create_embedding_backend(
            output_dimension=DEFAULT_BROLL_EMBEDDING_DIMENSION
        )
        self._pexels_client = pexels_client or PexelsClient()
        self._pixabay_client = pixabay_client or PixabayClient()
        self._temp_dir_root = temp_dir_root
        self._executor = PipelineExecutor(
            [
                DiscoverAssetStep(
                    pexels_client=self._pexels_client,
                    pixabay_client=self._pixabay_client,
                ),
                FetchAssetMetadataStep(repository=self._repository),
                DownloadPreviewFrameStep(),
                GenerateEmbeddingStep(
                    embedding_backend=self._embedding_backend,
                ),
                PersistBrollAssetStep(repository=self._repository),
                MarkJobCompletedStep(repository=self._repository),
            ]
        )

    async def run(
        self,
        query: str,
        *,
        category: str | None = None,
        job_id: str | None = None,
        conf: Mapping[str, Any] | None = None,
    ) -> PipelineContext:
        runtime_conf = dict(conf or {})
        runtime_conf["step_timeouts"] = {
            **DEFAULT_BROLL_STEP_TIMEOUTS,
            **dict(runtime_conf.get("step_timeouts") or {}),
        }
        runtime_conf["step_timeout_guidance"] = {
            **DEFAULT_BROLL_TIMEOUT_GUIDANCE,
            **dict(runtime_conf.get("step_timeout_guidance") or {}),
        }
        runtime_conf.setdefault("repository", self._repository)
        runtime_conf.setdefault("embedding_backend", self._embedding_backend)
        runtime_conf.setdefault("pexels_client", self._pexels_client)
        runtime_conf.setdefault("pixabay_client", self._pixabay_client)
        runtime_conf.setdefault("temp_dir_root", self._temp_dir_root)

        context = PipelineContext(conf=runtime_conf, data={"query": query})
        if category is not None:
            context.data["category"] = category
        if job_id is not None:
            context.data["job_id"] = job_id

        return await self._executor.run(context)
