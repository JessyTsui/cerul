#!/usr/bin/env python3
import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]

if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from backend.app.embedding import DEFAULT_GEMINI_EMBEDDING_DIMENSION  # noqa: E402
from workers.knowledge import (  # noqa: E402
    InMemoryKnowledgeRepository,
    KnowledgeIndexingPipeline,
)
from workers.knowledge.runtime import (  # noqa: E402
    StaticKnowledgeMetadataClient,
    StaticKnowledgeTranscriber,
)


class DeterministicSeedEmbeddingBackend:
    name = "deterministic-seed"

    def dimension(self) -> int:
        return DEFAULT_GEMINI_EMBEDDING_DIMENSION

    def embed_text(self, text: str) -> list[float]:
        seed = float(sum(ord(character) for character in text) % 97)
        return [seed + float(index) for index in range(self.dimension())]

    def embed_image(self, image_path: str) -> list[float]:
        raise NotImplementedError

    def embed_video(self, video_path: str) -> list[float]:
        raise NotImplementedError


async def _run_pipeline(args: argparse.Namespace) -> int:
    if args.use_database and not os.getenv("DATABASE_URL", "").strip():
        raise RuntimeError("--use-database requires DATABASE_URL to be set.")

    repository = None if args.use_database else InMemoryKnowledgeRepository()
    pipeline = KnowledgeIndexingPipeline(
        repository=repository,
        embedding_backend=(
            DeterministicSeedEmbeddingBackend() if args.fake_embeddings else None
        ),
        metadata_client=StaticKnowledgeMetadataClient(_build_metadata(args)),
        transcriber=StaticKnowledgeTranscriber(_load_transcript_segments(args)),
    )
    context = await pipeline.run(
        args.video_id,
        job_id=args.job_id,
        conf={"scene_threshold": args.scene_threshold},
    )

    if context.failed_step is not None:
        print(f"Pipeline failed at {context.failed_step}: {context.error}")
        return 1

    print(f"Scenes: {context.data.get('scene_count', 0)}")
    print(f"Segments: {context.data.get('segment_count', 0)}")
    print(f"Indexed: {context.data.get('indexed_segment_count', 0)}")
    print(f"Video ID: {context.data.get('knowledge_video_id')}")
    print(f"Status: {context.data.get('job_status')}")
    if isinstance(pipeline._repository, InMemoryKnowledgeRepository):
        print("Repository: in-memory (set DATABASE_URL and pass --use-database to persist)")
    return 0


def _build_metadata(args: argparse.Namespace) -> dict[str, object]:
    title = args.title or f"Knowledge seed for {args.video_id}"
    description = args.description or f"Seeded knowledge video for {args.video_id}."
    source_url = args.source_url or f"https://www.youtube.com/watch?v={args.video_id}"
    return {
        "id": args.video_id,
        "title": title,
        "description": description,
        "speaker": args.speaker,
        "published_at": args.published_at,
        "duration_seconds": args.duration_seconds,
        "thumbnail_url": args.thumbnail_url,
        "source_url": source_url,
        "video_url": args.video_path,
        "download_url": args.video_path,
    }


def _load_transcript_segments(args: argparse.Namespace) -> list[dict[str, object]]:
    if args.transcript_file is not None:
        payload = json.loads(Path(args.transcript_file).read_text(encoding="utf-8"))
        if not isinstance(payload, list):
            raise ValueError("Transcript file must contain a JSON array.")
        return [dict(item) for item in payload]

    fallback_text = args.description or args.title or args.video_id
    duration = float(args.duration_seconds or 30)
    return [{"start": 0.0, "end": duration, "text": fallback_text}]


def main() -> int:
    parser = argparse.ArgumentParser(description="Seed Cerul knowledge segments.")
    parser.add_argument("video_id", help="Source video id, e.g. openai-devday")
    parser.add_argument("video_path", help="Local video path or direct downloadable URL")
    parser.add_argument("--title", help="Video title override")
    parser.add_argument("--description", help="Video description override")
    parser.add_argument("--speaker", help="Speaker or channel name")
    parser.add_argument("--published-at", help="Published timestamp in ISO-8601")
    parser.add_argument("--duration-seconds", type=int, default=30)
    parser.add_argument("--thumbnail-url", help="Thumbnail URL")
    parser.add_argument("--source-url", help="Canonical public video URL")
    parser.add_argument("--transcript-file", help="JSON file with transcript segments")
    parser.add_argument("--job-id", help="Optional processing_jobs.id")
    parser.add_argument("--scene-threshold", type=float, default=0.35)
    parser.add_argument(
        "--fake-embeddings",
        action="store_true",
        help="Use deterministic local embeddings instead of Gemini for seed-only runs",
    )
    parser.add_argument(
        "--use-database",
        action="store_true",
        help="Use DATABASE_URL-backed repository instead of in-memory storage",
    )
    args = parser.parse_args()
    return asyncio.run(_run_pipeline(args))


if __name__ == "__main__":
    raise SystemExit(main())
