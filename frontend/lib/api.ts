import { buildConsoleProxyPath } from "./console-api";

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

type CreditBreakdownWire = {
  included_remaining?: number;
  topup_remaining?: number;
  bonus_remaining?: number;
};

type ExpiringCreditWire = {
  grant_type?: string;
  credits?: number;
  expires_at?: string;
};

type MonthlyUsageWire = {
  tier: string;
  plan_code?: string;
  period_start: string;
  period_end: string;
  credits_limit: number;
  credits_used: number;
  credits_remaining: number;
  wallet_balance?: number;
  credit_breakdown?: CreditBreakdownWire;
  expiring_credits?: ExpiringCreditWire[];
  request_count?: number;
  api_keys_active?: number;
  rate_limit_per_sec?: number | null;
  has_stripe_customer?: boolean;
  billing_hold?: boolean;
  daily_breakdown?: DailyUsageWire[];
};

type MonthlyUsageEnvelope = {
  usage?: MonthlyUsageWire;
};

type BillingLinkWire = {
  url?: string;
  checkout_url?: string;
  portal_url?: string;
  product_code?: string;
};

type BillingCatalogProductWire = {
  code?: string;
  name?: string;
  description?: string;
  kind?: "subscription" | "topup";
  planCode?: string;
  plan_code?: string;
  credits?: number;
  amountCents?: number;
  amount_cents?: number;
  currency?: string;
  priceDisplay?: string;
  price_display?: string;
  cadence?: string;
  allowPromotionCodes?: boolean;
  allow_promotion_codes?: boolean;
  stripePriceId?: string | null;
  stripe_price_id?: string | null;
  isConfigured?: boolean;
  is_configured?: boolean;
};

type BillingCatalogWire = {
  plan_code?: string;
  wallet_balance?: number;
  credit_breakdown?: CreditBreakdownWire;
  expiring_credits?: ExpiringCreditWire[];
  referral?: {
    code?: string;
    bonus_credits?: number;
    reward_delay_days?: number;
    redeemed_code?: string | null;
    status?: string | null;
  };
  products?: BillingCatalogProductWire[];
};

type JobStatusWire = "pending" | "running" | "retrying" | "completed" | "failed";
type JobTrackWire = "broll" | "knowledge" | "unified";
type JobStepStatusWire = "pending" | "running" | "completed" | "failed" | "skipped";

type JobSummaryWire = {
  id: string;
  track: JobTrackWire;
  job_type: string;
  status: JobStatusWire;
  attempts: number;
  max_attempts: number;
  error_message?: string | null;
  created_at: string;
  started_at?: string | null;
  completed_at?: string | null;
  updated_at: string;
};

type JobListWire = {
  jobs?: JobSummaryWire[];
  items?: JobSummaryWire[];
  total_count?: number;
  total?: number;
};

type JobStepDetailWire = {
  id: string;
  step_name: string;
  status: JobStepStatusWire;
  artifacts?: unknown;
  error_message?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  updated_at: string;
  duration_ms?: number | null;
  guidance?: string | null;
  logs?: Array<{
    at?: string | null;
    level?: string | null;
    message?: string | null;
    details?: unknown;
  }>;
};

type JobDetailWire = JobSummaryWire & {
  source_id?: string | null;
  input_payload?: unknown;
  locked_by?: string | null;
  locked_at?: string | null;
  next_retry_at?: string | null;
  steps?: JobStepDetailWire[];
};

type JobStatsTrackWire = {
  broll?: number;
  knowledge?: number;
  unified?: number;
};

type JobStatsWire = {
  total: number;
  pending: number;
  running: number;
  retrying: number;
  completed: number;
  failed: number;
  tracks?: JobStatsTrackWire;
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
  planCode: string;
  periodStart: string;
  periodEnd: string;
  creditsLimit: number;
  creditsUsed: number;
  creditsRemaining: number;
  walletBalance: number;
  creditBreakdown: {
    includedRemaining: number;
    topupRemaining: number;
    bonusRemaining: number;
  };
  expiringCredits: Array<{
    grantType: string;
    credits: number;
    expiresAt: string;
  }>;
  requestCount: number;
  apiKeysActive: number;
  rateLimitPerSec: number | null;
  hasStripeCustomer: boolean;
  billingHold: boolean;
  dailyBreakdown: DashboardUsageDay[];
};

export type BillingRedirect = {
  url: string;
};

export type BillingProduct = {
  code: string;
  name: string;
  description: string;
  kind: "subscription" | "topup";
  planCode: string;
  credits: number;
  amountCents: number;
  currency: string;
  priceDisplay: string;
  cadence: string;
  allowPromotionCodes: boolean;
  stripePriceId: string | null;
  isConfigured: boolean;
};

