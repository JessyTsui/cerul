import { describe, expect, it } from "vitest";
import { canonicalUrl } from "./site-url";
import {
  isDashboardRouteActive,
  isPrimaryNavigationActive,
  isPrimaryRoute,
} from "./site";

describe("canonicalUrl", () => {
  it("prefixes relative paths with the site origin", () => {
    expect(canonicalUrl("/docs")).toBe("https://cerul.ai/docs");
    expect(canonicalUrl("dashboard")).toBe("https://cerul.ai/dashboard");
  });
});

describe("isPrimaryRoute", () => {
  it("returns true for known primary routes", () => {
    expect(isPrimaryRoute("/")).toBe(true);
    expect(isPrimaryRoute("/docs")).toBe(true);
    expect(isPrimaryRoute("/pricing")).toBe(true);
  });

  it("returns false for unknown routes", () => {
    expect(isPrimaryRoute("/blog")).toBe(false);
  });
});

describe("isPrimaryNavigationActive", () => {
  it("matches nested paths for non-root sections", () => {
    expect(isPrimaryNavigationActive("/docs/search-api", "/docs")).toBe(true);
    expect(isPrimaryNavigationActive("/pricing", "/pricing")).toBe(true);
  });

  it("keeps the root route exact", () => {
    expect(isPrimaryNavigationActive("/", "/")).toBe(true);
    expect(isPrimaryNavigationActive("/docs", "/")).toBe(false);
  });
});

describe("isDashboardRouteActive", () => {
  it("matches nested dashboard routes", () => {
    expect(isDashboardRouteActive("/dashboard/usage", "/dashboard/usage")).toBe(true);
    expect(isDashboardRouteActive("/dashboard/usage/detail", "/dashboard/usage")).toBe(true);
  });
});
