from collections.abc import Mapping
from typing import Any

from backend.app.embedding import EmbeddingBackend, GeminiEmbeddingBackend
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
        self._embedding_backend = embedding_backend or GeminiEmbeddingBackend()
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
