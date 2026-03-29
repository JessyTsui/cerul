"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Cropper from "react-easy-crop";
import type { Area } from "react-easy-crop";
import { authClient } from "@/lib/auth";
import { fetchWithAuth } from "@/lib/api";
import { useConsoleViewer } from "@/components/console/console-viewer-context";

type ProfileSettingsModalProps = {
  onClose: () => void;
};

function getInitials(displayName: string | null, email: string | null): string {
  if (displayName) {
    return displayName
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase();
  }
  if (email) {
    return email[0]?.toUpperCase() ?? "U";
  }
  return "U";
}

/* ---------- Canvas crop helper ---------- */

function createImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image));
    image.addEventListener("error", (err) => reject(err));
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
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas context unavailable.");

  ctx.drawImage(
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

/* ---------- Modal ---------- */

export function ProfileSettingsModal({ onClose }: ProfileSettingsModalProps) {
  const viewer = useConsoleViewer();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(viewer.displayName ?? "");

  // Crop state
  const [rawImage, setRawImage] = useState<string | null>(null); // data URL of selected file
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedArea, setCroppedArea] = useState<Area | null>(null);

  // Final avatar (after crop + upload)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(viewer.image);
  const [pendingAvatarUrl, setPendingAvatarUrl] = useState<string | null>(null);

  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onCropComplete = useCallback((_: Area, croppedAreaPixels: Area) => {
    setCroppedArea(croppedAreaPixels);
  }, []);

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    const reader = new FileReader();
    reader.onload = () => {
      setRawImage(reader.result as string);
      setCrop({ x: 0, y: 0 });
      setZoom(1);
    };
    reader.readAsDataURL(file);
  }

  async function handleCropConfirm() {
    if (!rawImage || !croppedArea) return;
    setUploading(true);
    setError(null);
    try {
      const blob = await getCroppedBlob(rawImage, croppedArea, 256);
      const formData = new FormData();
      formData.append("file", blob, "avatar.jpg");
      const result = await fetchWithAuth<{ url: string }>("/dashboard/user/avatar", {
        method: "POST",
        body: formData,
      });
      setPendingAvatarUrl(result.url);
      setAvatarPreview(URL.createObjectURL(blob));
      setRawImage(null); // close cropper
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload avatar.");
    } finally {
      setUploading(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const updates: { name?: string; image?: string } = {};
      const trimmedName = name.trim();
      if (trimmedName && trimmedName !== (viewer.displayName ?? "")) {
        updates.name = trimmedName;
      }
      if (pendingAvatarUrl) {
        updates.image = pendingAvatarUrl;
      }
      if (Object.keys(updates).length > 0) {
        await authClient.updateUser(updates);
      }
      router.refresh();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update profile.");
    } finally {
      setSaving(false);
    }
  }

  const initials = getInitials(name || viewer.displayName, viewer.email);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-slate-700 bg-[#111827] shadow-2xl">
        {/* Header */}
        <div className="border-b border-slate-800 px-6 py-4">
          <h2 className="text-lg font-semibold text-white">Profile Settings</h2>
          <p className="mt-1 text-xs text-slate-400">Update your display name and avatar</p>
        </div>

        {/* Body */}
        <div className="space-y-6 px-6 py-6">
          {/* ===== Crop editor ===== */}
          {rawImage ? (
            <div>
              <div className="relative mx-auto h-64 w-full overflow-hidden rounded-xl bg-black">
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
              {/* Zoom slider */}
              <div className="mt-3 flex items-center gap-3">
                <span className="text-xs text-slate-500">Zoom</span>
                <input
                  type="range"
                  min={1}
                  max={3}
                  step={0.05}
                  value={zoom}
                  onChange={(e) => setZoom(Number(e.target.value))}
                  className="flex-1 accent-cyan-500"
                />
              </div>
              {/* Crop actions */}
              <div className="mt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setRawImage(null)}
                  className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleCropConfirm()}
                  disabled={uploading}
                  className="rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-500 disabled:opacity-50"
                >
                  {uploading ? "Uploading..." : "Confirm Crop"}
                </button>
              </div>
            </div>
          ) : (
            /* ===== Avatar preview + change button ===== */
            <div className="flex items-center gap-5">
              <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-slate-600 bg-slate-800">
                {avatarPreview ? (
                  <img src={avatarPreview} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="text-2xl font-semibold text-slate-300">{initials}</span>
                )}
              </div>
              <div>
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-slate-700 hover:text-white"
                >
                  Change Avatar
                </button>
                <p className="mt-1.5 text-[10px] text-slate-500">JPEG, PNG, or WebP. Max 2MB.</p>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={handleFileSelect}
                />
              </div>
            </div>
          )}

          {/* Name */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-400">Display Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              className="w-full rounded-lg border border-slate-700 bg-[#151c2c] px-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500"
            />
          </div>

          {/* Email (read-only) */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-400">Email</label>
            <input
              type="text"
              value={viewer.email ?? ""}
              disabled
              className="w-full rounded-lg border border-slate-700 bg-[#151c2c] px-3 py-2.5 text-sm text-slate-500 opacity-60"
            />
          </div>

          {/* Error */}
          {error ? (
            <p className="rounded-lg bg-red-950/30 px-3 py-2 text-xs text-red-400">{error}</p>
          ) : null}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-slate-800 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-600 bg-transparent px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || uploading || rawImage !== null}
            className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
