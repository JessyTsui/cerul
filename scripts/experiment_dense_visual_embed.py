#!/usr/bin/env python3
"""
Experiment: Dense visual embedding without Gemini annotation.

Strategy: After normal indexing, extract many keyframes per segment and create
additional visual retrieval units with multimodal embeddings (text + image).
This leverages Gemini Embedding 2's native cross-modal matching instead of
paying for Gemini Flash frame annotation.

Usage:
    python scripts/experiment_dense_visual_embed.py
"""

from __future__ import annotations

import asyncio
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend"))
sys.path.insert(0, str(REPO_ROOT))

from dotenv import load_dotenv
load_dotenv(REPO_ROOT / ".env")

import asyncpg

from app.config import get_settings
from app.embedding import create_embedding_backend
from app.search.base import DEFAULT_KNOWLEDGE_VECTOR_DIMENSION

from scripts.reindex_test_videos import IndexingConfig, reindex_videos, load_test_video_ids
from scripts.eval_indexing import run_eval

RESULTS_PATH = REPO_ROOT / "eval" / "dense_visual_experiment_results.json"


# ---------------------------------------------------------------------------
# Frame extraction
# ---------------------------------------------------------------------------

def extract_frames_at_timestamps(
    video_path: Path,
    timestamps: list[float],
    output_dir: Path,
    scale: str = "640:360",
) -> list[Path]:
    """Extract JPEG frames at given timestamps using ffmpeg."""
    output_dir.mkdir(parents=True, exist_ok=True)
    extracted: list[Path] = []
    for i, ts in enumerate(timestamps):
        output_path = output_dir / f"dense_frame_{i:04d}.jpg"
        result = subprocess.run(
            [
                "ffmpeg", "-y", "-loglevel", "error",
                "-ss", f"{ts:.3f}",
                "-i", str(video_path),
                "-frames:v", "1",
                "-vf", f"scale={scale}",
                "-q:v", "2",
                str(output_path),
            ],
            capture_output=True, text=True,
        )
        if result.returncode == 0 and output_path.exists() and output_path.stat().st_size > 0:
            extracted.append(output_path)
    return extracted


def compute_uniform_timestamps(
    start: float,
    end: float,
    count: int,
) -> list[float]:
    """Generate evenly spaced timestamps within a time range."""
    duration = end - start
    if duration <= 0 or count <= 0:
        return []
    if count == 1:
        return [start + duration * 0.5]
    step = duration / (count + 1)
    return [start + step * (i + 1) for i in range(count)]


def extract_scene_change_frames(
    video_path: Path,
    start: float,
    end: float,
    output_dir: Path,
    threshold: float = 0.20,
    max_frames: int = 30,
    scale: str = "640:360",
) -> list[Path]:
    """Extract frames at scene changes using ffmpeg scene filter."""
    output_dir.mkdir(parents=True, exist_ok=True)
    duration = end - start
    if duration <= 0:
        return []
    pattern = output_dir / "scene_%04d.jpg"
    result = subprocess.run(
        [
            "ffmpeg", "-y", "-loglevel", "error",
            "-ss", str(start),
            "-i", str(video_path),
            "-t", str(duration),
            "-vf", f"select=gt(scene\\,{threshold}),scale={scale}",
            "-vsync", "vfr",
            "-q:v", "2",
            str(pattern),
        ],
        capture_output=True, text=True,
    )
    frames = sorted(output_dir.glob("scene_*.jpg"))[:max_frames]
    return [f for f in frames if f.stat().st_size > 0]


# ---------------------------------------------------------------------------
# Dense visual unit creation
# ---------------------------------------------------------------------------

