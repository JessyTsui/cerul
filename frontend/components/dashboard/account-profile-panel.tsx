"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import Cropper from "react-easy-crop";
import type { Area } from "react-easy-crop";
import { fetchWithAuth } from "@/lib/api";
import { authClient } from "@/lib/auth";
import {
  useConsoleViewer,
  useConsoleViewerActions,
} from "@/components/console/console-viewer-context";

const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

function getInitials(displayName: string | null, email: string | null): string {
  if (displayName) {
    return displayName
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0] ?? "")
      .join("")
      .toUpperCase();
  }

  if (email) {
    return email[0]?.toUpperCase() ?? "U";
  }

  return "U";
}

function createImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image));
    image.addEventListener("error", (error) => reject(error));
    image.crossOrigin = "anonymous";
    image.src = url;
  });
}

async function getCroppedBlob(
  imageSrc: string,
  cropArea: Area,
  outputSize = 256,
): Promise<Blob> {
  const image = await createImage(imageSrc);
  const canvas = document.createElement("canvas");
  canvas.width = outputSize;
  canvas.height = outputSize;
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Canvas context unavailable.");
  }

  context.drawImage(
    image,
    cropArea.x,
    cropArea.y,
    cropArea.width,
    cropArea.height,
    0,
    0,
    outputSize,
    outputSize,
  );

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Crop failed."))),
      "image/jpeg",
      0.9,
    );
  });
}

