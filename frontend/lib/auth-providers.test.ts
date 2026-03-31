import { describe, expect, it } from "vitest";
import { getAuthUiConfig, getConfiguredSocialProviders } from "./auth-providers";

describe("getConfiguredSocialProviders", () => {
  it("returns only providers with both client id and secret configured", () => {
    expect(
      getConfiguredSocialProviders({
        GITHUB_CLIENT_ID: "github-id",
        GITHUB_CLIENT_SECRET: "github-secret",
        GOOGLE_CLIENT_ID: "google-id",
      } as NodeJS.ProcessEnv),
    ).toEqual({
      github: {
        clientId: "github-id",
        clientSecret: "github-secret",
      },
    });
  });

  it("trims configured provider credentials", () => {
    expect(
      getConfiguredSocialProviders({
        GOOGLE_CLIENT_ID: " google-id ",
        GOOGLE_CLIENT_SECRET: " google-secret ",
      } as NodeJS.ProcessEnv),
    ).toEqual({
      google: {
        clientId: "google-id",
        clientSecret: "google-secret",
      },
    });
  });
});

describe("getAuthUiConfig", () => {
  it("preserves provider order and returns the Google One Tap client id", () => {
    expect(
      getAuthUiConfig({
        GOOGLE_CLIENT_ID: "google-id",
        GOOGLE_CLIENT_SECRET: "google-secret",
        GITHUB_CLIENT_ID: "github-id",
        GITHUB_CLIENT_SECRET: "github-secret",
      } as NodeJS.ProcessEnv),
    ).toEqual({
      enabledProviders: ["github", "google"],
      googleOneTapClientId: "google-id",
    });
  });

  it("returns an empty UI config when no social providers are configured", () => {
    expect(getAuthUiConfig({} as NodeJS.ProcessEnv)).toEqual({
      enabledProviders: [],
      googleOneTapClientId: null,
    });
  });
});
