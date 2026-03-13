import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BrandMark } from "./brand-mark";

describe("BrandMark", () => {
  it("renders the Cerul wordmark with the shared logo asset", () => {
    const html = renderToStaticMarkup(<BrandMark />);

    expect(html).toContain("Cerul");
    expect(html).toContain("/logo.svg");
  });
});