export function AccountProfilePanel() {
  const viewer = useConsoleViewer();
  const { updateViewer } = useConsoleViewerActions();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(viewer.displayName ?? "");
  const [avatarPreview, setAvatarPreview] = useState<string | null>(viewer.image);
  const [pendingAvatarUrl, setPendingAvatarUrl] = useState<string | null>(null);
  const [rawImage, setRawImage] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedArea, setCroppedArea] = useState<Area | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    setName(viewer.displayName ?? "");
    setAvatarPreview(viewer.image);
    setPendingAvatarUrl(null);
  }, [viewer.displayName, viewer.image]);

  function onCropComplete(_: Area, croppedAreaPixels: Area) {
    setCroppedArea(croppedAreaPixels);
  }

  function handleFileSelect(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setError(null);
    setSuccess(null);

    const mimeType = (file.type || "").split(";")[0].trim().toLowerCase();
    if (!ALLOWED_IMAGE_TYPES.has(mimeType)) {
      setError("Use JPEG, PNG, or WebP for avatar uploads.");
      return;
    }

    if (file.size > MAX_AVATAR_BYTES) {
      setError("Avatar must be 2MB or smaller.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setRawImage(reader.result as string);
      setCrop({ x: 0, y: 0 });
      setZoom(1);
    };
    reader.readAsDataURL(file);
  }

  async function handleCropConfirm() {
    if (!rawImage || !croppedArea) {
      return;
    }

    setUploading(true);
    setError(null);
    setSuccess(null);

    try {
      const blob = await getCroppedBlob(rawImage, croppedArea, 256);
      const formData = new FormData();
      formData.append("file", blob, "avatar.jpg");

      const result = await fetchWithAuth<{ url: string }>("/dashboard/user/avatar", {
        method: "POST",
        body: formData,
      });

      setPendingAvatarUrl(result.url);
      setAvatarPreview(result.url);
      setRawImage(null);
      setSuccess("Avatar uploaded. Save changes to apply it to your account.");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to upload avatar.");
    } finally {
      setUploading(false);
    }
  }

  async function handleSave() {
    const trimmedName = name.trim();
    const nextName = trimmedName || viewer.displayName || "";
    const hasNameChange = Boolean(trimmedName && trimmedName !== (viewer.displayName ?? ""));
    const hasAvatarChange = pendingAvatarUrl !== null && pendingAvatarUrl !== viewer.image;

    if (!hasNameChange && !hasAvatarChange) {
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const updates: { name?: string; image?: string } = {};

      if (hasNameChange) {
        updates.name = nextName;
      }

      if (hasAvatarChange && pendingAvatarUrl) {
        updates.image = pendingAvatarUrl;
      }

      const result = await authClient.updateUser(updates);
      if (result.error) {
        throw result.error;
      }

      updateViewer({
        displayName: updates.name ?? viewer.displayName,
        image: updates.image ?? viewer.image,
      });

      setPendingAvatarUrl(null);
      setSuccess("Profile updated.");
      router.refresh();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to update profile.");
    } finally {
      setSaving(false);
    }
  }

  const trimmedName = name.trim();
  const hasPendingChanges =
    (Boolean(trimmedName) && trimmedName !== (viewer.displayName ?? ""))
    || (pendingAvatarUrl !== null && pendingAvatarUrl !== viewer.image);
  const initials = getInitials(trimmedName || viewer.displayName, viewer.email);

  return (
    <article
      id="account"
      className="surface-elevated scroll-mt-28 rounded-[32px] px-6 py-6"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--brand-bright)]">
            Account
          </p>
          <h2 className="mt-3 text-2xl font-semibold text-[var(--foreground)]">
            Profile settings
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-7 text-[var(--foreground-secondary)]">
            Keep the editable account surface simple: one avatar, one display name, one obvious save action.
          </p>
        </div>
        <span className="inline-flex rounded-full border border-[var(--border)] bg-white/72 px-3 py-1.5 text-xs text-[var(--foreground-secondary)]">
          {viewer.isAdmin ? "Admin access enabled" : "Standard workspace"}
        </span>
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
        <div className="rounded-[24px] border border-[var(--border)] bg-[var(--background-elevated)] px-5 py-5">
          {rawImage ? (
            <>
              <div className="relative mx-auto h-64 overflow-hidden rounded-[22px] bg-[#111827]">
                <Cropper
                  image={rawImage}
                  crop={crop}
                  zoom={zoom}
                  aspect={1}
                  cropShape="round"
                  showGrid={false}
                  onCropChange={setCrop}
                  onZoomChange={setZoom}
                  onCropComplete={onCropComplete}
                />
              </div>
              <div className="mt-4 flex items-center gap-3">
                <span className="text-xs uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                  Zoom
                </span>
                <input
                  type="range"
                  min={1}
                  max={3}
                  step={0.05}
                  value={zoom}
                  onChange={(event) => setZoom(Number(event.target.value))}
                  className="flex-1 accent-[var(--brand-bright)]"
                />
              </div>
              <div className="mt-4 flex gap-3">
                <button
                  type="button"
                  onClick={() => setRawImage(null)}
                  className="button-secondary"
                >
                  Cancel crop
                </button>
                <button
                  type="button"
                  onClick={() => void handleCropConfirm()}
                  disabled={uploading}
                  className="button-primary"
                >
                  {uploading ? "Uploading..." : "Confirm crop"}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-4">
                <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--border)] bg-white/80">
                  {avatarPreview ? (
                    <div
                      aria-hidden="true"
                      className="h-full w-full bg-cover bg-center"
                      style={{ backgroundImage: `url("${avatarPreview}")` }}
                    />
                  ) : (
                    <span className="text-2xl font-semibold text-[var(--foreground-secondary)]">
                      {initials}
                    </span>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-lg font-semibold text-[var(--foreground)]">
                    {trimmedName || viewer.displayName || "Unnamed user"}
                  </p>
                  <p className="mt-1 truncate text-sm text-[var(--foreground-secondary)]">
                    {viewer.email ?? "No email on file"}
                  </p>
                </div>
              </div>

              <div className="mt-5 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="button-secondary"
                >
                  Change avatar
                </button>
                <span className="inline-flex items-center rounded-full border border-[var(--border)] bg-white/72 px-3 py-2 text-xs text-[var(--foreground-tertiary)]">
                  JPEG, PNG, or WebP up to 2MB
                </span>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={handleFileSelect}
              />
            </>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-[24px] border border-[var(--border)] bg-[var(--background-elevated)] px-5 py-5">
            <label className="text-xs uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
              Display name
            </label>
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Your name"
              className="mt-3 h-12 w-full rounded-[18px] border border-[var(--border)] bg-white/82 px-4 text-sm text-[var(--foreground)] outline-none transition placeholder:text-[var(--foreground-tertiary)] focus:border-[var(--border-brand)]"
            />
          </div>

          <div className="rounded-[24px] border border-[var(--border)] bg-[var(--background-elevated)] px-5 py-5">
            <label className="text-xs uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
              Email
            </label>
            <div className="mt-3 rounded-[18px] border border-[var(--border)] bg-white/72 px-4 py-3 text-sm text-[var(--foreground-secondary)]">
              {viewer.email ?? "No email on file"}
            </div>
          </div>

          {error ? (
            <div className="rounded-[20px] border border-[rgba(191,91,70,0.2)] bg-[rgba(191,91,70,0.08)] px-4 py-3 text-sm text-[var(--error)]">
              {error}
            </div>
          ) : null}

          {success ? (
            <div className="rounded-[20px] border border-[rgba(31,141,74,0.18)] bg-[rgba(31,141,74,0.08)] px-4 py-3 text-sm text-[var(--success)]">
              {success}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={!hasPendingChanges || saving || uploading || rawImage !== null}
              className="button-primary"
            >
              {saving ? "Saving..." : "Save changes"}
            </button>
            <button
              type="button"
              onClick={() => {
                setName(viewer.displayName ?? "");
                setAvatarPreview(viewer.image);
                setPendingAvatarUrl(null);
                setRawImage(null);
                setError(null);
                setSuccess(null);
              }}
              disabled={saving || uploading}
              className="button-secondary"
            >
              Reset
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}
