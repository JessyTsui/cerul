export interface Bindings {
  DATABASE_URL: string;
  CERUL_ENV?: string;
  API_BASE_URL?: string;
  WEB_BASE_URL?: string;
  NEXT_PUBLIC_SITE_URL?: string;
  NEXT_PUBLIC_API_BASE_URL?: string;
  DEMO_MODE?: string;
  BETTER_AUTH_SECRET?: string;
  ADMIN_CONSOLE_EMAILS?: string;
  OPENAI_API_KEY?: string;
  GEMINI_API_KEY?: string;
  JINA_API_KEY?: string;
  YOUTUBE_API_KEY?: string;
  PEXELS_API_KEY?: string;
  PIXABAY_API_KEY?: string;
  EMBEDDING_BACKEND?: string;
  EMBEDDING_MODEL?: string;
  EMBEDDING_DIMENSION?: string;
  EMBEDDING_NORMALIZE?: string;
  EMBEDDING_OPENAI_BASE_URL?: string;
  EMBEDDING_OPENAI_API_KEY?: string;
  EMBEDDING_OPENAI_MODEL?: string;
  RERANK_MODEL?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRO_PRICE_ID?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  R2_BUCKET_NAME?: string;
  R2_PUBLIC_URL?: string;
  QUERY_IMAGES_BUCKET?: R2Bucket;
}

export interface AppConfig {
  environment: string;
  public: {
    appEnv: string;
    apiBaseUrl: string;
    webBaseUrl: string;
    demoMode: boolean;
    defaultTrack: string;
    enabledTracks: string[];
  };
  search: {
    mmrLambda: number;
    clipScoreThreshold: number | null;
  };
  embedding: {
    backend: "gemini" | "openai_compatible";
    model: string;
    dimension: number;
    normalize: boolean;
    openaiBaseUrl: string | null;
    openaiApiKey: string | null;
    openaiModel: string | null;
  };
  knowledge: {
    sceneThreshold: number;
    denseVisualFramesPerSegment: number;
    rerankTopN: number;
    rerankModel: string;
    rerankPromptTemplate: string;
    download: {
      maxHeight: number;
    };
  };
  dashboard: {
    adminEmails: string[];
  };
  stripe: {
    secretKey: string | null;
    webhookSecret: string | null;
    proPriceId: string | null;
  };
  email: {
    resendApiKey: string | null;
    from: string;
  };
  r2: {
    bucketName: string;
    publicUrl: string;
  };
  betterAuthSecret: string | null;
}

export interface AuthContext {
  userId: string;
  apiKeyId: string;
  tier: string;
  creditsRemaining: number;
  rateLimitPerSec: number;
}

export interface SessionContext {
  userId: string;
  email: string | null;
}

export interface ErrorDetail {
  code: string;
  message: string;
}

export interface ErrorResponse {
  error: ErrorDetail;
}

export interface UnifiedFilters {
  speaker?: string | null;
  published_after?: string | null;
  min_duration?: number | null;
  max_duration?: number | null;
  source?: string | null;
}

export interface SearchImageInput {
  url?: string | null;
  base64?: string | null;
}

export interface SearchRequest {
  query?: string | null;
  image?: SearchImageInput | null;
  max_results: number;
  ranking_mode: "embedding" | "rerank";
  include_summary: boolean;
  include_answer: boolean;
  filters?: UnifiedFilters | null;
}

export interface SearchResult {
  id: string;
  score: number;
  rerank_score?: number | null;
  url: string;
  title: string;
  snippet: string;
  transcript?: string | null;
  thumbnail_url?: string | null;
  keyframe_url?: string | null;
  duration: number;
  source: string;
  speaker?: string | null;
  timestamp_start?: number | null;
  timestamp_end?: number | null;
}

export interface SearchResponse {
  results: SearchResult[];
  answer?: string | null;
  credits_used: number;
  credits_remaining: number;
  request_id: string;
}

export interface UsageResponse {
  tier: string;
  plan_code?: string;
  period_start: string;
  period_end: string;
  credits_limit: number;
  credits_used: number;
  credits_remaining: number;
  wallet_balance?: number;
  credit_breakdown?: {
    included_remaining: number;
    bonus_remaining: number;
    paid_remaining: number;
  };
  expiring_credits?: Array<{
    grant_type: string;
    credits: number;
    expires_at: string;
  }>;
  rate_limit_per_sec: number;
  api_keys_active: number;
  billing_hold?: boolean;
  daily_free_remaining?: number;
  daily_free_limit?: number;
}

export interface IndexRequest {
  url: string;
  force?: boolean;
}

export interface SubmitIndexResponse {
  video_id: string;
  status: string;
  request_id: string;
}

export interface IndexStatusResponse {
  video_id: string;
  status: string;
  title?: string | null;
  current_step?: string | null;
  steps_completed?: number | null;
  steps_total?: number | null;
  duration?: number | null;
  units_created?: number | null;
  error?: string | null;
  created_at: string;
  completed_at?: string | null;
  failed_at?: string | null;
}

export interface IndexListItem {
  video_id: string;
  title: string;
  status: string;
  units_created: number;
  created_at: string;
  completed_at?: string | null;
}

export interface IndexListResponse {
  videos: IndexListItem[];
  total: number;
  page: number;
  per_page: number;
}

export interface DeleteIndexResponse {
  deleted: boolean;
}

export interface SearchExecution {
  results: SearchResult[];
  answer: string | null;
  tracking_links: TrackingLinkRecord[];
}

export interface TrackingLinkRecord {
  short_id: string;
  request_id: string;
  result_rank: number;
  unit_id: string;
  video_id: string;
  target_url: string;
  title: string;
  thumbnail_url?: string | null;
  source: string;
  speaker?: string | null;
  unit_type: string;
  timestamp_start?: number | null;
  timestamp_end?: number | null;
  transcript?: string | null;
  visual_desc?: string | null;
  keyframe_url?: string | null;
  score?: number | null;
}

export interface ResolvedQueryImage {
  bytes: Uint8Array;
  mimeType: string;
  extension: string;
}

export interface RateLimitLease {
  allowed: boolean;
  limit: number;
  remaining: number | null;
  retry_after_seconds: number;
}

export type DbRow = Record<string, unknown>;
