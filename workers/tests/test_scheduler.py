import asyncio
import json
from unittest.mock import AsyncMock

from workers.scheduler import ContentScheduler


class FakeDB:
    def __init__(
        self,
        *,
        sources: list[dict[str, object]],
        existing_jobs: set[tuple[str, str]] | None = None,
    ) -> None:
        self._sources = list(sources)
        self._existing_jobs = set(existing_jobs or set())
        self.inserted_jobs: list[dict[str, object]] = []
        self.updated_cursors: dict[str, str] = {}
        self.fetch_calls: list[tuple[str, tuple[object, ...]]] = []
        self.fetchval_calls: list[tuple[str, tuple[object, ...]]] = []
        self.execute_calls: list[tuple[str, tuple[object, ...]]] = []

    async def fetch(self, query: str, *params: object) -> list[dict[str, object]]:
        self.fetch_calls.append((query, params))
        return list(self._sources)

    async def fetchval(self, query: str, *params: object) -> object | None:
        self.fetchval_calls.append((query, params))
        source_id, source_item_id = params
        if (str(source_id), str(source_item_id)) in self._existing_jobs:
            return 1
        return None

    async def execute(self, query: str, *params: object) -> str:
        self.execute_calls.append((query, params))

        if "INSERT INTO processing_jobs" in query:
            track, source_id, job_type, payload_json = params
            payload = json.loads(str(payload_json))
            self.inserted_jobs.append(
                {
                    "track": track,
                    "source_id": source_id,
                    "job_type": job_type,
                    "payload": payload,
                }
            )
            self._existing_jobs.add((str(source_id), str(payload["source_item_id"])))
            return "INSERT 0 1"

        if "SET sync_cursor = $1" in query:
            cursor, source_id = params
            self.updated_cursors[str(source_id)] = str(cursor)
            return "UPDATE 1"

        if "SET metadata = jsonb_set" in query:
            cursor, source_id = params
            self.updated_cursors[str(source_id)] = str(cursor)
            return "UPDATE 1"

        raise AssertionError(f"Unexpected SQL: {query}")


def make_source(
    *,
    source_id: str,
    slug: str,
    track: str,
    source_type: str,
    config: dict[str, object],
    sync_cursor: str | None = None,
    is_active: bool = True,
) -> dict[str, object]:
    return {
        "id": source_id,
        "slug": slug,
        "track": track,
        "source_type": source_type,
        "config": config,
        "sync_cursor": sync_cursor,
        "is_active": is_active,
    }


