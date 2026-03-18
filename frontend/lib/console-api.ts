const DEFAULT_API_BASE_URL = "http://localhost:9104";
const CONSOLE_PROXY_PREFIX = "/api/console";
const CONSOLE_PATH_PREFIXES = ["/dashboard", "/admin"] as const;

function normalizePath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

function stripQuery(path: string): string {
  const queryIndex = path.indexOf("?");
  return queryIndex === -1 ? path : path.slice(0, queryIndex);
}

export function isConsolePath(path: string): boolean {
  const normalizedPath = stripQuery(normalizePath(path));

  return CONSOLE_PATH_PREFIXES.some((prefix) => (
    normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`)
  ));
}

export function buildConsoleProxyPath(path: string): string {
  const normalizedPath = normalizePath(path);

  if (!isConsolePath(normalizedPath)) {
    throw new Error(`Unsupported console API path: ${normalizedPath}`);
  }

  return `${CONSOLE_PROXY_PREFIX}${normalizedPath}`;
}

export function getBackendApiBaseUrl(): string {
  return (
    process.env.API_BASE_URL?.trim()?.replace(/\/$/, "")
    || process.env.NEXT_PUBLIC_API_BASE_URL?.trim()?.replace(/\/$/, "")
    || DEFAULT_API_BASE_URL
  );
}
