#!/usr/bin/env python3
"""
Search quality evaluation script.

Runs all queries from eval/search_benchmark.json against the search service,
computes NDCG@5, MRR, and Hit@3, and prints results.

Usage:
    python scripts/eval_search.py [--mode embedding|rerank] [--top-k 5]
"""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import os
import sys
import time
from pathlib import Path
from typing import Any

# Ensure repo root is on the path so backend imports work.
REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend"))

# Load .env before any app imports.
from dotenv import load_dotenv

load_dotenv(REPO_ROOT / ".env")

import asyncpg

from app.config import get_settings
from app.embedding import create_embedding_backend
from app.search.base import (
    DEFAULT_KNOWLEDGE_VECTOR_DIMENSION,
    vector_to_literal,
)
from app.search.rerank import LLMReranker

BENCHMARK_PATH = REPO_ROOT / "eval" / "search_benchmark.json"
RESULTS_PATH = REPO_ROOT / "eval" / "results.tsv"


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------

async def get_connection() -> asyncpg.Connection:
    url = get_settings().database.url or os.getenv("DATABASE_URL", "")
    if not url:
        raise RuntimeError("DATABASE_URL is not set")
    return await asyncpg.connect(url)


async def lookup_video_id_for_unit(
    conn: asyncpg.Connection, unit_id: str
) -> str | None:
    row = await conn.fetchrow(
        "SELECT v.source_video_id FROM retrieval_units ru "
        "JOIN videos v ON v.id = ru.video_id WHERE ru.id = $1",
        unit_id,
    )
    return row["source_video_id"] if row else None


# ---------------------------------------------------------------------------
# Direct vector search (bypasses API auth / credits)
# ---------------------------------------------------------------------------

async def vector_search(
    conn: asyncpg.Connection,
    query_embedding: list[float],
    *,
    limit: int = 20,
) -> list[dict[str, Any]]:
    """Run raw vector search against retrieval_units, returning ranked rows."""
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


# ---------------------------------------------------------------------------
# Dedup by video (keep best score per video)
# ---------------------------------------------------------------------------

