import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "../middleware";

describe("middleware", () => {
  it("redirects unauthenticated users away from protected routes", () => {
    const request = new NextRequest("https://cerul.ai/dashboard/usage");
    const response = middleware(request);

    expect(response.headers.get("location")).toBe(
      "https://cerul.ai/login?next=%2Fdashboard%2Fusage",
    );
  });

  it("redirects authenticated users away from guest-only routes", () => {
    const request = new NextRequest("https://cerul.ai/login", {
      headers: {
        cookie: "better-auth.session_token=session_123",
      },
    });
    const response = middleware(request);

    expect(response.headers.get("location")).toBe("https://cerul.ai/dashboard");
  });

  it("lets signup compatibility redirects preserve next params", () => {
    const request = new NextRequest(
      "https://cerul.ai/signup?next=%2Fdashboard%2Fusage",
      {
        headers: {
          cookie: "better-auth.session_token=session_123",
        },
      },
    );
    const response = middleware(request);

    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("allows verify-email to stay accessible without forcing redirects", () => {
    const request = new NextRequest("https://cerul.ai/verify-email?email=owner@example.com");
    const response = middleware(request);

    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
});
