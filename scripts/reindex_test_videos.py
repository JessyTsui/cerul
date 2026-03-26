#!/usr/bin/env python3
"""
Reindex test videos with custom indexing parameters.

Uses the unified indexing pipeline to re-process test videos from
eval/indexing_benchmark.json. Supports passing custom HeuristicFrameAnalyzer
and scene detection parameters.

Usage:
    python scripts/reindex_test_videos.py [--params '{"scene_threshold": 0.25}']
    python scripts/reindex_test_videos.py --video bxBzsSsqQAM
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend"))
sys.path.insert(0, str(REPO_ROOT))

from dotenv import load_dotenv
load_dotenv(REPO_ROOT / ".env")

from workers.knowledge.runtime import HeuristicFrameAnalyzer, HeuristicSceneDetector
from workers.unified.pipeline import UnifiedIndexingPipeline

BENCHMARK_PATH = REPO_ROOT / "eval" / "indexing_benchmark.json"

logger = logging.getLogger(__name__)


@dataclass
class IndexingConfig:
    """All tunable indexing parameters with defaults matching current production."""
    # Scene detection (HeuristicSceneDetector threshold — controls pause_threshold
    # and max_scene_seconds).
    scene_threshold: float = 0.35

    # Frame extraction (ffmpeg scene detection sensitivity).
    frame_scene_threshold: float = 0.25

    # Frame filtering.
    max_informative_frames: int = 2
    skin_ratio_threshold: float = 0.45
    edge_ratio_threshold: float = 0.04

    # Frame annotation budget.
    max_annotated_frames_per_scene: int = 1
    max_annotated_frames_per_video: int = 0

    # Short video annotation bias (seconds).
    short_video_annotate_bias_seconds: float = 180.0

    # OCR / text region detection.
    text_region_min_count: int = 8
    text_region_min_area_ratio: float = 0.02

    # Frame deduplication.
    hash_distance_threshold: int = 8

    # Route override: if True, always annotate scenes with informative frames
    # (bypasses the default "embed_only" fallback for long videos without OCR).
    always_annotate: bool = False

    def label(self) -> str:
        parts = []
        if self.scene_threshold != 0.35:
            parts.append(f"scene={self.scene_threshold}")
        if self.frame_scene_threshold != 0.25:
            parts.append(f"fscene={self.frame_scene_threshold}")
        if self.max_informative_frames != 2:
            parts.append(f"info={self.max_informative_frames}")
        if self.max_annotated_frames_per_scene != 1:
            parts.append(f"ann/sc={self.max_annotated_frames_per_scene}")
        if self.max_annotated_frames_per_video != 0:
            parts.append(f"ann/vid={self.max_annotated_frames_per_video}")
        if self.skin_ratio_threshold != 0.45:
            parts.append(f"skin={self.skin_ratio_threshold}")
        if self.edge_ratio_threshold != 0.04:
            parts.append(f"edge={self.edge_ratio_threshold}")
        if self.text_region_min_count != 8:
            parts.append(f"ocr_n={self.text_region_min_count}")
        if self.text_region_min_area_ratio != 0.02:
            parts.append(f"ocr_a={self.text_region_min_area_ratio}")
        if self.short_video_annotate_bias_seconds != 180.0:
            parts.append(f"short={self.short_video_annotate_bias_seconds}")
        if self.always_annotate:
            parts.append("always_annotate")
        return " | ".join(parts) if parts else "baseline"


class AlwaysAnnotateFrameAnalyzer(HeuristicFrameAnalyzer):
    """Subclass that overrides _resolve_scene_route to always annotate."""

    def _resolve_scene_route(
        self,
        *,
        video_duration_seconds: float,
        unique_frame_count: int,
        selected_frame_count: int,
        ocr_detected: bool,
    ) -> str:
        if unique_frame_count <= 1 or selected_frame_count <= 0:
            return "text_only"
        return "annotate"


class CustomSkinEdgeFrameAnalyzer(HeuristicFrameAnalyzer):
    """Subclass with configurable skin/edge thresholds."""

    def __init__(
        self,
        *,
        skin_ratio_threshold: float = 0.45,
        edge_ratio_threshold: float = 0.04,
        **kwargs: Any,
    ) -> None:
        super().__init__(**kwargs)
        self._skin_ratio_threshold = skin_ratio_threshold
        self._edge_ratio_threshold = edge_ratio_threshold

    def _is_informative_frame(self, frame_path: Path) -> bool:
        try:
            import cv2
            import numpy as np
        except ImportError:
            return True

        image = cv2.imread(str(frame_path))
        if image is None:
            try:
                return frame_path.stat().st_size > 0
            except OSError:
                return True

        hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
        lower_skin_primary = np.array([0, 40, 60], dtype=np.uint8)
        upper_skin_primary = np.array([25, 255, 255], dtype=np.uint8)
        lower_skin_secondary = np.array([160, 40, 60], dtype=np.uint8)
        upper_skin_secondary = np.array([180, 255, 255], dtype=np.uint8)
        skin_mask = cv2.inRange(hsv, lower_skin_primary, upper_skin_primary)
        skin_mask |= cv2.inRange(hsv, lower_skin_secondary, upper_skin_secondary)
        skin_ratio = float(np.count_nonzero(skin_mask)) / float(skin_mask.size)

        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        edges = cv2.Canny(gray, 100, 200)
        edge_ratio = float(np.count_nonzero(edges)) / float(edges.size)

        return not (
            skin_ratio > self._skin_ratio_threshold
            and edge_ratio < self._edge_ratio_threshold
        )


class AlwaysAnnotateCustomFrameAnalyzer(CustomSkinEdgeFrameAnalyzer):
    """Combines always_annotate route with custom skin/edge thresholds."""

    def _resolve_scene_route(
        self,
        *,
        video_duration_seconds: float,
        unique_frame_count: int,
        selected_frame_count: int,
        ocr_detected: bool,
    ) -> str:
        if unique_frame_count <= 1 or selected_frame_count <= 0:
            return "text_only"
        return "annotate"


def build_frame_analyzer(config: IndexingConfig) -> HeuristicFrameAnalyzer:
    """Build a HeuristicFrameAnalyzer (or subclass) from an IndexingConfig."""
    common_kwargs: dict[str, Any] = {
        "scene_threshold": config.frame_scene_threshold,
        "max_informative_frames": config.max_informative_frames,
        "max_annotated_frames_per_scene": config.max_annotated_frames_per_scene,
        "max_annotated_frames_per_video": config.max_annotated_frames_per_video,
        "short_video_annotate_bias_seconds": config.short_video_annotate_bias_seconds,
        "text_region_min_count": config.text_region_min_count,
        "text_region_min_area_ratio": config.text_region_min_area_ratio,
        "hash_distance_threshold": config.hash_distance_threshold,
    }
    needs_custom_skin_edge = (
        config.skin_ratio_threshold != 0.45
        or config.edge_ratio_threshold != 0.04
    )

    if config.always_annotate and needs_custom_skin_edge:
        return AlwaysAnnotateCustomFrameAnalyzer(
            skin_ratio_threshold=config.skin_ratio_threshold,
            edge_ratio_threshold=config.edge_ratio_threshold,
            **common_kwargs,
        )
    if config.always_annotate:
        return AlwaysAnnotateFrameAnalyzer(**common_kwargs)
    if needs_custom_skin_edge:
        return CustomSkinEdgeFrameAnalyzer(
            skin_ratio_threshold=config.skin_ratio_threshold,
            edge_ratio_threshold=config.edge_ratio_threshold,
            **common_kwargs,
        )
    return HeuristicFrameAnalyzer(**common_kwargs)


async def reindex_videos(
    video_ids: list[str],
    config: IndexingConfig,
    *,
    verbose: bool = False,
) -> dict[str, Any]:
    """Reindex the given videos with the specified config.

    Returns stats about the reindex run.
    """
    frame_analyzer = build_frame_analyzer(config)
    pipeline = UnifiedIndexingPipeline(
        frame_analyzer=frame_analyzer,
    )

    results: dict[str, Any] = {
        "config": config.label(),
        "videos": {},
        "total_time_seconds": 0,
        "success_count": 0,
        "error_count": 0,
    }

    t0 = time.perf_counter()

    for video_id in video_ids:
        video_t0 = time.perf_counter()
        print(f"  Reindexing {video_id} ...", end=" ", flush=True)
        try:
            context = await pipeline.run(
                url=f"https://www.youtube.com/watch?v={video_id}",
                source="youtube",
                source_video_id=video_id,
                owner_id=None,
                conf={
                    "scene_threshold": config.scene_threshold,
                    "step_timeouts": {
                        "DownloadKnowledgeVideoStep": 900.0,
                        "TranscribeKnowledgeVideoStep": 1200.0,
                        "AnalyzeKnowledgeFramesStep": 900.0,
                    },
                },
            )
            elapsed = time.perf_counter() - video_t0
            unit_count = context.data.get("indexed_unit_count", 0)
            print(f"OK ({unit_count} units, {elapsed:.1f}s)")
            results["videos"][video_id] = {
                "status": "ok",
                "unit_count": unit_count,
                "elapsed_seconds": round(elapsed, 1),
            }
            results["success_count"] += 1
        except Exception as exc:
            elapsed = time.perf_counter() - video_t0
            print(f"FAILED ({elapsed:.1f}s): {exc}")
            results["videos"][video_id] = {
                "status": "error",
                "error": str(exc),
                "elapsed_seconds": round(elapsed, 1),
            }
            results["error_count"] += 1
            if verbose:
                import traceback
                traceback.print_exc()

    results["total_time_seconds"] = round(time.perf_counter() - t0, 1)
    return results


def load_test_video_ids(video_filter: str | None = None) -> list[str]:
    benchmark = json.loads(BENCHMARK_PATH.read_text())
    all_ids = [v["source_video_id"] for v in benchmark["test_videos"]]
    if video_filter:
        filtered = [vid for vid in all_ids if vid in video_filter.split(",")]
        return filtered or all_ids
    return all_ids


def main() -> None:
    parser = argparse.ArgumentParser(description="Reindex test videos")
    parser.add_argument(
        "--params",
        type=str,
        default="{}",
        help='JSON dict of IndexingConfig overrides, e.g. \'{"scene_threshold": 0.25}\'',
    )
    parser.add_argument(
        "--video",
        type=str,
        default=None,
        help="Comma-separated video IDs to reindex (default: all test videos)",
    )
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO if args.verbose else logging.WARNING,
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
    )

    config_overrides = json.loads(args.params)
    config = IndexingConfig(**config_overrides)
    video_ids = load_test_video_ids(args.video)

    print(f"Config: {config.label()}")
    print(f"Videos: {len(video_ids)}")
    print("-" * 60)

    results = asyncio.run(reindex_videos(video_ids, config, verbose=args.verbose))

    print("-" * 60)
    print(
        f"Done: {results['success_count']} ok, {results['error_count']} errors, "
        f"{results['total_time_seconds']}s total"
    )

    return results


if __name__ == "__main__":
    main()