def dedupe_by_video(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: dict[str, dict[str, Any]] = {}
    for row in rows:
        vid = row["source_video_id"]
        if vid not in seen or _row_rank_score(row) > _row_rank_score(seen[vid]):
            seen[vid] = row
    return sorted(seen.values(), key=_row_rank_score, reverse=True)


# ---------------------------------------------------------------------------
# Metrics
# ---------------------------------------------------------------------------

def dcg(relevances: list[float], k: int) -> float:
    total = 0.0
    for i, rel in enumerate(relevances[:k]):
        total += rel / math.log2(i + 2)
    return total


def ndcg_at_k(ranked_video_ids: list[str], relevant_ids: set[str], k: int) -> float:
    relevances = [1.0 if vid in relevant_ids else 0.0 for vid in ranked_video_ids[:k]]
    ideal = [1.0] * min(k, len(relevant_ids))
    idcg = dcg(ideal, k)
    if idcg == 0:
        return 0.0
    return dcg(relevances, k) / idcg


def reciprocal_rank(ranked_video_ids: list[str], relevant_ids: set[str]) -> float:
    for i, vid in enumerate(ranked_video_ids):
        if vid in relevant_ids:
            return 1.0 / (i + 1)
    return 0.0


def hit_at_k(ranked_video_ids: list[str], relevant_ids: set[str], k: int) -> bool:
    return bool(relevant_ids & set(ranked_video_ids[:k]))


def _row_rank_score(row: dict[str, Any]) -> float:
    rerank_score = row.get("rerank_score")
    if rerank_score is not None:
        return float(rerank_score)
    return float(row.get("score", 0.0) or 0.0)


async def rank_candidate_rows(
    *,
    mode: str,
    query_text: str,
    candidate_rows: list[dict[str, Any]],
    reranker: LLMReranker | None = None,
) -> list[dict[str, Any]]:
    if mode == "rerank":
        active_reranker = reranker or LLMReranker()
        return await active_reranker.rerank(
            query_text,
            candidate_rows,
            top_n=len(candidate_rows),
        )
    return sorted(
        [dict(row) for row in candidate_rows],
        key=_row_rank_score,
        reverse=True,
    )


# ---------------------------------------------------------------------------
# Main evaluation loop
# ---------------------------------------------------------------------------

async def run_eval(mode: str, top_k: int) -> dict[str, Any]:
    benchmark = json.loads(BENCHMARK_PATH.read_text())
    queries = benchmark["queries"]

    print(f"Loaded {len(queries)} queries from benchmark v{benchmark['version']}")
    print(f"Mode: {mode} | Top-K: {top_k}")
    print("-" * 70)

    conn = await get_connection()
    embedder = create_embedding_backend(
        output_dimension=DEFAULT_KNOWLEDGE_VECTOR_DIMENSION
    )
    reranker = LLMReranker() if mode == "rerank" else None

    ndcg_scores: list[float] = []
    mrr_scores: list[float] = []
    hit3_scores: list[float] = []
    latencies: list[float] = []
    per_query: list[dict[str, Any]] = []

    for q in queries:
        if "id" not in q:
            continue
        qid = q["id"]
        query_text = q["query"]
        relevant_ids = set(q["relevant_videos"])
        difficulty = q.get("difficulty", "?")

        t0 = time.perf_counter()

        # Embed the query (sync call, use embed_query for RETRIEVAL_QUERY semantics).
        embedding = embedder.embed_query(query_text)

        # Search.
        candidate_rows = await vector_search(conn, embedding, limit=top_k * 8)
        ranked_rows = await rank_candidate_rows(
            mode=mode,
            query_text=query_text,
            candidate_rows=candidate_rows,
            reranker=reranker,
        )
        deduped = dedupe_by_video(ranked_rows)
        ranked_ids = [r["source_video_id"] for r in deduped[:top_k]]

        elapsed_ms = (time.perf_counter() - t0) * 1000

        # Compute metrics.
        q_ndcg = ndcg_at_k(ranked_ids, relevant_ids, top_k)
        q_mrr = reciprocal_rank(ranked_ids, relevant_ids)
        q_hit3 = 1.0 if hit_at_k(ranked_ids, relevant_ids, 3) else 0.0

        ndcg_scores.append(q_ndcg)
        mrr_scores.append(q_mrr)
        hit3_scores.append(q_hit3)
        latencies.append(elapsed_ms)

        status = "HIT" if q_hit3 else "MISS"
        print(
            f"  [{qid:>4}] {status:4} ndcg={q_ndcg:.3f} mrr={q_mrr:.3f} "
            f"lat={elapsed_ms:6.0f}ms [{difficulty:>6}] {query_text[:50]}"
        )

        per_query.append({
            "id": qid,
            "query": query_text,
            "difficulty": difficulty,
            "ndcg": q_ndcg,
            "mrr": q_mrr,
            "hit3": q_hit3,
            "latency_ms": elapsed_ms,
            "top_results": [
                {"video_id": r["source_video_id"], "title": r["title"], "score": float(r["score"])}
                for r in deduped[:top_k]
            ],
            "expected": list(relevant_ids),
        })

    await conn.close()

    # Aggregate metrics.
    n = len(per_query)
    avg_ndcg = sum(ndcg_scores) / n if n else 0
    avg_mrr = sum(mrr_scores) / n if n else 0
    avg_hit3 = sum(hit3_scores) / n if n else 0
    avg_latency = sum(latencies) / n if n else 0

    # By difficulty.
    for diff in ["easy", "medium", "hard"]:
        subset = [pq for pq in per_query if pq["difficulty"] == diff]
        if not subset:
            continue
        d_ndcg = sum(pq["ndcg"] for pq in subset) / len(subset)
        d_hit3 = sum(pq["hit3"] for pq in subset) / len(subset)
        print(f"\n  [{diff:>6}] n={len(subset):2d}  ndcg@{top_k}={d_ndcg:.4f}  hit@3={d_hit3:.4f}")

    print("\n" + "=" * 70)
    print(f"ndcg@{top_k}: {avg_ndcg:.4f}")
    print(f"mrr: {avg_mrr:.4f}")
    print(f"hit@3: {avg_hit3:.4f}")
    print(f"avg_latency_ms: {avg_latency:.0f}")
    print(f"total_queries: {n}")
    print("=" * 70)

    # Write detailed results to JSON for analysis.
    details_path = REPO_ROOT / "eval" / "search_eval_details.json"
    details_path.write_text(
        json.dumps(
            {
                "mode": mode,
                "top_k": top_k,
                "ndcg": avg_ndcg,
                "mrr": avg_mrr,
                "hit3": avg_hit3,
                "avg_latency_ms": avg_latency,
                "queries": per_query,
            },
            indent=2,
            ensure_ascii=False,
        )
    )
    print(f"\nDetailed results written to {details_path}")

    return {
        "ndcg": avg_ndcg,
        "mrr": avg_mrr,
        "hit3": avg_hit3,
        "avg_latency_ms": avg_latency,
        "evaluated_queries": n,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate search quality")
    parser.add_argument(
        "--mode",
        choices=["embedding", "rerank"],
        default="embedding",
        help="Search ranking mode (default: embedding)",
    )
    parser.add_argument(
        "--top-k",
        type=int,
        default=5,
        help="Number of results to evaluate (default: 5)",
    )
    args = parser.parse_args()
    asyncio.run(run_eval(args.mode, args.top_k))


if __name__ == "__main__":
    main()
