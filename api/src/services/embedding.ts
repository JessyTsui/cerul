import type { AppConfig, Bindings, ResolvedQueryImage } from "../types";
import { toBase64 } from "../utils/crypto";

const DEFAULT_GEMINI_EMBEDDING_MODEL = "gemini-embedding-2-preview";
const DEFAULT_GEMINI_EMBEDDING_DIMENSION = 768;
const DEFAULT_OPENAI_COMPATIBLE_EMBEDDING_DIMENSION = 2048;
const DEFAULT_OPENAI_COMPATIBLE_EMBEDDING_MODEL = "default";
const TASK_RETRIEVAL_DOCUMENT = "RETRIEVAL_DOCUMENT";
const TASK_RETRIEVAL_QUERY = "RETRIEVAL_QUERY";

export interface EmbeddingClient {
  readonly name: string;
  readonly dimension: number;
  embedText(text: string): Promise<number[]>;
  embedQuery(text: string): Promise<number[]>;
  embedQueryWithImage(text: string | null, image: ResolvedQueryImage): Promise<number[]>;
}

function l2Normalize(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (norm === 0) {
    return vector;
  }
  return vector.map((value) => value / norm);
}

function ensureVectorLength(vector: number[], expectedDimension: number, source: string): number[] {
  if (vector.length !== expectedDimension) {
    throw new Error(`${source} embedding dimension mismatch: expected ${expectedDimension}, got ${vector.length}.`);
  }
  return vector;
}

function extractEmbeddingValues(payload: any): number[] {
  const embeddings = payload?.embeddings ?? (payload?.embedding ? [payload.embedding] : null);
  const firstEmbedding = Array.isArray(embeddings) ? embeddings[0] : payload?.embedding ?? embeddings;
  const rawValues = firstEmbedding?.values ?? firstEmbedding ?? payload?.data?.[0]?.embedding;
  if (!Array.isArray(rawValues)) {
    throw new Error("Embedding payload is missing values.");
  }
  return rawValues.map((value) => Number(value));
}

class GeminiEmbeddingClient implements EmbeddingClient {
  readonly name: string;
  readonly dimension: number;

  constructor(
    private readonly env: Bindings,
    private readonly config: AppConfig,
    outputDimension?: number
  ) {
    this.name = config.embedding.model || DEFAULT_GEMINI_EMBEDDING_MODEL;
    this.dimension = outputDimension ?? config.embedding.dimension ?? DEFAULT_GEMINI_EMBEDDING_DIMENSION;
  }

  async embedText(text: string): Promise<number[]> {
    return this.embed(text, TASK_RETRIEVAL_DOCUMENT);
  }

  async embedQuery(text: string): Promise<number[]> {
    return this.embed(text, TASK_RETRIEVAL_QUERY);
  }

  async embedQueryWithImage(text: string | null, image: ResolvedQueryImage): Promise<number[]> {
    const apiKey = (this.env.GEMINI_API_KEY ?? "").trim();
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not set.");
    }

    const parts: any[] = [];
    if ((text ?? "").trim()) {
      parts.push({ text: text!.trim() });
    }
    parts.push({
      inlineData: {
        mimeType: image.mimeType,
        data: toBase64(image.bytes)
      }
    });

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${this.name}:embedContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: { parts },
          taskType: TASK_RETRIEVAL_QUERY,
          outputDimensionality: this.dimension
        })
      }
    );

    if (!response.ok) {
      throw new Error(`Gemini embedding request failed: ${response.status}`);
    }

    const payload = await response.json();
    let vector = ensureVectorLength(extractEmbeddingValues(payload), this.dimension, "Gemini");
    if (this.config.embedding.normalize && this.dimension !== 3072) {
      vector = l2Normalize(vector);
    }
    return vector;
  }

  private async embed(text: string, taskType: string): Promise<number[]> {
    if (!text.trim()) {
      throw new Error("text must not be empty.");
    }

    const apiKey = (this.env.GEMINI_API_KEY ?? "").trim();
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not set.");
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${this.name}:embedContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: {
            parts: [{ text }]
          },
          taskType,
          outputDimensionality: this.dimension
        })
      }
    );

    if (!response.ok) {
      throw new Error(`Gemini embedding request failed: ${response.status}`);
    }

    const payload = await response.json();
    let vector = ensureVectorLength(extractEmbeddingValues(payload), this.dimension, "Gemini");
    if (this.config.embedding.normalize && this.dimension !== 3072) {
      vector = l2Normalize(vector);
    }
    return vector;
  }
}

class OpenAICompatibleEmbeddingClient implements EmbeddingClient {
  readonly name: string;
  readonly dimension: number;

  constructor(
    private readonly env: Bindings,
    private readonly config: AppConfig,
    outputDimension?: number
  ) {
    const model = this.config.embedding.openaiModel ?? DEFAULT_OPENAI_COMPATIBLE_EMBEDDING_MODEL;
    this.name = `openai_compatible:${model}`;
    this.dimension = outputDimension ?? this.config.embedding.dimension ?? DEFAULT_OPENAI_COMPATIBLE_EMBEDDING_DIMENSION;
  }

  async embedText(text: string): Promise<number[]> {
    return this.request(text);
  }

  async embedQuery(text: string): Promise<number[]> {
    return this.request(text);
  }

  async embedQueryWithImage(text: string | null, image: ResolvedQueryImage): Promise<number[]> {
    const parts: Record<string, unknown>[] = [];
    if ((text ?? "").trim()) {
      parts.push({ type: "text", text: text!.trim() });
    }
    parts.push({
      type: "image_url",
      image_url: {
        url: `data:${image.mimeType};base64,${toBase64(image.bytes)}`
      }
    });
    return this.request(parts);
  }

  private async request(input: unknown): Promise<number[]> {
    const baseUrl = (this.config.embedding.openaiBaseUrl ?? "").replace(/\/+$/, "");
    if (!baseUrl) {
      throw new Error("EMBEDDING_OPENAI_BASE_URL is required for openai_compatible backend.");
    }

    const apiKey = (this.env.EMBEDDING_OPENAI_API_KEY ?? this.config.embedding.openaiApiKey ?? "no-key").trim() || "no-key";
    const model = this.config.embedding.openaiModel ?? DEFAULT_OPENAI_COMPATIBLE_EMBEDDING_MODEL;
    const response = await fetch(`${baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model,
        input,
        dimensions: this.dimension
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI-compatible embedding request failed: ${response.status}`);
    }

    const payload = await response.json();
    return ensureVectorLength(extractEmbeddingValues(payload), this.dimension, "OpenAI-compatible");
  }
}

export function createEmbeddingClient(env: Bindings, config: AppConfig, outputDimension?: number): EmbeddingClient {
  if (config.embedding.backend === "openai_compatible") {
    return new OpenAICompatibleEmbeddingClient(env, config, outputDimension);
  }
  return new GeminiEmbeddingClient(env, config, outputDimension);
}
