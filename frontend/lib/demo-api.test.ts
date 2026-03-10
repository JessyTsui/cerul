import { describe, expect, it } from "vitest";
import {
  getDashboardSnapshot,
  simulateDemoSearch,
  validateDemoSearchRequestBody,
} from "./demo-api";

describe("simulateDemoSearch", () => {
  it("returns deterministic knowledge search structure", () => {
    const response = simulateDemoSearch({
      mode: "knowledge",
      query: "Show me the slide about AGI timelines",
    });

    expect(response.mode).toBe("knowledge");
    expect(response.results.length).toBeGreaterThan(0);
    expect(response.requestId.startsWith("req_")).toBe(true);
  });
});

describe("validateDemoSearchRequestBody", () => {
  it("accepts valid payloads and fills defaults", () => {
    expect(validateDemoSearchRequestBody({ mode: "broll" })).toEqual({
      ok: true,
      value: {
        mode: "broll",
        query: "",
      },
    });
  });

  it("rejects invalid modes", () => {
    expect(validateDemoSearchRequestBody({ mode: "foo" })).toEqual({
      ok: false,
      error: "Invalid demo mode.",
    });
  });

  it("rejects non-string queries", () => {
    expect(validateDemoSearchRequestBody({ query: 42 })).toEqual({
      ok: false,
      error: "Query must be a string.",
    });
  });
});

describe("getDashboardSnapshot", () => {
  it("returns overview cards and live status", () => {
    const snapshot = getDashboardSnapshot();

    expect(snapshot.overviewCards).toHaveLength(4);
    expect(snapshot.liveStatus.health).toBe("Healthy");
    expect(snapshot.pipelineRuns.length).toBeGreaterThan(0);
  });
});
