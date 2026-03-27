import type { AppConfig, Bindings, ResolvedQueryImage } from "../types";
import { sha256Hex } from "../utils/crypto";

const ALLOWED_MIME_TYPES: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp"
};
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;

function normalizeContentType(value: string | null | undefined): string {
  return (value ?? "").split(";", 1)[0].trim().toLowerCase();
}

function validateImageSize(bytes: Uint8Array): void {
  if (bytes.byteLength > MAX_IMAGE_SIZE_BYTES) {
    throw new Error(`Image too large: ${bytes.byteLength} bytes (max ${MAX_IMAGE_SIZE_BYTES})`);
  }
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function buildResolvedImage(bytes: Uint8Array, mimeType: string): ResolvedQueryImage {
  if (!(mimeType in ALLOWED_MIME_TYPES)) {
    throw new Error(`Unsupported image type: ${mimeType || "unknown"}`);
  }
  validateImageSize(bytes);
  return {
    bytes,
    mimeType,
    extension: ALLOWED_MIME_TYPES[mimeType]
  };
}

async function downloadImage(url: string): Promise<ResolvedQueryImage> {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.status}`);
  }

  const contentType = normalizeContentType(response.headers.get("content-type"));
  const contentLength = Number.parseInt(response.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_SIZE_BYTES) {
    throw new Error(`Image too large: ${contentLength} bytes (max ${MAX_IMAGE_SIZE_BYTES})`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  return buildResolvedImage(bytes, contentType);
}

function decodeBase64Image(base64Value: string): ResolvedQueryImage {
  let mimeType = "image/jpeg";
  let payload = base64Value.trim();

  if (payload.startsWith("data:")) {
    const [header, body = ""] = payload.split(",", 2);
    if (!body) {
      throw new Error("Invalid data URI image payload.");
    }
    mimeType = normalizeContentType(header.replace("data:", "").split(";", 1)[0]);
    payload = body;
  }

  try {
    return buildResolvedImage(base64ToBytes(payload), mimeType);
  } catch {
    throw new Error("Invalid base64 image payload.");
  }
}

function resolveBytesImage(fileBytes: Uint8Array, contentType: string | null | undefined): ResolvedQueryImage {
  return buildResolvedImage(fileBytes, normalizeContentType(contentType) || "image/jpeg");
}

export async function resolveImageToBytes(input: {
  url?: string | null;
  base64?: string | null;
  fileBytes?: Uint8Array | null;
  fileContentType?: string | null;
}): Promise<ResolvedQueryImage> {
  if (input.url) {
    return downloadImage(input.url);
  }
  if (input.base64) {
    return decodeBase64Image(input.base64);
  }
  if (input.fileBytes) {
    return resolveBytesImage(input.fileBytes, input.fileContentType);
  }
  throw new Error("No image input provided.");
}

export async function uploadQueryImageToR2(
  env: Bindings,
  config: AppConfig,
  image: ResolvedQueryImage,
  requestId: string
): Promise<string | null> {
  const bucket = env.QUERY_IMAGES_BUCKET;
  if (!bucket) {
    return null;
  }

  const sha256 = await sha256Hex(image.bytes);
  const currentDate = new Date().toISOString().slice(0, 10);
  const key = `query-inputs/${currentDate}/${requestId}/${sha256}${image.extension}`;
  await bucket.put(key, image.bytes, {
    httpMetadata: {
      contentType: image.mimeType,
      cacheControl: "private, max-age=0, no-store"
    }
  });
  return key;
}
