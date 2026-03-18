import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

type DashboardSettingsSnapshot = {
  adminEmails: string[];
  bootstrapAdminSecret: string | null;
};

function normalizeEmail(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

function normalizeEmailList(value: string | undefined): string[] {
  const emails: string[] = [];
  const seen = new Set<string>();

  for (const item of (value ?? "").split(",")) {
    const normalized = normalizeEmail(item);

    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    emails.push(normalized);
  }

  return emails;
}

function normalizeSecret(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized || null;
}

function stripInlineComment(value: string): string {
  let quote: "\"" | "'" | null = null;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];

    if (quote === "\"") {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (character === "\\") {
        escaped = true;
        continue;
      }
    }

    if (quote) {
      if (character === quote) {
        quote = null;
      }
      continue;
    }

    if (character === "\"" || character === "'") {
      quote = character;
      continue;
    }

    if (character === "#") {
      return value.slice(0, index).trim();
    }
  }

  return value.trim();
}

function parseScalar(value: string): string | null {
  const normalized = stripInlineComment(value);

  if (!normalized || normalized === "null" || normalized === "~") {
    return null;
  }

  if (
    (normalized.startsWith("\"") && normalized.endsWith("\"")) ||
    (normalized.startsWith("'") && normalized.endsWith("'"))
  ) {
    return normalized.slice(1, -1);
  }

  return normalized;
}

function parseYamlEmailValue(value: string | undefined): string[] {
  const normalized = value?.trim();

  if (!normalized) {
    return [];
  }

  if (normalized.startsWith("[") && normalized.endsWith("]")) {
    return parseInlineList(normalized);
  }

  const scalar = parseScalar(normalized);

  if (!scalar) {
    return [];
  }

  if (scalar.includes(",")) {
    return normalizeEmailList(scalar);
  }

  const normalizedEmail = normalizeEmail(scalar);
  return normalizedEmail ? [normalizedEmail] : [];
}

function parseInlineList(value: string): string[] {
  const normalized = stripInlineComment(value);

  if (!normalized || normalized === "[]") {
    return [];
  }

  const inner = normalized.startsWith("[") && normalized.endsWith("]")
    ? normalized.slice(1, -1)
    : normalized;
  const emails: string[] = [];
  const seen = new Set<string>();
  let quote: "\"" | "'" | null = null;
  let escaped = false;
  let current = "";

  const pushCurrent = () => {
    const scalar = parseScalar(current);
    const normalizedEmail = scalar ? normalizeEmail(scalar) : null;

    if (!normalizedEmail || seen.has(normalizedEmail)) {
      current = "";
      return;
    }

    seen.add(normalizedEmail);
    emails.push(normalizedEmail);
    current = "";
  };

  for (let index = 0; index < inner.length; index += 1) {
    const character = inner[index];

    if (quote === "\"") {
      if (escaped) {
        escaped = false;
        current += character;
        continue;
      }

      if (character === "\\") {
        escaped = true;
        current += character;
        continue;
      }
    }

    if (quote) {
      if (character === quote) {
        quote = null;
      }
      current += character;
      continue;
    }

    if (character === "\"" || character === "'") {
      quote = character;
      current += character;
      continue;
    }

    if (character === ",") {
      pushCurrent();
      continue;
    }

    current += character;
  }

  pushCurrent();
  return emails;
}

