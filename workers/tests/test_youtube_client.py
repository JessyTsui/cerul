import asyncio
import os
from unittest.mock import patch

import pytest

from workers.common.sources import YouTubeClient


class FakeResponse:
    def __init__(self, payload: dict[str, object]) -> None:
        self._payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict[str, object]:
        return self._payload


class RecordingAsyncClient:
    def __init__(self, payloads: list[dict[str, object]], *args, **kwargs) -> None:
        self._payloads = list(payloads)
        self.calls: list[dict[str, object]] = []

    async def __aenter__(self) -> "RecordingAsyncClient":
        return self

    async def __aexit__(self, exc_type, exc, tb) -> bool:
        return False

    async def get(self, url: str, params: dict[str, object]) -> FakeResponse:
        self.calls.append({"url": url, "params": dict(params)})
        return FakeResponse(self._payloads.pop(0))


def test_get_video_metadata_normalizes_response() -> None:
    client = RecordingAsyncClient(
        [
            {
                "items": [
                    {
                        "id": "abc123",
                        "snippet": {
                            "title": "Agent systems keynote",
                            "description": "A deep dive into orchestration.",
                            "channelTitle": "Cerul Labs",
                            "channelId": "channel-42",
                            "publishedAt": "2026-03-01T10:00:00Z",
                            "tags": ["agents", "search"],
                            "thumbnails": {
                                "high": {"url": "https://img.youtube.com/vi/abc123/hqdefault.jpg"}
                            },
                            "liveBroadcastContent": "none",
                        },
                        "contentDetails": {"duration": "PT1H2M3S"},
                        "statistics": {
                            "viewCount": "12345",
                            "likeCount": "678",
                        },
                        "status": {
                            "license": "youtube",
                            "privacyStatus": "public",
                            "embeddable": True,
                        },
                    }
                ]
            }
        ]
    )

    with patch("workers.common.sources.youtube.httpx.AsyncClient", return_value=client):
        metadata = asyncio.run(YouTubeClient(api_key="test-key").get_video_metadata("abc123"))

    assert metadata == {
        "source": "youtube",
        "source_video_id": "abc123",
        "video_id": "abc123",
        "source_url": "https://www.youtube.com/watch?v=abc123",
        "video_url": "https://www.youtube.com/watch?v=abc123",
        "thumbnail_url": "https://img.youtube.com/vi/abc123/hqdefault.jpg",
        "title": "Agent systems keynote",
        "description": "A deep dive into orchestration.",
        "speaker": "Cerul Labs",
        "creator": "Cerul Labs",
        "channel_title": "Cerul Labs",
        "channel_id": "channel-42",
        "published_at": "2026-03-01T10:00:00Z",
        "duration": 3723,
        "duration_seconds": 3723,
        "view_count": 12345,
        "like_count": 678,
        "license": "standard-youtube-license",
        "privacy_status": "public",
        "embeddable": True,
        "live_broadcast_content": "none",
        "tags": ["agents", "search"],
    }
    assert client.calls == [
        {
            "url": "https://www.googleapis.com/youtube/v3/videos",
            "params": {
                "id": "abc123",
                "part": "snippet,contentDetails,status,statistics",
                "key": "test-key",
            },
        }
    ]