async def create_dense_visual_units(
    *,
    video_ids: list[str],
    frames_per_segment: int,
    frame_method: str = "uniform",  # "uniform" or "scene"
    scene_threshold: float = 0.20,
) -> dict[str, Any]:
    """Create additional visual retrieval units from dense frame embeddings.

    For each segment in each test video:
    1. Download the video (or find cached copy)
    2. Extract N frames per segment
    3. Create multimodal embeddings (transcript context + frame image)
    4. Insert as visual retrieval units in the DB
    """
    db_url = get_settings().database.url or os.getenv("DATABASE_URL", "")
    conn = await asyncpg.connect(db_url)
    embedder = create_embedding_backend(output_dimension=DEFAULT_KNOWLEDGE_VECTOR_DIMENSION)

    stats = {
        "frames_per_segment": frames_per_segment,
        "frame_method": frame_method,
        "total_frames_extracted": 0,
        "total_frames_embedded": 0,
        "total_units_created": 0,
        "embed_errors": 0,
        "videos": {},
    }

    for video_id in video_ids:
        print(f"  Dense visual embed for {video_id}...", end=" ", flush=True)
        video_stats = {"frames_extracted": 0, "units_created": 0, "errors": 0}

        # Get video info and segments
        video_row = await conn.fetchrow(
            "SELECT id, title, source_video_id FROM videos WHERE source_video_id = $1",
            video_id,
        )
        if video_row is None:
            print("SKIP (not in DB)")
            stats["videos"][video_id] = {"status": "not_found"}
            continue

        db_video_id = str(video_row["id"])
        video_title = video_row["title"] or ""

        # Get existing speech segments
        segments = await conn.fetch(
            """
            SELECT unit_index, timestamp_start, timestamp_end,
                   transcript, content_text
            FROM retrieval_units
            WHERE video_id = $1::uuid AND unit_type = 'speech'
            ORDER BY unit_index
            """,
            db_video_id,
        )
        if not segments:
            print("SKIP (no segments)")
            stats["videos"][video_id] = {"status": "no_segments"}
            continue

        # Find or download video file
        video_path = download_video_to_cache(video_id)
        if video_path is None:
            print("SKIP (download failed)")
            stats["videos"][video_id] = {"status": "download_failed"}
            continue

        # Delete existing dense visual units (unit_type='visual' with high unit_index)
        # Keep original visual units (unit_index < 1000)
        await conn.execute(
            """
            DELETE FROM retrieval_units
            WHERE video_id = $1::uuid AND unit_type = 'visual' AND unit_index >= 1000
            """,
            db_video_id,
        )

        unit_index_offset = 1000  # Dense visual units start at index 1000
        created_count = 0

        with tempfile.TemporaryDirectory(prefix="cerul-dense-") as tmp_dir:
            tmp_path = Path(tmp_dir)

            for seg in segments:
                ts_start = float(seg["timestamp_start"] or 0)
                ts_end = float(seg["timestamp_end"] or 0)
                transcript = str(seg["transcript"] or "").strip()
                seg_index = int(seg["unit_index"])

                if ts_end <= ts_start:
                    continue

                # Extract frames
                seg_frame_dir = tmp_path / f"seg_{seg_index}"
                if frame_method == "scene":
                    frames = extract_scene_change_frames(
                        video_path, ts_start, ts_end,
                        seg_frame_dir, threshold=scene_threshold,
                        max_frames=frames_per_segment,
                    )
                    # Pad with uniform frames if scene detection found too few
                    if len(frames) < frames_per_segment // 2:
                        uniform_ts = compute_uniform_timestamps(
                            ts_start, ts_end,
                            frames_per_segment - len(frames),
                        )
                        uniform_dir = seg_frame_dir / "uniform"
                        extra = extract_frames_at_timestamps(
                            video_path, uniform_ts, uniform_dir,
                        )
                        frames.extend(extra)
                else:
                    timestamps = compute_uniform_timestamps(
                        ts_start, ts_end, frames_per_segment,
                    )
                    frames = extract_frames_at_timestamps(
                        video_path, timestamps, seg_frame_dir,
                    )

                video_stats["frames_extracted"] += len(frames)

                # Embed each frame as a separate visual unit
                # Context: short title + transcript excerpt (first 200 chars)
                transcript_excerpt = transcript[:200].strip()
                embed_text = f"{video_title}\n{transcript_excerpt}"

                for frame_idx, frame_path in enumerate(frames[:frames_per_segment]):
                    try:
                        vector = list(embedder.embed_multimodal(
                            embed_text,
                            image_paths=[str(frame_path)],
                        ))
                    except Exception as exc:
                        video_stats["errors"] += 1
                        continue

                    unit_idx = unit_index_offset + seg_index * 100 + frame_idx
                    vec_literal = "[" + ",".join(f"{v:.12g}" for v in vector) + "]"

                    await conn.execute(
                        """
                        INSERT INTO retrieval_units (
                            video_id, unit_type, unit_index,
                            timestamp_start, timestamp_end,
                            content_text, transcript, visual_desc,
                            visual_type, metadata, embedding
                        ) VALUES (
                            $1::uuid, 'visual', $2,
                            $3, $4,
                            $5, $6, $7,
                            'frame_embed', $8::jsonb, $9::vector
                        )
                        ON CONFLICT (video_id, unit_type, unit_index) DO UPDATE SET
                            timestamp_start = EXCLUDED.timestamp_start,
                            timestamp_end = EXCLUDED.timestamp_end,
                            content_text = EXCLUDED.content_text,
                            transcript = EXCLUDED.transcript,
                            visual_desc = EXCLUDED.visual_desc,
                            embedding = EXCLUDED.embedding,
                            updated_at = NOW()
                        """,
                        db_video_id,
                        unit_idx,
                        ts_start,
                        ts_end,
                        embed_text,
                        transcript_excerpt,
                        f"Dense visual frame {frame_idx} of segment {seg_index}",
                        json.dumps({"dense_visual": True, "frame_method": frame_method}),
                        vec_literal,
                    )
                    created_count += 1

                    # Clean up frame file immediately to save disk
                    frame_path.unlink(missing_ok=True)

        video_stats["units_created"] = created_count
        stats["videos"][video_id] = video_stats
        stats["total_frames_extracted"] += video_stats["frames_extracted"]
        stats["total_frames_embedded"] += created_count
        stats["total_units_created"] += created_count
        stats["embed_errors"] += video_stats["errors"]
        print(f"OK ({created_count} visual units)")

    await conn.close()
    return stats


