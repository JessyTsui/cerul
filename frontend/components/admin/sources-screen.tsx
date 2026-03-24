"use client";

import { useCallback, useEffect, useState } from "react";
import {
  admin,
  type AdminSource,
  type AdminSourceAnalytics,
  type AdminSourceRecentVideosEntry,
  type CreateSourceInput,
  type SourceAnalyticsRange,
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

/**
 * Extract YouTube channel ID from various URL formats.
 * Supports: /channel/UC..., /@handle, /c/name, /user/name
 */
function extractChannelInfo(input: string): { type: "id" | "url"; value: string } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Already a channel ID (starts with UC and ~24 chars)
  if (/^UC[\w-]{20,}$/.test(trimmed)) {
    return { type: "id", value: trimmed };
  }

  try {
    const url = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
    if (!url.hostname.includes("youtube.com")) return null;

    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] === "channel" && parts[1]) {
      return { type: "id", value: parts[1] };
    }
    // For @handle, /c/name, /user/name — return the URL for display
    if (parts[0]?.startsWith("@") || parts[0] === "c" || parts[0] === "user") {
      return { type: "url", value: trimmed };
    }
  } catch {
    // not a URL
  }

  return null;
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

  // Quick-add by URL
  const [quickAddUrl, setQuickAddUrl] = useState("");
  const [quickAddError, setQuickAddError] = useState<string | null>(null);

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

  useEffect(() => {
    void loadAnalytics(analyticsRange);
  }, [analyticsRange, loadAnalytics]);

  function openCreateForm() {
    setForm(emptyForm);
    setEditingId(null);
    setShowForm(true);
    setActionError(null);
  }

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

  async function handleQuickAdd() {
    const info = extractChannelInfo(quickAddUrl);
    if (!info) {
      setQuickAddError(
        "Please enter a valid YouTube channel URL or channel ID (e.g. https://www.youtube.com/channel/UC... or https://www.youtube.com/@handle)",
      );
      return;
    }

    if (info.type === "url") {
      setQuickAddError(
        "Please use the channel ID format (UC...). You can find it in the channel's URL under /channel/UC...",
      );
      return;
    }

    setQuickAddError(null);
    setForm({
      ...emptyForm,
      channelId: info.value,
    });
    setEditingId(null);
    setShowForm(true);
    setQuickAddUrl("");
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

  function getAnalyticsForSource(sourceId: string): AdminSourceAnalytics | null {
    return analyticsData.find((a) => a.sourceId === sourceId) ?? null;
  }

  function getRecentVideosForSource(sourceId: string): AdminSourceRecentVideosEntry | null {
    return recentVideos.find((r) => r.sourceId === sourceId) ?? null;
  }

  const activeCount = sources.filter((s) => s.isActive).length;

  const inputClassName =
    "h-12 w-full rounded-[14px] border border-[var(--border)] bg-[var(--surface)] px-4 text-white outline-none transition focus:border-[var(--brand)]";
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
              void loadSources();
              void loadAnalytics(analyticsRange);
              void loadRecentVideos();
            }}
            type="button"
          >
            Refresh
          </button>
          <button className="button-primary" onClick={openCreateForm} type="button">
            Add source
          </button>
        </>
      }
    >
      {actionError ? (
        <div className="rounded-[18px] border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
          {actionError}
        </div>
      ) : null}

      {/* Delete confirmation modal */}
      {confirmDeleteSource ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="surface-elevated mx-4 w-full max-w-md rounded-[24px] px-6 py-6">
            <p className="text-lg font-semibold text-white">Delete source</p>
            <p className="mt-2 text-sm text-[var(--foreground-secondary)]">
              Are you sure you want to delete{" "}
              <strong className="text-white">{confirmDeleteSource.displayName}</strong>?
              This will stop all future video discovery from this channel.
              Existing indexed videos will not be removed.
            </p>
            <div className="mt-6 flex gap-3">
              <button
                className="rounded-[14px] border border-red-500/50 bg-red-500/20 px-4 py-2 text-sm text-red-200 transition hover:bg-red-500/30"
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

      {/* Quick-add by URL */}
      <section>
        <article className="surface rounded-[28px] px-6 py-5">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
            Quick add channel
          </p>
          <div className="mt-3 flex gap-3">
            <input
              type="text"
              value={quickAddUrl}
              onChange={(e) => {
                setQuickAddUrl(e.target.value);
                setQuickAddError(null);
              }}
              placeholder="Paste YouTube channel URL or channel ID..."
              className="h-12 flex-1 rounded-[14px] border border-[var(--border)] bg-[var(--surface)] px-4 text-white outline-none transition focus:border-[var(--brand)]"
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleQuickAdd();
              }}
            />
            <button
              className="button-primary shrink-0"
              type="button"
              onClick={() => void handleQuickAdd()}
            >
              Add
            </button>
          </div>
          {quickAddError ? (
            <p className="mt-2 text-xs text-red-300">{quickAddError}</p>
          ) : null}
        </article>
      </section>

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
                  className="w-full rounded-[14px] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-white outline-none transition focus:border-[var(--brand)]"
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
        <article className="surface rounded-[28px] px-6 py-5">
          <div className="flex items-center justify-between">
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
              Content sources
            </p>
            <div className="flex items-center gap-3">
              {/* Range selector */}
              <div className="flex rounded-full border border-[var(--border)] bg-[rgba(255,255,255,0.02)]">
                {RANGE_OPTIONS.map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setAnalyticsRange(opt.key)}
                    className={`px-3 py-1 text-xs transition ${
                      analyticsRange === opt.key
                        ? "bg-[var(--brand)] text-black rounded-full font-medium"
                        : "text-[var(--foreground-tertiary)] hover:text-white"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <span className="inline-flex items-center rounded-full border border-[var(--border)] bg-[rgba(255,255,255,0.04)] px-3 py-1 text-xs text-[var(--foreground-secondary)]">
                {sources.length} total
              </span>
              <span className="inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-300">
                {activeCount} active
              </span>
            </div>
          </div>

          {isLoading && sources.length === 0 ? (
            <div className="mt-6 flex justify-center py-12">
              <p className="text-sm text-[var(--foreground-tertiary)]">Loading sources...</p>
            </div>
          ) : error ? (
            <div className="mt-4 rounded-[18px] border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
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
              {sources.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE).map((source) => {
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
                    className="rounded-[20px] border border-[var(--border)] bg-[rgba(255,255,255,0.02)] transition hover:border-[var(--foreground-tertiary)]"
                  >
                    {/* Main row — always visible */}
                    <div
                      className="flex cursor-pointer items-center gap-4 p-5"
                      onClick={() => setExpandedId(isExpanded ? null : source.id)}
                    >
                      <ChannelAvatar url={thumbnailUrl} name={source.displayName} />

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate font-semibold text-white">
                            {source.displayName}
                          </p>
                          <span
                            className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] ${
                              source.isActive
                                ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                                : "border border-[var(--border)] bg-[rgba(255,255,255,0.04)] text-[var(--foreground-tertiary)]"
                            }`}
                          >
                            {source.isActive ? "Active" : "Paused"}
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs text-[var(--foreground-tertiary)]">
                          {source.slug}
                          {description ? ` · ${description.slice(0, 80)}${description.length > 80 ? "..." : ""}` : ""}
                        </p>
                      </div>

                      {/* Inline stats: subs, videos, views + analytics delta */}
                      <div className="hidden shrink-0 gap-5 text-xs lg:flex">
                        <div>
                          <span className="font-semibold text-white">{formatCount(subscriberCount)}</span>
                          <span className="ml-1 text-[var(--foreground-tertiary)]">subs</span>
                        </div>
                        <div>
                          <span className="font-semibold text-white">{formatCount(videoCount)}</span>
                          <span className="ml-1 text-[var(--foreground-tertiary)]">videos</span>
                        </div>
                        <div>
                          <span className="font-semibold text-white">{formatCount(viewCount)}</span>
                          <span className="ml-1 text-[var(--foreground-tertiary)]">views</span>
                        </div>
                        {analytics ? (
                          <div className="border-l border-[var(--border)] pl-5">
                            <span className="font-semibold text-white">{analytics.jobsCompleted}</span>
                            <DeltaBadge current={analytics.jobsCompleted} previous={analytics.prevJobsCompleted} />
                            <span className="ml-1 text-[var(--foreground-tertiary)]">indexed</span>
                            {analytics.jobsFailed > 0 ? (
                              <>
                                <span className="ml-3 font-semibold text-red-300">{analytics.jobsFailed}</span>
                                <span className="ml-1 text-[var(--foreground-tertiary)]">failed</span>
                              </>
                            ) : null}
                          </div>
                        ) : null}
                      </div>

                      {/* Inline tags (first 3) */}
                      {keywords.length > 0 ? (
                        <div className="hidden shrink-0 gap-1.5 xl:flex">
                          {keywords.slice(0, 3).map((kw) => (
                            <span
                              key={kw}
                              className="rounded-full border border-[var(--border)] bg-[rgba(255,255,255,0.04)] px-2 py-0.5 text-[10px] text-[var(--foreground-tertiary)]"
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

                      {/* Actions */}
                      <div className="flex shrink-0 items-center gap-2" onClick={(e) => e.stopPropagation()}>
                        {channelId ? (
                          <a
                            href={getChannelUrl(channelId)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex h-7 items-center rounded-lg border border-[var(--border)] px-2.5 text-xs text-[var(--foreground-secondary)] transition hover:border-[var(--brand)] hover:text-white"
                          >
                            YouTube
                          </a>
                        ) : null}
                        <button
                          className="inline-flex h-7 items-center rounded-lg border border-[var(--border)] px-2.5 text-xs text-[var(--foreground-secondary)] transition hover:border-[var(--brand)] hover:text-white"
                          onClick={() => openEditForm(source)}
                          type="button"
                        >
                          Edit
                        </button>
                        <button
                          className="inline-flex h-7 items-center rounded-lg border border-[var(--border)] px-2.5 text-xs text-[var(--foreground-secondary)] transition hover:border-amber-500 hover:text-amber-300"
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
                          className="inline-flex h-7 items-center rounded-lg border border-red-500/40 bg-red-500/10 px-2.5 text-xs text-red-300 transition hover:border-red-500 hover:bg-red-500/20"
                          onClick={() => setConfirmDeleteSource(source)}
                          type="button"
                        >
                          Delete
                        </button>
                      </div>

                      {/* Expand indicator */}
                      <span className="text-xs text-[var(--foreground-tertiary)]">
                        {isExpanded ? "▲" : "▼"}
                      </span>
                    </div>

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
                                  <span className="font-semibold text-white">{formatCount(subscriberCount)}</span>
                                  <span className="ml-1 text-[var(--foreground-tertiary)]">subscribers</span>
                                </div>
                              ) : null}
                              {videoCount != null ? (
                                <div>
                                  <span className="font-semibold text-white">{formatCount(videoCount)}</span>
                                  <span className="ml-1 text-[var(--foreground-tertiary)]">videos</span>
                                </div>
                              ) : null}
                              {viewCount != null ? (
                                <div>
                                  <span className="font-semibold text-white">{formatCount(viewCount)}</span>
                                  <span className="ml-1 text-[var(--foreground-tertiary)]">total views</span>
                                </div>
                              ) : null}
                              {maxResults != null ? (
                                <div>
                                  <span className="font-semibold text-white">{maxResults}</span>
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
                                    <span className="font-semibold text-white">{analytics.jobsCreated}</span>
                                    <DeltaBadge current={analytics.jobsCreated} previous={analytics.prevJobsCreated} />
                                    <span className="ml-1 text-[var(--foreground-tertiary)]">discovered</span>
                                  </div>
                                  <div>
                                    <span className="font-semibold text-white">{analytics.jobsCompleted}</span>
                                    <DeltaBadge current={analytics.jobsCompleted} previous={analytics.prevJobsCompleted} />
                                    <span className="ml-1 text-[var(--foreground-tertiary)]">completed</span>
                                  </div>
                                  <div>
                                    <span className={`font-semibold ${analytics.jobsFailed > 0 ? "text-red-300" : "text-white"}`}>
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
                                    className="flex gap-3 rounded-[12px] border border-[var(--border)] bg-[rgba(255,255,255,0.02)] p-2 transition hover:border-[var(--foreground-tertiary)]"
                                  >
                                    {video.thumbnailUrl ? (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img
                                        src={video.thumbnailUrl}
                                        alt=""
                                        className="h-16 w-28 shrink-0 rounded-[8px] object-cover"
                                      />
                                    ) : (
                                      <div className="flex h-16 w-28 shrink-0 items-center justify-center rounded-[8px] bg-[rgba(255,255,255,0.06)]">
                                        <span className="text-xs text-[var(--foreground-tertiary)]">No thumb</span>
                                      </div>
                                    )}
                                    <div className="min-w-0 flex-1">
                                      <p className="line-clamp-2 text-sm leading-tight text-white">
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
                      className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs text-[var(--foreground-secondary)] transition hover:text-white disabled:opacity-30"
                      type="button"
                      disabled={currentPage === 0}
                      onClick={() => setCurrentPage((p) => p - 1)}
                    >
                      Previous
                    </button>
                    <button
                      className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs text-[var(--foreground-secondary)] transition hover:text-white disabled:opacity-30"
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
