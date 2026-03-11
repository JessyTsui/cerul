const DEFAULT_API_BASE_URL = "http://localhost:9104";

type JsonBody =
  | Record<string, unknown>
  | Array<unknown>;

type FetchWithAuthOptions = Omit<RequestInit, "body"> & {
  body?: BodyInit | JsonBody | null;
};

type ApiErrorPayload = {
  error?: {
    code?: string;
    message?: string;
  };
  detail?: unknown;
};

type ApiKeyWire = {
  id: string;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at?: string | null;
  is_active?: boolean;
};

type ApiKeyListWire = {
  api_keys?: ApiKeyWire[];
  items?: ApiKeyWire[];
};

type CreateApiKeyWire = {
  key_id?: string;
  id?: string;
  raw_key?: string;
  api_key?: string;
  prefix?: string;
  name?: string;
  created_at?: string | null;
};

type DailyUsageWire = {
  date: string;
  credits_used?: number;
  request_count?: number;
};

type MonthlyUsageWire = {
  tier: string;
  period_start: string;
  period_end: string;
  credits_limit: number;
  credits_used: number;
  credits_remaining: number;
  request_count?: number;
  api_keys_active?: number;
  rate_limit_per_sec?: number | null;
  has_stripe_customer?: boolean;
  daily_breakdown?: DailyUsageWire[];
};

type MonthlyUsageEnvelope = {
  usage?: MonthlyUsageWire;
};

type BillingLinkWire = {
  url?: string;
  checkout_url?: string;
  portal_url?: string;
};

export type DashboardApiKey = {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  isActive: boolean;
};

export type CreateApiKeyRequest = {
  name: string;
};

export type CreateApiKeyResponse = {
  keyId: string;
  rawKey: string;
  prefix?: string;
  name?: string;
  createdAt?: string | null;
};

export type DashboardUsageDay = {
  date: string;
  creditsUsed: number;
  requestCount: number;
};

export type DashboardMonthlyUsage = {
  tier: string;
  periodStart: string;
  periodEnd: string;
  creditsLimit: number;
  creditsUsed: number;
  creditsRemaining: number;
  requestCount: number;
  apiKeysActive: number;
  rateLimitPerSec: number | null;
  hasStripeCustomer: boolean;
  dailyBreakdown: DashboardUsageDay[];
};

export type BillingRedirect = {
  url: string;
};

export class ApiClientError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(
    message: string,
    options: {
      status: number;
      code?: string;
      details?: unknown;
    },
  ) {
    super(message);
    this.name = "ApiClientError";
    this.status = options.status;
    this.code = options.code ?? "unknown_error";
    this.details = options.details;
  }
}

export function getApiErrorMessage(
  error: unknown,
  fallback = "Something went wrong while contacting the dashboard API.",
): string {
  if (error instanceof TypeError) {
    return "Could not reach the dashboard API. Verify NEXT_PUBLIC_API_BASE_URL and ensure CORS allows credentialed requests from this app.";
  }

  if (error instanceof ApiClientError) {
    return error.message;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonBody(body: FetchWithAuthOptions["body"]): body is JsonBody {
  return isPlainObject(body) || Array.isArray(body);
}

function getApiBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ??
    DEFAULT_API_BASE_URL
  );
}

function buildUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${getApiBaseUrl()}${normalizedPath}`;
}

async function parseResponseBody(response: Response): Promise<unknown> {
  if (response.status === 204) {
    return null;
  }

  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function getErrorPayload(body: unknown): ApiErrorPayload["error"] | null {
  if (!isPlainObject(body) || !isPlainObject(body.error)) {
    if (!isPlainObject(body)) {
      return null;
    }

    if (typeof body.detail === "string") {
      return {
        message: body.detail,
      };
    }

    if (Array.isArray(body.detail)) {
      const firstItem = body.detail[0];
      if (isPlainObject(firstItem) && typeof firstItem.msg === "string") {
        return {
          message: firstItem.msg,
        };
      }
    }

    return null;
  }

  const code =
    typeof body.error.code === "string" ? body.error.code : undefined;
  const message =
    typeof body.error.message === "string" ? body.error.message : undefined;

  return {
    code,
    message,
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isApiKeyWire(value: unknown): value is ApiKeyWire {
  return (
    isPlainObject(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.prefix === "string" &&
    typeof value.created_at === "string" &&
    (value.last_used_at === undefined ||
      value.last_used_at === null ||
      typeof value.last_used_at === "string") &&
    (value.is_active === undefined || typeof value.is_active === "boolean")
  );
}

function isDailyUsageWire(value: unknown): value is DailyUsageWire {
  return (
    isPlainObject(value) &&
    typeof value.date === "string" &&
    (value.credits_used === undefined || isFiniteNumber(value.credits_used)) &&
    (value.request_count === undefined || isFiniteNumber(value.request_count))
  );
}

function normalizeApiKey(input: ApiKeyWire): DashboardApiKey {
  return {
    id: input.id,
    name: input.name,
    prefix: input.prefix,
    createdAt: input.created_at,
    lastUsedAt: input.last_used_at ?? null,
    isActive: input.is_active ?? true,
  };
}

function normalizeApiKeys(payload: unknown): DashboardApiKey[] {
  const items = Array.isArray(payload)
    ? payload
    : isPlainObject(payload) && Array.isArray(payload.api_keys)
      ? payload.api_keys
      : isPlainObject(payload) && Array.isArray(payload.items)
        ? payload.items
        : null;

  if (!items) {
    throw new ApiClientError("Invalid API key list response.", {
      status: 500,
      code: "invalid_payload",
      details: payload,
    });
  }

  const normalizedItems = items
    .filter((item): item is ApiKeyWire => isApiKeyWire(item))
    .map((item) => normalizeApiKey(item));

  if (items.length > 0 && normalizedItems.length === 0) {
    throw new ApiClientError("API key list response did not include valid items.", {
      status: 500,
      code: "invalid_payload",
      details: payload,
    });
  }

  return normalizedItems;
}

function normalizeCreatedKey(payload: unknown): CreateApiKeyResponse {
  if (!isPlainObject(payload)) {
    throw new ApiClientError("Invalid API key create response.", {
      status: 500,
      code: "invalid_payload",
      details: payload,
    });
  }

  const keyId =
    typeof payload.key_id === "string"
      ? payload.key_id
      : typeof payload.id === "string"
        ? payload.id
        : null;
  const rawKey =
    typeof payload.raw_key === "string"
      ? payload.raw_key
      : typeof payload.api_key === "string"
        ? payload.api_key
        : null;

  if (!keyId || !rawKey) {
    throw new ApiClientError("API key response is missing the raw key.", {
      status: 500,
      code: "invalid_payload",
      details: payload,
    });
  }

  return {
    keyId,
    rawKey,
    prefix: typeof payload.prefix === "string" ? payload.prefix : undefined,
    name: typeof payload.name === "string" ? payload.name : undefined,
    createdAt:
      typeof payload.created_at === "string" ? payload.created_at : undefined,
  };
}

function normalizeUsage(payload: unknown): DashboardMonthlyUsage {
  const raw = isPlainObject(payload) && isPlainObject(payload.usage)
    ? payload.usage
    : payload;

  if (!isPlainObject(raw)) {
    throw new ApiClientError("Invalid usage response.", {
      status: 500,
      code: "invalid_payload",
      details: payload,
    });
  }

  if (
    typeof raw.tier !== "string" ||
    typeof raw.period_start !== "string" ||
    typeof raw.period_end !== "string" ||
    typeof raw.credits_limit !== "number" ||
    typeof raw.credits_used !== "number" ||
    typeof raw.credits_remaining !== "number"
  ) {
    throw new ApiClientError("Usage response is missing required fields.", {
      status: 500,
      code: "invalid_payload",
      details: payload,
    });
  }

  const usagePayload = raw as MonthlyUsageWire;

  const dailyBreakdown = Array.isArray(usagePayload.daily_breakdown)
    ? usagePayload.daily_breakdown
        .filter((entry): entry is DailyUsageWire => isDailyUsageWire(entry))
        .map((entry) => ({
          date: entry.date,
          creditsUsed: entry.credits_used ?? 0,
          requestCount: entry.request_count ?? 0,
        }))
    : [];

  return {
    tier: usagePayload.tier,
    periodStart: usagePayload.period_start,
    periodEnd: usagePayload.period_end,
    creditsLimit: usagePayload.credits_limit,
    creditsUsed: usagePayload.credits_used,
    creditsRemaining: usagePayload.credits_remaining,
    requestCount: usagePayload.request_count ?? 0,
    apiKeysActive: usagePayload.api_keys_active ?? 0,
    rateLimitPerSec:
      typeof usagePayload.rate_limit_per_sec === "number"
        ? usagePayload.rate_limit_per_sec
        : null,
    hasStripeCustomer: usagePayload.has_stripe_customer === true,
    dailyBreakdown,
  };
}

function normalizeBillingLink(payload: unknown): BillingRedirect {
  if (!isPlainObject(payload)) {
    throw new ApiClientError("Invalid billing response.", {
      status: 500,
      code: "invalid_payload",
      details: payload,
    });
  }

  const url =
    typeof payload.url === "string"
      ? payload.url
      : typeof payload.checkout_url === "string"
        ? payload.checkout_url
        : typeof payload.portal_url === "string"
          ? payload.portal_url
          : null;

  if (!url) {
    throw new ApiClientError("Billing response is missing a redirect URL.", {
      status: 500,
      code: "invalid_payload",
      details: payload,
    });
  }

  return { url };
}

export async function fetchWithAuth<T>(
  path: string,
  options: FetchWithAuthOptions = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  let body = options.body;

  if (isJsonBody(body)) {
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    body = JSON.stringify(body);
  }

  const response = await fetch(buildUrl(path), {
    ...options,
    body,
    headers,
    credentials: "include",
  });

  const parsedBody = await parseResponseBody(response);

  if (!response.ok) {
    const apiError = getErrorPayload(parsedBody);

    throw new ApiClientError(
      apiError?.message ?? `Dashboard request failed with status ${response.status}.`,
      {
        status: response.status,
        code: apiError?.code,
        details: parsedBody,
      },
    );
  }

  return parsedBody as T;
}

export const apiKeys = {
  async list(): Promise<DashboardApiKey[]> {
    const payload = await fetchWithAuth<ApiKeyListWire | ApiKeyWire[]>(
      "/dashboard/api-keys",
      {
        method: "GET",
        cache: "no-store",
      },
    );

    return normalizeApiKeys(payload);
  },

  async create(input: CreateApiKeyRequest): Promise<CreateApiKeyResponse> {
    const payload = await fetchWithAuth<CreateApiKeyWire>(
      "/dashboard/api-keys",
      {
        method: "POST",
        body: input,
      },
    );

    return normalizeCreatedKey(payload);
  },

  async revoke(id: string): Promise<void> {
    await fetchWithAuth<null>(`/dashboard/api-keys/${id}`, {
      method: "DELETE",
    });
  },
};

export const usage = {
  async getMonthly(): Promise<DashboardMonthlyUsage> {
    const payload = await fetchWithAuth<MonthlyUsageWire | MonthlyUsageEnvelope>(
      "/dashboard/usage/monthly",
      {
        method: "GET",
        cache: "no-store",
      },
    );

    return normalizeUsage(payload);
  },
};

export const billing = {
  async createCheckout(): Promise<BillingRedirect> {
    const payload = await fetchWithAuth<BillingLinkWire>(
      "/dashboard/billing/checkout",
      {
        method: "POST",
      },
    );

    return normalizeBillingLink(payload);
  },

  async createPortal(): Promise<BillingRedirect> {
    const payload = await fetchWithAuth<BillingLinkWire>(
      "/dashboard/billing/portal",
      {
        method: "POST",
      },
    );

    return normalizeBillingLink(payload);
  },
};