export type BillingCatalog = {
  planCode: string;
  walletBalance: number;
  creditBreakdown: {
    includedRemaining: number;
    topupRemaining: number;
    bonusRemaining: number;
  };
  expiringCredits: Array<{
    grantType: string;
    credits: number;
    expiresAt: string;
  }>;
  referral: {
    code: string;
    bonusCredits: number;
    rewardDelayDays: number;
    redeemedCode: string | null;
    status: string | null;
  };
  products: BillingProduct[];
};

export type BillingCheckoutRequest = {
  productCode?: string;
};

export type JobStatus = JobStatusWire;
export type JobTrack = JobTrackWire;
export type JobStepStatus = JobStepStatusWire;

export type JobListParams = {
  status?: JobStatus;
  track?: JobTrack;
  limit?: number;
  offset?: number;
};

export type DashboardJobSummary = {
  id: string;
  track: JobTrack;
  jobType: string;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
};

export type DashboardJobStep = {
  id: string;
  stepName: string;
  status: JobStepStatus;
  artifacts: unknown;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
  durationMs: number | null;
  guidance: string | null;
  logs: Array<{
    at: string | null;
    level: string;
    message: string;
    details: Record<string, unknown> | null;
  }>;
};

export type DashboardJobDetail = DashboardJobSummary & {
  sourceId: string | null;
  inputPayload: unknown;
  lockedBy: string | null;
  lockedAt: string | null;
  nextRetryAt: string | null;
  steps: DashboardJobStep[];
};

export type DashboardJobList = {
  jobs: DashboardJobSummary[];
  totalCount: number;
};

