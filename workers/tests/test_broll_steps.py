import asyncio
from unittest.mock import patch

from workers.broll import BrollIndexingPipeline
from workers.broll.repository import InMemoryBrollAssetRepository
from workers.broll.steps import (
    DiscoverAssetStep,
    FetchAssetMetadataStep,
    GenerateClipEmbeddingStep,
)
from workers.broll.steps import download_preview_frame as download_preview_frame_module
from workers.common.pipeline import PipelineContext


class FakeEmbeddingBackend:
    name = "fake-clip"

    def dimension(self) -> int:
        return 512

    def embed_text(self, text: str) -> list[float]:
        return [0.0] * self.dimension()

    def embed_image(self, image_path: str) -> list[float]:
        return [float(index) for index in range(self.dimension())]


class FakeSourceClient:
    def __init__(self, payload: list[dict[str, object]]) -> None:
        self._payload = payload

    async def search_videos(
        self,
        query: str,
        per_page: int = 50,
    ) -> list[dict[str, object]]:
        return self._payload


class PerAssetEmbeddingBackend(FakeEmbeddingBackend):
    def embed_image(self, image_path: str) -> list[float]:
        if image_path.endswith("bad.jpg"):
            raise RuntimeError("corrupt preview frame")
        return super().embed_image(image_path)


class FakeResponse:
    def __init__(self, content: bytes = b"fake-image") -> None:
        self.content = content
        self.headers = {"content-type": "image/jpeg"}

    def raise_for_status(self) -> None:
        return None


class FakeAsyncClient:
    def __init__(self, *args, **kwargs) -> None:
        return None

    async def __aenter__(self) -> "FakeAsyncClient":
        return self

    async def __aexit__(self, exc_type, exc, tb) -> bool:
        return False

    async def get(self, url: str) -> FakeResponse:
        return FakeResponse()


def test_fetch_asset_metadata_step_normalizes_pexels_payload() -> None:
    repository = InMemoryBrollAssetRepository()
    step = FetchAssetMetadataStep(repository=repository)
    context = PipelineContext(
        data={
            "raw_assets": [
                {
                    "source": "pexels",
                    "payload": {
                        "id": 123,
                        "url": "https://www.pexels.com/video/123/",
                        "image": "https://images.pexels.com/videos/123.jpeg",
                        "duration": 14,
                        "video_files": [
                            {
                                "link": "https://cdn.pexels.com/videos/123_large.mp4",
                                "width": 1920,
                                "height": 1080,
                                "quality": "hd",
                            },
                            {
                                "link": "https://cdn.pexels.com/videos/123_small.mp4",
                                "width": 640,
                                "height": 360,
                                "quality": "sd",
                            },
                        ],
                        "user": {"name": "Avery"},
                        "tags": ["drone", "river"],
                    },
                }
            ]
        }
    )

    asyncio.run(step.run(context))

    asset = context.data["assets"][0]
    assert asset["id"] == "pexels_123"
    assert asset["source_asset_id"] == "123"
    assert asset["video_url"] == "https://cdn.pexels.com/videos/123_large.mp4"
    assert asset["thumbnail_url"] == "https://images.pexels.com/videos/123.jpeg"
    assert asset["license"] == "Pexels License"
    assert asset["creator"] == "Avery"
    assert asset["tags"] == ["drone", "river"]


def test_fetch_asset_metadata_step_skips_invalid_and_duplicate_assets() -> None:
    repository = InMemoryBrollAssetRepository()
    step = FetchAssetMetadataStep(repository=repository)
    context = PipelineContext(
        data={
            "raw_assets": [
                {
                    "source": "pexels",
                    "payload": {
                        "id": 123,
                        "url": "https://www.pexels.com/video/123/",
                        "image": "https://images.pexels.com/videos/123.jpeg",
                        "duration": 14,
                        "video_files": [
                            {
                                "link": "https://cdn.pexels.com/videos/123_large.mp4",
                                "width": 1920,
                                "height": 1080,
                            }
                        ],
                    },
                },
                {
                    "source": "pexels",
                    "payload": {
                        "id": 123,
                        "url": "https://www.pexels.com/video/123/",
                        "image": "https://images.pexels.com/videos/123.jpeg",
                        "duration": 14,
                        "video_files": [
                            {
                                "link": "https://cdn.pexels.com/videos/123_large.mp4",
                                "width": 1920,
                                "height": 1080,
                            }
                        ],
                    },
                },
                {"source": "pexels", "payload": {"image": "https://example.com/bad.jpg"}},
                {"source": "pexels", "payload": "invalid-payload"},
            ]
        }
    )

    asyncio.run(step.run(context))

    assert context.data["new_assets_count"] == 1
    assert context.data["duplicate_asset_count"] == 1
    assert set(context.data["metadata_errors"]) == {"pexels:2", "pexels:3"}
    assert context.data["assets"][0]["id"] == "pexels_123"


