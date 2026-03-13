import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AuthModeSwitcher } from "./auth-mode-switcher";

describe("AuthModeSwitcher", () => {
  it("renders links for both auth modes and preserves next path", () => {
    const html = renderToStaticMarkup(
      <AuthModeSwitcher activeMode="login" nextPath="/admin" />,
    );

    expect(html).toContain('href="/login?next=%2Fadmin"');
    expect(html).toContain('href="/signup?next=%2Fadmin"');
    expect(html).toContain("Sign in");
    expect(html).toContain("Sign up");
  });
});
