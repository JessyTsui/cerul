#!/usr/bin/env python3
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Any

ROOT_DIR = Path(__file__).resolve().parents[1]
DEFAULT_QUERY_FILE = ROOT_DIR / "scripts" / "broll_queries.txt"
DEFAULT_STATE_FILE = ROOT_DIR / "scripts" / ".seed_broll_state.json"

if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from workers.broll import BrollAssetRepository, BrollIndexingPipeline  # noqa: E402


PipelineFactory = Callable[[BrollAssetRepository], BrollIndexingPipeline]


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Seed Cerul B-roll assets.")
    parser.add_argument("--query", help='Single query mode, e.g. "aerial mountain sunrise"')
    parser.add_argument(
        "--file",
        default=str(DEFAULT_QUERY_FILE),
        help="Batch mode query file path",
    )
    parser.add_argument(
        "--source",
        choices=("pexels", "pixabay", "all"),
        default="all",
        help="Content source selection",
    )
    parser.add_argument(
        "--per-page",
        type=int,
        default=50,
        help="Results fetched per provider API call",
    )
    parser.add_argument(
        "--max-pages",
        type=int,
        default=10,
        help="Maximum pagination depth per query",
    )
    parser.add_argument(
        "--resume",
        action="store_true",
        help="Skip queries already marked as completed in the state file",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be processed without making API calls",
    )
    parser.add_argument(
        "--db-url",
        help="Database URL override. Defaults to DATABASE_URL.",
    )
    return parser


async def run_seed(
    args: argparse.Namespace,
    *,
    state_path: Path = DEFAULT_STATE_FILE,
    pipeline_factory: PipelineFactory | None = None,
) -> int:
    queries = load_queries(
        query=args.query,
        file_path=Path(args.file) if args.file else DEFAULT_QUERY_FILE,
    )
    state = load_state(state_path)
    sources = resolve_sources(args.source)

    if args.dry_run:
        _print_dry_run_plan(
            queries=queries,
            state=state,
            sources=sources,
            per_page=args.per_page,
            max_pages=args.max_pages,
            resume=args.resume,
        )
        return 0

    db_url = resolve_db_url(args.db_url)
    repository = BrollAssetRepository(db_url)
    await repository.connect()
    pipeline = (
        pipeline_factory(repository)
        if pipeline_factory is not None
        else BrollIndexingPipeline(repository=repository, db_url=db_url)
    )

    total_queries = len(queries)
    started_at = time.monotonic()
    executed_queries = 0

    try:
        for index, query in enumerate(queries, start=1):
            query_state = state.get(query, {})
            if args.resume and query_state.get("status") == "completed":
                print(f"Query {index}/{total_queries} '{query}': skipped (completed)")
                continue

            query_started_at = time.monotonic()
            try:
                context = await pipeline.run(
                    query,
                    conf={
                        "sources": sources,
                        "per_page": args.per_page,
                        "max_pages": args.max_pages,
                    },
                )
            except Exception as exc:
                state[query] = {
                    "status": "failed",
                    "assets_found": 0,
                    "assets_indexed": 0,
                    "last_page": 0,
                    "error": str(exc),
                }
                save_state(state_path, state)
                print(f"Query {index}/{total_queries} '{query}': failed ({exc})")
                continue

            query_state = build_query_state(context=context)
            state[query] = query_state
            save_state(state_path, state)

            executed_queries += 1
            eta_seconds = estimate_remaining_seconds(
                started_at=started_at,
                processed_queries=executed_queries,
                remaining_queries=total_queries - index,
            )
            elapsed_seconds = time.monotonic() - query_started_at

            if context.failed_step is not None:
                error_message = context.error or f"failed at {context.failed_step}"
                print(
                    f"Query {index}/{total_queries} '{query}': failed "
                    f"({error_message})"
                )
                continue

            print(
                f"Query {index}/{total_queries} '{query}': "
                f"{query_state['assets_found']} discovered, "
                f"{query_state['new_assets']} new, "
                f"{query_state['assets_indexed']} indexed "
                f"[{format_duration(elapsed_seconds)} elapsed, "
                f"ETA {format_duration(eta_seconds)}]"
            )
    finally:
        await repository.close()

    completed_queries = [
        query for query in queries if state.get(query, {}).get("status") == "completed"
    ]
    failed_queries = [
        query for query in queries if state.get(query, {}).get("status") == "failed"
    ]
    total_indexed = sum(
        int(state[query].get("assets_indexed", 0)) for query in completed_queries
    )
    print(
        f"Total: {total_indexed:,} assets indexed across "
        f"{len(completed_queries)} queries"
    )
    if failed_queries:
        print(f"Warning: {len(failed_queries)} queries failed")
        return 1
    return 0


