import { describe, expect, it } from "vitest";
import {
  apiReferenceEndpoints,
  docsLandingSections,
  getDocBySlug,
  getDocsPageCanonical,
  getDocsStaticParams,
} from "./docs";

describe("getDocBySlug", () => {
  it("returns the expected docs page", () => {
    expect(getDocBySlug("usage-api")?.title).toBe("Usage");
  });

  it("returns undefined for unknown slugs", () => {
    expect(getDocBySlug("unknown")).toBeUndefined();
  });
});

describe("docs helpers", () => {
  it("builds static params for each page", () => {
    expect(getDocsStaticParams()).toEqual(
      expect.arrayContaining([{ slug: "usage-api" }]),
    );
  });

  it("generates canonical urls", () => {
    expect(getDocsPageCanonical("usage-api")).toBe(
      "https://cerul.ai/docs/usage-api",
    );
  });

  it("keeps the public API reference limited to search and usage", () => {
    expect(apiReferenceEndpoints.map((endpoint) => endpoint.path)).toEqual([
      "/v1/search",
      "/v1/usage",
    ]);
  });

  it("does not expose unit_type in public response examples", () => {
    const searchEndpoint = apiReferenceEndpoints.find(
      (endpoint) => endpoint.id === "search-v1",
    );
    const responseSection = docsLandingSections.find(
      (section) => section.id === "response",
    );

    expect(searchEndpoint?.responseSchema).not.toContain("unit_type");
    expect(searchEndpoint?.responseExample).not.toContain("unit_type");
    expect(responseSection?.code).not.toContain("unit_type");
    expect(responseSection?.code).toContain("keyframe_url");
  });
});
