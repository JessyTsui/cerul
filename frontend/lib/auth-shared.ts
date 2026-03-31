export const DEFAULT_AUTH_REDIRECT_PATH = "/dashboard";
export const AUTH_FORM_MODES = ["login", "signup"] as const;
export const AUTH_PAGE_PATHS = ["/login", "/signup"] as const;

export type AuthFormMode = (typeof AUTH_FORM_MODES)[number];

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
  EMAIL_NOT_VERIFIED: "Please verify your email address before signing in.",
  EMAIL_ALREADY_VERIFIED: "That Cerul email address is already verified.",
  INVALID_TOKEN: "This link is invalid or has already been used.",
  TOKEN_EXPIRED: "This link has expired. Please request a new one.",
  unable_to_get_user_info:
    "Cerul could not read your profile from that provider. Please try again.",
  unable_to_link_account:
    "Cerul could not link that social account. Try signing in with your original method first.",
};

type AuthPagePath = (typeof AUTH_PAGE_PATHS)[number];

export function normalizeAuthFormMode(
  mode: string | null | undefined,
): AuthFormMode {
  return mode === "signup" ? "signup" : "login";
}

export function normalizeAuthRedirectPath(
  nextPath: string | null | undefined,
): string {
  if (!nextPath) {
    return DEFAULT_AUTH_REDIRECT_PATH;
  }

  const trimmedPath = nextPath.trim();

  if (
    trimmedPath === "/" ||
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
  const query = new URLSearchParams();

  if (pagePath === "/signup") {
    query.set("mode", "signup");
  }

  if (normalizedNextPath !== DEFAULT_AUTH_REDIRECT_PATH) {
    query.set("next", normalizedNextPath);
  }

  const targetPath = pagePath === "/signup" ? "/login" : pagePath;
  const search = query.toString();

  if (!search) {
    return targetPath;
  }

  return `${targetPath}?${search}`;
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

export function getAuthErrorCode(error: unknown): string | null {
  if (
    error &&
    typeof error === "object" &&
    "error" in error &&
    error.error &&
    typeof error.error === "object" &&
    "code" in error.error &&
    typeof error.error.code === "string" &&
    error.error.code.trim()
  ) {
    return error.error.code.trim();
  }

  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code.trim()
  ) {
    return error.code.trim();
  }

  return null;
}

export function isEmailNotVerifiedError(error: unknown): boolean {
  return getAuthErrorCode(error) === "EMAIL_NOT_VERIFIED";
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