def test_search_channel_videos_preserves_search_order() -> None:
    client = RecordingAsyncClient(
        [
            {
                "items": [
                    {"id": {"videoId": "video-b"}},
                    {"id": {"videoId": "video-a"}},
                ]
            },
            {
                "items": [
                    {
                        "id": "video-a",
                        "snippet": {
                            "title": "Earlier upload",
                            "channelTitle": "Cerul Labs",
                            "channelId": "channel-42",
                            "publishedAt": "2026-02-01T10:00:00Z",
                            "thumbnails": {
                                "default": {"url": "https://img.youtube.com/vi/video-a/default.jpg"}
                            },
                        },
                        "contentDetails": {"duration": "PT10M"},
                        "statistics": {"viewCount": "200"},
                        "status": {"license": "creativeCommon"},
                    },
                    {
                        "id": "video-b",
                        "snippet": {
                            "title": "Latest upload",
                            "channelTitle": "Cerul Labs",
                            "channelId": "channel-42",
                            "publishedAt": "2026-03-02T10:00:00Z",
                            "thumbnails": {
                                "default": {"url": "https://img.youtube.com/vi/video-b/default.jpg"}
                            },
                        },
                        "contentDetails": {"duration": "PT4M5S"},
                        "statistics": {
                            "viewCount": "400",
                            "likeCount": "25",
                        },
                        "status": {"license": "youtube"},
                    },
                ]
            },
        ]
    )

    with patch("workers.common.sources.youtube.httpx.AsyncClient", return_value=client):
        videos = asyncio.run(
            YouTubeClient(api_key="test-key").search_channel_videos(
                "channel-42",
                max_results=2,
            )
        )

    assert [video["source_video_id"] for video in videos] == ["video-b", "video-a"]
    assert videos[0]["title"] == "Latest upload"
    assert videos[0]["duration_seconds"] == 245
    assert videos[0]["view_count"] == 400
    assert videos[0]["like_count"] == 25
    assert videos[1]["license"] == "creative-commons"
    assert videos[1]["view_count"] == 200
    assert videos[1]["like_count"] is None
    assert client.calls == [
        {
            "url": "https://www.googleapis.com/youtube/v3/search",
            "params": {
                "channelId": "channel-42",
                "maxResults": 2,
                "order": "date",
                "part": "snippet",
                "type": "video",
                "key": "test-key",
            },
        },
        {
            "url": "https://www.googleapis.com/youtube/v3/videos",
            "params": {
                "id": "video-b,video-a",
                "part": "snippet,contentDetails,status,statistics",
                "key": "test-key",
            },
        },
    ]


def test_search_videos_supports_filters_and_preserves_search_order() -> None:
    client = RecordingAsyncClient(
        [
            {
                "items": [
                    {"id": {"videoId": "video-b"}},
                    {"id": {"videoId": "video-a"}},
                ]
            },
            {
                "items": [
                    {
                        "id": "video-a",
                        "snippet": {
                            "title": "Agent memory systems",
                            "channelTitle": "Cerul Labs",
                            "channelId": "channel-42",
                            "publishedAt": "2026-02-28T10:00:00Z",
                            "thumbnails": {
                                "default": {"url": "https://img.youtube.com/vi/video-a/default.jpg"}
                            },
                        },
                        "contentDetails": {"duration": "PT8M"},
                        "statistics": {"viewCount": "900"},
                        "status": {"license": "youtube"},
                    },
                    {
                        "id": "video-b",
                        "snippet": {
                            "title": "Latest agent demo",
                            "channelTitle": "Cerul Labs",
                            "channelId": "channel-42",
                            "publishedAt": "2026-03-02T10:00:00Z",
                            "thumbnails": {
                                "default": {"url": "https://img.youtube.com/vi/video-b/default.jpg"}
                            },
                        },
                        "contentDetails": {"duration": "PT12M34S"},
                        "statistics": {
                            "viewCount": "1500",
                            "likeCount": "42",
                        },
                        "status": {"license": "creativeCommon"},
                    },
                ]
            },
        ]
    )

    with patch("workers.common.sources.youtube.httpx.AsyncClient", return_value=client):
        videos = asyncio.run(
            YouTubeClient(api_key="test-key").search_videos(
                "  agent systems  ",
                max_results=2,
                published_after="2026-02-01T00:00:00Z",
                relevance_language="en",
                video_duration="medium",
                event_type="completed",
            )
        )

    assert [video["source_video_id"] for video in videos] == ["video-b", "video-a"]
    assert videos[0]["title"] == "Latest agent demo"
    assert videos[0]["license"] == "creative-commons"
    assert videos[0]["view_count"] == 1500
    assert videos[0]["like_count"] == 42
    assert videos[1]["view_count"] == 900
    assert videos[1]["like_count"] is None
    assert client.calls == [
        {
            "url": "https://www.googleapis.com/youtube/v3/search",
            "params": {
                "eventType": "completed",
                "maxResults": 2,
                "order": "relevance",
                "part": "snippet",
                "publishedAfter": "2026-02-01T00:00:00Z",
                "q": "agent systems",
                "relevanceLanguage": "en",
                "type": "video",
                "videoDuration": "medium",
                "key": "test-key",
            },
        },
        {
            "url": "https://www.googleapis.com/youtube/v3/videos",
            "params": {
                "id": "video-b,video-a",
                "part": "snippet,contentDetails,status,statistics",
                "key": "test-key",
            },
        },
    ]


