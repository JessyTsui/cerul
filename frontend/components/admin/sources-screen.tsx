"use client";

import { useCallback, useEffect, useState } from "react";
import {
  admin,
  type AdminSource,
  type AdminSourceAnalytics,
  type AdminSourceRecentVideosEntry,
  type CreateSourceInput,
  type SourceAnalyticsRange,
  type SubmitVideoResult,
  type TriggerSearchResult,
  type VideoJobStatus,
} from "@/lib/admin-api";
import { getApiErrorMessage } from "@/lib/api";
import { AdminLayout } from "./admin-layout";

type FormState = {
  slug: string;
  displayName: string;
  channelId: string;
  maxResults: string;
  isActive: boolean;
  description: string;
  thumbnailUrl: string;
};

const emptyForm: FormState = {
  slug: "",
  displayName: "",
  channelId: "",
  maxResults: "30",
  isActive: true,
  description: "",
  thumbnailUrl: "",
};

const RANGE_OPTIONS: { key: SourceAnalyticsRange; label: string }[] = [
  { key: "24h", label: "24h" },
  { key: "3d", label: "3d" },
  { key: "7d", label: "7d" },
  { key: "15d", label: "15d" },
  { key: "30d", label: "30d" },
];

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function getChannelUrl(channelId: string): string {
  return `https://www.youtube.com/channel/${channelId}`;
}

function getMetaString(metadata: Record<string, unknown>, key: string): string {
  const value = metadata[key];
  return typeof value === "string" ? value : "";
}

function getMetaInt(metadata: Record<string, unknown>, key: string): number | null {
  const value = metadata[key];
  return typeof value === "number" ? value : null;
}

