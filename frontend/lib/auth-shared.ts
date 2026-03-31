export const DEFAULT_AUTH_REDIRECT_PATH = "/dashboard";
export const AUTH_PAGE_PATHS = ["/login", "/signup"] as const;
const AUTH_CALLBACK_ERROR_MESSAGES: Record<string, string> = {
  account_already_linked_to_different_user:
    "That social account is already linked to a different Cerul user.",
  "email_doesn't_match":
    "That social account uses a different email address than your existing Cerul account.",
  email_not_found:
    "This provider did not return an email address, so Cerul could not complete the sign-in.",
  invalid_code: "The social login request expired. Please try again.",
  no_callback_url: "The social login flow is missing a redirect target. Please try again.",
  oauth_provider_not_found:
    "That social login provider is not available right now. Please try another sign-in method.",
  unable_to_get_user_info:
    "Cerul could not read your profile from that provider. Please try again.",
  unable_to_link_account:
    "Cerul could not link that social account. Try signing in with your original method first.",
};

type AuthPagePath = (typeof AUTH_PAGE_PATHS)[number];

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

export function buildAuthPageHref(
  pagePath: AuthPagePath,
  nextPath: string | null | undefined,
): string {
  const normalizedNextPath = normalizeAuthRedirectPath(nextPath);

  if (normalizedNextPath === DEFAULT_AUTH_REDIRECT_PATH) {
    return pagePath;
  }

  const query = new URLSearchParams({ next: normalizedNextPath });
  return `${pagePath}?${query.toString()}`;
}

export function buildSocialAuthRedirectOptions(
  pagePath: AuthPagePath,
  nextPath: string | null | undefined,
) {
  const callbackURL = normalizeAuthRedirectPath(nextPath);

  return {
    callbackURL,
    newUserCallbackURL: callbackURL,
    errorCallbackURL: buildAuthPageHref(pagePath, callbackURL),
  };
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

export function getAuthCallbackErrorMessage(
  errorCode: string | null | undefined,
  errorDescription?: string | null | undefined,
): string | null {
  const normalizedErrorCode = errorCode?.trim();
  if (normalizedErrorCode && AUTH_CALLBACK_ERROR_MESSAGES[normalizedErrorCode]) {
    return AUTH_CALLBACK_ERROR_MESSAGES[normalizedErrorCode];
  }

  const normalizedDescription = errorDescription?.trim();
  return normalizedDescription || null;
}
