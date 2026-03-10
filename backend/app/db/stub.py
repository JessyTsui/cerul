from __future__ import annotations

# STUB: retained for development/test flows until all local paths use real DB fixtures.

from copy import deepcopy
from dataclasses import dataclass
from datetime import date
from typing import Any

from app.search.base import build_placeholder_vector

STUB_API_KEY = "cerul_sk_abcdefghijklmnopqrstuvwxyz123456"


@dataclass
class StubTransaction:
    database: "StubDatabase"
    snapshot_data: dict[str, Any] | None = None

    async def __aenter__(self) -> "StubDatabase":
        self.snapshot_data = self.database.snapshot()
        return self.database

    async def __aexit__(self, exc_type, exc, tb) -> bool:
        if exc_type is not None and self.snapshot_data is not None:
            self.database.restore(self.snapshot_data)
        return False


class StubDatabase:
    def __init__(self) -> None:
        self.user_profiles: dict[str, dict[str, Any]] = {
            "user_stub": {
                "id": "user_stub",
                "tier": "free",
                "monthly_credit_limit": 1_000,
                "rate_limit_per_sec": 1,
            }
        }
        self.api_keys: list[dict[str, Any]] = [
            {
                "id": "key_stub",
                "user_id": "user_stub",
                "name": "Default key",
                "is_active": True,
                "raw_key": STUB_API_KEY,
            }
        ]
        self.usage_events: dict[str, dict[str, Any]] = {}
        self.usage_monthly: dict[tuple[str, date, date], dict[str, Any]] = {}
        self.query_logs: list[dict[str, Any]] = []
        self.broll_assets = [
            {
                "id": "pexels_28192743",
                "score": 0.94,
                "title": "Aerial drone shot of coastal highway",
                "description": (
                    "Cinematic 4K drone footage of winding coastal road at golden hour "
                    "with ocean views"
                ),
                "video_url": (
                    "https://videos.pexels.com/video-files/28192743/"
                    "aerial-coastal-drone.mp4"
                ),
                "thumbnail_url": (
                    "https://images.pexels.com/photos/28192743/"
                    "pexels-photo-28192743.jpeg"
                ),
                "duration": 18,
                "source": "pexels",
                "license": "pexels-license",
                "embedding": build_placeholder_vector(
                    "aerial drone shot coastal highway sunset",
                    512,
                ),
            },
            {
                "id": "pixabay_992100",
                "score": 0.89,
                "title": "Business handshake in modern office",
                "description": "Professional office handshake with shallow depth of field",
                "video_url": (
                    "https://cdn.pixabay.com/video/2024/01/12/"
                    "business-handshake.mp4"
                ),
                "thumbnail_url": (
                    "https://cdn.pixabay.com/photo/2024/01/12/business-handshake.jpg"
                ),
                "duration": 12,
                "source": "pixabay",
                "license": "pixabay-license",
                "embedding": build_placeholder_vector(
                    "business handshake in modern office",
                    512,
                ),
            },
        ]
        self.knowledge_segments = [
            {
                "id": "yt_seg_001",
                "score": 0.91,
                "title": "OpenAI Dev Day Keynote",
                "description": "Discussion about agent workflows and reasoning models.",
                "video_url": "https://www.youtube.com/watch?v=openai-devday",
                "thumbnail_url": "https://img.youtube.com/vi/openai-devday/hqdefault.jpg",
                "duration": 3600,
                "source": "youtube",
                "license": "standard-youtube-license",
                "timestamp_start": 120.0,
                "timestamp_end": 178.5,
                "speaker": "Sam Altman",
                "published_at": date(2025, 11, 6),
                "embedding": build_placeholder_vector(
                    "agents reasoning models keynote answer",
                    1536,
                ),
            },
            {
                "id": "yt_seg_002",
                "score": 0.83,
                "title": "Vector search fundamentals",
                "description": "A walkthrough of cosine similarity and semantic retrieval.",
                "video_url": "https://www.youtube.com/watch?v=vector-search",
                "thumbnail_url": "https://img.youtube.com/vi/vector-search/hqdefault.jpg",
                "duration": 2100,
                "source": "youtube",
                "license": "standard-youtube-license",
                "timestamp_start": 42.0,
                "timestamp_end": 97.0,
                "speaker": "Jane Doe",
                "published_at": date(2024, 5, 20),
                "embedding": build_placeholder_vector(
                    "cosine similarity semantic retrieval",
                    1536,
                ),
            },
        ]

    def snapshot(self) -> dict[str, Any]:
        return {
            "api_keys": deepcopy(self.api_keys),
            "usage_events": deepcopy(self.usage_events),
            "usage_monthly": deepcopy(self.usage_monthly),
            "query_logs": deepcopy(self.query_logs),
        }

    def restore(self, snapshot_data: dict[str, Any]) -> None:
        self.api_keys = snapshot_data["api_keys"]
        self.usage_events = snapshot_data["usage_events"]
        self.usage_monthly = snapshot_data["usage_monthly"]
        self.query_logs = snapshot_data["query_logs"]

    def transaction(self) -> StubTransaction:
        return StubTransaction(self)

    async def search_broll_assets(
        self,
        *,
        min_duration: int | None,
        max_duration: int | None,
        source: str | None,
        limit: int,
    ) -> list[dict[str, Any]]:
        rows = self.broll_assets
        if min_duration is not None:
            rows = [row for row in rows if row["duration"] >= min_duration]
        if max_duration is not None:
            rows = [row for row in rows if row["duration"] <= max_duration]
        if source is not None:
            rows = [row for row in rows if row["source"] == source]
        return deepcopy(rows[:limit])

    async def search_knowledge_segments(
        self,
        *,
        speaker: str | None,
        published_after: date | None,
        limit: int,
    ) -> list[dict[str, Any]]:
        rows = self.knowledge_segments
        if speaker is not None:
            speaker_casefold = speaker.casefold()
            rows = [
                row
                for row in rows
                if row["speaker"].casefold() == speaker_casefold
            ]
        if published_after is not None:
            rows = [row for row in rows if row["published_at"] >= published_after]
        return deepcopy(rows[:limit])

    async def get_user_profile(self, user_id: str) -> dict[str, Any] | None:
        profile = self.user_profiles.get(user_id)
        return deepcopy(profile) if profile is not None else None

    async def get_usage_summary(
        self,
        user_id: str,
        period_start: date,
        period_end: date,
    ) -> dict[str, Any]:
        profile = self.user_profiles[user_id]
        usage = self.usage_monthly.get((user_id, period_start, period_end))
        credits_used = 0 if usage is None else int(usage["credits_used"])
        return {
            "tier": profile["tier"],
            "credits_limit": profile["monthly_credit_limit"],
            "credits_used": credits_used,
            "rate_limit_per_sec": profile["rate_limit_per_sec"],
        }

    async def count_active_api_keys(self, user_id: str) -> int:
        return sum(
            1
            for api_key in self.api_keys
            if api_key["user_id"] == user_id and api_key["is_active"]
        )

    async def find_active_api_key(self, raw_key: str) -> dict[str, Any] | None:
        for api_key in self.api_keys:
            if api_key["is_active"] and api_key.get("raw_key") == raw_key:
                return deepcopy(api_key)
        return None

    async def record_usage_charge(
        self,
        *,
        user_id: str,
        api_key_id: str,
        request_id: str,
        search_type: str,
        include_answer: bool,
        period_start: date,
        period_end: date,
        credits_used: int,
    ) -> int:
        existing = self.usage_events.get(request_id)
        if existing is not None:
            return int(existing["credits_used"])

        self.usage_events[request_id] = {
            "user_id": user_id,
            "api_key_id": api_key_id,
            "search_type": search_type,
            "include_answer": include_answer,
            "credits_used": credits_used,
            "period_start": period_start,
            "period_end": period_end,
        }
        usage_key = (user_id, period_start, period_end)
        usage_row = self.usage_monthly.setdefault(
            usage_key,
            {"credits_used": 0},
        )
        usage_row["credits_used"] += credits_used
        return credits_used

    async def append_query_log(
        self,
        *,
        request_id: str,
        user_id: str,
        api_key_id: str,
        search_type: str,
        query_text: str,
        include_answer: bool,
        filters: dict[str, Any] | None,
        results_count: int,
    ) -> None:
        self.query_logs.append(
            {
                "request_id": request_id,
                "user_id": user_id,
                "api_key_id": api_key_id,
                "search_type": search_type,
                "query_text": query_text,
                "include_answer": include_answer,
                "filters": deepcopy(filters),
                "results_count": results_count,
            }
        )


def create_stub_database() -> StubDatabase:
    return StubDatabase()
