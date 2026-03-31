import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AuthSocialSection } from "./auth-social-section";

describe("AuthSocialSection", () => {
  it("renders social buttons in the configured provider order", () => {
    const html = renderToStaticMarkup(
      <AuthSocialSection
        mode="login"
        nextPath="/dashboard/usage"
        enabledProviders={["github", "google"]}
        googleOneTapClientId="google-client-id"
        onErrorChange={() => {}}
      />,
    );

    expect(html).toContain("Continue with GitHub");
    expect(html).toContain("Continue with Google");
    expect(html).toContain("Or continue with email");
    expect(html.indexOf("Continue with GitHub")).toBeLessThan(
      html.indexOf("Continue with Google"),
    );
  });

  it("renders nothing when no social providers are configured", () => {
    const html = renderToStaticMarkup(
      <AuthSocialSection
        mode="signup"
        nextPath="/dashboard"
        enabledProviders={[]}
        googleOneTapClientId={null}
        onErrorChange={() => {}}
      />,
    );

    expect(html).toBe("");
  });
});
