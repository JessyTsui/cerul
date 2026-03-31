import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  executeMock,
  getAuthDatabaseMock,
  withAuthDatabaseRecoveryMock,
} = vi.hoisted(() => ({
  executeMock: vi.fn(),
  getAuthDatabaseMock: vi.fn(),
  withAuthDatabaseRecoveryMock: vi.fn(),
}));

vi.mock("kysely", () => ({
  sql: vi.fn(() => ({
    execute: executeMock,
  })),
}));

vi.mock("@/lib/auth-db", () => ({
  getAuthDatabase: getAuthDatabaseMock,
  withAuthDatabaseRecovery: withAuthDatabaseRecoveryMock,
}));

import { POST } from "./route";

describe("password reset status route", () => {
  beforeEach(() => {
    executeMock.mockReset();
    getAuthDatabaseMock.mockReset();
    withAuthDatabaseRecoveryMock.mockReset();

    getAuthDatabaseMock.mockReturnValue({ name: "auth-db" });
    withAuthDatabaseRecoveryMock.mockImplementation(
      async (operation: () => Promise<unknown>) => operation(),
    );
  });

  it("returns 400 unknown for invalid email payloads", async () => {
    const response = await POST(
      new Request("https://cerul.ai/api/auth/password-reset-status", {
        method: "POST",
        body: JSON.stringify({
          email: "not-an-email",
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      status: "unknown",
    });
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("returns credential when the account has an email-password login", async () => {
    executeMock.mockResolvedValue({
      rows: [
        {
          hasCredential: true,
          hasAnyAccount: true,
        },
      ],
    });

    const response = await POST(
      new Request("https://cerul.ai/api/auth/password-reset-status", {
        method: "POST",
        body: JSON.stringify({
          email: "owner@example.com",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "credential",
    });
    expect(withAuthDatabaseRecoveryMock).toHaveBeenCalledTimes(1);
    expect(getAuthDatabaseMock).toHaveBeenCalledTimes(1);
  });

  it("returns social when the account only has social providers", async () => {
    executeMock.mockResolvedValue({
      rows: [
        {
          hasCredential: false,
          hasAnyAccount: true,
        },
      ],
    });

    const response = await POST(
      new Request("https://cerul.ai/api/auth/password-reset-status", {
        method: "POST",
        body: JSON.stringify({
          email: "owner@example.com",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "social",
    });
  });

  it("falls back to unknown when the database lookup fails", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    executeMock.mockRejectedValue(new Error("database unavailable"));

    const response = await POST(
      new Request("https://cerul.ai/api/auth/password-reset-status", {
        method: "POST",
        body: JSON.stringify({
          email: "owner@example.com",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "unknown",
    });

    consoleErrorSpy.mockRestore();
  });
});