function parseDashboardSettingsFromYaml(content: string): Partial<DashboardSettingsSnapshot> {
  const parsed: Partial<DashboardSettingsSnapshot> = {};
  const lines = content.split(/\r?\n/);
  let inDashboard = false;
  let collectingAdminEmails = false;
  let adminEmails: string[] = [];

  for (const rawLine of lines) {
    const indent = rawLine.match(/^ */)?.[0].length ?? 0;
    const trimmed = rawLine.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    if (!inDashboard) {
      if (indent === 0 && trimmed === "dashboard:") {
        inDashboard = true;
      }
      continue;
    }

    if (indent === 0 && !trimmed.startsWith("- ")) {
      if (collectingAdminEmails) {
        parsed.adminEmails = adminEmails;
      }
      break;
    }

    if (collectingAdminEmails) {
      if (indent >= 2 && trimmed.startsWith("- ")) {
        const scalar = parseScalar(trimmed.slice(2));
        const normalized = scalar ? normalizeEmail(scalar) : null;
        if (normalized && !adminEmails.includes(normalized)) {
          adminEmails.push(normalized);
        }
        continue;
      }

      parsed.adminEmails = adminEmails;
      collectingAdminEmails = false;
    }

    if (trimmed.startsWith("admin_emails:")) {
      const value = trimmed.slice("admin_emails:".length).trim();

      if (!value) {
        adminEmails = [];
        collectingAdminEmails = true;
        continue;
      }

      parsed.adminEmails = parseInlineList(value);
      continue;
    }

    if (trimmed.startsWith("bootstrap_admin_secret:")) {
      const value = trimmed.slice("bootstrap_admin_secret:".length).trim();
      parsed.bootstrapAdminSecret = parseScalar(value);
    }
  }

  if (collectingAdminEmails) {
    parsed.adminEmails = adminEmails;
  }

  return parsed;
}

function resolveConfigDir(): string {
  const configuredDir = process.env.CERUL_CONFIG_DIR?.trim();

  if (configuredDir) {
    return configuredDir;
  }

  const repoRelativeDir = path.resolve(process.cwd(), "..", "config");
  if (existsSync(repoRelativeDir)) {
    return repoRelativeDir;
  }

  return path.resolve(process.cwd(), "config");
}

function loadDashboardSettingsFromConfig(): DashboardSettingsSnapshot {
  const configDir = resolveConfigDir();
  const environment = process.env.CERUL_ENV?.trim().toLowerCase() || "development";
  const snapshot: DashboardSettingsSnapshot = {
    adminEmails: [],
    bootstrapAdminSecret: null,
  };

  for (const configPath of [
    path.join(configDir, "base.yaml"),
    path.join(configDir, `${environment}.yaml`),
  ]) {
    if (!existsSync(configPath)) {
      continue;
    }

    const parsed = parseDashboardSettingsFromYaml(readFileSync(configPath, "utf8"));

    if (parsed.adminEmails) {
      snapshot.adminEmails = parsed.adminEmails;
    }

    if (Object.prototype.hasOwnProperty.call(parsed, "bootstrapAdminSecret")) {
      snapshot.bootstrapAdminSecret = parsed.bootstrapAdminSecret ?? null;
    }
  }

  return snapshot;
}

function hasEnvOverride(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(process.env, name);
}

export function getConfiguredAdminEmails(): Set<string> {
  if (
    hasEnvOverride("ADMIN_CONSOLE_EMAILS") ||
    hasEnvOverride("CERUL__DASHBOARD__ADMIN_EMAILS")
  ) {
    return new Set([
      ...normalizeEmailList(process.env.ADMIN_CONSOLE_EMAILS),
      ...parseYamlEmailValue(process.env.CERUL__DASHBOARD__ADMIN_EMAILS),
    ]);
  }

  return new Set(loadDashboardSettingsFromConfig().adminEmails);
}

export function getConfiguredBootstrapAdminSecret(): string | null {
  if (hasEnvOverride("BOOTSTRAP_ADMIN_SECRET")) {
    return normalizeSecret(process.env.BOOTSTRAP_ADMIN_SECRET);
  }

  if (hasEnvOverride("CERUL__DASHBOARD__BOOTSTRAP_ADMIN_SECRET")) {
    return parseScalar(process.env.CERUL__DASHBOARD__BOOTSTRAP_ADMIN_SECRET ?? "");
  }

  return loadDashboardSettingsFromConfig().bootstrapAdminSecret;
}
