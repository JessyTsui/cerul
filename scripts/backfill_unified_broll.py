#!/usr/bin/env python3
from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import secrets
import sys
from pathlib import Path
from typing import Any

import asyncpg

ROOT_DIR = Path(__file__).resolve().parents[1]

if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Queue unified backfill jobs for legacy broll_assets rows.",
    )
    parser.add_argument(
        "--db-url",
        help="Database URL override. Defaults to DATABASE_URL.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Optional max number of legacy assets to inspect.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-enqueue even when unified units already exist for the asset.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the backfill plan without writing jobs.",
    )
    return parser


def resolve_db_url(explicit_db_url: str | None) -> str:
    db_url = (explicit_db_url or os.getenv("DATABASE_URL") or "").strip()
    if not db_url:
        raise RuntimeError("DATABASE_URL is required unless --dry-run is set.")
    return db_url


def generate_request_id() -> str:
    return f"req_{secrets.token_hex(12)}"


def normalize_source_video_id(
    *,
    source: str,
    source_asset_id: str,
    source_url: str | None,
) -> str | None:
    normalized_asset_id = source_asset_id.strip()
    if normalized_asset_id.isdigit():
        return normalized_asset_id

    if source == "pexels":
        match = re.search(r"(\d+)$", normalized_asset_id)
        if match:
            return match.group(1)
        if source_url:
            url_match = re.search(r"/video/[^/]*-([0-9]+)/?$", source_url)
            if url_match:
                return url_match.group(1)

    if source == "pixabay":
        match = re.search(r"(\d+)$", normalized_asset_id)
        if match:
            return match.group(1)
        if source_url:
            url_match = re.search(r"/videos/(?:[^/]*-)?([0-9]+)/?$", source_url)
            if url_match:
                return url_match.group(1)

    return None


async def fetch_legacy_assets(
    connection: asyncpg.Connection,
    *,
    limit: int,
) -> list[asyncpg.Record]:
    sql = """
        SELECT
            id::text AS asset_id,
            source,
            source_asset_id,
            source_url,
            video_url
        FROM broll_assets
        WHERE source IN ('pexels', 'pixabay')
        ORDER BY created_at ASC, id ASC
    """
    if limit > 0:
        sql += " LIMIT $1"
        return await connection.fetch(sql, limit)
    return await connection.fetch(sql)


async def fetch_unified_video_state(
    connection: asyncpg.Connection,
    *,
    source: str,
    source_video_id: str,
) -> dict[str, Any] | None:
    row = await connection.fetchrow(
        """
        SELECT
            v.id::text AS video_id,
            EXISTS (
                SELECT 1
                FROM retrieval_units AS ru
                WHERE ru.video_id = v.id
            ) AS has_units
        FROM videos AS v
        WHERE v.source = $1
          AND v.source_video_id = $2
        LIMIT 1
        """,
        source,
        source_video_id,
    )
    return dict(row) if row is not None else None


async def has_active_unified_job(
    connection: asyncpg.Connection,
    *,
    source: str,
    source_video_id: str,
) -> bool:
    existing = await connection.fetchval(
        """
        SELECT 1
        FROM processing_jobs
        WHERE track = 'unified'
          AND status IN ('pending', 'running', 'retrying')
          AND input_payload->>'source' = $1
          AND input_payload->>'source_video_id' = $2
        LIMIT 1
        """,
        source,
        source_video_id,
    )
    return bool(existing)


async def queue_backfill(
    connection: asyncpg.Connection,
    *,
    asset: asyncpg.Record,
    source_video_id: str,
    existing_video_id: str | None,
    force: bool,
) -> None:
    source = str(asset["source"])
    source_url = str(asset.get("source_url") or asset.get("video_url") or "").strip()
    if not source_url:
        raise ValueError(f"Legacy asset {asset['asset_id']} is missing a usable URL.")

    payload = {
        "request_id": generate_request_id(),
        "video_id": existing_video_id,
        "owner_id": None,
        "url": source_url,
        "source": source,
        "source_video_id": source_video_id,
        "force": force,
        "legacy_asset_id": str(asset["asset_id"]),
        "backfill_reason": "legacy_broll_reembed_3072d",
    }
    await connection.execute(
        """
        INSERT INTO processing_jobs (
            track,
            source_id,
            job_type,
            status,
            input_payload
        )
        VALUES (
            'unified',
            NULL,
            'index_video',
            'pending',
            $1::jsonb
        )
        """,
        json.dumps(payload),
    )


async def run_backfill(args: argparse.Namespace) -> int:
    db_url = resolve_db_url(args.db_url)
    connection = await asyncpg.connect(db_url)

    inspected = 0
    queued = 0
    skipped_existing = 0
    skipped_active_job = 0
    skipped_invalid = 0

    try:
        assets = await fetch_legacy_assets(connection, limit=max(int(args.limit), 0))
        for asset in assets:
            inspected += 1
            source = str(asset["source"])
            source_video_id = normalize_source_video_id(
                source=source,
                source_asset_id=str(asset["source_asset_id"]),
                source_url=(
                    str(asset["source_url"]).strip()
                    if asset.get("source_url") is not None
                    else None
                ),
            )
            if source_video_id is None:
                skipped_invalid += 1
                print(
                    f"skip invalid: {asset['asset_id']} "
                    f"({source} / {asset['source_asset_id']})"
                )
                continue

            unified_video = await fetch_unified_video_state(
                connection,
                source=source,
                source_video_id=source_video_id,
            )
            if (
                unified_video is not None
                and bool(unified_video.get("has_units"))
                and not args.force
            ):
                skipped_existing += 1
                print(
                    f"skip existing: {asset['asset_id']} "
                    f"-> {source}:{source_video_id}"
                )
                continue

            if await has_active_unified_job(
                connection,
                source=source,
                source_video_id=source_video_id,
            ):
                skipped_active_job += 1
                print(
                    f"skip active job: {asset['asset_id']} "
                    f"-> {source}:{source_video_id}"
                )
                continue

            if args.dry_run:
                queued += 1
                print(
                    f"would queue: {asset['asset_id']} "
                    f"-> {source}:{source_video_id}"
                )
                continue

            await queue_backfill(
                connection,
                asset=asset,
                source_video_id=source_video_id,
                existing_video_id=(
                    str(unified_video["video_id"]) if unified_video is not None else None
                ),
                force=bool(args.force),
            )
            queued += 1
            print(
                f"queued: {asset['asset_id']} -> {source}:{source_video_id}"
            )
    finally:
        await connection.close()

    print(
        "summary: "
        f"inspected={inspected} "
        f"queued={queued} "
        f"skipped_existing={skipped_existing} "
        f"skipped_active_job={skipped_active_job} "
        f"skipped_invalid={skipped_invalid}"
    )
    return 0


async def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    return await run_backfill(args)


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
