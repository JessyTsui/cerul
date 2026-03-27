import { apiError } from "./http";

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asString(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized || null;
}

export function parseBoolean(value: unknown, fieldName: string, fallback: boolean): boolean {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  if (typeof value === "boolean") {
    return value;
  }
  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "off"].includes(normalized)) {
    return false;
  }
  apiError(400, `${fieldName} must be a boolean.`);
}

export function parseInteger(value: unknown, fieldName: string, fallback: number): number {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const parsed = Number.parseInt(String(value).trim(), 10);
  if (!Number.isFinite(parsed)) {
    apiError(400, `${fieldName} must be an integer.`);
  }
  return parsed;
}

export function ensureJsonObject(value: unknown, message: string): Record<string, unknown> {
  if (!isPlainObject(value)) {
    apiError(400, message);
  }
  return value;
}

export function parseDateString(value: unknown, fieldName: string): string | null {
  const normalized = asString(value);
  if (normalized == null) {
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    apiError(400, `${fieldName} must be a valid date.`);
  }
  return normalized;
}