def test_run_once_creates_jobs_for_new_content_items() -> None:
    db = FakeDB(
        sources=[
            make_source(
                source_id="source-yt",
                slug="openai-channel",
                track="knowledge",
                source_type="youtube",
                config={"channel_id": "channel-42"},
            ),
            make_source(
                source_id="source-pexels",
                slug="cinematic-drone",
                track="broll",
                source_type="pexels",
                config={"query": "cinematic drone"},
            ),
            make_source(
                source_id="source-pixabay",
                slug="ocean-waves",
                track="broll",
                source_type="pixabay",
                config={"query": "ocean waves"},
            ),
        ]
    )
    youtube_client = AsyncMock()
    youtube_client.search_channel_videos.return_value = [
        {
            "source_video_id": "video-001",
            "video_id": "video-001",
            "title": "OpenAI keynote",
            "published_at": "2026-03-10T12:00:00Z",
        }
    ]
    pexels_client = AsyncMock()
    pexels_client.search_videos.return_value = [
        {
            "id": 501,
            "url": "https://www.pexels.com/video/501/",
            "duration": 14,
        }
    ]
    pixabay_client = AsyncMock()
    pixabay_client.search_videos.return_value = [
        {
            "id": 901,
            "pageURL": "https://pixabay.com/videos/id-901/",
            "duration": 8,
        }
    ]

    scheduler = ContentScheduler(
        youtube_client=youtube_client,
        pexels_client=pexels_client,
        pixabay_client=pixabay_client,
    )

    summary = asyncio.run(scheduler.run_once(db))

    assert summary == {
        "openai-channel": {"discovered": 1, "new_jobs": 1, "skipped": 0},
        "cinematic-drone": {"discovered": 1, "new_jobs": 1, "skipped": 0},
        "ocean-waves": {"discovered": 1, "new_jobs": 1, "skipped": 0},
    }
    assert len(db.inserted_jobs) == 3
    assert all(job["track"] == "unified" for job in db.inserted_jobs)
    assert db.inserted_jobs[0]["job_type"] == "index_video"
    assert db.inserted_jobs[0]["payload"]["source_item_id"] == "video-001"
    assert db.inserted_jobs[0]["payload"]["source_video_id"] == "video-001"
    assert db.inserted_jobs[0]["payload"]["url"] == "https://www.youtube.com/watch?v=video-001"
    assert db.inserted_jobs[1]["job_type"] == "index_video"
    assert db.inserted_jobs[1]["payload"]["source_item_id"] == "501"
    assert db.inserted_jobs[1]["payload"]["source"] == "pexels"
    assert db.inserted_jobs[1]["payload"]["query"] == "cinematic drone"
    assert db.inserted_jobs[2]["payload"]["source_item_id"] == "901"
    assert db.inserted_jobs[2]["payload"]["source"] == "pixabay"
    assert db.inserted_jobs[2]["payload"]["url"] == "https://pixabay.com/videos/id-901/"
    youtube_client.search_channel_videos.assert_awaited_once_with(
        "channel-42",
        max_results=25,
    )
    pexels_client.search_videos.assert_awaited_once_with("cinematic drone", per_page=50)
    pixabay_client.search_videos.assert_awaited_once_with(
        query="ocean waves",
        per_page=50,
    )


def test_run_once_skips_existing_jobs() -> None:
    db = FakeDB(
        sources=[
            make_source(
                source_id="source-pexels",
                slug="city-lights",
                track="broll",
                source_type="pexels",
                config={"query": "city lights"},
            )
        ],
        existing_jobs={("source-pexels", "777")},
    )
    pexels_client = AsyncMock()
    pexels_client.search_videos.return_value = [{"id": 777, "url": "https://example.com/777"}]

    scheduler = ContentScheduler(
        youtube_client=AsyncMock(),
        pexels_client=pexels_client,
        pixabay_client=AsyncMock(),
    )

    summary = asyncio.run(scheduler.run_once(db))

    assert summary == {
        "city-lights": {"discovered": 1, "new_jobs": 0, "skipped": 1},
    }
    assert db.inserted_jobs == []
    assert db.updated_cursors == {"source-pexels": "777"}


def test_run_once_updates_sync_cursor_after_successful_scan() -> None:
    db = FakeDB(
        sources=[
            make_source(
                source_id="source-yt",
                slug="research-talks",
                track="knowledge",
                source_type="youtube",
                config={"channel_id": "channel-99"},
                sync_cursor="2026-03-08T00:00:00Z",
            )
        ]
    )
    youtube_client = AsyncMock()
    youtube_client.search_channel_videos.return_value = [
        {
            "source_video_id": "video-010",
            "video_id": "video-010",
            "published_at": "2026-03-09T12:00:00Z",
        },
        {
            "source_video_id": "video-011",
            "video_id": "video-011",
            "published_at": "2026-03-10T18:30:00Z",
        },
    ]

    scheduler = ContentScheduler(
        youtube_client=youtube_client,
        pexels_client=AsyncMock(),
        pixabay_client=AsyncMock(),
    )

    summary = asyncio.run(scheduler.run_once(db))

    assert summary == {
        "research-talks": {"discovered": 2, "new_jobs": 2, "skipped": 0},
    }
    assert db.updated_cursors == {"source-yt": "2026-03-10T18:30:00Z"}


