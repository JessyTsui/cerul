#!/usr/bin/env python3
"""
Experiment: annotation vs no-annotation, using existing DB data.
No reindex needed — directly manipulates retrieval_units in DB.

Config 1: Baseline (existing DB state as-is)
Config 2: Strip annotation text from visual units + add 5 dense embed units
Config 3: Keep annotation text + add 5 dense embed units
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend"))
sys.path.insert(0, str(REPO_ROOT))

from dotenv import load_dotenv
load_dotenv(REPO_ROOT / ".env")

import asyncpg
from app.config import get_settings
from scripts.eval_indexing import run_eval
from scripts.experiment_dense_visual_embed import (
    create_dense_visual_units,
    cleanup_dense_visual_units,
    _find_cached_video,
    load_test_video_ids,
)

RESULTS_PATH = REPO_ROOT / "eval" / "no_annotation_experiment_results.json"


async def get_connection() -> asyncpg.Connection:
    url = get_settings().database.url or os.getenv("DATABASE_URL", "")
    return await asyncpg.connect(url)


async def strip_visual_annotation_text(video_ids: list[str]) -> dict[str, int]:
    """Remove visual_desc/visual_type from existing visual units (simulates no annotation)."""
    conn = await get_connection()
    counts = {}
    for vid in video_ids:
        result = await conn.execute(
            """
            UPDATE retrieval_units
            SET visual_desc = NULL, visual_type = NULL, content_text = title
            WHERE video_id = (SELECT id FROM videos WHERE source_video_id = $1)
              AND unit_type = 'visual'
              AND unit_index < 1000
            """,
            vid,
        )
        counts[vid] = int(result.split()[-1]) if result else 0
    # Also strip visual info from speech units' content_text
    for vid in video_ids:
        rows = await conn.fetch(
            """
            SELECT ru.id, ru.transcript, v.title
            FROM retrieval_units ru
            JOIN videos v ON v.id = ru.video_id
            WHERE v.source_video_id = $1 AND ru.unit_type = 'speech'
            """,
            vid,
        )
        for row in rows:
            # Rebuild content_text without visual description
            title = row["title"] or ""
            transcript = row["transcript"] or ""
            new_content = f"{title}\n{transcript}".strip()
            await conn.execute(
                "UPDATE retrieval_units SET content_text = $1 WHERE id = $2",
                new_content,
                row["id"],
            )
    await conn.close()
    return counts


async def restore_visual_annotation_text(video_ids: list[str]) -> None:
    """Restore visual_desc by re-reading from metadata. Since we can't easily restore,
    we'll just note this config needs a reindex to fully restore."""
    pass  # We'll reindex at the end to restore


async def main() -> None:
    video_ids = load_test_video_ids()
    all_results: list[dict] = []

    # Check which videos have cached files for dense embed
    cached_vids = [vid for vid in video_ids if _find_cached_video(vid) is not None]
    print(f"Videos with cached files: {len(cached_vids)}/{len(video_ids)}")
    print(f"  Cached: {cached_vids}")
    missing = [vid for vid in video_ids if vid not in cached_vids]
    if missing:
        print(f"  Missing: {missing} (dense embed will skip these)")

    # ======== Config 1: Baseline (DB as-is) ========
    print(f"\n{'=' * 70}")
    print("CONFIG 1: Baseline (existing DB with annotation)")
    print(f"{'=' * 70}")
    await cleanup_dense_visual_units(video_ids)
    eval1 = await run_eval("embedding", top_k=5)
    all_results.append({
        "name": "1. Baseline (annotation, no dense embed)",
        "recall_5": eval1["recall_5"],
        "visual_recall": eval1["visual_recall"],
        "ndcg": eval1["ndcg"],
        "mrr": eval1["mrr"],
        "per_query": eval1["queries"],
    })
    print(f"\n>>> recall@5={eval1['recall_5']:.4f} visual={eval1['visual_recall']:.4f} ndcg={eval1['ndcg']:.4f}")

    # ======== Config 3: Annotation + 5 dense embed (run this BEFORE stripping) ========
    print(f"\n{'=' * 70}")
    print("CONFIG 3: Annotation + 5 dense embed")
    print(f"{'=' * 70}")
    await cleanup_dense_visual_units(video_ids)
    dense_stats = await create_dense_visual_units(
        video_ids=video_ids, frames_per_segment=5,
    )
    print(f"  Added {dense_stats['total_units_created']} dense visual units")
    eval3 = await run_eval("embedding", top_k=5)
    all_results.append({
        "name": "3. Annotation + 5 dense embed",
        "dense_units": dense_stats["total_units_created"],
        "recall_5": eval3["recall_5"],
        "visual_recall": eval3["visual_recall"],
        "ndcg": eval3["ndcg"],
        "mrr": eval3["mrr"],
        "per_query": eval3["queries"],
    })
    print(f"\n>>> recall@5={eval3['recall_5']:.4f} visual={eval3['visual_recall']:.4f} ndcg={eval3['ndcg']:.4f}")

    # ======== Config 2: No annotation + 5 dense embed ========
    print(f"\n{'=' * 70}")
    print("CONFIG 2: No annotation + 5 dense embed")
    print(f"{'=' * 70}")
    # Strip annotation text from existing units
    strip_counts = await strip_visual_annotation_text(video_ids)
    total_stripped = sum(strip_counts.values())
    print(f"  Stripped annotation from {total_stripped} visual units")
    # Dense embed units already exist from Config 3
    eval2 = await run_eval("embedding", top_k=5)
    # Insert at position 1 so order is 1,2,3
    all_results.insert(1, {
        "name": "2. No annotation + 5 dense embed",
        "stripped_visual_units": total_stripped,
        "dense_units": dense_stats["total_units_created"],
        "recall_5": eval2["recall_5"],
        "visual_recall": eval2["visual_recall"],
        "ndcg": eval2["ndcg"],
        "mrr": eval2["mrr"],
        "per_query": eval2["queries"],
    })
    print(f"\n>>> recall@5={eval2['recall_5']:.4f} visual={eval2['visual_recall']:.4f} ndcg={eval2['ndcg']:.4f}")

    # Cleanup
    await cleanup_dense_visual_units(video_ids)

    # Save
    RESULTS_PATH.write_text(json.dumps(all_results, indent=2, ensure_ascii=False))

    print(f"\n{'=' * 70}")
    print("FINAL COMPARISON")
    print(f"{'=' * 70}")
    print(f"{'Config':<45} {'Recall@5':>10} {'Visual':>10} {'NDCG':>10} {'MRR':>10}")
    print("-" * 90)
    for r in all_results:
        print(
            f"{r['name']:<45} {r['recall_5']:>10.4f} {r['visual_recall']:>10.4f} "
            f"{r['ndcg']:>10.4f} {r['mrr']:>10.4f}"
        )
    print(f"\nSaved to {RESULTS_PATH}")
    print("\nWARNING: DB visual annotation text has been stripped for Config 2.")
    print("Run a reindex to restore annotation data.")


if __name__ == "__main__":
    import logging
    logging.basicConfig(level=logging.WARNING)
    asyncio.run(main())
