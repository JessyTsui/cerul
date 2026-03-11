export const DEFAULT_AUTH_REDIRECT_PATH = "/dashboard";

export function normalizeAuthRedirectPath(
  nextPath: string | null | undefined,
): string {
  if (!nextPath) {
    return DEFAULT_AUTH_REDIRECT_PATH;
  }

  const trimmedPath = nextPath.trim();

  if (
    !trimmedPath.startsWith("/") ||
    trimmedPath.startsWith("//") ||
    trimmedPath.includes("\\")
  ) {
    return DEFAULT_AUTH_REDIRECT_PATH;
  }

  return trimmedPath;
}

export function getAuthErrorMessage(
  error: unknown,
  fallback = "Authentication request failed.",
): string {
  if (
    error &&
    typeof error === "object" &&
    "error" in error &&
    error.error &&
    typeof error.error === "object" &&
    "message" in error.error &&
    typeof error.error.message === "string" &&
    error.error.message.trim()
  ) {
    return error.error.message;
  }

  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message.trim()
  ) {
    return error.message;
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
}