def test_run_once_handles_source_client_errors_gracefully() -> None:
    db = FakeDB(
        sources=[
            make_source(
                source_id="source-pexels",
                slug="broken-pexels",
                track="broll",
                source_type="pexels",
                config={"query": "broken"},
            ),
            make_source(
                source_id="source-yt",
                slug="healthy-youtube",
                track="knowledge",
                source_type="youtube",
                config={"channel_id": "channel-42"},
            ),
        ]
    )
    pexels_client = AsyncMock()
    pexels_client.search_videos.side_effect = RuntimeError("pexels unavailable")
    youtube_client = AsyncMock()
    youtube_client.search_channel_videos.return_value = [
        {
            "source_video_id": "video-001",
            "video_id": "video-001",
            "published_at": "2026-03-10T12:00:00Z",
        }
    ]

    scheduler = ContentScheduler(
        youtube_client=youtube_client,
        pexels_client=pexels_client,
        pixabay_client=AsyncMock(),
    )

    summary = asyncio.run(scheduler.run_once(db))

    assert summary == {
        "broken-pexels": {"discovered": 0, "new_jobs": 0, "skipped": 0},
        "healthy-youtube": {"discovered": 1, "new_jobs": 1, "skipped": 0},
    }
    assert len(db.inserted_jobs) == 1
    assert db.inserted_jobs[0]["source_id"] == "source-yt"


def test_run_once_only_processes_active_sources() -> None:
    db = FakeDB(
        sources=[
            make_source(
                source_id="source-active",
                slug="active-pixabay",
                track="broll",
                source_type="pixabay",
                config={"query": "sunrise"},
                is_active=True,
            ),
            make_source(
                source_id="source-inactive",
                slug="inactive-pixabay",
                track="broll",
                source_type="pixabay",
                config={"query": "night city"},
                is_active=False,
            ),
        ]
    )
    pixabay_client = AsyncMock()
    pixabay_client.search_videos.return_value = [{"id": 111}]

    scheduler = ContentScheduler(
        youtube_client=AsyncMock(),
        pexels_client=AsyncMock(),
        pixabay_client=pixabay_client,
    )

    summary = asyncio.run(scheduler.run_once(db))

    assert summary == {
        "active-pixabay": {"discovered": 1, "new_jobs": 1, "skipped": 0},
    }
    pixabay_client.search_videos.assert_awaited_once_with(query="sunrise", per_page=50)
    assert len(db.inserted_jobs) == 1
    assert db.inserted_jobs[0]["source_id"] == "source-active"


def test_run_once_supports_legacy_metadata_backed_sources() -> None:
    db = FakeDB(
        sources=[
            {
                "id": "legacy-yt",
                "slug": "legacy-youtube",
                "track": "knowledge",
                "base_url": "https://www.youtube.com",
                "metadata": json.dumps(
                    {
                        "channel_id": "channel-legacy",
                        "sync_cursor": "2026-03-01T00:00:00Z",
                    }
                ),
                "is_active": True,
            }
        ]
    )
    youtube_client = AsyncMock()
    youtube_client.search_channel_videos.return_value = [
        {
            "source_video_id": "legacy-video-1",
            "video_id": "legacy-video-1",
            "published_at": "2026-03-10T12:00:00Z",
        }
    ]

    scheduler = ContentScheduler(
        youtube_client=youtube_client,
        pexels_client=AsyncMock(),
        pixabay_client=AsyncMock(),
    )

    summary = asyncio.run(scheduler.run_once(db))

    assert summary == {
        "legacy-youtube": {"discovered": 1, "new_jobs": 1, "skipped": 0},
    }
    assert len(db.inserted_jobs) == 1
    assert db.inserted_jobs[0]["track"] == "unified"
    assert db.inserted_jobs[0]["payload"]["source"] == "youtube"
    assert db.updated_cursors == {"legacy-yt": "2026-03-10T12:00:00Z"}
