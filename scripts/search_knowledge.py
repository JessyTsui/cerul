#!/usr/bin/env python3
"""
Quick search script for testing knowledge segment retrieval.

Usage:
    python scripts/search_knowledge.py "what is attention mechanism"
    python scripts/search_knowledge.py "how does GPT tokenizer work" --top 10
    python scripts/search_knowledge.py "ARC benchmark" --verbose
"""
import argparse
import asyncio
import os
import sys
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import asyncpg
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")


async def embed_query(query: str) -> list[float]:
    """Embed a search query using Gemini Embedding 2."""
    from backend.app.embedding.gemini import GeminiEmbeddingBackend

    backend = GeminiEmbeddingBackend(output_dimension=3072)
    return backend.embed_query(query)


async def search(
    query: str,
    *,
    top_k: int = 5,
    verbose: bool = False,
) -> None:
    db_url = os.getenv("DATABASE_URL", "")
    if not db_url:
        print("ERROR: DATABASE_URL not set")
        sys.exit(1)

    print(f"\n🔍 Query: \"{query}\"\n")
    print("Embedding query...")
    query_vector = await embed_query(query)
    print(f"  → {len(query_vector)}-dim vector\n")

    conn = await asyncpg.connect(db_url)
    try:
        rows = await conn.fetch(
            """
            SELECT
                ks.title,
                ks.transcript_text,
                ks.visual_description,
                ks.visual_text_content,
                ks.visual_type,
                ks.has_visual_embedding,
                ks.timestamp_start,
                ks.timestamp_end,
                kv.source_video_id,
                kv.title AS video_title,
                kv.speaker,
                1 - (ks.embedding <=> $1::vector) AS similarity
            FROM knowledge_segments ks
            JOIN knowledge_videos kv ON kv.id = ks.video_id
            WHERE ks.embedding IS NOT NULL
            ORDER BY ks.embedding <=> $1::vector
            LIMIT $2
            """,
            str(query_vector),
            top_k,
        )

        if not rows:
            print("No results found.")
            return

        for i, row in enumerate(rows, 1):
            sim = float(row["similarity"])
            ts_start = int(row["timestamp_start"])
            ts_end = int(row["timestamp_end"])
            vid = row["source_video_id"]
            yt_link = f"https://youtu.be/{vid}?t={ts_start}"

            print(f"{'─' * 70}")
            print(f"#{i}  similarity: {sim:.4f}  |  {row['video_title']}")
            print(f"    🎬 {yt_link}")
            print(f"    ⏱  {_fmt_time(ts_start)} → {_fmt_time(ts_end)}")
            print(f"    📌 {row['title']}")
            if row["has_visual_embedding"] and row["visual_type"]:
                print(f"    🖼  [{row['visual_type']}] {(row['visual_description'] or '')[:100]}")
            if verbose:
                transcript = (row["transcript_text"] or "")[:300]
                print(f"    📝 {transcript}...")
                if row["visual_text_content"]:
                    print(f"    🔤 Visible text: {row['visual_text_content'][:150]}")

        print(f"{'─' * 70}")
        print(f"\n✅ {len(rows)} results from {len(set(r['source_video_id'] for r in rows))} videos\n")
    finally:
        await conn.close()


def _fmt_time(seconds: int) -> str:
    h, m, s = seconds // 3600, (seconds % 3600) // 60, seconds % 60
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def main():
    parser = argparse.ArgumentParser(description="Search knowledge segments")
    parser.add_argument("query", help="Search query text")
    parser.add_argument("--top", type=int, default=5, help="Number of results (default: 5)")
    parser.add_argument("--verbose", "-v", action="store_true", help="Show transcript excerpts")
    args = parser.parse_args()
    asyncio.run(search(args.query, top_k=args.top, verbose=args.verbose))


if __name__ == "__main__":
    main()
