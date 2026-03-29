"use client";

import { useCallback, useEffect, useState } from "react";
import {
  admin,
  type AdminIndexedVideo,
  type AdminIndexedVideosResponse,
} from "@/lib/admin-api";
import { formatAdminDateTime } from "@/lib/admin-console";

const VIDEO_PAGE_SIZE = 8;

function statusBadgeClass(status: string | null): string {
  if (status === "failed") {
    return "border-[rgba(191,91,70,0.2)] bg-[rgba(191,91,70,0.12)] text-[var(--error)]";
  }
  if (status === "running" || status === "retrying" || status === "pending") {
    return "border-[var(--border-brand)] bg-[var(--brand-subtle)] text-[var(--brand-bright)]";
  }
  if (status === "completed") {
    return "border-[rgba(31,141,74,0.2)] bg-[rgba(31,141,74,0.12)] text-[var(--success)]";
  }
  return "border-[var(--border)] bg-white/68 text-[var(--foreground-tertiary)]";
}

function VideoRow({
  video,
  deleting,
  onDelete,
}: {
  video: AdminIndexedVideo;
  deleting: boolean;
  onDelete: (video: AdminIndexedVideo) => void;
}) {
  const primaryUrl = video.sourceUrl ?? video.videoUrl;

  return (
    <article className="rounded-[22px] border border-[var(--border)]/70 bg-white/68 px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-medium text-[var(--foreground)]">{video.title}</p>
            <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-[var(--foreground-tertiary)]">
              {video.source}
            </span>
            <span className={`rounded-full border px-2 py-0.5 text-[10px] ${statusBadgeClass(video.lastJobStatus)}`}>
              {video.lastJobStatus ?? "no job"}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-[var(--foreground-secondary)]">
            source id: <span className="font-mono text-[var(--foreground-tertiary)]">{video.sourceVideoId}</span>
          </p>
          {primaryUrl ? (
            <p className="mt-1 break-all text-[11px] text-[var(--foreground-tertiary)]">{primaryUrl}</p>
          ) : null}
          <p className="mt-2 text-[11px] text-[var(--foreground-secondary)]">
            {video.unitsCreated} unit{video.unitsCreated === 1 ? "" : "s"}
            {video.speaker ? ` • ${video.speaker}` : ""}
            {video.lastJobAt ? ` • last job ${formatAdminDateTime(video.lastJobAt)}` : ""}
            {` • updated ${formatAdminDateTime(video.updatedAt)}`}
          </p>
        </div>
        <button
          type="button"
          disabled={deleting}
          onClick={() => onDelete(video)}
          className={`shrink-0 rounded-md px-3 py-1 text-xs font-medium transition ${
            deleting
              ? "cursor-not-allowed bg-[rgba(191,91,70,0.08)] text-[var(--error)]/60"
              : "bg-[rgba(191,91,70,0.12)] text-[var(--error)] hover:bg-[rgba(191,91,70,0.18)]"
          }`}
        >
          {deleting ? "Deleting..." : "Delete"}
        </button>
      </div>
    </article>
  );
}

