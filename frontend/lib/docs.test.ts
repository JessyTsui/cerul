import { describe, expect, it } from "vitest";
import { getDocBySlug, getDocsPageCanonical, getDocsStaticParams } from "./docs";

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
});
