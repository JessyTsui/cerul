import { afterEach, describe, expect, it } from "vitest";
import {
  buildConsoleProxyPath,
  getBackendApiBaseUrl,
  isConsolePath,
} from "./console-api";

describe("console API helpers", () => {
  const originalApiBaseUrl = process.env.API_BASE_URL;
  const originalPublicApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;

  afterEach(() => {
    process.env.API_BASE_URL = originalApiBaseUrl;
    process.env.NEXT_PUBLIC_API_BASE_URL = originalPublicApiBaseUrl;
  });

  it("builds same-origin proxy paths for console endpoints", () => {
    expect(buildConsoleProxyPath("/dashboard/usage/monthly")).toBe(
      "/api/console/dashboard/usage/monthly",
    );
    expect(buildConsoleProxyPath("/admin/summary?range=today")).toBe(
      "/api/console/admin/summary?range=today",
    );
  });

  it("recognizes dashboard and admin routes", () => {
    expect(isConsolePath("/dashboard")).toBe(true);
    expect(isConsolePath("/dashboard/jobs?status=running")).toBe(true);
    expect(isConsolePath("/admin/summary")).toBe(true);
    expect(isConsolePath("/v1/search")).toBe(false);
  });

  it("prefers server-only API base URLs when resolving backend origin", () => {
    process.env.API_BASE_URL = "http://127.0.0.1:8000/";
    process.env.NEXT_PUBLIC_API_BASE_URL = "http://localhost:9000";

    expect(getBackendApiBaseUrl()).toBe("http://127.0.0.1:8000");
  });

  it("rejects non-console paths", () => {
    expect(() => buildConsoleProxyPath("/v1/search")).toThrow(
      "Unsupported console API path: /v1/search",
    );
  });
});
