import { describe, expect, it } from "vitest";
import {
  buildAuthPageHref,
  buildSocialAuthRedirectOptions,
  DEFAULT_AUTH_REDIRECT_PATH,
  getAuthCallbackErrorMessage,
  getAuthErrorMessage,
  normalizeAuthRedirectPath,
} from "./auth-shared";

describe("normalizeAuthRedirectPath", () => {
  it("falls back to dashboard for empty input", () => {
    expect(normalizeAuthRedirectPath(undefined)).toBe(
      DEFAULT_AUTH_REDIRECT_PATH,
    );
  });

  it("keeps safe internal paths", () => {
    expect(normalizeAuthRedirectPath("/dashboard/usage")).toBe(
      "/dashboard/usage",
    );
  });

  it("rejects external or malformed targets", () => {
    expect(normalizeAuthRedirectPath("https://evil.example")).toBe(
      DEFAULT_AUTH_REDIRECT_PATH,
    );
    expect(normalizeAuthRedirectPath("//evil.example")).toBe(
      DEFAULT_AUTH_REDIRECT_PATH,
    );
    expect(normalizeAuthRedirectPath("/\\evil.example")).toBe(
      DEFAULT_AUTH_REDIRECT_PATH,
    );
  });
});

describe("getAuthErrorMessage", () => {
  it("prefers nested error messages", () => {
    expect(
      getAuthErrorMessage({
        error: {
          message: "Session expired.",
        },
      }),
    ).toBe("Session expired.");
  });

  it("falls back to top-level error messages", () => {
    expect(
      getAuthErrorMessage({
        message: "Invalid credentials.",
      }),
    ).toBe("Invalid credentials.");
  });

  it("returns the provided fallback for unknown values", () => {
    expect(getAuthErrorMessage(null, "Sign-in failed.")).toBe("Sign-in failed.");
  });
});

describe("buildAuthPageHref", () => {
  it("maps signup links to the unified login page", () => {
    expect(buildAuthPageHref("/signup", undefined)).toBe("/login?mode=signup");
  });

  it("preserves safe internal redirect targets", () => {
    expect(buildAuthPageHref("/login", "/admin")).toBe("/login?next=%2Fadmin");
    expect(buildAuthPageHref("/signup", "/admin")).toBe(
      "/login?mode=signup&next=%2Fadmin",
    );
  });
});

describe("buildSocialAuthRedirectOptions", () => {
  it("keeps the same next path for new and returning social users", () => {
    expect(buildSocialAuthRedirectOptions("/login", "/admin")).toEqual({
      callbackURL: "/admin",
      newUserCallbackURL: "/admin",
      errorCallbackURL: "/login?next=%2Fadmin",
    });
  });

  it("routes signup social errors back to login signup mode", () => {
    expect(buildSocialAuthRedirectOptions("/signup", "/admin")).toEqual({
      callbackURL: "/admin",
      newUserCallbackURL: "/admin",
      errorCallbackURL: "/login?mode=signup&next=%2Fadmin",
    });
  });
});

describe("getAuthCallbackErrorMessage", () => {
  it("maps known Better Auth callback errors to friendly messages", () => {
    expect(getAuthCallbackErrorMessage("email_doesn't_match")).toBe(
      "That social account uses a different email address than your existing Cerul account.",
    );
  });

  it("falls back to the callback error description when available", () => {
    expect(
      getAuthCallbackErrorMessage("unknown_error", "Try another provider."),
    ).toBe("Try another provider.");
  });
});
