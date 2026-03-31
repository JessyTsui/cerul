export const AUTH_SOCIAL_PROVIDER_IDS = ["github", "google"] as const;

export type AuthSocialProviderId = (typeof AUTH_SOCIAL_PROVIDER_IDS)[number];

type ProviderCredentials = {
  clientId: string;
  clientSecret: string;
};

export type AuthUiConfig = {
  enabledProviders: AuthSocialProviderId[];
  googleOneTapClientId: string | null;
};

function normalizeEnvValue(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function resolveProviderCredentials(input: {
  clientId?: string;
  clientSecret?: string;
}): ProviderCredentials | null {
  const clientId = normalizeEnvValue(input.clientId);
  const clientSecret = normalizeEnvValue(input.clientSecret);

  if (!clientId || !clientSecret) {
    return null;
  }

  return {
    clientId,
    clientSecret,
  };
}

export function getConfiguredSocialProviders(env: NodeJS.ProcessEnv = process.env) {
  const github = resolveProviderCredentials({
    clientId: env.GITHUB_CLIENT_ID,
    clientSecret: env.GITHUB_CLIENT_SECRET,
  });
  const google = resolveProviderCredentials({
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
  });

  return {
    ...(github ? { github } : {}),
    ...(google ? { google } : {}),
  };
}

export function getAuthUiConfig(env: NodeJS.ProcessEnv = process.env): AuthUiConfig {
  const configuredProviders = getConfiguredSocialProviders(env);
  const enabledProviders = AUTH_SOCIAL_PROVIDER_IDS.filter((providerId) =>
    providerId in configuredProviders
  );

  return {
    enabledProviders,
    googleOneTapClientId: configuredProviders.google?.clientId ?? null,
  };
}