def load_queries(*, query: str | None, file_path: Path) -> list[str]:
    if query:
        return [normalize_query(query)]

    if not file_path.exists():
        raise FileNotFoundError(f"Query file does not exist: {file_path}")

    ordered_queries: list[str] = []
    seen_queries: set[str] = set()
    for raw_line in file_path.read_text(encoding="utf-8").splitlines():
        normalized_query = normalize_query(raw_line)
        if not normalized_query or normalized_query.startswith("#"):
            continue
        if normalized_query in seen_queries:
            continue
        seen_queries.add(normalized_query)
        ordered_queries.append(normalized_query)

    if not ordered_queries:
        raise ValueError("No valid B-roll queries were found.")
    return ordered_queries


def normalize_query(value: str) -> str:
    return value.strip()


def load_state(state_path: Path) -> dict[str, dict[str, Any]]:
    if not state_path.exists():
        return {}

    payload = json.loads(state_path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("Seed state file must contain a JSON object.")
    return {
        str(query): dict(value)
        for query, value in payload.items()
        if isinstance(value, dict)
    }


def save_state(state_path: Path, state: dict[str, dict[str, Any]]) -> None:
    state_path.parent.mkdir(parents=True, exist_ok=True)
    state_path.write_text(
        json.dumps(state, indent=2, sort_keys=True, ensure_ascii=True) + "\n",
        encoding="utf-8",
    )


def resolve_sources(source_name: str) -> list[str]:
    if source_name == "all":
        return ["pexels", "pixabay"]
    return [source_name]


def resolve_db_url(explicit_db_url: str | None) -> str:
    db_url = (explicit_db_url or os.getenv("DATABASE_URL") or "").strip()
    if not db_url:
        raise RuntimeError("DATABASE_URL is required unless --dry-run is set.")
    return db_url


def build_query_state(*, context: Any) -> dict[str, Any]:
    assets_found = int(context.data.get("discovered_assets_count", 0))
    assets_indexed = int(context.data.get("indexed_assets_count", 0))
    return {
        "status": "failed" if context.failed_step is not None else "completed",
        "assets_found": assets_found,
        "new_assets": int(context.data.get("new_assets_count", 0)),
        "assets_indexed": assets_indexed,
        "last_page": int(context.data.get("last_discovery_page", 0)),
        "error": context.error,
    }


def estimate_remaining_seconds(
    *,
    started_at: float,
    processed_queries: int,
    remaining_queries: int,
) -> float:
    if processed_queries <= 0 or remaining_queries <= 0:
        return 0.0

    average_seconds = (time.monotonic() - started_at) / processed_queries
    return average_seconds * remaining_queries


def format_duration(seconds: float) -> str:
    total_seconds = max(int(seconds), 0)
    hours, remainder = divmod(total_seconds, 3600)
    minutes, secs = divmod(remainder, 60)
    if hours:
        return f"{hours:d}h{minutes:02d}m{secs:02d}s"
    if minutes:
        return f"{minutes:d}m{secs:02d}s"
    return f"{secs:d}s"


def _print_dry_run_plan(
    *,
    queries: Sequence[str],
    state: dict[str, dict[str, Any]],
    sources: Sequence[str],
    per_page: int,
    max_pages: int,
    resume: bool,
) -> None:
    total_queries = len(queries)
    max_assets_per_query = per_page * max_pages * len(sources)
    for index, query in enumerate(queries, start=1):
        if resume and state.get(query, {}).get("status") == "completed":
            print(f"Query {index}/{total_queries} '{query}': skipped (completed)")
            continue
        print(
            f"Query {index}/{total_queries} '{query}': dry-run, up to "
            f"{max_assets_per_query} assets from {', '.join(sources)}"
        )

    print(
        f"Dry run: {total_queries} queries, up to "
        f"{max_assets_per_query * total_queries:,} source assets total"
    )


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return asyncio.run(run_seed(args))
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
