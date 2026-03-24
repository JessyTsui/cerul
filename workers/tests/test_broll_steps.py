import asyncio
import json
from types import SimpleNamespace
from unittest.mock import patch

from backend.app.embedding import GeminiEmbeddingBackend
from workers.broll import BrollIndexingPipeline
from workers.broll.repository import BrollAssetRepository, InMemoryBrollAssetRepository
from workers.broll.steps import (
    DiscoverAssetStep,
    FetchAssetMetadataStep,
    GenerateEmbeddingStep,
)
from workers.broll.steps import download_preview_frame as download_preview_frame_module
from workers.common.sources import PixabayClient
import workers.common.sources.pixabay as pixabay_source_module
from workers.common.pipeline import PipelineContext


class FakeEmbeddingBackend:
    name = "fake-gemini"

    def dimension(self) -> int:
        return 768

    def embed_text(self, text: str) -> list[float]:
        return [0.0] * self.dimension()

    def embed_image(self, image_path: str) -> list[float]:
        return [float(index) for index in range(self.dimension())]

    def embed_video(self, video_path: str) -> list[float]:
        return [float(index) for index in range(self.dimension())]


class FakeSourceClient:
    def __init__(
        self,
        payload: list[dict[str, object]],
        *,
        error: Exception | None = None,
    ) -> None:
        self._payload = payload
        self._error = error
        self.calls: list[dict[str, object]] = []

    async def search_videos(
        self,
        query: str,
        per_page: int = 50,
        **kwargs: object,
    ) -> list[dict[str, object]]:
        self.calls.append(
            {
                "query": query,
                "per_page": per_page,
                **kwargs,
            }
        )
        if self._error is not None:
            raise self._error
        return self._payload


class StrictPixabaySourceClient:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    async def search_videos(
        self,
        query: str,
        per_page: int = 50,
        *,
        page: int = 1,
        order: str = "popular",
        safesearch: bool = True,
        video_type: str = "film",
        category: str | None = None,
        editors_choice: bool | None = None,
        min_width: int | None = None,
        min_height: int | None = None,
        lang: str | None = None,
    ) -> list[dict[str, object]]:
        self.calls.append(
            {
                "query": query,
                "per_page": per_page,
                "page": page,
                "order": order,
                "safesearch": safesearch,
                "video_type": video_type,
                "category": category,
                "editors_choice": editors_choice,
                "min_width": min_width,
                "min_height": min_height,
                "lang": lang,
            }
        )
        return []


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


class FakePixabayApiResponse:
    def __init__(self, payload: dict[str, object]) -> None:
        self._payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict[str, object]:
        return self._payload


class RecordingPixabayAsyncClient:
    last_request: dict[str, object] | None = None

    def __init__(self, *args, **kwargs) -> None:
        return None

    async def __aenter__(self) -> "RecordingPixabayAsyncClient":
        return self

    async def __aexit__(self, exc_type, exc, tb) -> bool:
        return False

    async def get(
        self,
        url: str,
        params: dict[str, object],
    ) -> FakePixabayApiResponse:
        type(self).last_request = {
            "url": url,
            "params": params,
        }
        return FakePixabayApiResponse(
            {"hits": [{"id": 987}, "ignore-me", {"id": 654}]}
        )


class FakeTransaction:
    async def __aenter__(self) -> "FakeTransaction":
        return self

    async def __aexit__(self, exc_type, exc, tb) -> bool:
        return False


class FakePoolAcquire:
    def __init__(self, connection: "RecordingRepositoryConnection") -> None:
        self._connection = connection

    async def __aenter__(self) -> "RecordingRepositoryConnection":
        return self._connection

    async def __aexit__(self, exc_type, exc, tb) -> bool:
        return False


class FakePool:
    def __init__(self, connection: "RecordingRepositoryConnection") -> None:
        self._connection = connection
        self.closed = False

    def acquire(self) -> FakePoolAcquire:
        return FakePoolAcquire(self._connection)

    async def close(self) -> None:
        self.closed = True


