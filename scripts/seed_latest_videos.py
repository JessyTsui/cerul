"""One-shot script: for each active YouTube source, discover the latest 100
videos via the YouTube Search API and insert them as pending processing_jobs.

Usage:
    python scripts/seed_latest_videos.py [--max-results 100] [--dry-run]

Requires DATABASE_URL and YOUTUBE_API_KEY in env (or .env file).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import asyncpg
import httpx

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

YT_SEARCH_URL = "https://www.googleapis.com/youtube/v3/search"
YT_VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos"


def _load_env() -> None:
    env_path = ROOT / ".env"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip())


async def fetch_video_ids(
    client: httpx.AsyncClient,
    api_key: str,
    channel_id: str,
    max_results: int,
) -> list[str]:
    video_ids: list[str] = []
    next_page: str | None = None

    while len(video_ids) < max_results:
        params: dict[str, str] = {
            "key": api_key,
            "channelId": channel_id,
            "type": "video",
            "part": "snippet",
            "order": "date",
            "maxResults": str(min(max_results - len(video_ids), 50)),
        }
        if next_page:
            params["pageToken"] = next_page

        resp = await client.get(YT_SEARCH_URL, params=params)
        resp.raise_for_status()
        payload = resp.json()

        for item in payload.get("items", []):
            vid = item.get("id", {}).get("videoId")
            if vid and vid not in video_ids:
                video_ids.append(vid)

        next_page = payload.get("nextPageToken")
        if not next_page:
            break

    return video_ids[:max_results]


async def fetch_video_metadata(
    client: httpx.AsyncClient,
    api_key: str,
    video_ids: list[str],
) -> list[dict]:
    results: list[dict] = []

    for i in range(0, len(video_ids), 50):
        batch = video_ids[i : i + 50]
        resp = await client.get(
            YT_VIDEOS_URL,
            params={
                "key": api_key,
                "id": ",".join(batch),
                "part": "snippet,contentDetails,statistics",
            },
        )
        resp.raise_for_status()
        payload = resp.json()

        for item in payload.get("items", []):
            vid = str(item.get("id", ""))
            snippet = item.get("snippet", {})
            stats = item.get("statistics", {})
            content = item.get("contentDetails", {})

            duration = 0
            import re

            m = re.match(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", content.get("duration", ""))
            if m:
                duration = int(m.group(1) or 0) * 3600 + int(m.group(2) or 0) * 60 + int(m.group(3) or 0)

            thumbs = snippet.get("thumbnails", {})
            thumb_url = None
            for key in ("maxres", "standard", "high", "medium", "default"):
                if thumbs.get(key, {}).get("url"):
                    thumb_url = thumbs[key]["url"]
                    break

            results.append(
                {
                    "source": "youtube",
                    "source_video_id": vid,
                    "video_id": vid,
                    "source_url": f"https://www.youtube.com/watch?v={vid}",
                    "video_url": f"https://www.youtube.com/watch?v={vid}",
                    "thumbnail_url": thumb_url,
                    "title": snippet.get("title", ""),
                    "description": snippet.get("description", ""),
                    "channel_title": snippet.get("channelTitle"),
                    "channel_id": snippet.get("channelId"),
                    "published_at": snippet.get("publishedAt"),
                    "duration_seconds": duration,
                    "view_count": int(stats["viewCount"]) if stats.get("viewCount") else None,
                    "like_count": int(stats["likeCount"]) if stats.get("likeCount") else None,
                }
            )

    return results


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--max-results", type=int, default=100)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    _load_env()

    database_url = os.environ.get("DATABASE_URL", "").strip()
    api_key = os.environ.get("YOUTUBE_API_KEY", "").strip()
    if not database_url:
        sys.exit("DATABASE_URL is required.")
    if not api_key:
        sys.exit("YOUTUBE_API_KEY is required.")

    conn = await asyncpg.connect(database_url)

    sources = await conn.fetch(
        """
        SELECT id, slug, track, source_type, config
        FROM content_sources
        WHERE is_active = TRUE AND source_type = 'youtube'
        ORDER BY slug
        """
    )
    log.info("Found %d active YouTube sources.", len(sources))

    total_created = 0
    total_skipped = 0

    async with httpx.AsyncClient(timeout=30.0) as client:
        for row in sources:
            source_id = str(row["id"])
            slug = row["slug"]
            config = row["config"] if isinstance(row["config"], dict) else json.loads(row["config"])
            channel_id = config.get("channel_id", "")

            if not channel_id:
                log.warning("Skipping '%s' — no channel_id.", slug)
                continue

            log.info("[%s] Fetching latest %d videos for channel %s ...", slug, args.max_results, channel_id)

            try:
                video_ids = await fetch_video_ids(client, api_key, channel_id, args.max_results)
            except httpx.HTTPStatusError as e:
                log.error("[%s] YouTube search failed: %s", slug, e)
                continue

            if not video_ids:
                log.info("[%s] No videos found.", slug)
                continue

            log.info("[%s] Found %d video IDs, fetching metadata ...", slug, len(video_ids))

            try:
                videos_meta = await fetch_video_metadata(client, api_key, video_ids)
            except httpx.HTTPStatusError as e:
                log.error("[%s] YouTube videos lookup failed: %s", slug, e)
                continue

            created = 0
            skipped = 0

            for meta in videos_meta:
                video_id = meta["source_video_id"]

                exists = await conn.fetchval(
                    """
                    SELECT 1 FROM processing_jobs
                    WHERE source_id = $1 AND input_payload->>'source_item_id' = $2
                    LIMIT 1
                    """,
                    row["id"],
                    video_id,
                )
                if exists:
                    skipped += 1
                    continue

                if args.dry_run:
                    created += 1
                    continue

                await conn.execute(
                    """
                    INSERT INTO processing_jobs (track, source_id, job_type, status, input_payload)
                    VALUES ('unified', $1, 'index_video', 'pending', $2::jsonb)
                    """,
                    row["id"],
                    json.dumps(
                        {
                            "track": "unified",
                            "discovery_track": "unified",
                            "source_slug": slug,
                            "source_type": "youtube",
                            "source_item_id": video_id,
                            "source": "youtube",
                            "source_video_id": video_id,
                            "url": meta["video_url"],
                            "owner_id": None,
                            "item": meta,
                            "source_metadata": meta,
                        },
                        default=str,
                    ),
                )
                created += 1

            # Update sync_cursor to latest video
            published_dates = sorted(
                [str(m.get("published_at", "")) for m in videos_meta if m.get("published_at")],
            )
            if published_dates and not args.dry_run:
                await conn.execute(
                    "UPDATE content_sources SET sync_cursor = $1 WHERE id = $2",
                    published_dates[-1],
                    row["id"],
                )

            total_created += created
            total_skipped += skipped
            mode = "[DRY RUN] " if args.dry_run else ""
            log.info(
                "%s[%s] Done — %d created, %d skipped (already existed).",
                mode,
                slug,
                created,
                skipped,
            )

    await conn.close()
    log.info("=== TOTAL: %d jobs created, %d skipped ===", total_created, total_skipped)


if __name__ == "__main__":
    asyncio.run(main())