def test_discover_asset_step_allows_empty_successful_results() -> None:
    step = DiscoverAssetStep(
        pexels_client=FakeSourceClient([]),
        pixabay_client=FakeSourceClient([]),
    )
    context = PipelineContext(data={"query": "cinematic drone shot"})

    asyncio.run(step.run(context))

    assert context.data["raw_assets"] == []
    assert context.data["discovered_assets_count"] == 0


def test_fetch_asset_metadata_step_normalizes_pixabay_payload() -> None:
    repository = InMemoryBrollAssetRepository()
    step = FetchAssetMetadataStep(repository=repository)
    context = PipelineContext(
        data={
            "raw_assets": [
                {
                    "source": "pixabay",
                    "payload": {
                        "id": 987,
                        "pageURL": "https://pixabay.com/videos/id-987/",
                        "tags": "city, skyline, night",
                        "duration": 20,
                        "videos": {
                            "medium": {
                                "url": "https://cdn.pixabay.com/videos/987_medium.mp4"
                            }
                        },
                        "picture_id": "567890",
                        "user": "Riley",
                    },
                }
            ]
        }
    )

    asyncio.run(step.run(context))

    asset = context.data["assets"][0]
    assert asset["id"] == "pixabay_987"
    assert asset["source_asset_id"] == "987"
    assert asset["video_url"] == "https://cdn.pixabay.com/videos/987_medium.mp4"
    assert (
        asset["thumbnail_url"]
        == "https://i.vimeocdn.com/video/567890_640x360.jpg"
    )
    assert asset["license"] == "Pixabay License"
    assert asset["creator"] == "Riley"
    assert asset["tags"] == ["city", "skyline", "night"]


def test_generate_clip_embedding_step_produces_expected_dimension() -> None:
    step = GenerateClipEmbeddingStep(embedding_backend=FakeEmbeddingBackend())
    context = PipelineContext(
        data={
            "assets": [{"id": "pexels_123"}],
            "frame_paths": {"pexels_123": "/tmp/frame.jpg"},
        }
    )

    asyncio.run(step.run(context))

    vector = context.data["embeddings"]["pexels_123"]
    assert len(vector) == 512
    assert context.data["embedding_dimension"] == 512


def test_generate_clip_embedding_step_continues_after_single_asset_failure() -> None:
    step = GenerateClipEmbeddingStep(embedding_backend=PerAssetEmbeddingBackend())
    context = PipelineContext(
        data={
            "assets": [{"id": "good"}, {"id": "bad"}],
            "frame_paths": {
                "good": "/tmp/good.jpg",
                "bad": "/tmp/bad.jpg",
            },
        }
    )

    asyncio.run(step.run(context))

    assert "good" in context.data["embeddings"]
    assert "bad" not in context.data["embeddings"]
    assert context.data["embedding_errors"]["bad"] == "corrupt preview frame"


def test_broll_indexing_pipeline_runs_end_to_end_with_stubs() -> None:
    repository = InMemoryBrollAssetRepository()
    pipeline = BrollIndexingPipeline(
        repository=repository,
        embedding_backend=FakeEmbeddingBackend(),
        pexels_client=FakeSourceClient(
            [
                {
                    "id": 1,
                    "url": "https://www.pexels.com/video/1/",
                    "image": "https://images.pexels.com/videos/1.jpeg",
                    "duration": 8,
                    "video_files": [
                        {
                            "link": "https://cdn.pexels.com/videos/1_large.mp4",
                            "width": 1920,
                            "height": 1080,
                        }
                    ],
                    "user": {"name": "Avery"},
                    "tags": ["drone"],
                }
            ]
        ),
        pixabay_client=FakeSourceClient([]),
    )

    with patch.object(
        download_preview_frame_module.httpx,
        "AsyncClient",
        FakeAsyncClient,
    ):
        context = asyncio.run(pipeline.run("cinematic drone shot"))

    assert context.failed_step is None
    assert context.data["discovered_assets_count"] == 1
    assert context.data["new_assets_count"] == 1
    assert context.data["indexed_assets_count"] == 1
    assert context.data["job_status"] == "completed"
    assert context.data["job_artifacts"]["duplicate_asset_count"] == 0
    assert context.data["job_artifacts"]["embedding_error_count"] == 0
    assert len(repository.stored_assets) == 1