def test_search_channel_videos_paginates_beyond_first_50_results() -> None:
    first_page_ids = [f"video-{index:02d}" for index in range(50)]
    second_page_ids = [f"video-{index:02d}" for index in range(50, 55)]
    metadata_items = [
        {
            "id": video_id,
            "snippet": {
                "title": f"Title {video_id}",
                "channelTitle": "Cerul Labs",
                "channelId": "channel-42",
                "publishedAt": "2026-03-02T10:00:00Z",
                "thumbnails": {
                    "default": {
                        "url": f"https://img.youtube.com/vi/{video_id}/default.jpg"
                    }
                },
            },
            "contentDetails": {"duration": "PT1M"},
            "status": {"license": "youtube"},
        }
        for video_id in [*first_page_ids, *second_page_ids]
    ]
    client = RecordingAsyncClient(
        [
            {
                "items": [{"id": {"videoId": video_id}} for video_id in first_page_ids],
                "nextPageToken": "page-2",
            },
            {
                "items": [{"id": {"videoId": video_id}} for video_id in second_page_ids],
            },
            {"items": metadata_items[:50]},
            {"items": metadata_items[50:]},
        ]
    )

    with patch("workers.common.sources.youtube.httpx.AsyncClient", return_value=client):
        videos = asyncio.run(
            YouTubeClient(api_key="test-key").search_channel_videos(
                "channel-42",
                max_results=55,
            )
        )

    assert len(videos) == 55
    assert [video["source_video_id"] for video in videos] == [
        *first_page_ids,
        *second_page_ids,
    ]
    assert client.calls == [
        {
            "url": "https://www.googleapis.com/youtube/v3/search",
            "params": {
                "channelId": "channel-42",
                "maxResults": 50,
                "order": "date",
                "part": "snippet",
                "type": "video",
                "key": "test-key",
            },
        },
        {
            "url": "https://www.googleapis.com/youtube/v3/search",
            "params": {
                "channelId": "channel-42",
                "maxResults": 5,
                "order": "date",
                "pageToken": "page-2",
                "part": "snippet",
                "type": "video",
                "key": "test-key",
            },
        },
        {
            "url": "https://www.googleapis.com/youtube/v3/videos",
            "params": {
                "id": ",".join(first_page_ids),
                "part": "snippet,contentDetails,status,statistics",
                "key": "test-key",
            },
        },
        {
            "url": "https://www.googleapis.com/youtube/v3/videos",
            "params": {
                "id": ",".join(second_page_ids),
                "part": "snippet,contentDetails,status,statistics",
                "key": "test-key",
            },
        },
    ]


def test_youtube_client_requires_api_key() -> None:
    with patch.dict(os.environ, {"YOUTUBE_API_KEY": ""}):
        client = YouTubeClient(api_key="")

        with pytest.raises(RuntimeError, match="YOUTUBE_API_KEY is required"):
            asyncio.run(client.get_video_metadata("abc123"))


def test_youtube_client_prefers_youtube_api_proxy_over_ytdlp_proxy(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("YOUTUBE_API_PROXY", "http://youtube-proxy.example:10001")
    monkeypatch.setenv("YTDLP_PROXY", "http://ytdlp-proxy.example:10002")

    client = YouTubeClient(api_key="test-key")

    assert client._proxy == "http://youtube-proxy.example:10001"


def test_youtube_client_real_api_returns_known_video_metadata() -> None:
    api_key = os.getenv("YOUTUBE_API_KEY", "").strip()
    if not api_key:
        pytest.skip("YOUTUBE_API_KEY is not set.")

    metadata = asyncio.run(YouTubeClient(api_key=api_key).get_video_metadata("jNQXAC9IVRw"))

    assert metadata["source"] == "youtube"
    assert metadata["source_video_id"] == "jNQXAC9IVRw"
    assert metadata["video_url"] == "https://www.youtube.com/watch?v=jNQXAC9IVRw"
    assert metadata["thumbnail_url"]
    assert metadata["duration_seconds"] > 0
    assert metadata["published_at"]
