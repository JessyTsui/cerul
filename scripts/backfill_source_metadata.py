"""
One-off script: fetch YouTube channel info (avatar, description, stats, keywords)
for all content_sources and update their metadata JSONB column.
Downloads avatars to R2 CDN if configured.

Usage:
    python scripts/backfill_source_metadata.py
    python scripts/backfill_source_metadata.py --force   # re-fetch all, even existing

Requires YOUTUBE_API_KEY and DATABASE_URL in .env
"""

import asyncio
import json
import os
import re
import sys
from pathlib import Path

# Ensure repo root is on sys.path for workers/backend imports
_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

import httpx
import asyncpg
from dotenv import load_dotenv


async def fetch_channels_info(
    api_key: str,
    channel_ids: list[str],
) -> dict[str, dict]:
    """Batch-fetch channel snippet + statistics + keywords from YouTube Data API v3."""
    result: dict[str, dict] = {}
    for i in range(0, len(channel_ids), 50):
        batch = channel_ids[i : i + 50]
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                "https://www.googleapis.com/youtube/v3/channels",
                params={
                    "key": api_key,
                    "id": ",".join(batch),
                    "part": "snippet,statistics,brandingSettings",
                },
            )
            response.raise_for_status()
            data = response.json()

        for item in data.get("items", []):
            cid = item.get("id", "")
            snippet = item.get("snippet", {})
            statistics = item.get("statistics", {})
            branding = item.get("brandingSettings", {})
            branding_channel = branding.get("channel", {})

            thumbnails = snippet.get("thumbnails", {})
            thumbnail_url = None
            for key in ("high", "medium", "default"):
                thumb = thumbnails.get(key)
                if isinstance(thumb, dict) and thumb.get("url"):
                    thumbnail_url = thumb["url"]
                    break

            keywords = _parse_keywords(branding_channel.get("keywords"))

            result[cid] = {
                "thumbnail_url": thumbnail_url,
                "description": (snippet.get("description") or "").strip(),
                "custom_url": snippet.get("customUrl"),
                "country": snippet.get("country"),
                "subscriber_count": _safe_int(statistics.get("subscriberCount")),
                "video_count": _safe_int(statistics.get("videoCount")),
                "view_count": _safe_int(statistics.get("viewCount")),
                "keywords": keywords,
            }

    return result


async def mirror_avatar_to_r2(channel_id: str, source_url: str) -> str | None:
    """Download avatar and upload to R2. Returns CDN URL or None on failure."""
    try:
        from workers.common.storage import R2FrameUploader
        uploader = R2FrameUploader()
        if not uploader.available():
            return None

        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(source_url)
            resp.raise_for_status()
        content_type = resp.headers.get("content-type", "image/jpeg")
        ext = "png" if "png" in content_type else "jpg"
        key = f"avatars/channels/{channel_id}.{ext}"
        return await uploader.upload_bytes(key, resp.content, content_type)
    except Exception as exc:
        print(f"    R2 upload failed: {exc}")
        return None


def _parse_keywords(raw) -> list[str]:
    if not isinstance(raw, str) or not raw.strip():
        return []
    keywords = []
    for match in re.finditer(r'"([^"]+)"|(\S+)', raw):
        kw = (match.group(1) or match.group(2) or "").strip()
        if kw:
            keywords.append(kw)
    return keywords


def _safe_int(value) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (ValueError, TypeError):
        return None


def _format_count(n: int | None) -> str:
    if n is None:
        return "N/A"
    if n >= 1_000_000:
        return f"{n / 1_000_000:.1f}M"
    if n >= 1_000:
        return f"{n / 1_000:.1f}K"
    return str(n)


async def main():
    load_dotenv()
    force = "--force" in sys.argv

    api_key = os.getenv("YOUTUBE_API_KEY", "").strip()
    database_url = os.getenv("DATABASE_URL", "").strip()

    if not api_key:
        print("ERROR: YOUTUBE_API_KEY not set in .env")
        sys.exit(1)
    if not database_url:
        print("ERROR: DATABASE_URL not set in .env")
        sys.exit(1)

    conn = await asyncpg.connect(database_url)

    try:
        where_clause = "" if force else """
              AND (
                  metadata IS NULL
                  OR metadata = '{}'::jsonb
                  OR NOT (metadata ? 'thumbnail_url')
                  OR metadata->>'thumbnail_url' IS NULL
                  OR metadata->>'thumbnail_url' = ''
              )
        """
        rows = await conn.fetch(f"""
            SELECT id, slug, display_name, config, metadata
            FROM content_sources
            WHERE source_type = 'youtube'
            {where_clause}
            ORDER BY display_name
        """)
        print(f"Found {len(rows)} YouTube sources to update{' (--force)' if force else ''}\n")

        if not rows:
            print("Nothing to do.")
            return

        source_channel_map: list[tuple[str, str, str, dict]] = []
        channel_ids: list[str] = []
        for row in rows:
            config = json.loads(row["config"]) if isinstance(row["config"], str) else (row["config"] or {})
            channel_id = config.get("channel_id", "")
            if channel_id:
                existing_meta = row["metadata"] or {}
                if isinstance(existing_meta, str):
                    existing_meta = json.loads(existing_meta)
                source_channel_map.append((row["id"], row["slug"], channel_id, existing_meta))
                if channel_id not in channel_ids:
                    channel_ids.append(channel_id)

        print(f"Fetching info for {len(channel_ids)} unique channels from YouTube API...\n")
        channels_info = await fetch_channels_info(api_key, channel_ids)

        updated = 0
        for source_id, slug, channel_id, existing_metadata in source_channel_map:
            info = channels_info.get(channel_id)
            if not info:
                print(f"  SKIP  {slug} — channel {channel_id} not found on YouTube")
                continue

            # Mirror avatar to R2 CDN
            avatar_url = info["thumbnail_url"]
            r2_public_url = os.getenv("R2_PUBLIC_URL", "").strip()
            if avatar_url and (not avatar_url.startswith(r2_public_url) if r2_public_url else True):
                cdn_url = await mirror_avatar_to_r2(channel_id, avatar_url)
                if cdn_url:
                    avatar_url = cdn_url

            merged = dict(existing_metadata) if isinstance(existing_metadata, dict) else {}
            merged["thumbnail_url"] = avatar_url
            merged["description"] = info["description"]
            merged["custom_url"] = info["custom_url"]
            merged["country"] = info["country"]
            merged["subscriber_count"] = info["subscriber_count"]
            merged["video_count"] = info["video_count"]
            merged["view_count"] = info["view_count"]
            merged["keywords"] = info["keywords"]

            await conn.execute(
                """
                UPDATE content_sources
                SET metadata = $1::jsonb, updated_at = now()
                WHERE id = $2
                """,
                json.dumps(merged),
                source_id,
            )
            updated += 1

            subs = _format_count(info["subscriber_count"])
            videos = _format_count(info["video_count"])
            views = _format_count(info["view_count"])
            cdn_tag = "cdn" if avatar_url and "cdn" in avatar_url else "yt"
            kw_count = len(info["keywords"])
            print(f"  OK    {slug:<25} subs={subs:<8} videos={videos:<6} views={views:<10} avatar={cdn_tag:<4} kw={kw_count}")
            if info["keywords"]:
                print(f"        keywords: {', '.join(info['keywords'][:8])}")

        print(f"\nDone. Updated {updated}/{len(source_channel_map)} sources.")

    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
