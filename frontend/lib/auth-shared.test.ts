import { describe, expect, it } from "vitest";
import {
  buildAuthPageHref,
  DEFAULT_AUTH_REDIRECT_PATH,
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
  it("keeps auth page links clean for the default redirect", () => {
    expect(buildAuthPageHref("/signup", undefined)).toBe("/signup");
  });

  it("preserves safe internal redirect targets", () => {
    expect(buildAuthPageHref("/login", "/admin")).toBe("/login?next=%2Fadmin");
  });
});