VIDEO_CACHE_DIR = REPO_ROOT / "eval" / ".video_cache"


def _find_cached_video(video_id: str) -> Path | None:
    """Find or download video to persistent cache directory."""
    VIDEO_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    # Check cache first
    for ext in ("mp4", "webm", "mkv"):
        candidate = VIDEO_CACHE_DIR / f"{video_id}.{ext}"
        if candidate.exists() and candidate.stat().st_size > 1000:
            return candidate
    return None


def download_video_to_cache(video_id: str) -> Path | None:
    """Download video using yt-dlp to persistent cache."""
    cached = _find_cached_video(video_id)
    if cached is not None:
        return cached
    VIDEO_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    output_template = str(VIDEO_CACHE_DIR / f"{video_id}.%(ext)s")
    proxy = os.getenv("YTDLP_PROXY", "").strip()
    cmd = [
        "yt-dlp", "--no-playlist",
        "--extractor-args", "youtube:player_client=android",
        "-f", "bestvideo[height<=480]+bestaudio/best[height<=480]",
        "--output", output_template,
        f"https://www.youtube.com/watch?v={video_id}",
    ]
    if proxy:
        cmd[1:1] = ["--proxy", proxy]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=900)
    if result.returncode != 0:
        return None
    return _find_cached_video(video_id)


async def cleanup_dense_visual_units(video_ids: list[str]) -> None:
    """Remove all dense visual units (unit_index >= 1000) for given videos."""
    db_url = get_settings().database.url or os.getenv("DATABASE_URL", "")
    conn = await asyncpg.connect(db_url)
    for video_id in video_ids:
        await conn.execute(
            """
            DELETE FROM retrieval_units
            WHERE video_id = (SELECT id FROM videos WHERE source_video_id = $1)
              AND unit_type = 'visual'
              AND unit_index >= 1000
            """,
            video_id,
        )
    await conn.close()


# ---------------------------------------------------------------------------
# Main experiment
# ---------------------------------------------------------------------------

