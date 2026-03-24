"use client";

import { useCallback, useEffect, useState } from "react";
import { admin, type AdminSource, type CreateSourceInput } from "@/lib/admin-api";
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

function ChannelAvatar({ url, name }: { url: string; name: string }) {
  const [failed, setFailed] = useState(false);
  const letter = name.charAt(0).toUpperCase();

  if (!url || failed) {
    return (
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[rgba(255,255,255,0.06)] text-base font-semibold text-[var(--foreground-tertiary)]">
        {letter}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={name}
      className="h-12 w-12 shrink-0 rounded-full border border-[var(--border)] object-cover"
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
  const [togglingId, setTogglingId] = useState<string | null>(null);

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

  useEffect(() => {
    void loadSources();
  }, [loadSources]);

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
      await loadSources();
    } catch (err) {
      setActionError(getApiErrorMessage(err, "Failed to delete source."));
    } finally {
      setDeletingId(null);
    }
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
            onClick={() => void loadSources()}
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
                <span className={labelClassName}>
                  Channel avatar URL
                </span>
                <input
                  type="url"
                  value={form.thumbnailUrl}
                  onChange={(e) => updateField("thumbnailUrl", e.target.value)}
                  placeholder="https://yt3.ggpht.com/..."
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
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={form.thumbnailUrl.trim()}
                  alt="Channel avatar preview"
                  className="h-10 w-10 rounded-full border border-[var(--border)] object-cover"
                />
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
              <button
                className="button-secondary"
                type="button"
                onClick={closeForm}
              >
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
            <div className="flex gap-3">
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
            <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {sources.map((source) => {
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

                return (
                  <div
                    key={source.id}
                    className="group relative rounded-[20px] border border-[var(--border)] bg-[rgba(255,255,255,0.02)] p-5 transition hover:border-[var(--foreground-tertiary)]"
                  >
                    <div className="flex items-start gap-4">
                      <ChannelAvatar
                        url={thumbnailUrl}
                        name={source.displayName}
                      />

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
                        </p>
                      </div>
                    </div>

                    {description ? (
                      <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-[var(--foreground-secondary)]">
                        {description}
                      </p>
                    ) : null}

                    {keywords.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {keywords.slice(0, 6).map((kw) => (
                          <span
                            key={kw}
                            className="rounded-full border border-[var(--border)] bg-[rgba(255,255,255,0.04)] px-2 py-0.5 text-[10px] text-[var(--foreground-tertiary)]"
                          >
                            {kw}
                          </span>
                        ))}
                        {keywords.length > 6 ? (
                          <span className="px-1 py-0.5 text-[10px] text-[var(--foreground-tertiary)]">
                            +{keywords.length - 6}
                          </span>
                        ) : null}
                      </div>
                    ) : null}

                    {(subscriberCount != null || videoCount != null || viewCount != null) ? (
                      <div className="mt-3 flex gap-4 text-xs">
                        {subscriberCount != null ? (
                          <div>
                            <span className="font-semibold text-white">{formatCount(subscriberCount)}</span>
                            <span className="ml-1 text-[var(--foreground-tertiary)]">subs</span>
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
                            <span className="ml-1 text-[var(--foreground-tertiary)]">views</span>
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--foreground-tertiary)]">
                      {channelId ? (
                        <a
                          href={getChannelUrl(channelId)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 transition hover:text-[var(--brand)]"
                        >
                          <svg
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            className="h-3.5 w-3.5"
                            aria-hidden="true"
                          >
                            <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814Z" />
                            <path d="m9.545 15.568 6.273-3.568-6.273-3.568v7.136Z" fill="var(--surface)" />
                          </svg>
                          YouTube
                        </a>
                      ) : null}
                      {maxResults != null ? (
                        <span>Max {maxResults}/sync</span>
                      ) : null}
                      <span>
                        Synced{" "}
                        {source.syncCursor
                          ? new Date(source.syncCursor).toLocaleDateString()
                          : "never"}
                      </span>
                    </div>

                    <div className="mt-4 flex gap-2 border-t border-[var(--border)] pt-3">
                      <button
                        className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--foreground-secondary)] transition hover:border-[var(--brand)] hover:text-white"
                        onClick={() => openEditForm(source)}
                        type="button"
                      >
                        Edit
                      </button>
                      <button
                        className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--foreground-secondary)] transition hover:border-amber-500 hover:text-amber-300"
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
                        className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--foreground-secondary)] transition hover:border-red-500 hover:text-red-300"
                        disabled={deletingId === source.id}
                        onClick={() => void handleDelete(source)}
                        type="button"
                      >
                        {deletingId === source.id ? "..." : "Delete"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </article>
      </section>
    </AdminLayout>
  );
}
