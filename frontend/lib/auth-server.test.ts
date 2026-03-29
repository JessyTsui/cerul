import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  authInstanceCount: 0,
  databaseGeneration: 0,
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(),
}));

vi.mock("./auth-db", () => ({
  getAuthDatabase: vi.fn(() => ({})),
  getAuthDatabaseGeneration: vi.fn(() => state.databaseGeneration),
  isRetryableAuthDatabaseError: vi.fn(
    (error: unknown) =>
      error instanceof Error &&
      error.message === "Connection terminated unexpectedly",
  ),
  resetAuthDatabaseState: vi.fn(async () => {
    state.databaseGeneration += 1;
  }),
  upsertUserProfile: vi.fn(),
}));

vi.mock("better-auth", () => ({
  betterAuth: vi.fn(() => ({
    instanceId: ++state.authInstanceCount,
    api: {
      getSession: vi.fn(),
    },
  })),
}));

vi.mock("better-auth/next-js", () => ({
  toNextJsHandler: vi.fn((auth: { instanceId: number }) => ({
    GET: vi.fn(),
    POST: vi.fn(async (request: Request) => {
      const body = await request.text();

      if (auth.instanceId === 1) {
        expect(body).toBe('{"email":"owner@example.com"}');
        throw new Error("Connection terminated unexpectedly");
      }

      return new Response(body, { status: 200 });
    }),
  })),
}));

describe("getAuthRouteHandlers", () => {
  beforeEach(() => {
    state.authInstanceCount = 0;
    state.databaseGeneration = 0;
    vi.resetModules();
  });

  it("retries POST auth requests with a fresh request clone", async () => {
    const { getAuthRouteHandlers } = await import("./auth-server");

    const request = new Request("http://127.0.0.1:3000/api/auth/sign-in/email", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: '{"email":"owner@example.com"}',
    });

    const response = await getAuthRouteHandlers().POST(request);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{"email":"owner@example.com"}');
  });
});
