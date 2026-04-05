import { describe, expect, it, vi } from "vitest";

vi.mock("./site-url", () => ({
  getSiteOrigin: vi.fn(() => "https://cerul.ai"),
}));

describe("email templates", () => {
  it("renders verification emails with inline-only markup", async () => {
    const { emailVerificationTemplate } = await import("./email-templates");

    const html = emailVerificationTemplate({
      name: "Owner Example",
      url: "https://cerul.ai/api/auth/verify-email?token=abc",
    });

    expect(html).toContain("Verify your email address");
    expect(html).toContain("Owner Example");
    expect(html).toContain("Verify email");
    expect(html).toContain("https://cerul.ai/api/auth/verify-email?token=abc");
    expect(html).not.toContain("<style");
  });

  it("renders welcome emails with dashboard and docs links", async () => {
    const { welcomeTemplate } = await import("./email-templates");

    const html = welcomeTemplate({
      name: "Owner Example",
    });

    expect(html).toContain("Welcome to Cerul, Owner Example!");
    expect(html).toContain("100 signup credits");
    expect(html).toContain("300-credit monthly free tier");
    expect(html).toContain("https://cerul.ai/dashboard");
    expect(html).toContain("https://cerul.ai/docs");
  });
});