class RecordingRepositoryConnection:
    def __init__(
        self,
        *,
        fetch_rows: list[dict[str, object]] | None = None,
        fetchval_result: int = 0,
    ) -> None:
        self.fetch_rows = fetch_rows or []
        self.fetchval_result = fetchval_result
        self.fetch_calls: list[tuple[str, tuple[object, ...]]] = []
        self.fetchrow_calls: list[tuple[str, tuple[object, ...]]] = []
        self.fetchval_calls: list[tuple[str, tuple[object, ...]]] = []
        self.execute_calls: list[tuple[str, tuple[object, ...]]] = []
        self.executemany_calls: list[tuple[str, list[tuple[object, ...]]]] = []

    async def fetch(self, query: str, *params: object) -> list[dict[str, object]]:
        self.fetch_calls.append((query, params))
        return list(self.fetch_rows)

    async def fetchrow(
        self,
        query: str,
        *params: object,
    ) -> dict[str, object] | None:
        self.fetchrow_calls.append((query, params))
        return {"exists": 1} if self.fetch_rows else None

    async def fetchval(self, query: str, *params: object) -> int:
        self.fetchval_calls.append((query, params))
        return self.fetchval_result

    async def execute(self, query: str, *params: object) -> str:
        self.execute_calls.append((query, params))
        return "OK"

    async def executemany(
        self,
        query: str,
        records: list[tuple[object, ...]],
    ) -> None:
        self.executemany_calls.append((query, list(records)))

    def transaction(self) -> FakeTransaction:
        return FakeTransaction()


class FakeAsyncpgModule:
    def __init__(self, pool: FakePool) -> None:
        self._pool = pool
        self.create_pool_calls: list[dict[str, object]] = []

    async def create_pool(self, **kwargs: object) -> FakePool:
        self.create_pool_calls.append(dict(kwargs))
        return self._pool


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


def test_discover_asset_step_passes_pixabay_search_options() -> None:
    pixabay_client = FakeSourceClient([])
    step = DiscoverAssetStep(pixabay_client=pixabay_client)
    context = PipelineContext(
        conf={
            "sources": "pixabay",
            "per_page": 24,
            "pixabay_page": 3,
            "pixabay_search_options": {
                "video_type": "all",
                "order": "latest",
                "min_width": 1920,
            },
            "safesearch": False,
            "pixabay_editors_choice": True,
        },
        data={"query": "city skyline"},
    )

    asyncio.run(step.run(context))

    assert pixabay_client.calls == [
        {
            "query": "city skyline",
            "per_page": 24,
            "page": 3,
            "video_type": "all",
            "order": "latest",
            "min_width": 1920,
            "safesearch": False,
            "editors_choice": True,
        }
    ]


def test_discover_asset_step_filters_unsupported_pixabay_search_options() -> None:
    pixabay_client = StrictPixabaySourceClient()
    step = DiscoverAssetStep(pixabay_client=pixabay_client)
    context = PipelineContext(
        conf={
            "sources": ["pixabay"],
            "pixabay_search_options": {
                "page": 2,
                "video_type": "all",
                "foo": "bar",
            },
            "pixabay_bar": "baz",
        },
        data={"query": "forest river"},
    )

    asyncio.run(step.run(context))

    assert pixabay_client.calls == [
        {
            "query": "forest river",
            "per_page": 50,
            "page": 2,
            "order": "popular",
            "safesearch": True,
            "video_type": "all",
            "category": None,
            "editors_choice": None,
            "min_width": None,
            "min_height": None,
            "lang": None,
        }
    ]
    assert context.data["raw_assets"] == []
    assert context.data["discovered_assets_count"] == 0


