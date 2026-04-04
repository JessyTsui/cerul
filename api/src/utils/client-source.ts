const CLIENT_SOURCE_HEADER = "x-cerul-client-source";
const CLIENT_SOURCE_PATTERN = /^[a-z0-9][a-z0-9._/-]{0,63}$/;

function normalizeClientSource(value: string | null | undefined): string | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  return CLIENT_SOURCE_PATTERN.test(normalized) ? normalized : null;
}

export function resolveClientSource(request: Request): string | null {
  const explicitSource = normalizeClientSource(request.headers.get(CLIENT_SOURCE_HEADER));
  if (explicitSource) {
    return explicitSource;
  }

  const userAgent = (request.headers.get("user-agent") ?? "").trim().toLowerCase();
  if (userAgent.startsWith("cerul-js/")) {
    return "sdk-js";
  }
  if (userAgent.startsWith("cerul-python/")) {
    return "sdk-python";
  }

  return null;
}