async def main() -> None:
    video_ids = load_test_video_ids()
    all_results: list[dict] = []

    configs = [
        # First: reindex with baseline to get fresh videos cached + baseline eval
        ("Baseline (no dense visual)", 0, "uniform"),
        ("D: 5 frames/seg (uniform)", 5, "uniform"),
        ("E: 10 frames/seg (uniform)", 10, "uniform"),
        ("F: 20 frames/seg (uniform)", 20, "uniform"),
        ("G: 10 frames/seg (scene detect)", 10, "scene"),
    ]

    # Step 0: Download all test videos to persistent cache
    print("=" * 70)
    print("Step 0: Downloading test videos to cache")
    print("=" * 70)
    for vid in video_ids:
        cached = _find_cached_video(vid)
        if cached:
            print(f"  {vid}: cached at {cached}")
        else:
            print(f"  {vid}: downloading...", end=" ", flush=True)
            path = download_video_to_cache(vid)
            print(f"{'OK' if path else 'FAILED'}")

    # Step 1: Reindex all videos with baseline params
    print(f"\n{'=' * 70}")
    print("Step 1: Reindex with baseline params")
    print("=" * 70)
    baseline_config = IndexingConfig()
    reindex_result = await reindex_videos(video_ids, baseline_config)
    if reindex_result["error_count"] > 3:
        print(f"Too many reindex failures ({reindex_result['error_count']}), aborting")
        return

    for name, frames_per_seg, method in configs:
        print(f"\n{'=' * 70}")
        print(f"EXPERIMENT: {name}")
        print(f"{'=' * 70}")

        t0 = time.perf_counter()

        if frames_per_seg == 0:
            # Baseline: just eval without dense visual units
            await cleanup_dense_visual_units(video_ids)
        else:
            # Clean up previous dense units, then create new ones
            await cleanup_dense_visual_units(video_ids)
            dense_stats = await create_dense_visual_units(
                video_ids=video_ids,
                frames_per_segment=frames_per_seg,
                frame_method=method,
            )
            print(f"  Created {dense_stats['total_units_created']} dense visual units "
                  f"({dense_stats['embed_errors']} errors)")

        elapsed = time.perf_counter() - t0

        # Run eval
        eval_result = await run_eval("embedding", top_k=5)

        entry = {
            "name": name,
            "frames_per_segment": frames_per_seg,
            "frame_method": method,
            "elapsed_seconds": round(elapsed, 1),
            "recall_5": eval_result["recall_5"],
            "visual_recall": eval_result["visual_recall"],
            "ndcg": eval_result["ndcg"],
            "mrr": eval_result["mrr"],
            "per_query": eval_result["queries"],
        }
        if frames_per_seg > 0:
            entry["dense_stats"] = dense_stats
        all_results.append(entry)

        print(
            f"\nSUMMARY: recall@5={eval_result['recall_5']:.4f} "
            f"visual={eval_result['visual_recall']:.4f} "
            f"ndcg={eval_result['ndcg']:.4f} ({elapsed:.0f}s)"
        )

    # Cleanup: remove dense visual units to leave DB in baseline state
    print(f"\n{'=' * 70}")
    print("Cleaning up dense visual units...")
    await cleanup_dense_visual_units(video_ids)

    # Save results
    RESULTS_PATH.write_text(json.dumps(all_results, indent=2, ensure_ascii=False))
    print(f"Results saved to {RESULTS_PATH}")

    # Summary table
    print(f"\n{'=' * 70}")
    print("EXPERIMENT RESULTS")
    print(f"{'=' * 70}")
    print(f"{'Config':<40} {'Recall@5':>10} {'Visual':>10} {'NDCG':>10} {'Time':>8}")
    print("-" * 80)
    for r in all_results:
        print(f"{r['name']:<40} {r['recall_5']:>10.4f} {r['visual_recall']:>10.4f} "
              f"{r['ndcg']:>10.4f} {r['elapsed_seconds']:>7.0f}s")


if __name__ == "__main__":
    import logging
    logging.basicConfig(level=logging.WARNING)
    asyncio.run(main())
