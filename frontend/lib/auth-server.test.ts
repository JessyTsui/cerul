import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  authInstanceCount: 0,
  lastAuthConfig: null as Record<string, unknown> | null,
  databaseGeneration: 0,
  sentEmails: [] as Array<{ to: string; subject: string; html: string }>,
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

vi.mock("./email", () => ({
  sendEmail: vi.fn(async (input: { to: string; subject: string; html: string }) => {
    state.sentEmails.push(input);
  }),
}));

vi.mock("./email-templates", () => ({
  emailVerificationTemplate: vi.fn(() => "<p>verify</p>"),
  passwordChangedTemplate: vi.fn(() => "<p>changed</p>"),
  passwordResetTemplate: vi.fn(() => "<p>reset</p>"),
  welcomeTemplate: vi.fn(() => "<p>welcome</p>"),
}));

vi.mock("better-auth", () => ({
  betterAuth: vi.fn((config: Record<string, unknown>) => {
    state.lastAuthConfig = config;

    return {
      instanceId: ++state.authInstanceCount,
      api: {
        getSession: vi.fn(),
      },
    };
  }),
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

vi.mock("better-auth/plugins", () => ({
  oneTap: vi.fn(() => ({ id: "one-tap" })),
}));

describe("getAuthRouteHandlers", () => {
  beforeEach(() => {
    state.authInstanceCount = 0;
    state.lastAuthConfig = null;
    state.databaseGeneration = 0;
    state.sentEmails = [];
    delete process.env.GITHUB_CLIENT_ID;
    delete process.env.GITHUB_CLIENT_SECRET;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
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

  it("configures social providers, email flows, account linking, and one tap when env vars are set", async () => {
    process.env.GITHUB_CLIENT_ID = "github-client-id";
    process.env.GITHUB_CLIENT_SECRET = "github-client-secret";
    process.env.GOOGLE_CLIENT_ID = "google-client-id";
    process.env.GOOGLE_CLIENT_SECRET = "google-client-secret";

    const { getAuth } = await import("./auth-server");

    getAuth();

    expect(state.lastAuthConfig).toMatchObject({
      socialProviders: {
        github: {
          clientId: "github-client-id",
          clientSecret: "github-client-secret",
        },
        google: {
          clientId: "google-client-id",
          clientSecret: "google-client-secret",
        },
      },
      account: {
        accountLinking: {
          enabled: true,
          trustedProviders: ["google", "github"],
        },
      },
      plugins: [{ id: "one-tap" }],
      emailAndPassword: {
        enabled: true,
        autoSignIn: true,
        requireEmailVerification: true,
        resetPasswordTokenExpiresIn: 3600,
      },
      emailVerification: {
        expiresIn: 86400,
        sendOnSignUp: true,
        autoSignInAfterVerification: true,
      },
    });

    expect(state.lastAuthConfig?.emailAndPassword).toMatchObject({
      sendResetPassword: expect.any(Function),
      onPasswordReset: expect.any(Function),
    });
    expect(state.lastAuthConfig?.emailVerification).toMatchObject({
      sendVerificationEmail: expect.any(Function),
      afterEmailVerification: expect.any(Function),
    });
  });

  it("upserts the user profile and only welcomes already-verified users at creation time", async () => {
    const { getAuth } = await import("./auth-server");
    const { upsertUserProfile } = await import("./auth-db");

    getAuth();

    const createHook = state.lastAuthConfig?.databaseHooks as {
      user?: {
        create?: {
          after?: (user: { id: string; email: string; name: string }) => Promise<void>;
        };
      };
    };

    await createHook.user?.create?.after?.({
      id: "user_123",
      email: "owner@example.com",
      name: "Owner Example",
      emailVerified: false,
    });
    await Promise.resolve();

    expect(upsertUserProfile).toHaveBeenCalledWith({
      id: "user_123",
      email: "owner@example.com",
      name: "Owner Example",
      grantSignupBonus: true,
      createDefaultApiKey: true,
    });
    expect(state.sentEmails).toEqual([]);

    await createHook.user?.create?.after?.({
      id: "user_456",
      email: "social@example.com",
      name: "Social Example",
      emailVerified: true,
    });
    await Promise.resolve();

    expect(state.sentEmails).toContainEqual({
      to: "social@example.com",
      subject: "Welcome to Cerul",
      html: "<p>welcome</p>",
    });
  });

  it("sends a welcome email after email verification succeeds", async () => {
    const { getAuth } = await import("./auth-server");

    getAuth();

    const emailVerification = state.lastAuthConfig?.emailVerification as {
      afterEmailVerification?: (user: {
        email: string;
        name: string;
      }) => Promise<void>;
    };

    await emailVerification.afterEmailVerification?.({
      email: "owner@example.com",
      name: "Owner Example",
    });
    await Promise.resolve();

    expect(state.sentEmails).toContainEqual({
      to: "owner@example.com",
      subject: "Welcome to Cerul",
      html: "<p>welcome</p>",
    });
  });
});
