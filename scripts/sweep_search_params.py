#!/usr/bin/env python3
"""
Auto-optimize search parameters — autoresearch-style sweep.

Systematically tests each search parameter, finds optimal values,
and logs all results. Changes one parameter at a time.

Usage:
    python scripts/sweep_search_params.py
"""

from __future__ import annotations

import asyncio
import json
import math
import os
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Sequence

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend"))

from dotenv import load_dotenv
load_dotenv(REPO_ROOT / ".env")

import asyncpg

from app.config import get_settings
from app.embedding import create_embedding_backend
from app.search.base import (
    DEFAULT_KNOWLEDGE_VECTOR_DIMENSION,
    mmr_diversify,
    parse_vector,
    vector_to_literal,
)
from app.search.rerank import LLMReranker

BENCHMARK_PATH = REPO_ROOT / "eval" / "search_benchmark.json"
RESULTS_PATH = REPO_ROOT / "eval" / "search_sweep_results.tsv"


# ---------------------------------------------------------------------------
# Search pipeline with tunable parameters
# ---------------------------------------------------------------------------

@dataclass
class SearchConfig:
    mode: str = "embedding"
    top_k: int = 5
    candidate_mult: int = 8         # vector search limit = top_k * candidate_mult
    rerank_top_n: int = 20          # how many candidates to send to reranker
    mmr_lambda: float = 1.0         # 1.0 = no MMR, <1.0 = diversify
    cap_per_video: int = 0          # 0 = no cap

    def label(self) -> str:
        parts = [f"mode={self.mode}"]
        parts.append(f"cand={self.candidate_mult}x")
        if self.mode == "rerank":
            parts.append(f"rerank_n={self.rerank_top_n}")
        if self.mmr_lambda < 1.0:
            parts.append(f"mmr={self.mmr_lambda}")
        if self.cap_per_video > 0:
            parts.append(f"cap={self.cap_per_video}")
        return " | ".join(parts)


async def get_connection() -> asyncpg.Connection:
    url = get_settings().database.url or os.getenv("DATABASE_URL", "")
    return await asyncpg.connect(url)


async def vector_search(
    conn: asyncpg.Connection,
    query_embedding: list[float],
    *,
    limit: int = 40,
) -> list[dict[str, Any]]:
    dim = DEFAULT_KNOWLEDGE_VECTOR_DIMENSION
    vec_literal = vector_to_literal(query_embedding)
    distance_sql = (
        f"(ru.embedding::halfvec({dim}) <=> "
        f"($1::vector({dim}))::halfvec({dim}))"
    )
    sql = f"""
        SELECT
            ru.id::text AS id,
            v.source_video_id,
            v.title,
            ru.unit_type,
            ru.transcript AS transcript_text,
            ru.visual_desc AS visual_description,
            ru.embedding::text AS embedding,
            ru.timestamp_start,
            ru.timestamp_end,
            1 - {distance_sql} AS score
        FROM retrieval_units AS ru
        JOIN videos AS v ON v.id = ru.video_id
        WHERE ru.unit_type = ANY($2::text[])
        ORDER BY {distance_sql}
        LIMIT $3
    """
    rows = await conn.fetch(sql, vec_literal, ["speech", "visual"], limit)
    return [dict(r) for r in rows]


def apply_mmr(
    rows: list[dict[str, Any]],
    *,
    mmr_lambda: float,
    limit: int,
) -> list[dict[str, Any]]:
    if mmr_lambda >= 1.0 or len(rows) <= 1:
        return rows[:limit]
    embeddings = [parse_vector(row.get("embedding")) for row in rows]
    scores = [float(row.get("rerank_score", row.get("score", 0.0))) for row in rows]
    return mmr_diversify(
        rows, embeddings, limit=limit,
        lambda_multiplier=mmr_lambda, relevance_scores=scores,
    )


def cap_per_video(
    rows: list[dict[str, Any]],
    *,
    cap: int,
) -> list[dict[str, Any]]:
    if cap <= 0:
        return rows
    counts: dict[str, int] = {}
    result = []
    for row in rows:
        vid = row["source_video_id"]
        counts[vid] = counts.get(vid, 0) + 1
        if counts[vid] <= cap:
            result.append(row)
    return result


