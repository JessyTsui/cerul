import { describe, expect, it } from "vitest";
import {
  isRetryableAuthDatabaseError,
  normalizeAuthDatabaseUrl,
} from "./auth-db";

describe("normalizeAuthDatabaseUrl", () => {
  it("adds a connect timeout when one is missing", () => {
    expect(
      normalizeAuthDatabaseUrl("postgresql://user:pass@db.example.com:5432/cerul"),
    ).toBe(
      "postgresql://user:pass@db.example.com:5432/cerul?connect_timeout=30",
    );
  });

  it("preserves an existing connect timeout", () => {
    expect(
      normalizeAuthDatabaseUrl(
        "postgresql://user:pass@db.example.com:5432/cerul?sslmode=require&connect_timeout=10",
      ),
    ).toBe(
      "postgresql://user:pass@db.example.com:5432/cerul?sslmode=require&connect_timeout=10",
    );
  });
});

describe("isRetryableAuthDatabaseError", () => {
  it("treats terminated pg connections as retryable", () => {
    expect(
      isRetryableAuthDatabaseError(new Error("Connection terminated unexpectedly")),
    ).toBe(true);
  });

  it("treats Better Auth failed-session wrappers as retryable", () => {
    expect(
      isRetryableAuthDatabaseError({
        message: "Failed to get session",
        body: {
          code: "FAILED_TO_GET_SESSION",
          message: "Failed to get session",
        },
      }),
    ).toBe(true);
  });

  it("does not retry unrelated validation errors", () => {
    expect(
      isRetryableAuthDatabaseError(new Error("Invalid email or password")),
    ).toBe(false);
  });
});