def test_discover_asset_step_normalizes_pixabay_search_option_types() -> None:
    pixabay_client = StrictPixabaySourceClient()
    step = DiscoverAssetStep(pixabay_client=pixabay_client)
    context = PipelineContext(
        conf={
            "sources": ["pixabay"],
            "pixabay_search_options": {
                "page": "2",
                "safesearch": "false",
                "editors_choice": "true",
                "min_width": "1920",
                "min_height": "1080",
                "video_type": "all",
            },
            "pixabay_order": " latest ",
            "pixabay_lang": " en ",
        },
        data={"query": "forest river"},
    )

    asyncio.run(step.run(context))

    assert pixabay_client.calls == [
        {
            "query": "forest river",
            "per_page": 50,
            "page": 2,
            "order": "latest",
            "safesearch": False,
            "video_type": "all",
            "category": None,
            "editors_choice": True,
            "min_width": 1920,
            "min_height": 1080,
            "lang": "en",
        }
    ]
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
                                "url": "https://cdn.pixabay.com/videos/987_medium.mp4",
                                "width": 1280,
                                "height": 720,
                                "thumbnail": (
                                    "https://cdn.pixabay.com/video/987_medium.jpg"
                                ),
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
    assert asset["thumbnail_url"] == "https://cdn.pixabay.com/video/987_medium.jpg"
    assert asset["title"] == "City Skyline Night"
    assert asset["license"] == "Pixabay License"
    assert asset["creator"] == "Riley"
    assert asset["tags"] == ["city", "skyline", "night"]


def test_fetch_asset_metadata_step_falls_back_to_legacy_pixabay_picture_id() -> None:
    repository = InMemoryBrollAssetRepository()
    step = FetchAssetMetadataStep(repository=repository)
    context = PipelineContext(
        data={
            "raw_assets": [
                {
                    "source": "pixabay",
                    "payload": {
                        "id": 654,
                        "pageURL": "https://pixabay.com/videos/id-654/",
                        "tags": "forest, river",
                        "duration": 12,
                        "videos": {
                            "small": {
                                "url": "https://cdn.pixabay.com/videos/654_small.mp4",
                                "width": 960,
                                "height": 540,
                            }
                        },
                        "picture_id": "123456",
                    },
                }
            ]
        }
    )

    asyncio.run(step.run(context))

    asset = context.data["assets"][0]
    assert asset["thumbnail_url"] == "https://i.vimeocdn.com/video/123456_640x360.jpg"


def test_pixabay_client_builds_expected_request_params() -> None:
    client = PixabayClient(api_key="pixabay-test-key")

    with patch.object(
        pixabay_source_module.httpx,
        "AsyncClient",
        RecordingPixabayAsyncClient,
    ):
        hits = asyncio.run(
            client.search_videos(
                query="city skyline",
                per_page=24,
                page=3,
                order="latest",
                safesearch=False,
                video_type="all",
                category="travel",
                editors_choice=True,
                min_width=1920,
                min_height=1080,
                lang="en",
            )
        )

    assert hits == [{"id": 987}, {"id": 654}]
    assert RecordingPixabayAsyncClient.last_request == {
        "url": "https://pixabay.com/api/videos/",
        "params": {
            "key": "pixabay-test-key",
            "q": "city skyline",
            "per_page": 24,
            "page": 3,
            "order": "latest",
            "safesearch": "false",
            "video_type": "all",
            "category": "travel",
            "editors_choice": "true",
            "min_width": 1920,
            "min_height": 1080,
            "lang": "en",
        },
    }


def test_generate_embedding_step_produces_expected_dimension() -> None:
    step = GenerateEmbeddingStep(embedding_backend=FakeEmbeddingBackend())
    context = PipelineContext(
        data={
            "assets": [{"id": "pexels_123"}],
            "frame_paths": {"pexels_123": "/tmp/frame.jpg"},
        }
    )

    asyncio.run(step.run(context))

    vector = context.data["embeddings"]["pexels_123"]
    assert len(vector) == 768
    assert context.data["embedding_dimension"] == 768


def test_generate_embedding_step_continues_after_single_asset_failure() -> None:
    step = GenerateEmbeddingStep(embedding_backend=PerAssetEmbeddingBackend())
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