export function VideoLibraryPanel() {
  const [data, setData] = useState<AdminIndexedVideosResponse | null>(null);
  const [queryInput, setQueryInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [deletingVideoIds, setDeletingVideoIds] = useState<Set<string>>(() => new Set());

  const loadVideos = useCallback(async (requestedQuery: string, requestedOffset: number) => {
    setIsLoading(true);
    try {
      const result = await admin.getIndexedVideos({
        query: requestedQuery || undefined,
        limit: VIDEO_PAGE_SIZE,
        offset: requestedOffset,
      });
      if (result.total === 0 && requestedOffset !== 0) {
        setOffset(0);
        return;
      }
      if (result.total > 0 && requestedOffset >= result.total) {
        setOffset(Math.max(Math.floor((result.total - 1) / VIDEO_PAGE_SIZE) * VIDEO_PAGE_SIZE, 0));
        return;
      }
      setData(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load indexed videos.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadVideos(searchQuery, offset);
  }, [searchQuery, offset, loadVideos]);

  async function handleDelete(video: AdminIndexedVideo) {
    if (
      !window.confirm(
        `Delete all indexed data for "${video.title}"? This removes retrieval units, tracking links, access records, and related jobs.`,
      )
    ) {
      return;
    }

    setDeletingVideoIds((current) => new Set(current).add(video.videoId));
    setNotice(null);
    try {
      const result = await admin.deleteIndexedVideo(video.videoId);
      setNotice(
        `Deleted ${result.title} • ${result.unitsDeleted} units • ${result.processingJobsDeleted} related job${result.processingJobsDeleted === 1 ? "" : "s"}.`,
      );
      if (data && data.videos.length === 1 && offset > 0) {
        setOffset(Math.max(offset - VIDEO_PAGE_SIZE, 0));
      } else {
        await loadVideos(searchQuery, offset);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete indexed video.");
    } finally {
      setDeletingVideoIds((current) => {
        const next = new Set(current);
        next.delete(video.videoId);
        return next;
      });
    }
  }

  const total = data?.total ?? 0;
  const videos = data?.videos ?? [];
  const currentPage = total > 0 ? Math.floor((data?.offset ?? 0) / VIDEO_PAGE_SIZE) + 1 : 1;
  const totalPages = Math.max(Math.ceil(Math.max(total, 1) / VIDEO_PAGE_SIZE), 1);
  const rangeStart = total > 0 ? (data?.offset ?? 0) + 1 : 0;
  const rangeEnd = Math.min((data?.offset ?? 0) + videos.length, total);

  return (
    <article className="surface-elevated overflow-hidden rounded-[30px] px-5 py-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[var(--foreground)]">Indexed videos</p>
          <p className="mt-1 text-xs text-[var(--foreground-tertiary)]">
            Search by title or original URL, then delete a video and all related indexed data.
          </p>
        </div>
        <div className="rounded-full border border-[var(--border)] px-2.5 py-0.5 text-[11px] text-[var(--foreground-secondary)]">
          {total} total
        </div>
      </div>

      <form
        className="mt-4 flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setNotice(null);
          setOffset(0);
          setSearchQuery(queryInput.trim());
        }}
      >
        <input
          value={queryInput}
          onChange={(event) => setQueryInput(event.target.value)}
          placeholder="Search by title or original URL"
          className="admin-input min-w-[280px] flex-1 text-sm"
        />
        <button type="submit" className="button-primary" disabled={isLoading}>
          Search
        </button>
        <button
          type="button"
          className="button-secondary"
          onClick={() => {
            setQueryInput("");
            setSearchQuery("");
            setOffset(0);
            setNotice(null);
          }}
        >
          Clear
        </button>
      </form>

      {notice ? (
        <p className="mt-3 rounded-xl border border-[rgba(31,141,74,0.18)] bg-[rgba(31,141,74,0.12)] px-3 py-2 text-xs text-[var(--success)]">
          {notice}
        </p>
      ) : null}

      {error ? (
        <p className="mt-3 rounded-xl border border-[rgba(191,91,70,0.18)] bg-[rgba(191,91,70,0.12)] px-3 py-2 text-xs text-[var(--error)]">
          {error}
        </p>
      ) : null}

      <div className="mt-4 space-y-3">
        {isLoading && !data ? (
          <p className="text-xs text-[var(--foreground-tertiary)]">Loading indexed videos…</p>
        ) : videos.length === 0 ? (
          <p className="text-xs text-[var(--foreground-tertiary)]">
            {searchQuery
              ? "No indexed videos matched this title or URL."
              : "No indexed videos available yet."}
          </p>
        ) : (
          videos.map((video) => (
            <VideoRow
              key={video.videoId}
              video={video}
              deleting={deletingVideoIds.has(video.videoId)}
              onDelete={handleDelete}
            />
          ))
        )}
      </div>

      {total > VIDEO_PAGE_SIZE ? (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-[var(--border)]/70 bg-white/56 px-3 py-2 text-[11px] text-[var(--foreground-secondary)]">
          <p>
            Showing {rangeStart}-{rangeEnd} of {total}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setOffset((current) => Math.max(current - VIDEO_PAGE_SIZE, 0))}
              disabled={(data?.offset ?? 0) === 0}
              className="rounded-md border border-[var(--border)] px-2.5 py-1 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Prev
            </button>
            <span className="text-[10px] text-[var(--foreground-tertiary)]">
              Page {currentPage} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setOffset((current) => current + VIDEO_PAGE_SIZE)}
              disabled={(data?.offset ?? 0) + VIDEO_PAGE_SIZE >= total}
              className="rounded-md border border-[var(--border)] px-2.5 py-1 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
}
