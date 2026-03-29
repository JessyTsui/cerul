import { describe, expect, it } from "vitest";
import { canonicalUrl } from "./site-url";
import {
  adminRoutes,
  isAdminRouteActive,
  primaryNavigation,
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

describe("primaryNavigation", () => {
  it("keeps docs in the public navigation", () => {
    expect(primaryNavigation.some((item) => item.href === "/docs")).toBe(true);
  });
});

describe("isDashboardRouteActive", () => {
  it("matches nested dashboard routes", () => {
    expect(isDashboardRouteActive("/dashboard/usage", "/dashboard/usage")).toBe(true);
    expect(isDashboardRouteActive("/dashboard/usage/detail", "/dashboard/usage")).toBe(true);
  });
});

describe("adminRoutes", () => {
  it("includes the workers and content console entries", () => {
    expect(adminRoutes.some((item) => item.href === "/admin/workers")).toBe(true);
    expect(adminRoutes.some((item) => item.href === "/admin/content")).toBe(true);
  });
});

describe("isAdminRouteActive", () => {
  it("matches nested admin routes", () => {
    expect(isAdminRouteActive("/admin/requests", "/admin/requests")).toBe(true);
    expect(isAdminRouteActive("/admin/requests/detail", "/admin/requests")).toBe(true);
  });
});
