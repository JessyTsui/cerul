import type { Route } from "next";
import Link from "next/link";
import type { DemoMode, DemoSearchResult } from "@/lib/demo-api";

type SearchResultCardProps = {
  mode: DemoMode;
  rank: number;
  result: DemoSearchResult;
};

const thumbnailPalettes = [
  ["#1d4ed8", "#0f172a"],
  ["#ea580c", "#172554"],
  ["#0f766e", "#111827"],
  ["#7c3aed", "#1e293b"],
];

function hashString(value: string): number {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }

  return Math.abs(hash);
}

function getThumbnailBackground(seed: string): string {
  const palette = thumbnailPalettes[hashString(seed) % thumbnailPalettes.length];

  return `linear-gradient(135deg, ${palette[0]}, ${palette[1]})`;
}

function formatRelevance(score: number): string {
  return `${Math.round(score * 100)}%`;
}

export function SearchResultCard({
  mode,
  rank,
  result,
}: SearchResultCardProps) {
  const relevance = formatRelevance(result.score);

  if (mode === "broll") {
    return (
      <article className="surface-elevated overflow-hidden">
        <div
          className="relative aspect-video border-b border-[var(--border)]"
          style={{ background: getThumbnailBackground(result.id) }}
        >
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.24),transparent_36%)]" />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(10,10,15,0.08),rgba(10,10,15,0.78))]" />
          <div className="relative flex h-full flex-col justify-between p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="rounded-full border border-white/15 bg-black/20 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.16em] text-white/80 backdrop-blur-sm">
                Preview {String(rank).padStart(2, "0")}
              </span>
              <span className="rounded-full border border-white/15 bg-black/20 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.16em] text-white/80 backdrop-blur-sm">
                {relevance}
              </span>
            </div>
            <div className="rounded-[20px] border border-white/10 bg-black/20 px-4 py-4 backdrop-blur-md">
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-white/60">
                {result.source}
              </p>
              <h3 className="mt-2 text-lg font-semibold text-white">{result.title}</h3>
            </div>
          </div>
        </div>
        <div className="space-y-4 px-5 py-5">
          <p className="text-sm leading-7 text-[var(--foreground-secondary)]">
            {result.detail}
          </p>
          <div className="flex flex-col gap-3 border-t border-[var(--border)] pt-4">
            <p className="font-mono text-xs leading-6 break-all text-[var(--foreground-tertiary)]">
              {result.href}
            </p>
            <Link
              href={result.href as Route}
              className="button-ghost w-fit px-0 text-sm text-[var(--brand-bright)] hover:bg-transparent hover:text-white"
            >
              Open link →
            </Link>
          </div>
        </div>
      </article>
    );
  }

  return (
    <article className="surface-elevated px-5 py-5 sm:px-6">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-[var(--border-brand)] bg-[var(--brand-subtle)] px-3 py-1 font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--brand-bright)]">
              Rank {String(rank).padStart(2, "0")}
            </span>
            <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1 font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-secondary)]">
              {result.source}
            </span>
          </div>
          <h3 className="mt-4 text-xl font-semibold text-white sm:text-2xl">
            {result.title}
          </h3>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-[var(--foreground-secondary)] sm:text-base">
            {result.detail}
          </p>
        </div>

        <div className="rounded-[20px] border border-[var(--border)] bg-[var(--surface)] px-4 py-4 lg:min-w-[132px]">
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
            Relevance
          </p>
          <p className="mt-3 font-mono text-3xl font-semibold text-white">
            {relevance}
          </p>
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-3 border-t border-[var(--border)] pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="font-mono text-xs leading-6 break-all text-[var(--foreground-tertiary)]">
          {result.href}
        </p>
        <Link
          href={result.href as Route}
          className="button-ghost w-fit px-0 text-sm text-[var(--brand-bright)] hover:bg-transparent hover:text-white"
        >
          Open link →
        </Link>
      </div>
    </article>
  );
}
