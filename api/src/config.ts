import type { AppConfig, Bindings } from "./types";

const DEFAULT_ENABLED_TRACKS = ["broll", "knowledge"];
const DEFAULT_ADMIN_EMAILS: string[] = [];

function firstNonEmpty(...values: Array<string | undefined | null>): string | null {
  for (const value of values) {
    const cleaned = (value ?? "").trim();
    if (cleaned) {
      return cleaned;
    }
  }

  return null;
}

function parseBoolean(value: string | undefined | null, fallback: boolean): boolean {
  const normalized = (value ?? "").trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (["true", "1", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function parseInteger(value: string | undefined | null, fallback: number): number {
  const parsed = Number.parseInt((value ?? "").trim(), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseAdminEmails(value: string | undefined | null): string[] {
  const source = (value ?? "").trim();
  if (!source) {
    return DEFAULT_ADMIN_EMAILS;
  }

  return [...new Set(source.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean))];
}

function normalizeEmbeddingBackend(value: string | undefined | null): "gemini" | "openai_compatible" {
  return (value ?? "").trim().toLowerCase() === "openai_compatible"
    ? "openai_compatible"
    : "gemini";
}

export function allowedWebOrigins(env: Bindings): string[] {
  const origins: string[] = [];

  for (const value of [
    env.WEB_BASE_URL,
    env.NEXT_PUBLIC_SITE_URL,
    "http://localhost:3000",
    "http://127.0.0.1:3000"
  ]) {
    const normalized = (value ?? "").trim().replace(/\/+$/, "");
    if (normalized && !origins.includes(normalized)) {
      origins.push(normalized);
    }
  }

  return origins;
}

export function getConfig(env: Bindings): AppConfig {
  const environment = firstNonEmpty(env.CERUL_ENV, "development") ?? "development";
  const webBaseUrl = firstNonEmpty(env.WEB_BASE_URL, env.NEXT_PUBLIC_SITE_URL, "http://localhost:3000") ?? "http://localhost:3000";
  const apiBaseUrl = firstNonEmpty(env.API_BASE_URL, env.NEXT_PUBLIC_API_BASE_URL, "http://localhost:8000") ?? "http://localhost:8000";
  const embeddingBackend = normalizeEmbeddingBackend(env.EMBEDDING_BACKEND);

  return {
    environment,
    public: {
      appEnv: environment,
      apiBaseUrl,
      webBaseUrl,
      demoMode: parseBoolean(env.DEMO_MODE, false),
      defaultTrack: "broll",
      enabledTracks: DEFAULT_ENABLED_TRACKS
    },
    search: {
      mmrLambda: 0.75,
      clipScoreThreshold: null
    },
    embedding: {
      backend: embeddingBackend,
      model: firstNonEmpty(env.EMBEDDING_MODEL, "gemini-embedding-2-preview") ?? "gemini-embedding-2-preview",
      dimension: parseInteger(env.EMBEDDING_DIMENSION, 3072),
      normalize: parseBoolean(env.EMBEDDING_NORMALIZE, true),
      openaiBaseUrl: firstNonEmpty(env.EMBEDDING_OPENAI_BASE_URL),
      openaiApiKey: firstNonEmpty(env.EMBEDDING_OPENAI_API_KEY),
      openaiModel: firstNonEmpty(env.EMBEDDING_OPENAI_MODEL)
    },
    knowledge: {
      sceneThreshold: 0.35,
      denseVisualFramesPerSegment: 5,
      rerankTopN: 30,
      rerankModel: firstNonEmpty(env.RERANK_MODEL, "jina-reranker-v3") ?? "jina-reranker-v3",
      rerankPromptTemplate: "default",
      download: {
        maxHeight: 480
      }
    },
    dashboard: {
      adminEmails: parseAdminEmails(env.ADMIN_CONSOLE_EMAILS)
    },
    stripe: {
      secretKey: firstNonEmpty(env.STRIPE_SECRET_KEY),
      webhookSecret: firstNonEmpty(env.STRIPE_WEBHOOK_SECRET),
      proPriceId: firstNonEmpty(env.STRIPE_PRO_PRICE_ID)
    },
    r2: {
      bucketName: firstNonEmpty(env.R2_BUCKET_NAME, "cerul-cdn") ?? "cerul-cdn",
      publicUrl: (firstNonEmpty(env.R2_PUBLIC_URL) ?? "").replace(/\/+$/, "")
    },
    betterAuthSecret: firstNonEmpty(env.BETTER_AUTH_SECRET)
  };
}
