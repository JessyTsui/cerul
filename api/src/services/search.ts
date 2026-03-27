import type { DatabaseClient } from "../db/client";
import { createEmbeddingClient } from "./embedding";
import { LLMReranker } from "./rerank";
import { AnswerGenerator } from "./answer";
import type {
  AppConfig,
  Bindings,
  ResolvedQueryImage,
  SearchExecution,
  SearchRequest,
  SearchResult,
  TrackingLinkRecord
} from "../types";
import { randomShortId } from "../utils/crypto";

const DEFAULT_KNOWLEDGE_VECTOR_DIMENSION = 3072;
const DEFAULT_MMR_LAMBDA = 0.75;

function resolveMmrLambda(config: AppConfig, override?: number): number {
  const candidate = override ?? config.search.mmrLambda;
  return candidate >= 0 && candidate <= 1 ? candidate : DEFAULT_MMR_LAMBDA;
}

function vectorToLiteral(vector: number[]): string {
  return `[${vector.map((value) => value.toFixed(8)).join(",")}]`;
}

function parseVector(rawValue: unknown): number[] | null {
  if (rawValue == null) {
    return null;
  }
  if (Array.isArray(rawValue)) {
    return rawValue.map((value) => Number(value));
  }
  const normalized = String(rawValue).trim().replace(/^\[/, "").replace(/\]$/, "");
  if (!normalized) {
    return [];
  }
  return normalized.split(",").map((value) => Number(value));
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length !== right.length) {
    return 0;
  }
  const numerator = left.reduce((sum, value, index) => sum + value * right[index], 0);
  const leftNorm = Math.sqrt(left.reduce((sum, value) => sum + value * value, 0));
  const rightNorm = Math.sqrt(right.reduce((sum, value) => sum + value * value, 0));
  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }
  return numerator / (leftNorm * rightNorm);
}

function mmrDiversify<T>(
  candidates: T[],
  embeddings: Array<number[] | null>,
  limit: number,
  lambdaMultiplier: number,
  relevanceScores?: number[]
): T[] {
  if (limit <= 0 || candidates.length === 0) {
    return [];
  }

  const selectionLimit = Math.min(limit, candidates.length);
  const selectedIndexes: number[] = [];
  const remainingIndexes = candidates.map((_, index) => index);

  while (remainingIndexes.length > 0 && selectedIndexes.length < selectionLimit) {
    let bestIndex: number | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const candidateIndex of remainingIndexes) {
      const candidateEmbedding = embeddings[candidateIndex];
      const relevance = relevanceScores?.[candidateIndex] ?? 1;
      let diversityPenalty = 0;

      if (selectedIndexes.length > 0 && candidateEmbedding) {
        const similarities = selectedIndexes
          .map((selectedIndex) => embeddings[selectedIndex])
          .filter((embedding): embedding is number[] => Array.isArray(embedding))
          .map((embedding) => cosineSimilarity(candidateEmbedding, embedding));
        diversityPenalty = similarities.length > 0 ? Math.max(...similarities) : 0;
      }

      const mmrScore = lambdaMultiplier * relevance - (1 - lambdaMultiplier) * diversityPenalty;
      if (mmrScore > bestScore) {
        bestScore = mmrScore;
        bestIndex = candidateIndex;
      }
    }

    if (bestIndex == null) {
      break;
    }

    selectedIndexes.push(bestIndex);
    remainingIndexes.splice(remainingIndexes.indexOf(bestIndex), 1);
  }

  return selectedIndexes.map((index) => candidates[index]);
}

function clampScore(value: unknown): number {
  return Math.max(0, Math.min(Number(value ?? 0), 1));
}

function coerceOptionalFloat(value: unknown): number | null {
  return value == null ? null : Number(value);
}

