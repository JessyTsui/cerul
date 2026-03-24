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
      ...normalizeEmailList(process.env.CERUL__DASHBOARD__ADMIN_EMAILS),
    ]);
  }

  return new Set<string>();
}