function formatCount(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function DeltaBadge({ current, previous }: { current: number; previous: number }) {
  const delta = current - previous;
  if (delta === 0 && current === 0) return null;
  const sign = delta > 0 ? "+" : "";
  const color =
    delta > 0
      ? "text-emerald-400"
      : delta < 0
        ? "text-red-400"
        : "text-[var(--foreground-tertiary)]";
  return (
    <span className={`ml-1 text-[10px] ${color}`}>
      {sign}
      {delta}
    </span>
  );
}

function ChannelAvatar({ url, name, size = 12 }: { url: string; name: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const letter = name.charAt(0).toUpperCase();
  const sizeClass = size === 12 ? "h-12 w-12" : "h-10 w-10";
  const textSize = size === 12 ? "text-base" : "text-sm";

  if (!url || failed) {
    return (
      <div className={`flex ${sizeClass} shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[rgba(255,255,255,0.06)] ${textSize} font-semibold text-[var(--foreground-tertiary)]`}>
        {letter}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={name}
      className={`${sizeClass} shrink-0 rounded-full border border-[var(--border)] object-cover`}
      onError={() => setFailed(true)}
    />
  );
}

export function AdminSourcesScreen() {
  const [sources, setSources] = useState<AdminSource[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [isSaving, setIsSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteSource, setConfirmDeleteSource] = useState<AdminSource | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<{ id: string; msg: string } | null>(null);

  // Modals
  const [showAddSourceModal, setShowAddSourceModal] = useState(false);
  const [showSubmitVideoModal, setShowSubmitVideoModal] = useState(false);
  const [showSearchModal, setShowSearchModal] = useState(false);

  // Add source by URL
  const [addSourceUrl, setAddSourceUrl] = useState("");
  const [addSourceLoading, setAddSourceLoading] = useState(false);
  const [addSourceError, setAddSourceError] = useState<string | null>(null);
  const [addSourceResult, setAddSourceResult] = useState<{ name: string; alreadyExists: boolean } | null>(null);

  // Video submission
  const [videoUrl, setVideoUrl] = useState("");
  const [videoSubmitting, setVideoSubmitting] = useState(false);
  const [videoSubmitResult, setVideoSubmitResult] = useState<SubmitVideoResult | null>(null);
  const [videoSubmitError, setVideoSubmitError] = useState<string | null>(null);
  const [videoJobs, setVideoJobs] = useState<VideoJobStatus[]>([]);

  // Search
  const [searchQuery, setSearchQuery] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchResult, setSearchResult] = useState<TriggerSearchResult | null>(null);

  // Analytics
  const [analyticsRange, setAnalyticsRange] = useState<SourceAnalyticsRange>("7d");
  const [analyticsData, setAnalyticsData] = useState<AdminSourceAnalytics[]>([]);

  // Recent videos
  const [recentVideos, setRecentVideos] = useState<AdminSourceRecentVideosEntry[]>([]);

  // Expanded cards
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Pagination
  const PAGE_SIZE = 30;
  const [currentPage, setCurrentPage] = useState(0);

  const loadSources = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await admin.getSources();
      setSources(response.sources);
    } catch (err) {
      setError(getApiErrorMessage(err, "Failed to load sources."));
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadAnalytics = useCallback(async (range: SourceAnalyticsRange) => {
    try {
      const response = await admin.getSourcesAnalytics(range);
      setAnalyticsData(response.sources);
    } catch {
      // silent fail for analytics
    }
  }, []);

  const loadRecentVideos = useCallback(async () => {
    try {
      const response = await admin.getSourcesRecentVideos(3);
      setRecentVideos(response.sources);
    } catch {
      // silent fail
    }
  }, []);

  useEffect(() => {
    void loadSources();
    void loadRecentVideos();
  }, [loadSources, loadRecentVideos]);

  // ESC to close modals
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setShowAddSourceModal(false);
        setShowSubmitVideoModal(false);
        setShowSearchModal(false);
        setConfirmDeleteSource(null);
        closeForm();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    void loadAnalytics(analyticsRange);
  }, [analyticsRange, loadAnalytics]);

  function openEditForm(source: AdminSource) {
    const channelId =
      typeof source.config.channel_id === "string" ? source.config.channel_id : "";
    const maxResults =
      typeof source.config.max_results === "number"
        ? String(source.config.max_results)
        : "30";

    setForm({
      slug: source.slug,
      displayName: source.displayName,
      channelId,
      maxResults,
      isActive: source.isActive,
      description: getMetaString(source.metadata, "description"),
      thumbnailUrl: getMetaString(source.metadata, "thumbnail_url"),
    });
    setEditingId(source.id);
    setShowForm(true);
    setActionError(null);
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setActionError(null);
  }

  function updateField(field: keyof FormState, value: string | boolean) {
    setForm((prev) => {
      const next = { ...prev, [field]: value };
      if (field === "displayName" && !editingId) {
        next.slug = slugify(value as string);
      }
      return next;
    });
  }

  async function handleSave() {
    if (!form.slug.trim() || !form.displayName.trim() || !form.channelId.trim()) {
      setActionError("Slug, display name, and channel ID are required.");
      return;
    }

    setIsSaving(true);
    setActionError(null);

    try {
      const config: Record<string, unknown> = {
        channel_id: form.channelId.trim(),
        max_results: parseInt(form.maxResults, 10) || 30,
      };

      const metadata: Record<string, unknown> = {};
      if (form.description.trim()) metadata.description = form.description.trim();
      if (form.thumbnailUrl.trim()) metadata.thumbnail_url = form.thumbnailUrl.trim();

      if (editingId) {
        await admin.updateSource(editingId, {
          slug: form.slug.trim(),
          displayName: form.displayName.trim(),
          isActive: form.isActive,
          config,
          metadata,
        });
      } else {
        const input: CreateSourceInput = {
          slug: form.slug.trim(),
          track: "unified",
          sourceType: "youtube",
          displayName: form.displayName.trim(),
          isActive: form.isActive,
          config,
          metadata,
        };
        await admin.createSource(input);
      }

      closeForm();
      await loadSources();
    } catch (err) {
      setActionError(getApiErrorMessage(err, "Failed to save source."));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleAddSource() {
    if (!addSourceUrl.trim()) return;
    setAddSourceLoading(true);
    setAddSourceError(null);
    setAddSourceResult(null);
    try {
      const result = await admin.createSourceFromUrl(addSourceUrl.trim());
      setAddSourceResult({
        name: result.source.displayName,
        alreadyExists: result.alreadyExists,
      });
      if (!result.alreadyExists) {
        void loadSources();
      }
      setAddSourceUrl("");
    } catch (err) {
      setAddSourceError(getApiErrorMessage(err, "Failed to add channel."));
    } finally {
      setAddSourceLoading(false);
    }
  }

  async function handleTriggerSearch() {
    if (!searchQuery.trim()) return;
    setSearchLoading(true);
    setSearchError(null);
    setSearchResult(null);
    try {
      const result = await admin.triggerSearch({ query: searchQuery.trim() });
      setSearchResult(result);
    } catch (err) {
      setSearchError(getApiErrorMessage(err, "Search failed."));
    } finally {
      setSearchLoading(false);
    }
  }

  async function handleToggleActive(source: AdminSource) {
    setTogglingId(source.id);
    try {
      await admin.updateSource(source.id, { isActive: !source.isActive });
      await loadSources();
    } catch (err) {
      setActionError(getApiErrorMessage(err, "Failed to toggle source."));
    } finally {
      setTogglingId(null);
    }
  }

  async function handleDelete(source: AdminSource) {
    setDeletingId(source.id);
    try {
      await admin.deleteSource(source.id);
      setConfirmDeleteSource(null);
      await loadSources();
    } catch (err) {
      setActionError(getApiErrorMessage(err, "Failed to delete source."));
    } finally {
      setDeletingId(null);
    }
  }

  async function handleSync(source: AdminSource) {
    setSyncingId(source.id);
    setSyncResult(null);
    try {
      const result = await admin.syncSource(source.id);
      setSyncResult({
        id: source.id,
        msg: `Discovered ${result.videosDiscovered}, created ${result.jobsCreated} jobs, skipped ${result.skipped}`,
      });
      void loadAnalytics(analyticsRange);
    } catch (err) {
      setSyncResult({
        id: source.id,
        msg: getApiErrorMessage(err, "Sync failed."),
      });
    } finally {
      setSyncingId(null);
    }
  }

  async function handleSubmitVideo() {
    if (!videoUrl.trim()) return;
    setVideoSubmitting(true);
    setVideoSubmitError(null);
    setVideoSubmitResult(null);
    setVideoJobs([]);
    try {
      const result = await admin.submitVideo(videoUrl.trim());
      setVideoSubmitResult(result);
      // Fetch job status
      if (result.videoId) {
        const jobs = await admin.getVideoJobStatus(result.videoId);
        setVideoJobs(jobs);
      }
    } catch (err) {
      setVideoSubmitError(getApiErrorMessage(err, "Failed to submit video."));
    } finally {
      setVideoSubmitting(false);
    }
  }

  async function handleCheckVideoStatus(videoId: string) {
    try {
      const jobs = await admin.getVideoJobStatus(videoId);
      setVideoJobs(jobs);
    } catch {
      // silent
    }
  }

  function getAnalyticsForSource(sourceId: string): AdminSourceAnalytics | null {
    return analyticsData.find((a) => a.sourceId === sourceId) ?? null;
  }

  function getRecentVideosForSource(sourceId: string): AdminSourceRecentVideosEntry | null {
    return recentVideos.find((r) => r.sourceId === sourceId) ?? null;
  }

  const activeCount = sources.filter((s) => s.isActive).length;

  // Sort: by subscriber count descending (biggest channels first)
  const sortedSources = [...sources].sort((a, b) => {
    const aSubs = getMetaInt(a.metadata, "subscriber_count") ?? 0;
    const bSubs = getMetaInt(b.metadata, "subscriber_count") ?? 0;
    return bSubs - aSubs;
  });

  const inputClassName = "admin-input";
  const labelClassName =
    "block font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]";

  return (
    <AdminLayout
      currentPath="/admin/sources"
      title="Sources"
      description="Manage YouTube channels and content sources for automated video discovery."
      actions={
        <>
          <button
            className="button-secondary"
            onClick={() => {
              setVideoUrl("");
              setVideoSubmitResult(null);
              setVideoSubmitError(null);
              setVideoJobs([]);
              setShowSubmitVideoModal(true);
            }}
            type="button"
          >
            Submit video
          </button>
          <button
            className="button-secondary"
            onClick={() => {
              setSearchQuery("");
              setSearchResult(null);
              setSearchError(null);
              setShowSearchModal(true);
            }}
            type="button"
          >
            Search YouTube
          </button>
          <button
            className="button-primary"
            onClick={() => {
              setAddSourceUrl("");
              setAddSourceError(null);
              setAddSourceResult(null);
              setShowAddSourceModal(true);
            }}
            type="button"
          >
            Add source
          </button>
        </>
      }
    >
      {actionError ? (
        <div className="rounded-[18px] border border-[rgba(191,91,70,0.18)] bg-[rgba(191,91,70,0.12)] px-4 py-3 text-sm text-[var(--error)]">
          {actionError}
        </div>
      ) : null}

      {/* Delete confirmation modal */}
      {confirmDeleteSource ? (
        <div className="admin-modal-backdrop fixed inset-0 z-50 flex items-center justify-center">
          <div className="surface-elevated mx-4 w-full max-w-md rounded-[24px] px-6 py-6">
            <p className="text-lg font-semibold text-[var(--foreground)]">Delete source</p>
            <p className="mt-2 text-sm text-[var(--foreground-secondary)]">
              Are you sure you want to delete{" "}
              <strong className="text-[var(--foreground)]">{confirmDeleteSource.displayName}</strong>?
              This will stop all future video discovery from this channel.
              Existing indexed videos will not be removed.
            </p>
            <div className="mt-6 flex gap-3">
              <button
                className="rounded-[14px] border border-[rgba(191,91,70,0.22)] bg-[rgba(191,91,70,0.12)] px-4 py-2 text-sm text-[var(--error)] transition hover:bg-[rgba(191,91,70,0.18)]"
                type="button"
                disabled={deletingId === confirmDeleteSource.id}
                onClick={() => void handleDelete(confirmDeleteSource)}
              >
                {deletingId === confirmDeleteSource.id ? "Deleting..." : "Delete"}
              </button>
              <button
                className="button-secondary"
                type="button"
                onClick={() => setConfirmDeleteSource(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Add source modal */}
      {showAddSourceModal ? (
        <div className="admin-modal-backdrop fixed inset-0 z-50 flex items-center justify-center">
          <div className="surface-elevated mx-4 w-full max-w-lg rounded-[24px] px-6 py-6">
            <p className="text-lg font-semibold text-[var(--foreground)]">Add YouTube channel</p>
            <p className="mt-1 text-sm text-[var(--foreground-secondary)]">
              Paste a channel URL or ID. Channel info will be fetched automatically.
            </p>
            <input
              type="text"
              value={addSourceUrl}
              onChange={(e) => {
                setAddSourceUrl(e.target.value);
                setAddSourceError(null);
                setAddSourceResult(null);
              }}
              placeholder="e.g. https://youtube.com/@OpenAI or UCxxxxxxx"
              className={`mt-4 ${inputClassName}`}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleAddSource();
              }}
              autoFocus
            />
            {addSourceError ? (
              <p className="mt-2 text-xs text-[var(--error)]">{addSourceError}</p>
            ) : null}
            {addSourceResult ? (
              <p className={`mt-2 text-xs ${addSourceResult.alreadyExists ? "text-[var(--accent-bright)]" : "text-[var(--success)]"}`}>
                {addSourceResult.alreadyExists
                  ? `"${addSourceResult.name}" already exists.`
                  : `"${addSourceResult.name}" added successfully.`}
              </p>
            ) : null}
            <div className="mt-5 flex gap-3">
              <button
                className="button-primary"
                type="button"
                disabled={addSourceLoading}
                onClick={() => void handleAddSource()}
              >
                {addSourceLoading ? "Adding..." : "Add"}
              </button>
              <button
                className="button-secondary"
                type="button"
                onClick={() => setShowAddSourceModal(false)}
              >
                {addSourceResult ? "Close" : "Cancel"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Search YouTube modal */}
      {showSearchModal ? (
        <div className="admin-modal-backdrop fixed inset-0 z-50 flex items-center justify-center">
          <div className="surface-elevated mx-4 w-full max-w-lg rounded-[24px] px-6 py-6">
            <p className="text-lg font-semibold text-[var(--foreground)]">Search YouTube</p>
            <p className="mt-1 text-sm text-[var(--foreground-secondary)]">
              Search for videos and queue matching results for indexing.
              Videos under 3 min or 5K views are filtered automatically.
            </p>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setSearchError(null);
                setSearchResult(null);
              }}
              placeholder="e.g. AI frontier model release 2026"
              className={`mt-4 ${inputClassName}`}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleTriggerSearch();
              }}
              autoFocus
            />
            {searchError ? (
              <p className="mt-2 text-xs text-[var(--error)]">{searchError}</p>
            ) : null}
            {searchResult ? (
              <div className="mt-3 rounded-[16px] border border-[var(--border)] bg-white/64 p-4 text-sm">
                <p className="text-[var(--foreground)]">
                  Found <strong>{searchResult.videosFound}</strong> videos,
                  filtered <strong>{searchResult.videosFiltered}</strong>,
                  created <strong className="text-[var(--success)]">{searchResult.jobsCreated}</strong> jobs.
                </p>
                {searchResult.jobsCreated === 0 && searchResult.videosFound > 0 ? (
                  <p className="mt-1 text-xs text-[var(--foreground-tertiary)]">
                    All matching videos were either already queued or filtered out.
                  </p>
                ) : null}
              </div>
            ) : null}
            <div className="mt-5 flex gap-3">
              <button
                className="button-primary"
                type="button"
                disabled={searchLoading}
                onClick={() => void handleTriggerSearch()}
              >
                {searchLoading ? "Searching..." : "Search"}
              </button>
              <button
                className="button-secondary"
                type="button"
                onClick={() => setShowSearchModal(false)}
              >
                {searchResult ? "Close" : "Cancel"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Submit video modal */}
      {showSubmitVideoModal ? (
        <div className="admin-modal-backdrop fixed inset-0 z-50 flex items-center justify-center">
          <div className="surface-elevated mx-4 w-full max-w-xl rounded-[24px] px-6 py-6">
            <p className="text-lg font-semibold text-[var(--foreground)]">Submit video for indexing</p>
            <p className="mt-1 text-sm text-[var(--foreground-secondary)]">
              Paste a YouTube video URL to manually queue it for processing.
            </p>
            <div className="mt-4 flex gap-3">
              <input
                type="text"
                value={videoUrl}
                onChange={(e) => {
                  setVideoUrl(e.target.value);
                  setVideoSubmitError(null);
                  setVideoSubmitResult(null);
                }}
                placeholder="e.g. https://youtube.com/watch?v=dQw4w9WgXcQ"
                className={inputClassName}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleSubmitVideo();
                }}
                autoFocus
              />
            </div>
            {videoSubmitError ? (
              <p className="mt-2 text-xs text-[var(--error)]">{videoSubmitError}</p>
            ) : null}

            {videoSubmitResult ? (
              <div className="mt-4 rounded-[16px] border border-[var(--border)] bg-white/64 p-4">
                <div className="flex gap-3">
                  {videoSubmitResult.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={videoSubmitResult.thumbnailUrl}
                      alt=""
                      className="h-16 w-28 shrink-0 rounded-[8px] object-cover"
                    />
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-[var(--foreground)]">{videoSubmitResult.title}</p>
                    <p className="mt-0.5 text-xs text-[var(--foreground-tertiary)]">
                      {videoSubmitResult.channelTitle}
                      {videoSubmitResult.durationSeconds != null
                        ? ` · ${formatDuration(videoSubmitResult.durationSeconds)}`
                        : ""}
                    </p>
                    <p className={`mt-1 text-xs ${videoSubmitResult.alreadyExists ? "text-[var(--accent-bright)]" : "text-[var(--success)]"}`}>
                      {videoSubmitResult.alreadyExists
                        ? "This video already has a processing job."
                        : "Job created successfully."}
                    </p>
                  </div>
                </div>

                {videoJobs.length > 0 ? (
                  <div className="mt-3 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                        Job status
                      </p>
                      <button
                        className="text-xs text-[var(--foreground-secondary)] transition hover:text-[var(--foreground)]"
                        type="button"
                        onClick={() => void handleCheckVideoStatus(videoSubmitResult.videoId)}
                      >
                        Refresh
                      </button>
                    </div>
                    {videoJobs.map((job) => (
                      <div
                        key={job.jobId}
                        className="flex items-center gap-3 rounded-[10px] border border-[var(--border)] bg-[rgba(255,255,255,0.02)] px-3 py-2 text-xs"
                      >
                        <span
                          className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] ${
                            job.status === "completed"
                              ? "border border-[rgba(31,141,74,0.18)] bg-[rgba(31,141,74,0.12)] text-[var(--success)]"
                              : job.status === "failed"
                                ? "border border-[rgba(191,91,70,0.18)] bg-[rgba(191,91,70,0.12)] text-[var(--error)]"
                                : job.status === "running"
                                  ? "border border-[var(--border-brand)] bg-[var(--brand-subtle)] text-[var(--brand-bright)]"
                                  : "border border-[var(--border)] bg-white/72 text-[var(--foreground-tertiary)]"
                          }`}
                        >
                          {job.status}
                        </span>
                        <span className="text-[var(--foreground-tertiary)]">
                          {new Date(job.createdAt).toLocaleString()}
                        </span>
                        {job.errorMessage ? (
                          <span className="truncate text-[var(--error)]" title={job.errorMessage}>
                            {job.errorMessage}
                          </span>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="mt-5 flex gap-3">
              {!videoSubmitResult ? (
                <button
                  className="button-primary"
                  type="button"
                  disabled={videoSubmitting}
                  onClick={() => void handleSubmitVideo()}
                >
                  {videoSubmitting ? "Submitting..." : "Submit"}
                </button>
              ) : null}
              <button
                className="button-secondary"
                type="button"
                onClick={() => setShowSubmitVideoModal(false)}
              >
                {videoSubmitResult ? "Close" : "Cancel"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showForm ? (
        <section>
          <article className="surface-elevated rounded-[32px] px-6 py-6">
            <p className="eyebrow">
              {editingId ? "Edit source" : "Add YouTube channel"}
            </p>
            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <label className="space-y-2 text-sm text-[var(--foreground-secondary)]">
                <span className={labelClassName}>Display name</span>
                <input
                  type="text"
                  value={form.displayName}
                  onChange={(e) => updateField("displayName", e.target.value)}
                  placeholder="e.g. OpenAI"
                  className={inputClassName}
                />
              </label>
              <label className="space-y-2 text-sm text-[var(--foreground-secondary)]">
                <span className={labelClassName}>Slug</span>
                <input
                  type="text"
                  value={form.slug}
                  onChange={(e) => updateField("slug", e.target.value)}
                  placeholder="e.g. openai"
                  className={inputClassName}
                />
              </label>
              <label className="space-y-2 text-sm text-[var(--foreground-secondary)]">
                <span className={labelClassName}>YouTube Channel ID</span>
                <input
                  type="text"
                  value={form.channelId}
                  onChange={(e) => updateField("channelId", e.target.value)}
                  placeholder="e.g. UCXZCJLdBC09xxGZ6gcdrc6A"
                  className={inputClassName}
                />
              </label>
              <label className="space-y-2 text-sm text-[var(--foreground-secondary)]">
                <span className={labelClassName}>Max results per sync</span>
                <input
                  type="number"
                  value={form.maxResults}
                  onChange={(e) => updateField("maxResults", e.target.value)}
                  min="1"
                  max="200"
                  className={inputClassName}
                />
              </label>
              <label className="space-y-2 text-sm text-[var(--foreground-secondary)] lg:col-span-2">
                <span className={labelClassName}>Channel avatar URL</span>
                <input
                  type="url"
                  value={form.thumbnailUrl}
                  onChange={(e) => updateField("thumbnailUrl", e.target.value)}
                  placeholder="https://cdn.cerul.ai/avatars/channels/..."
                  className={inputClassName}
                />
              </label>
              <label className="space-y-2 text-sm text-[var(--foreground-secondary)] lg:col-span-2">
                <span className={labelClassName}>Description</span>
                <textarea
                  value={form.description}
                  onChange={(e) => updateField("description", e.target.value)}
                  placeholder="Brief description of this channel's focus and content..."
                  rows={3}
                  className="admin-textarea"
                />
              </label>
            </div>

            <div className="mt-5 flex items-center gap-6">
              <label className="flex items-center gap-3 text-sm text-[var(--foreground-secondary)]">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => updateField("isActive", e.target.checked)}
                  className="h-4 w-4 rounded border-[var(--border)] accent-[var(--brand)]"
                />
                Active
              </label>
            </div>

            {form.thumbnailUrl.trim() ? (
              <div className="mt-4 flex items-center gap-3">
                <span className={labelClassName}>Preview</span>
                <ChannelAvatar url={form.thumbnailUrl.trim()} name={form.displayName || "?"} size={10} />
              </div>
            ) : null}

            <div className="mt-6 flex gap-3">
              <button
                className="button-primary"
                type="button"
                disabled={isSaving}
                onClick={() => void handleSave()}
              >
                {isSaving ? "Saving..." : editingId ? "Update" : "Create"}
              </button>
              <button className="button-secondary" type="button" onClick={closeForm}>
                Cancel
              </button>
            </div>
          </article>
        </section>
      ) : null}

      <section>
        <article className="surface-elevated rounded-[30px] px-6 py-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                Content sources
              </p>
              <p className="mt-2 max-w-2xl text-sm leading-7 text-[var(--foreground-secondary)]">
                Keep source management lightweight: add channels, review throughput, and
                expand a row only when you need channel-level detail.
              </p>
            </div>
            <div className="flex items-center gap-3">
              {/* Range selector */}
              <div className="flex rounded-full border border-[var(--border)] bg-white/68 p-1">
                {RANGE_OPTIONS.map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setAnalyticsRange(opt.key)}
                    className={`px-3 py-1 text-xs transition ${
                      analyticsRange === opt.key
                        ? "rounded-full bg-[var(--foreground)] text-[#faf6ef] font-medium"
                        : "text-[var(--foreground-tertiary)] hover:text-[var(--foreground)]"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <span className="inline-flex items-center rounded-full border border-[var(--border)] bg-white/68 px-3 py-1 text-xs text-[var(--foreground-secondary)]">
                {sources.length} total
              </span>
              <span className="inline-flex items-center rounded-full border border-[rgba(31,141,74,0.18)] bg-[rgba(31,141,74,0.12)] px-3 py-1 text-xs text-[var(--success)]">
                {activeCount} active
              </span>
            </div>
          </div>

          {isLoading && sources.length === 0 ? (
            <div className="mt-6 flex justify-center py-12">
              <p className="text-sm text-[var(--foreground-tertiary)]">Loading sources...</p>
            </div>
          ) : error ? (
            <div className="mt-4 rounded-[18px] border border-[rgba(191,91,70,0.18)] bg-[rgba(191,91,70,0.12)] px-4 py-3 text-sm text-[var(--error)]">
              {error}
            </div>
          ) : sources.length === 0 ? (
            <div className="mt-6 flex justify-center py-12">
              <p className="text-sm text-[var(--foreground-tertiary)]">
                No sources configured. Click &ldquo;Add source&rdquo; to get started.
              </p>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {sortedSources.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE).map((source) => {
                const channelId =
                  typeof source.config.channel_id === "string"
                    ? source.config.channel_id
                    : null;
                const maxResults =
                  typeof source.config.max_results === "number"
                    ? source.config.max_results
                    : null;
                const thumbnailUrl = getMetaString(source.metadata, "thumbnail_url");
                const description = getMetaString(source.metadata, "description");
                const subscriberCount = getMetaInt(source.metadata, "subscriber_count");
                const videoCount = getMetaInt(source.metadata, "video_count");
                const viewCount = getMetaInt(source.metadata, "view_count");
                const keywords = Array.isArray(source.metadata.keywords)
                  ? (source.metadata.keywords as string[])
                  : [];
                const analytics = getAnalyticsForSource(source.id);
                const videos = getRecentVideosForSource(source.id);
                const isExpanded = expandedId === source.id;

                return (
                  <div
                    key={source.id}
                    className="rounded-[22px] border border-[var(--border)] bg-white/64 transition hover:border-[var(--border-strong)] hover:bg-white/78"
                  >
                    {/* Main row — always visible */}
                    <div
                      className="flex cursor-pointer items-center gap-3 px-5 py-4"
                      onClick={() => setExpandedId(isExpanded ? null : source.id)}
                    >
                      <ChannelAvatar url={thumbnailUrl} name={source.displayName} />

                      {/* Name + description — fixed proportion */}
                      <div className="min-w-0 w-[280px] shrink-0">
                        <div className="flex items-center gap-2">
                          <p className="truncate font-semibold text-[var(--foreground)]">
                            {source.displayName}
                          </p>
                          <span
                            className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] ${
                              source.isActive
                                ? "border border-[rgba(31,141,74,0.18)] bg-[rgba(31,141,74,0.12)] text-[var(--success)]"
                                : "border border-[var(--border)] bg-white/72 text-[var(--foreground-tertiary)]"
                            }`}
                          >
                            {source.isActive ? "Active" : "Paused"}
                          </span>
                        </div>
                        <p className="mt-0.5 truncate text-xs text-[var(--foreground-tertiary)]">
                          {source.slug}
                          {description ? ` · ${description.slice(0, 60)}` : ""}
                        </p>
                      </div>

                      {/* Stats columns — fixed widths for alignment */}
                      <div className="hidden shrink-0 items-center text-xs lg:flex">
                        <span className="w-[90px] text-right font-semibold text-[var(--foreground)]">
                          {formatCount(subscriberCount)}
                          <span className="ml-1 font-normal text-[var(--foreground-tertiary)]">subs</span>
                        </span>
                        <span className="w-[90px] text-right font-semibold text-[var(--foreground)]">
                          {formatCount(videoCount)}
                          <span className="ml-1 font-normal text-[var(--foreground-tertiary)]">vids</span>
                        </span>
                        <span className="w-[100px] text-right font-semibold text-[var(--foreground)]">
                          {formatCount(viewCount)}
                          <span className="ml-1 font-normal text-[var(--foreground-tertiary)]">views</span>
                        </span>
                        <span className="ml-3 w-[100px] border-l border-[var(--border)] pl-3 text-right">
                          <span className="font-semibold text-[var(--foreground)]">
                            {analytics ? analytics.jobsCompleted : 0}
                          </span>
                          {analytics ? (
                            <DeltaBadge current={analytics.jobsCompleted} previous={analytics.prevJobsCompleted} />
                          ) : null}
                          <span className="ml-1 font-normal text-[var(--foreground-tertiary)]">idx</span>
                        </span>
                      </div>

                      {/* Tags — fill remaining space */}
                      <div className="hidden min-w-0 flex-1 xl:block">
                        {keywords.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {keywords.slice(0, 3).map((kw) => (
                              <span
                                key={kw}
                                className="truncate rounded-full border border-[var(--border)] bg-[rgba(255,255,255,0.04)] px-2 py-0.5 text-[10px] text-[var(--foreground-tertiary)]"
                              >
                                {kw}
                              </span>
                            ))}
                            {keywords.length > 3 ? (
                              <span className="py-0.5 text-[10px] text-[var(--foreground-tertiary)]">
                                +{keywords.length - 3}
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                      </div>

                      {/* Actions */}
                      <div className="flex shrink-0 items-center gap-2" onClick={(e) => e.stopPropagation()}>
                        {channelId ? (
                          <a
                            href={getChannelUrl(channelId)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex h-7 items-center rounded-lg border border-[var(--border)] px-2.5 text-xs text-[var(--foreground-secondary)] transition hover:border-[var(--brand)] hover:bg-white hover:text-[var(--foreground)]"
                          >
                            YouTube
                          </a>
                        ) : null}
                        <button
                          className="inline-flex h-7 items-center rounded-lg border border-[var(--border)] px-2.5 text-xs text-[var(--foreground-secondary)] transition hover:border-[rgba(31,141,74,0.18)] hover:bg-[rgba(31,141,74,0.08)] hover:text-[var(--success)]"
                          disabled={syncingId === source.id}
                          onClick={() => void handleSync(source)}
                          type="button"
                        >
                          {syncingId === source.id ? "Syncing..." : "Sync"}
                        </button>
                        <button
                          className="inline-flex h-7 items-center rounded-lg border border-[var(--border)] px-2.5 text-xs text-[var(--foreground-secondary)] transition hover:border-[var(--brand)] hover:bg-white hover:text-[var(--foreground)]"
                          onClick={() => openEditForm(source)}
                          type="button"
                        >
                          Edit
                        </button>
                        <button
                          className="inline-flex h-7 items-center rounded-lg border border-[var(--border)] px-2.5 text-xs text-[var(--foreground-secondary)] transition hover:border-[rgba(212,156,105,0.22)] hover:bg-[rgba(212,156,105,0.08)] hover:text-[var(--accent-bright)]"
                          disabled={togglingId === source.id}
                          onClick={() => void handleToggleActive(source)}
                          type="button"
                        >
                          {togglingId === source.id
                            ? "..."
                            : source.isActive
                              ? "Pause"
                              : "Resume"}
                        </button>
                        <button
                          className="inline-flex h-7 items-center rounded-lg border border-[rgba(191,91,70,0.22)] bg-[rgba(191,91,70,0.12)] px-2.5 text-xs text-[var(--error)] transition hover:border-[rgba(191,91,70,0.3)] hover:bg-[rgba(191,91,70,0.18)]"
                          onClick={() => setConfirmDeleteSource(source)}
                          type="button"
                        >
                          Delete
                        </button>
                      </div>

                      {/* Expand indicator */}
                      <span className="shrink-0 text-xs text-[var(--foreground-tertiary)]">
                        {isExpanded ? "▲" : "▼"}
                      </span>
                    </div>

                    {/* Sync result toast */}
                    {syncResult?.id === source.id ? (
                      <div className="border-t border-[var(--border)] px-5 py-2 text-xs text-[var(--foreground-secondary)]">
                        {syncResult.msg}
                      </div>
                    ) : null}

                    {/* Expanded detail section */}
                    {isExpanded ? (
                      <div className="border-t border-[var(--border)] px-5 pb-5 pt-4">
                        <div className="grid gap-6 lg:grid-cols-2">
                          {/* Left: channel info + keywords */}
                          <div className="space-y-4">
                            {/* Channel stats */}
                            <div className="flex flex-wrap gap-4 text-xs">
                              {subscriberCount != null ? (
                                <div>
                                  <span className="font-semibold text-[var(--foreground)]">{formatCount(subscriberCount)}</span>
                                  <span className="ml-1 text-[var(--foreground-tertiary)]">subscribers</span>
                                </div>
                              ) : null}
                              {videoCount != null ? (
                                <div>
                                  <span className="font-semibold text-[var(--foreground)]">{formatCount(videoCount)}</span>
                                  <span className="ml-1 text-[var(--foreground-tertiary)]">videos</span>
                                </div>
                              ) : null}
                              {viewCount != null ? (
                                <div>
                                  <span className="font-semibold text-[var(--foreground)]">{formatCount(viewCount)}</span>
                                  <span className="ml-1 text-[var(--foreground-tertiary)]">total views</span>
                                </div>
                              ) : null}
                              {maxResults != null ? (
                                <div>
                                  <span className="font-semibold text-[var(--foreground)]">{maxResults}</span>
                                  <span className="ml-1 text-[var(--foreground-tertiary)]">max/sync</span>
                                </div>
                              ) : null}
                              <div>
                                <span className="text-[var(--foreground-tertiary)]">
                                  Synced{" "}
                                  {source.syncCursor
                                    ? new Date(source.syncCursor).toLocaleDateString()
                                    : "never"}
                                </span>
                              </div>
                            </div>

                            {/* Analytics for selected range */}
                            {analytics ? (
                              <div>
                                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                                  Activity ({analyticsRange})
                                </p>
                                <div className="mt-2 flex gap-6 text-xs">
                                  <div>
                                    <span className="font-semibold text-[var(--foreground)]">{analytics.jobsCreated}</span>
                                    <DeltaBadge current={analytics.jobsCreated} previous={analytics.prevJobsCreated} />
                                    <span className="ml-1 text-[var(--foreground-tertiary)]">discovered</span>
                                  </div>
                                  <div>
                                    <span className="font-semibold text-[var(--foreground)]">{analytics.jobsCompleted}</span>
                                    <DeltaBadge current={analytics.jobsCompleted} previous={analytics.prevJobsCompleted} />
                                    <span className="ml-1 text-[var(--foreground-tertiary)]">completed</span>
                                  </div>
                                  <div>
                                    <span className={`font-semibold ${analytics.jobsFailed > 0 ? "text-[var(--error)]" : "text-[var(--foreground)]"}`}>
                                      {analytics.jobsFailed}
                                    </span>
                                    <DeltaBadge current={analytics.jobsFailed} previous={analytics.prevJobsFailed} />
                                    <span className="ml-1 text-[var(--foreground-tertiary)]">failed</span>
                                  </div>
                                </div>
                              </div>
                            ) : null}

                            {/* Keywords */}
                            {keywords.length > 0 ? (
                              <div>
                                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                                  Keywords
                                </p>
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                  {keywords.slice(0, 10).map((kw) => (
                                    <span
                                      key={kw}
                                      className="rounded-full border border-[var(--border)] bg-[rgba(255,255,255,0.04)] px-2 py-0.5 text-[10px] text-[var(--foreground-tertiary)]"
                                    >
                                      {kw}
                                    </span>
                                  ))}
                                  {keywords.length > 10 ? (
                                    <span className="px-1 py-0.5 text-[10px] text-[var(--foreground-tertiary)]">
                                      +{keywords.length - 10}
                                    </span>
                                  ) : null}
                                </div>
                              </div>
                            ) : null}
                          </div>

                          {/* Right: recent videos */}
                          <div>
                            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                              Recent videos
                            </p>
                            {videos && videos.videos.length > 0 ? (
                              <div className="mt-2 space-y-2">
                                {videos.videos.map((video) => (
                                  <a
                                    key={video.videoId}
                                    href={`https://www.youtube.com/watch?v=${video.videoId}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex gap-3 rounded-[14px] border border-[var(--border)] bg-white/56 p-2 transition hover:border-[var(--border-strong)] hover:bg-white/72"
                                  >
                                    {video.thumbnailUrl ? (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img
                                        src={video.thumbnailUrl}
                                        alt=""
                                        className="h-16 w-28 shrink-0 rounded-[8px] object-cover"
                                      />
                                    ) : (
                                      <div className="flex h-16 w-28 shrink-0 items-center justify-center rounded-[8px] bg-white/72">
                                        <span className="text-xs text-[var(--foreground-tertiary)]">No thumb</span>
                                      </div>
                                    )}
                                    <div className="min-w-0 flex-1">
                                      <p className="line-clamp-2 text-sm leading-tight text-[var(--foreground)]">
                                        {video.title}
                                      </p>
                                      <div className="mt-1 flex gap-3 text-[10px] text-[var(--foreground-tertiary)]">
                                        {video.viewCount != null ? (
                                          <span>{formatCount(video.viewCount)} views</span>
                                        ) : null}
                                        {video.durationSeconds != null ? (
                                          <span>{formatDuration(video.durationSeconds)}</span>
                                        ) : null}
                                        {video.publishedAt ? (
                                          <span>{new Date(video.publishedAt).toLocaleDateString()}</span>
                                        ) : null}
                                      </div>
                                    </div>
                                  </a>
                                ))}
                              </div>
                            ) : (
                              <p className="mt-2 text-xs text-[var(--foreground-tertiary)]">
                                No videos indexed yet.
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}

              {/* Pagination */}
              {sources.length > PAGE_SIZE ? (
                <div className="flex items-center justify-between pt-2">
                  <p className="text-xs text-[var(--foreground-tertiary)]">
                    Showing {currentPage * PAGE_SIZE + 1}–{Math.min((currentPage + 1) * PAGE_SIZE, sources.length)} of {sources.length}
                  </p>
                  <div className="flex gap-2">
                    <button
                      className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs text-[var(--foreground-secondary)] transition hover:bg-white hover:text-[var(--foreground)] disabled:opacity-30"
                      type="button"
                      disabled={currentPage === 0}
                      onClick={() => setCurrentPage((p) => p - 1)}
                    >
                      Previous
                    </button>
                    <button
                      className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs text-[var(--foreground-secondary)] transition hover:bg-white hover:text-[var(--foreground)] disabled:opacity-30"
                      type="button"
                      disabled={(currentPage + 1) * PAGE_SIZE >= sources.length}
                      onClick={() => setCurrentPage((p) => p + 1)}
                    >
                      Next
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </article>
      </section>
    </AdminLayout>
  );
}
