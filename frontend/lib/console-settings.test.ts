import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  getConfiguredAdminEmails,
  getConfiguredBootstrapAdminSecret,
} from "./console-settings";

describe("console settings helpers", () => {
  const originalAdminEmails = process.env.ADMIN_CONSOLE_EMAILS;
  const originalSharedAdminEmails = process.env.CERUL__DASHBOARD__ADMIN_EMAILS;
  const originalBootstrapSecret = process.env.BOOTSTRAP_ADMIN_SECRET;
  const originalSharedBootstrapSecret =
    process.env.CERUL__DASHBOARD__BOOTSTRAP_ADMIN_SECRET;
  const originalConfigDir = process.env.CERUL_CONFIG_DIR;
  const originalEnvironment = process.env.CERUL_ENV;

  afterEach(() => {
    process.env.ADMIN_CONSOLE_EMAILS = originalAdminEmails;
    process.env.CERUL__DASHBOARD__ADMIN_EMAILS = originalSharedAdminEmails;
    process.env.BOOTSTRAP_ADMIN_SECRET = originalBootstrapSecret;
    process.env.CERUL__DASHBOARD__BOOTSTRAP_ADMIN_SECRET =
      originalSharedBootstrapSecret;
    process.env.CERUL_CONFIG_DIR = originalConfigDir;
    process.env.CERUL_ENV = originalEnvironment;
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

  it("accepts YAML-style shared admin email overrides", () => {
    delete process.env.ADMIN_CONSOLE_EMAILS;
    process.env.CERUL__DASHBOARD__ADMIN_EMAILS =
      "[\"owner@example.com\", \"admin@example.com\"]";

    expect(Array.from(getConfiguredAdminEmails()).sort()).toEqual([
      "admin@example.com",
      "owner@example.com",
    ]);
  });

  it("falls back to dashboard YAML settings when env overrides are absent", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "cerul-console-settings-"));
    process.env.CERUL_CONFIG_DIR = tempDir;
    process.env.CERUL_ENV = "production";
    delete process.env.ADMIN_CONSOLE_EMAILS;
    delete process.env.CERUL__DASHBOARD__ADMIN_EMAILS;
    delete process.env.BOOTSTRAP_ADMIN_SECRET;
    delete process.env.CERUL__DASHBOARD__BOOTSTRAP_ADMIN_SECRET;

    writeFileSync(
      path.join(tempDir, "base.yaml"),
      [
        "dashboard:",
        "  admin_emails:",
        "    - base@example.com",
        "  bootstrap_admin_secret: base-secret",
        "",
      ].join("\n"),
    );
    writeFileSync(
      path.join(tempDir, "production.yaml"),
      [
        "dashboard:",
        "  admin_emails:",
        "    - prod@example.com",
        "  bootstrap_admin_secret: prod-secret",
        "",
      ].join("\n"),
    );

    expect(Array.from(getConfiguredAdminEmails())).toEqual(["prod@example.com"]);
    expect(getConfiguredBootstrapAdminSecret()).toBe("prod-secret");

    rmSync(tempDir, { recursive: true, force: true });
  });

  it("splits quoted comma-delimited admin emails from YAML config", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "cerul-console-settings-"));
    process.env.CERUL_CONFIG_DIR = tempDir;
    process.env.CERUL_ENV = "production";
    delete process.env.ADMIN_CONSOLE_EMAILS;
    delete process.env.CERUL__DASHBOARD__ADMIN_EMAILS;

    writeFileSync(
      path.join(tempDir, "base.yaml"),
      [
        "dashboard:",
        "  admin_emails: \"owner@example.com,admin@example.com\"",
        "",
      ].join("\n"),
    );

    expect(Array.from(getConfiguredAdminEmails()).sort()).toEqual([
      "admin@example.com",
      "owner@example.com",
    ]);

    rmSync(tempDir, { recursive: true, force: true });
  });
});
