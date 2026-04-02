import { beforeEach, describe, expect, it, vi } from "vitest";

const { redirectMock } = vi.hoisted(() => ({
  redirectMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

import SignupPage from "./page";

describe("SignupPage", () => {
  beforeEach(() => {
    redirectMock.mockReset();
  });

  it("redirects signup requests to login signup mode", async () => {
    await SignupPage({
      searchParams: Promise.resolve({}),
    });

    expect(redirectMock).toHaveBeenCalledWith("/login?mode=signup");
  });

  it("preserves redirect and callback error state", async () => {
    await SignupPage({
      searchParams: Promise.resolve({
        next: "/dashboard/usage",
        error: "EMAIL_NOT_VERIFIED",
        error_description: "Please verify your email first.",
      }),
    });

    expect(redirectMock).toHaveBeenCalledWith(
      "/login?mode=signup&next=%2Fdashboard%2Fusage&error=EMAIL_NOT_VERIFIED&error_description=Please+verify+your+email+first.",
    );
  });

  it("preserves referral codes when redirecting to signup mode", async () => {
    await SignupPage({
      searchParams: Promise.resolve({
        ref: "crlbonus",
      }),
    });

    expect(redirectMock).toHaveBeenCalledWith("/login?mode=signup&ref=crlbonus");
  });
});