function truncateText(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 3).trimEnd()}...`;
}

export class UnifiedSearchService {
  private readonly embeddingClient;
  private readonly reranker;
  private readonly answerGenerator;
  private readonly mmrLambda: number;

  constructor(
    private readonly db: DatabaseClient,
    private readonly env: Bindings,
    private readonly config: AppConfig,
    options?: { mmrLambda?: number }
  ) {
    this.embeddingClient = createEmbeddingClient(env, config, DEFAULT_KNOWLEDGE_VECTOR_DIMENSION);
    this.reranker = new LLMReranker(env, config);
    this.answerGenerator = new AnswerGenerator(env);
    this.mmrLambda = resolveMmrLambda(config, options?.mmrLambda);
  }

  async search(input: {
    payload: SearchRequest;
    userId: string;
    requestId: string;
    image?: ResolvedQueryImage | null;
    queryVector?: number[] | null;
  }): Promise<SearchExecution> {
    const queryVector = await this.resolveQueryVector(input.payload.query ?? null, input.image ?? null, input.queryVector ?? null);
    const allowedUnitTypes = input.payload.include_summary ? ["summary", "speech", "visual"] : ["speech", "visual"];
    const candidateLimitPerType = Math.min(Math.max(input.payload.max_results * 8, 24), 120);
    const candidateLimit = candidateLimitPerType * allowedUnitTypes.length;

    let candidateRows = await this.fetchUnitRows({
      filters: input.payload.filters ?? null,
      queryVector,
      userId: input.userId,
      limit: candidateLimit,
      allowedUnitTypes
    });

    candidateRows = this.dedupeRows(candidateRows);
    if (candidateRows.length === 0) {
      return { results: [], answer: null, tracking_links: [] };
    }

    candidateRows.sort((left, right) => Number(right.score ?? 0) - Number(left.score ?? 0));

    let selectedRows = candidateRows;
    if (input.payload.ranking_mode === "rerank" && (input.payload.query ?? "").trim()) {
      const rerankedRows = await this.reranker.rerank(input.payload.query!.trim(), candidateRows);
      const diversifiedRows = this.diversifyRows(rerankedRows, input.payload.max_results * 3);
      selectedRows = this.capPerVideo(diversifiedRows, 2).slice(0, input.payload.max_results);
    } else {
      selectedRows = candidateRows.slice(0, input.payload.max_results);
    }

    const answer = input.payload.include_answer
      ? await this.answerGenerator.generate(input.payload.query ?? "Image search query", selectedRows)
      : null;

    const trackingLinks: TrackingLinkRecord[] = [];
    const results: SearchResult[] = [];

    selectedRows.forEach((row, rank) => {
      const shortId = randomShortId(8);
      const trackingUrl = `${this.config.public.webBaseUrl.replace(/\/+$/, "")}/v/${shortId}`;
      const targetUrl = this.buildTargetUrl(row);
      trackingLinks.push({
        short_id: shortId,
        request_id: input.requestId,
        result_rank: rank,
        unit_id: String(row.id),
        video_id: String(row.video_id),
        target_url: targetUrl,
        title: String(row.title ?? ""),
        thumbnail_url: row.thumbnail_url == null ? null : String(row.thumbnail_url),
        source: String(row.source ?? ""),
        speaker: row.speaker == null ? null : String(row.speaker),
        unit_type: String(row.unit_type ?? "speech"),
        timestamp_start: coerceOptionalFloat(row.timestamp_start),
        timestamp_end: coerceOptionalFloat(row.timestamp_end),
        transcript: row.transcript_text == null ? null : String(row.transcript_text),
        visual_desc: row.visual_description == null ? String(row.visual_summary ?? "") || null : String(row.visual_description),
        keyframe_url: row.keyframe_url == null ? null : String(row.keyframe_url)
      });

      results.push({
        id: String(row.id),
        score: clampScore(row.score),
        rerank_score: row.rerank_score == null ? null : clampScore(row.rerank_score),
        url: trackingUrl,
        title: String(row.title ?? ""),
        snippet: this.buildSnippet(row),
        thumbnail_url: row.thumbnail_url == null ? null : String(row.thumbnail_url),
        keyframe_url: row.keyframe_url == null ? null : String(row.keyframe_url),
        duration: Number(row.duration ?? 0),
        source: String(row.source ?? ""),
        speaker: row.speaker == null ? null : String(row.speaker),
        timestamp_start: coerceOptionalFloat(row.timestamp_start),
        timestamp_end: coerceOptionalFloat(row.timestamp_end)
      });
    });

    return {
      results,
      answer,
      tracking_links: trackingLinks
    };
  }

  private async resolveQueryVector(query: string | null, image: ResolvedQueryImage | null, queryVector: number[] | null): Promise<number[]> {
    if (Array.isArray(queryVector)) {
      if (queryVector.length !== DEFAULT_KNOWLEDGE_VECTOR_DIMENSION) {
        throw new Error(`Query embedding dimension mismatch: expected ${DEFAULT_KNOWLEDGE_VECTOR_DIMENSION}, got ${queryVector.length}.`);
      }
      return queryVector.map((value) => Number(value));
    }

    if (image) {
      return this.embeddingClient.embedQueryWithImage(query, image);
    }
    if ((query ?? "").trim()) {
      return this.embeddingClient.embedQuery(query!.trim());
    }
    throw new Error("No query input provided.");
  }

  private async fetchUnitRows(input: {
    filters: SearchRequest["filters"] | null;
    queryVector: number[];
    userId: string;
    limit: number;
    allowedUnitTypes: string[];
  }): Promise<Array<Record<string, unknown>>> {
    const params: unknown[] = [vectorToLiteral(input.queryVector), input.allowedUnitTypes, input.userId];
    const conditions: string[] = [
      "ru.unit_type = ANY($2::text[])",
      "EXISTS (SELECT 1 FROM video_access AS va WHERE va.video_id = ru.video_id AND (va.owner_id IS NULL OR va.owner_id = $3))"
    ];

    if (input.filters?.speaker) {
      params.push(input.filters.speaker);
      conditions.push(`v.speaker = $${params.length}`);
    }
    if (input.filters?.published_after) {
      params.push(input.filters.published_after);
      conditions.push(`v.published_at >= $${params.length}`);
    }
    if (input.filters?.min_duration != null) {
      params.push(input.filters.min_duration);
      conditions.push(`v.duration_seconds >= $${params.length}`);
    }
    if (input.filters?.max_duration != null) {
      params.push(input.filters.max_duration);
      conditions.push(`v.duration_seconds <= $${params.length}`);
    }
    if (input.filters?.source) {
      params.push(input.filters.source);
      conditions.push(`v.source = $${params.length}`);
    }

    params.push(input.limit);
    const distanceSql =
      `(ru.embedding::halfvec(${DEFAULT_KNOWLEDGE_VECTOR_DIMENSION}) <=> ` +
      `($1::vector(${DEFAULT_KNOWLEDGE_VECTOR_DIMENSION}))::halfvec(${DEFAULT_KNOWLEDGE_VECTOR_DIMENSION}))`;

    return this.db.fetch(
      `
        SELECT
            ru.id::text AS id,
            v.id::text AS video_id,
            ru.unit_type,
            ru.unit_index,
            ru.content_text,
            ru.transcript AS transcript_text,
            ru.visual_desc AS visual_description,
            ru.visual_desc AS visual_summary,
            ru.metadata->>'visual_text_content' AS visual_text_content,
            ru.metadata->>'segment_title' AS segment_title,
            ru.visual_type,
            ru.keyframe_url,
            ru.timestamp_start,
            ru.timestamp_end,
            ru.embedding::text AS embedding,
            1 - ${distanceSql} AS score,
            v.title,
            v.description,
            v.source,
            v.source_url,
            v.video_url,
            v.thumbnail_url,
            v.duration_seconds AS duration,
            v.speaker,
            v.license,
            v.creator,
            v.published_at
        FROM retrieval_units AS ru
        JOIN videos AS v
            ON v.id = ru.video_id
        WHERE ${conditions.join(" AND ")}
        ORDER BY ${distanceSql}
        LIMIT $${params.length}
      `,
      ...(params as any[])
    );
  }

  private dedupeRows(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
    const byId = new Map<string, Record<string, unknown>>();
    for (const row of rows) {
      const rowId = String(row.id ?? "");
      if (rowId && !byId.has(rowId)) {
        byId.set(rowId, { ...row });
      }
    }

    const bySegmentKey = new Map<string, Record<string, unknown>>();
    for (const row of byId.values()) {
      const videoId = String(row.video_id ?? "");
      const timestampStart = row.timestamp_start;
      const timestampEnd = row.timestamp_end;
      const segmentKey =
        videoId && timestampStart != null && timestampEnd != null
          ? `${videoId}:${Number(timestampStart).toFixed(2)}-${Number(timestampEnd).toFixed(2)}`
          : String(row.id ?? "");

      const existing = bySegmentKey.get(segmentKey);
      if (!existing) {
        bySegmentKey.set(segmentKey, row);
        continue;
      }

      const existingScore = Number(existing.score ?? 0);
      const newScore = Number(row.score ?? 0);
      if (newScore > existingScore) {
        const merged = { ...row };
        this.mergeSegmentFields(merged, existing);
        bySegmentKey.set(segmentKey, merged);
      } else {
        this.mergeSegmentFields(existing, row);
      }
    }

    return [...bySegmentKey.values()];
  }

  private mergeSegmentFields(target: Record<string, unknown>, source: Record<string, unknown>): void {
    if (!target.transcript_text && source.transcript_text) {
      target.transcript_text = source.transcript_text;
    }
    if (!target.visual_description && source.visual_description) {
      target.visual_description = source.visual_description;
    }
    if (!target.visual_summary && source.visual_summary) {
      target.visual_summary = source.visual_summary;
    }
    if (!target.visual_text_content && source.visual_text_content) {
      target.visual_text_content = source.visual_text_content;
    }
  }

  private diversifyRows(rows: Array<Record<string, unknown>>, limit: number): Array<Record<string, unknown>> {
    const embeddings = rows.map((row) => parseVector(row.embedding));
    const relevanceScores = rows.map((row) => Number(row.rerank_score ?? row.score ?? 0));
    return mmrDiversify(rows, embeddings, limit, this.mmrLambda, relevanceScores);
  }

  private capPerVideo(rows: Array<Record<string, unknown>>, limit: number): Array<Record<string, unknown>> {
    const selected: Array<Record<string, unknown>> = [];
    const countsByVideo = new Map<string, number>();
    for (const row of rows) {
      const videoId = String(row.video_id ?? "");
      if (!videoId) {
        continue;
      }
      const count = countsByVideo.get(videoId) ?? 0;
      if (count >= limit) {
        continue;
      }
      countsByVideo.set(videoId, count + 1);
      selected.push(row);
    }
    return selected;
  }

  private buildTargetUrl(row: Record<string, unknown>): string {
    const targetUrl = String(row.source_url ?? row.video_url ?? "").trim();
    if (!targetUrl) {
      return this.config.public.webBaseUrl.replace(/\/+$/, "");
    }

    const timestampStart = coerceOptionalFloat(row.timestamp_start);
    if (timestampStart == null) {
      return targetUrl;
    }

    if (String(row.source ?? "").trim().toLowerCase() === "youtube") {
      const url = new URL(targetUrl);
      url.searchParams.set("t", String(Math.max(Math.trunc(timestampStart), 0)));
      return url.toString();
    }
    return targetUrl;
  }

  private buildSnippet(row: Record<string, unknown>): string {
    const rawValue =
      row.transcript_text ??
      row.visual_description ??
      row.visual_summary ??
      row.visual_text_content ??
      row.content_text ??
      row.description ??
      "";
    return truncateText(String(rawValue).trim(), 220);
  }
}
