#!/usr/bin/env python3
"""
Experiment: Does removing Gemini Flash annotation hurt when we have dense visual embeddings?

Three configs:
1. Baseline: normal annotation + normal embed
2. No annotation + 5 dense visual embeds per segment
3. Normal annotation + 5 dense visual embeds per segment (best from prior experiment)
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend"))
sys.path.insert(0, str(REPO_ROOT))

from dotenv import load_dotenv
load_dotenv(REPO_ROOT / ".env")

from scripts.reindex_test_videos import IndexingConfig, reindex_videos, load_test_video_ids
from scripts.eval_indexing import run_eval
from scripts.experiment_dense_visual_embed import (
    create_dense_visual_units,
    cleanup_dense_visual_units,
    download_video_to_cache,
    _find_cached_video,
)

RESULTS_PATH = REPO_ROOT / "eval" / "no_annotation_experiment_results.json"


class NoAnnotationConfig(IndexingConfig):
    """Config that sets annotation budget to 0 — no Gemini Flash calls."""
    max_annotated_frames_per_video: int = 0
    max_annotated_frames_per_scene: int = 0


async def main() -> None:
    video_ids = load_test_video_ids()
    all_results: list[dict] = []

    # Pre-download videos
    print("=" * 70)
    print("Downloading test videos")
    print("=" * 70)
    for vid in video_ids:
        cached = _find_cached_video(vid)
        if cached:
            print(f"  {vid}: cached")
        else:
            print(f"  {vid}: downloading...", end=" ", flush=True)
            path = download_video_to_cache(vid)
            print("OK" if path else "FAILED")

    configs = [
        {
            "name": "1. Baseline (annotation + normal embed)",
            "indexing_config": IndexingConfig(),
            "dense_frames": 0,
        },
        {
            "name": "2. No annotation + 5 dense embed",
            "indexing_config": IndexingConfig(
                max_annotated_frames_per_video=0,
                max_annotated_frames_per_scene=0,
            ),
            "dense_frames": 5,
        },
        {
            "name": "3. Annotation + 5 dense embed",
            "indexing_config": IndexingConfig(),
            "dense_frames": 5,
        },
    ]

    for cfg in configs:
        name = cfg["name"]
        print(f"\n{'=' * 70}")
        print(f"EXPERIMENT: {name}")
        print(f"{'=' * 70}")

        t0 = time.perf_counter()

        # Reindex with given config
        reindex_result = await reindex_videos(
            video_ids, cfg["indexing_config"], verbose=False,
        )
        if reindex_result["error_count"] > 3:
            print(f"Too many failures ({reindex_result['error_count']})")
            all_results.append({"name": name, "status": "failed"})
            continue

        # Add dense visual units if needed
        await cleanup_dense_visual_units(video_ids)
        dense_units = 0
        if cfg["dense_frames"] > 0:
            dense_stats = await create_dense_visual_units(
                video_ids=video_ids,
                frames_per_segment=cfg["dense_frames"],
            )
            dense_units = dense_stats["total_units_created"]
            print(f"  Added {dense_units} dense visual units")

        elapsed = time.perf_counter() - t0

        # Eval
        eval_result = await run_eval("embedding", top_k=5)

        entry = {
            "name": name,
            "status": "ok",
            "elapsed_seconds": round(elapsed, 1),
            "success_count": reindex_result["success_count"],
            "error_count": reindex_result["error_count"],
            "dense_visual_units": dense_units,
            "recall_5": eval_result["recall_5"],
            "visual_recall": eval_result["visual_recall"],
            "ndcg": eval_result["ndcg"],
            "mrr": eval_result["mrr"],
            "per_query": eval_result["queries"],
        }
        all_results.append(entry)

        print(
            f"\n>>> recall@5={eval_result['recall_5']:.4f} "
            f"visual={eval_result['visual_recall']:.4f} "
            f"ndcg={eval_result['ndcg']:.4f} mrr={eval_result['mrr']:.4f} "
            f"({elapsed:.0f}s)"
        )

    # Cleanup
    await cleanup_dense_visual_units(video_ids)

    # Save
    RESULTS_PATH.write_text(json.dumps(all_results, indent=2, ensure_ascii=False))
    print(f"\n{'=' * 70}")
    print("RESULTS SUMMARY")
    print(f"{'=' * 70}")
    print(f"{'Config':<45} {'Recall@5':>10} {'Visual':>10} {'NDCG':>10}")
    print("-" * 80)
    for r in all_results:
        if r.get("status") != "ok":
            print(f"{r['name']:<45} FAILED")
            continue
        print(
            f"{r['name']:<45} {r['recall_5']:>10.4f} {r['visual_recall']:>10.4f} "
            f"{r['ndcg']:>10.4f}"
        )
    print(f"\nSaved to {RESULTS_PATH}")


if __name__ == "__main__":
    import logging
    logging.basicConfig(level=logging.WARNING)
    asyncio.run(main())