export type DashboardJobStats = {
  total: number;
  pending: number;
  running: number;
  retrying: number;
  completed: number;
  failed: number;
  tracks: {
    broll: number;
    knowledge: number;
    unified: number;
  };
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
    return "Could not reach the dashboard API. Verify NEXT_PUBLIC_API_BASE_URL or API_BASE_URL and ensure the API is reachable from the frontend proxy.";
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

function buildUrl(path: string): string {
  return buildConsoleProxyPath(path);
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

function isExpiringCreditWire(value: unknown): value is ExpiringCreditWire {
  return (
    isPlainObject(value) &&
    typeof value.grant_type === "string" &&
    isFiniteNumber(value.credits) &&
    typeof value.expires_at === "string"
  );
}

function isJobStatus(value: unknown): value is JobStatus {
  return (
    value === "pending" ||
    value === "running" ||
    value === "retrying" ||
    value === "completed" ||
    value === "failed"
  );
}

function isJobTrack(value: unknown): value is JobTrack {
  return value === "broll" || value === "knowledge" || value === "unified";
}

function isJobStepStatus(value: unknown): value is JobStepStatus {
  return (
    value === "pending" ||
    value === "running" ||
    value === "completed" ||
    value === "failed" ||
    value === "skipped"
  );
}

function isJobSummaryWire(value: unknown): value is JobSummaryWire {
  return (
    isPlainObject(value) &&
    typeof value.id === "string" &&
    isJobTrack(value.track) &&
    typeof value.job_type === "string" &&
    isJobStatus(value.status) &&
    isFiniteNumber(value.attempts) &&
    isFiniteNumber(value.max_attempts) &&
    (value.error_message === undefined ||
      value.error_message === null ||
      typeof value.error_message === "string") &&
    typeof value.created_at === "string" &&
    (value.started_at === undefined ||
      value.started_at === null ||
      typeof value.started_at === "string") &&
    (value.completed_at === undefined ||
      value.completed_at === null ||
      typeof value.completed_at === "string") &&
    typeof value.updated_at === "string"
  );
}

function isJobStepDetailWire(value: unknown): value is JobStepDetailWire {
  return (
    isPlainObject(value) &&
    typeof value.id === "string" &&
    typeof value.step_name === "string" &&
    isJobStepStatus(value.status) &&
    (value.error_message === undefined ||
      value.error_message === null ||
      typeof value.error_message === "string") &&
    (value.started_at === undefined ||
      value.started_at === null ||
      typeof value.started_at === "string") &&
    (value.completed_at === undefined ||
      value.completed_at === null ||
      typeof value.completed_at === "string") &&
    typeof value.updated_at === "string"
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
    planCode:
      typeof usagePayload.plan_code === "string"
        ? usagePayload.plan_code
        : usagePayload.tier,
    periodStart: usagePayload.period_start,
    periodEnd: usagePayload.period_end,
    creditsLimit: usagePayload.credits_limit,
    creditsUsed: usagePayload.credits_used,
    creditsRemaining: usagePayload.credits_remaining,
    walletBalance:
      typeof usagePayload.wallet_balance === "number"
        ? usagePayload.wallet_balance
        : usagePayload.credits_remaining,
    creditBreakdown: {
      includedRemaining:
        typeof usagePayload.credit_breakdown?.included_remaining === "number"
          ? usagePayload.credit_breakdown.included_remaining
          : 0,
      topupRemaining:
        typeof usagePayload.credit_breakdown?.topup_remaining === "number"
          ? usagePayload.credit_breakdown.topup_remaining
          : 0,
      bonusRemaining:
        typeof usagePayload.credit_breakdown?.bonus_remaining === "number"
          ? usagePayload.credit_breakdown.bonus_remaining
          : 0,
    },
    expiringCredits: Array.isArray(usagePayload.expiring_credits)
      ? usagePayload.expiring_credits
          .filter((entry): entry is ExpiringCreditWire => isExpiringCreditWire(entry))
          .map((entry) => ({
            grantType: entry.grant_type ?? "unknown",
            credits: entry.credits ?? 0,
            expiresAt: entry.expires_at ?? "",
          }))
      : [],
    requestCount: usagePayload.request_count ?? 0,
    apiKeysActive: usagePayload.api_keys_active ?? 0,
    rateLimitPerSec:
      typeof usagePayload.rate_limit_per_sec === "number"
        ? usagePayload.rate_limit_per_sec
        : null,
    hasStripeCustomer: usagePayload.has_stripe_customer === true,
    billingHold: usagePayload.billing_hold === true,
    dailyBreakdown,
  };
}

function normalizeBillingProduct(payload: unknown): BillingProduct | null {
  if (!isPlainObject(payload) || typeof payload.code !== "string" || typeof payload.name !== "string") {
    return null;
  }

  const kind = payload.kind === "subscription" ? "subscription" : payload.kind === "topup" ? "topup" : null;
  if (!kind) {
    return null;
  }

  return {
    code: payload.code,
    name: payload.name,
    description: typeof payload.description === "string" ? payload.description : "",
    kind,
    planCode:
      typeof payload.plan_code === "string"
        ? payload.plan_code
        : typeof payload.planCode === "string"
          ? payload.planCode
          : "free",
    credits:
      typeof payload.credits === "number"
        ? payload.credits
        : 0,
    amountCents:
      typeof payload.amount_cents === "number"
        ? payload.amount_cents
        : typeof payload.amountCents === "number"
          ? payload.amountCents
          : 0,
    currency: typeof payload.currency === "string" ? payload.currency : "usd",
    priceDisplay:
      typeof payload.price_display === "string"
        ? payload.price_display
        : typeof payload.priceDisplay === "string"
          ? payload.priceDisplay
          : "",
    cadence: typeof payload.cadence === "string" ? payload.cadence : "",
    allowPromotionCodes:
      payload.allow_promotion_codes === true || payload.allowPromotionCodes === true,
    stripePriceId:
      typeof payload.stripe_price_id === "string"
        ? payload.stripe_price_id
        : typeof payload.stripePriceId === "string"
          ? payload.stripePriceId
          : null,
    isConfigured:
      payload.is_configured === true || payload.isConfigured === true,
  };
}

function normalizeBillingCatalog(payload: unknown): BillingCatalog {
  if (!isPlainObject(payload)) {
    throw new ApiClientError("Invalid billing catalog response.", {
      status: 500,
      code: "invalid_payload",
      details: payload,
    });
  }

  const products = Array.isArray(payload.products)
    ? payload.products
        .map((entry) => normalizeBillingProduct(entry))
        .filter((entry): entry is BillingProduct => entry !== null)
    : [];
  const breakdown = isPlainObject(payload.credit_breakdown) ? payload.credit_breakdown : {};
  const referral = isPlainObject(payload.referral) ? payload.referral : {};

  return {
    planCode: typeof payload.plan_code === "string" ? payload.plan_code : "free",
    walletBalance: typeof payload.wallet_balance === "number" ? payload.wallet_balance : 0,
    creditBreakdown: {
      includedRemaining:
        typeof breakdown.included_remaining === "number"
          ? breakdown.included_remaining
          : 0,
      topupRemaining:
        typeof breakdown.topup_remaining === "number"
          ? breakdown.topup_remaining
          : 0,
      bonusRemaining:
        typeof breakdown.bonus_remaining === "number"
          ? breakdown.bonus_remaining
          : 0,
    },
    expiringCredits: Array.isArray(payload.expiring_credits)
      ? payload.expiring_credits
          .filter((entry): entry is ExpiringCreditWire => isExpiringCreditWire(entry))
          .map((entry) => ({
            grantType: entry.grant_type ?? "unknown",
            credits: entry.credits ?? 0,
            expiresAt: entry.expires_at ?? "",
          }))
      : [],
    referral: {
      code: typeof referral.code === "string" ? referral.code : "",
      bonusCredits:
        typeof referral.bonus_credits === "number"
          ? referral.bonus_credits
          : 0,
      rewardDelayDays:
        typeof referral.reward_delay_days === "number"
          ? referral.reward_delay_days
          : 0,
      redeemedCode:
        typeof referral.redeemed_code === "string"
          ? referral.redeemed_code
          : null,
      status:
        typeof referral.status === "string"
          ? referral.status
          : null,
    },
    products,
  };
}

function normalizeJobSummary(input: JobSummaryWire): DashboardJobSummary {
  return {
    id: input.id,
    track: input.track,
    jobType: input.job_type,
    status: input.status,
    attempts: input.attempts,
    maxAttempts: input.max_attempts,
    errorMessage: input.error_message ?? null,
    createdAt: input.created_at,
    startedAt: input.started_at ?? null,
    completedAt: input.completed_at ?? null,
    updatedAt: input.updated_at,
  };
}

function normalizeJobList(payload: unknown): DashboardJobList {
  if (!isPlainObject(payload)) {
    throw new ApiClientError("Invalid job list response.", {
      status: 500,
      code: "invalid_payload",
      details: payload,
    });
  }

  const items = Array.isArray(payload.jobs)
    ? payload.jobs
    : Array.isArray(payload.items)
      ? payload.items
      : null;
  const totalCount =
    typeof payload.total_count === "number"
      ? payload.total_count
      : typeof payload.total === "number"
        ? payload.total
        : null;

  if (!items || totalCount === null) {
    throw new ApiClientError("Job list response is missing pagination fields.", {
      status: 500,
      code: "invalid_payload",
      details: payload,
    });
  }

  const jobs = items
    .filter((item): item is JobSummaryWire => isJobSummaryWire(item))
    .map((item) => normalizeJobSummary(item));

  if (items.length > 0 && jobs.length === 0) {
    throw new ApiClientError("Job list response did not include valid jobs.", {
      status: 500,
      code: "invalid_payload",
      details: payload,
    });
  }

  return {
    jobs,
    totalCount,
  };
}

function normalizeJobStep(input: JobStepDetailWire): DashboardJobStep {
  return {
    id: input.id,
    stepName: input.step_name,
    status: input.status,
    artifacts: input.artifacts ?? {},
    errorMessage: input.error_message ?? null,
    startedAt: input.started_at ?? null,
    completedAt: input.completed_at ?? null,
    updatedAt: input.updated_at,
    durationMs:
      typeof input.duration_ms === "number" && Number.isFinite(input.duration_ms)
        ? input.duration_ms
        : null,
    guidance: typeof input.guidance === "string" ? input.guidance : null,
    logs: Array.isArray(input.logs)
      ? input.logs
          .map((entry) => {
            if (!isPlainObject(entry) || typeof entry.message !== "string") {
              return null;
            }
            return {
              at: typeof entry.at === "string" ? entry.at : null,
              level: typeof entry.level === "string" ? entry.level : "info",
              message: entry.message,
              details: isPlainObject(entry.details) ? entry.details : null,
            };
          })
          .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      : [],
  };
}

function normalizeJobDetail(payload: unknown): DashboardJobDetail {
  if (!isPlainObject(payload) || !isJobSummaryWire(payload)) {
    throw new ApiClientError("Invalid job detail response.", {
      status: 500,
      code: "invalid_payload",
      details: payload,
    });
  }

  const jobPayload = payload as JobDetailWire;
  const steps = Array.isArray(jobPayload.steps)
    ? jobPayload.steps
        .filter((step): step is JobStepDetailWire => isJobStepDetailWire(step))
        .map((step) => normalizeJobStep(step))
    : [];

  return {
    ...normalizeJobSummary(jobPayload),
    sourceId: typeof jobPayload.source_id === "string" ? jobPayload.source_id : null,
    inputPayload: jobPayload.input_payload ?? {},
    lockedBy: typeof jobPayload.locked_by === "string" ? jobPayload.locked_by : null,
    lockedAt: typeof jobPayload.locked_at === "string" ? jobPayload.locked_at : null,
    nextRetryAt:
      typeof jobPayload.next_retry_at === "string" ? jobPayload.next_retry_at : null,
    steps,
  };
}

function normalizeJobStats(payload: unknown): DashboardJobStats {
  if (
    !isPlainObject(payload) ||
    !isFiniteNumber(payload.total) ||
    !isFiniteNumber(payload.pending) ||
    !isFiniteNumber(payload.running) ||
    !isFiniteNumber(payload.retrying) ||
    !isFiniteNumber(payload.completed) ||
    !isFiniteNumber(payload.failed) ||
    !isPlainObject(payload.tracks)
  ) {
    throw new ApiClientError("Invalid job stats response.", {
      status: 500,
      code: "invalid_payload",
      details: payload,
    });
  }

  return {
    total: payload.total,
    pending: payload.pending,
    running: payload.running,
    retrying: payload.retrying,
    completed: payload.completed,
    failed: payload.failed,
    tracks: {
      broll: isFiniteNumber(payload.tracks.broll) ? payload.tracks.broll : 0,
      knowledge: isFiniteNumber(payload.tracks.knowledge)
        ? payload.tracks.knowledge
        : 0,
      unified: isFiniteNumber(payload.tracks.unified)
        ? payload.tracks.unified
        : 0,
    },
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

function buildQueryString(
  params: Record<string, string | number | null | undefined>,
): string {
  const searchParams = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") {
      return;
    }

    searchParams.set(key, String(value));
  });

  const queryString = searchParams.toString();
  return queryString ? `?${queryString}` : "";
}

export async function fetchWithAuth<T>(
  path: string,
  options: FetchWithAuthOptions = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  let body = options.body;
  const isFormData = typeof FormData !== "undefined" && body instanceof FormData;

  if (isJsonBody(body)) {
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    body = JSON.stringify(body);
  } else if (isFormData) {
    // Let the browser set Content-Type with the correct multipart boundary.
    headers.delete("Content-Type");
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

export const jobs = {
  async list(params: JobListParams = {}): Promise<DashboardJobList> {
    const queryString = buildQueryString({
      status: params.status,
      track: params.track,
      limit: params.limit,
      offset: params.offset,
    });
    const payload = await fetchWithAuth<JobListWire>(
      `/dashboard/jobs${queryString}`,
      {
        method: "GET",
        cache: "no-store",
      },
    );

    return normalizeJobList(payload);
  },

  async get(jobId: string): Promise<DashboardJobDetail> {
    const payload = await fetchWithAuth<JobDetailWire>(`/dashboard/jobs/${jobId}`, {
      method: "GET",
      cache: "no-store",
    });

    return normalizeJobDetail(payload);
  },

  async getStats(): Promise<DashboardJobStats> {
    const payload = await fetchWithAuth<JobStatsWire>("/dashboard/jobs/stats", {
      method: "GET",
      cache: "no-store",
    });

    return normalizeJobStats(payload);
  },
};

export const billing = {
  async getCatalog(): Promise<BillingCatalog> {
    const payload = await fetchWithAuth<BillingCatalogWire>(
      "/dashboard/billing/catalog",
      {
        method: "GET",
        cache: "no-store",
      },
    );

    return normalizeBillingCatalog(payload);
  },

  async createCheckout(input: BillingCheckoutRequest = {}): Promise<BillingRedirect> {
    const payload = await fetchWithAuth<BillingLinkWire>(
      "/dashboard/billing/checkout",
      {
        method: "POST",
        body:
          typeof input.productCode === "string" && input.productCode.trim()
            ? { product_code: input.productCode }
            : {},
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

  async redeemReferral(code: string): Promise<BillingCatalog["referral"]> {
    const payload = await fetchWithAuth<{ referral?: BillingCatalogWire["referral"] }>(
      "/dashboard/billing/referrals/redeem",
      {
        method: "POST",
        body: { code },
      },
    );

    return normalizeBillingCatalog({
      referral: payload.referral ?? {},
    }).referral;
  },
};

export { admin } from "./admin-api";
export type {
  AdminContentSummary,
  AdminFailedJob,
  AdminFailedStep,
  AdminWorkersSummary,
  AdminMetricTarget,
  AdminMetricTargetInput,
  AdminMetricValue,
  AdminNotice,
  AdminQueryBucket,
  AdminRange,
  AdminRequestsSummary,
  AdminSourceFreshness,
  AdminSourceGrowth,
  AdminSourceHealth,
  AdminSummary,
  AdminSummaryPoint,
  AdminTargetComparisonMode,
  AdminTargetScopeType,
  AdminTargetsResponse,
  AdminUsersSummary,
  AdminWindow,
} from "./admin-api";
