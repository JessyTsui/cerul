import { afterEach, describe, expect, it } from "vitest";
import { getConfiguredAdminEmails } from "./console-settings";

describe("console settings helpers", () => {
  const originalAdminEmails = process.env.ADMIN_CONSOLE_EMAILS;
  const originalSharedAdminEmails = process.env.CERUL__DASHBOARD__ADMIN_EMAILS;

  afterEach(() => {
    process.env.ADMIN_CONSOLE_EMAILS = originalAdminEmails;
    process.env.CERUL__DASHBOARD__ADMIN_EMAILS = originalSharedAdminEmails;
  });

  it("merges legacy and shared admin email settings", () => {
    process.env.ADMIN_CONSOLE_EMAILS = "owner@example.com";
    process.env.CERUL__DASHBOARD__ADMIN_EMAILS =
      "admin@example.com,owner@example.com";

    expect(Array.from(getConfiguredAdminEmails()).sort()).toEqual([
      "admin@example.com",
      "owner@example.com",
    ]);
  });

  it("accepts comma-delimited shared admin email overrides", () => {
    delete process.env.ADMIN_CONSOLE_EMAILS;
    process.env.CERUL__DASHBOARD__ADMIN_EMAILS =
      "owner@example.com,admin@example.com";

    expect(Array.from(getConfiguredAdminEmails()).sort()).toEqual([
      "admin@example.com",
      "owner@example.com",
    ]);
  });
});