def test_broll_indexing_pipeline_uses_gemini_backend_by_default() -> None:
    pipeline = BrollIndexingPipeline()

    assert isinstance(pipeline._embedding_backend, GeminiEmbeddingBackend)


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


def test_broll_asset_repository_bulk_check_existing_returns_matching_asset_ids() -> None:
    connection = RecordingRepositoryConnection(
        fetch_rows=[
            {"source": "pexels", "source_asset_id": "123"},
            {"source": "pixabay", "source_asset_id": "456"},
        ]
    )
    pool = FakePool(connection)
    asyncpg_module = FakeAsyncpgModule(pool)
    repository = BrollAssetRepository("postgres://example.test/cerul")

    with patch("workers.broll.repository._import_asyncpg", return_value=asyncpg_module):
        existing_ids = asyncio.run(
            repository.bulk_check_existing(
                [
                    {
                        "id": "pexels_123",
                        "source": "pexels",
                        "source_asset_id": "123",
                    },
                    {
                        "id": "pixabay_456",
                        "source": "pixabay",
                        "source_asset_id": "456",
                    },
                    {
                        "id": "pexels_999",
                        "source": "pexels",
                        "source_asset_id": "999",
                    },
                ]
            )
        )

    assert existing_ids == {"pexels_123", "pixabay_456"}
    assert len(connection.fetch_calls) == 1
    _, params = connection.fetch_calls[0]
    assert list(params[0]) == ["pexels", "pixabay", "pexels"]
    assert list(params[1]) == ["123", "456", "999"]


def test_broll_asset_repository_store_assets_batch_upserts_records() -> None:
    connection = RecordingRepositoryConnection()
    pool = FakePool(connection)
    asyncpg_module = FakeAsyncpgModule(pool)
    repository = BrollAssetRepository("postgres://example.test/cerul")
    assets = [
        {
            "id": "pexels_123",
            "source": "pexels",
            "source_asset_id": "123",
            "source_url": "https://www.pexels.com/video/123/",
            "video_url": "https://cdn.pexels.com/videos/123.mp4",
            "thumbnail_url": "https://images.pexels.com/videos/123.jpeg",
            "duration": 14,
            "title": "Mountain Dawn",
            "description": "Golden hour drone shot",
            "tags": ["mountain", "sunrise"],
            "license": "Pexels License",
            "creator": "Avery",
            "metadata": {"query": "aerial mountain sunrise"},
        },
        {
            "id": "pixabay_456",
            "source": "pixabay",
            "source_asset_id": "456",
            "source_url": "https://pixabay.com/videos/id-456/",
            "video_url": "https://cdn.pixabay.com/videos/456.mp4",
            "thumbnail_url": "https://cdn.pixabay.com/video/456.jpg",
            "duration_seconds": 21,
            "title": "City Lights",
            "description": "",
            "tags": ["city", "night"],
            "license": "Pixabay License",
            "creator": "Riley",
            "metadata": {"query": "tokyo neon streets night"},
        },
    ]

    with patch("workers.broll.repository._import_asyncpg", return_value=asyncpg_module):
        stored_count = asyncio.run(
            repository.store_assets_batch(
                assets,
                [
                    [0.1, 0.2, 0.3],
                    [0.4, 0.5, 0.6],
                ],
            )
        )

    assert stored_count == 2
    assert len(connection.executemany_calls) == 1
    query, records = connection.executemany_calls[0]
    assert "ON CONFLICT (source, source_asset_id) DO UPDATE" in query
    assert len(records) == 2
    assert records[0][0:4] == (
        "pexels",
        "123",
        "https://www.pexels.com/video/123/",
        "https://cdn.pexels.com/videos/123.mp4",
    )
    assert records[0][5] == 14
    assert records[0][8] == ["mountain", "sunrise"]
    assert json.loads(records[0][11]) == {"query": "aerial mountain sunrise"}
    assert records[0][12] == "[0.1,0.2,0.3]"