def dedupe_by_video(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: dict[str, dict[str, Any]] = {}
    for row in rows:
        vid = row["source_video_id"]
        s = _rank_score(row)
        if vid not in seen or s > _rank_score(seen[vid]):
            seen[vid] = row
    return sorted(seen.values(), key=_rank_score, reverse=True)


def _rank_score(row: dict[str, Any]) -> float:
    rs = row.get("rerank_score")
    if rs is not None:
        return float(rs)
    return float(row.get("score", 0.0) or 0.0)


# ---------------------------------------------------------------------------
# Metrics
# ---------------------------------------------------------------------------

def dcg(rels: list[float], k: int) -> float:
    return sum(r / math.log2(i + 2) for i, r in enumerate(rels[:k]))

def ndcg_at_k(ranked: list[str], relevant: set[str], k: int) -> float:
    rels = [1.0 if v in relevant else 0.0 for v in ranked[:k]]
    ideal = [1.0] * min(k, len(relevant))
    idcg = dcg(ideal, k)
    return dcg(rels, k) / idcg if idcg > 0 else 0.0

def mrr(ranked: list[str], relevant: set[str]) -> float:
    for i, v in enumerate(ranked):
        if v in relevant:
            return 1.0 / (i + 1)
    return 0.0

def hit_at_k(ranked: list[str], relevant: set[str], k: int) -> bool:
    return bool(relevant & set(ranked[:k]))


# ---------------------------------------------------------------------------
# Single eval run
# ---------------------------------------------------------------------------

async def run_eval(
    conn: asyncpg.Connection,
    embedder: Any,
    benchmark: dict,
    config: SearchConfig,
    reranker: LLMReranker | None = None,
    *,
    verbose: bool = False,
) -> dict[str, float]:
    queries = [q for q in benchmark["queries"] if "id" in q]
    ndcgs, mrrs, hits = [], [], []

    # Cache embeddings to avoid repeated API calls.
    if not hasattr(run_eval, "_cache"):
        run_eval._cache = {}

    for q in queries:
        qid = q["id"]
        if qid in run_eval._cache:
            embedding = run_eval._cache[qid]
        else:
            for attempt in range(5):
                try:
                    embedding = embedder.embed_query(q["query"])
                    break
                except Exception as e:
                    if attempt < 4:
                        wait = 2 ** attempt
                        print(f"    embed retry {attempt+1}/5 ({e.__class__.__name__}), wait {wait}s")
                        await asyncio.sleep(wait)
                    else:
                        raise
            run_eval._cache[qid] = embedding
        relevant = set(q["relevant_videos"])

        # 1. Vector search
        rows = await vector_search(
            conn, embedding,
            limit=config.top_k * config.candidate_mult,
        )

        # 2. Rerank
        if config.mode == "rerank" and reranker:
            rows = await reranker.rerank(
                q["query"], rows,
                top_n=config.rerank_top_n,
            )

        # 3. MMR
        rows = apply_mmr(rows, mmr_lambda=config.mmr_lambda, limit=config.top_k * 3)

        # 4. Cap per video
        rows = cap_per_video(rows, cap=config.cap_per_video)

        # 5. Dedupe & take top_k
        deduped = dedupe_by_video(rows)
        ranked_ids = [r["source_video_id"] for r in deduped[:config.top_k]]

        ndcgs.append(ndcg_at_k(ranked_ids, relevant, config.top_k))
        mrrs.append(mrr(ranked_ids, relevant))
        hits.append(1.0 if hit_at_k(ranked_ids, relevant, 3) else 0.0)

    n = len(queries)
    result = {
        "ndcg5": sum(ndcgs) / n,
        "mrr": sum(mrrs) / n,
        "hit3": sum(hits) / n,
    }

    if verbose:
        print(f"  ndcg@5={result['ndcg5']:.4f}  mrr={result['mrr']:.4f}  hit@3={result['hit3']:.4f}")

    return result


# ---------------------------------------------------------------------------
# Sweep
# ---------------------------------------------------------------------------

async def main():
    print("=" * 70)
    print("  Auto-Optimize Search Parameters")
    print("=" * 70)

    conn = await get_connection()
    embedder = create_embedding_backend(
        output_dimension=DEFAULT_KNOWLEDGE_VECTOR_DIMENSION
    )
    benchmark = json.loads(BENCHMARK_PATH.read_text())

    # Initialize results log
    results: list[dict[str, Any]] = []

    def log_result(experiment: str, config: SearchConfig, metrics: dict):
        entry = {
            "experiment": experiment,
            "config": config.label(),
            **metrics,
        }
        results.append(entry)
        print(f"    → ndcg@5={metrics['ndcg5']:.4f}  mrr={metrics['mrr']:.4f}  hit@3={metrics['hit3']:.4f}")

    # ===================================================================
    # Phase 1: Embedding mode — optimize candidate_mult
    # ===================================================================
    print("\n--- Phase 1: Embedding mode — candidate_mult sweep ---")
    best_cand = 8
    best_cand_score = 0.0

    for mult in [4, 6, 8, 10, 12, 16, 20]:
        cfg = SearchConfig(mode="embedding", candidate_mult=mult)
        print(f"\n  candidate_mult={mult}")
        m = await run_eval(conn, embedder, benchmark, cfg)
        log_result(f"cand_mult={mult}", cfg, m)
        if m["ndcg5"] > best_cand_score:
            best_cand_score = m["ndcg5"]
            best_cand = mult

    print(f"\n  ✓ Best candidate_mult: {best_cand} (ndcg@5={best_cand_score:.4f})")

    # ===================================================================
    # Phase 2: Rerank mode — optimize rerank_top_n
    # ===================================================================
    print("\n--- Phase 2: Rerank mode — rerank_top_n sweep ---")
    reranker = LLMReranker()
    best_rerank_n = 20
    best_rerank_score = 0.0

    for n in [5, 10, 15, 20, 25, 30, 40]:
        cfg = SearchConfig(
            mode="rerank", candidate_mult=best_cand,
            rerank_top_n=n,
        )
        print(f"\n  rerank_top_n={n}")
        m = await run_eval(conn, embedder, benchmark, cfg, reranker)
        log_result(f"rerank_n={n}", cfg, m)
        if m["ndcg5"] > best_rerank_score:
            best_rerank_score = m["ndcg5"]
            best_rerank_n = n

    print(f"\n  ✓ Best rerank_top_n: {best_rerank_n} (ndcg@5={best_rerank_score:.4f})")

    # ===================================================================
    # Phase 3: MMR lambda sweep
    # ===================================================================
    print("\n--- Phase 3: MMR lambda sweep ---")
    best_mmr = 1.0
    best_mmr_score = best_rerank_score

    for lam in [1.0, 0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.6, 0.5]:
        cfg = SearchConfig(
            mode="rerank", candidate_mult=best_cand,
            rerank_top_n=best_rerank_n, mmr_lambda=lam,
        )
        print(f"\n  mmr_lambda={lam}")
        m = await run_eval(conn, embedder, benchmark, cfg, reranker)
        log_result(f"mmr={lam}", cfg, m)
        if m["ndcg5"] > best_mmr_score:
            best_mmr_score = m["ndcg5"]
            best_mmr = lam

    print(f"\n  ✓ Best mmr_lambda: {best_mmr} (ndcg@5={best_mmr_score:.4f})")

    # ===================================================================
    # Phase 4: Cap per video sweep
    # ===================================================================
    print("\n--- Phase 4: Cap per video sweep ---")
    best_cap = 0
    best_cap_score = best_mmr_score

    for cap in [0, 1, 2, 3, 4]:
        cfg = SearchConfig(
            mode="rerank", candidate_mult=best_cand,
            rerank_top_n=best_rerank_n, mmr_lambda=best_mmr,
            cap_per_video=cap,
        )
        print(f"\n  cap_per_video={cap}")
        m = await run_eval(conn, embedder, benchmark, cfg, reranker)
        log_result(f"cap={cap}", cfg, m)
        if m["ndcg5"] > best_cap_score:
            best_cap_score = m["ndcg5"]
            best_cap = cap

    print(f"\n  ✓ Best cap_per_video: {best_cap} (ndcg@5={best_cap_score:.4f})")

    # ===================================================================
    # Phase 5: Compare embedding vs rerank with best params
    # ===================================================================
    print("\n--- Phase 5: Final comparison ---")

    cfg_emb = SearchConfig(
        mode="embedding", candidate_mult=best_cand,
        mmr_lambda=best_mmr, cap_per_video=best_cap,
    )
    m_emb = await run_eval(conn, embedder, benchmark, cfg_emb)
    log_result("final_embedding", cfg_emb, m_emb)

    cfg_rerank = SearchConfig(
        mode="rerank", candidate_mult=best_cand,
        rerank_top_n=best_rerank_n, mmr_lambda=best_mmr,
        cap_per_video=best_cap,
    )
    m_rerank = await run_eval(conn, embedder, benchmark, cfg_rerank, reranker)
    log_result("final_rerank", cfg_rerank, m_rerank)

    await conn.close()

    # ===================================================================
    # Summary
    # ===================================================================
    print("\n" + "=" * 70)
    print("  OPTIMAL CONFIGURATION")
    print("=" * 70)
    print(f"  candidate_mult:  {best_cand}")
    print(f"  rerank_top_n:    {best_rerank_n}")
    print(f"  mmr_lambda:      {best_mmr}")
    print(f"  cap_per_video:   {best_cap}")
    print()
    print(f"  Embedding mode:  ndcg@5={m_emb['ndcg5']:.4f}  mrr={m_emb['mrr']:.4f}  hit@3={m_emb['hit3']:.4f}")
    print(f"  Rerank mode:     ndcg@5={m_rerank['ndcg5']:.4f}  mrr={m_rerank['mrr']:.4f}  hit@3={m_rerank['hit3']:.4f}")
    print("=" * 70)

    # Write results TSV
    RESULTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(RESULTS_PATH, "w") as f:
        f.write("experiment\tconfig\tndcg5\tmrr\thit3\n")
        for r in results:
            f.write(f"{r['experiment']}\t{r['config']}\t{r['ndcg5']:.4f}\t{r['mrr']:.4f}\t{r['hit3']:.4f}\n")
    print(f"\nResults written to {RESULTS_PATH}")

    # Write optimal config as JSON
    optimal_path = REPO_ROOT / "eval" / "optimal_search_config.json"
    json.dump(
        {
            "candidate_mult": best_cand,
            "rerank_top_n": best_rerank_n,
            "mmr_lambda": best_mmr,
            "cap_per_video": best_cap,
            "embedding_metrics": m_emb,
            "rerank_metrics": m_rerank,
        },
        open(optimal_path, "w"),
        indent=2,
    )
    print(f"Optimal config written to {optimal_path}")


if __name__ == "__main__":
    asyncio.run(main())
