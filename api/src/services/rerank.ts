import type { AppConfig, Bindings } from "../types";

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_RERANK_MODEL = "jina-reranker-v3";
const DEFAULT_JINA_BASE_URL = "https://api.jina.ai/v1";

function clampScore(score: number): number {
  return Math.max(0, Math.min(score, 10));
}

function coerceText(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function truncateText(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 3).trimEnd()}...`;
}

function buildJinaDocument(candidate: Record<string, unknown>): string {
  const parts: string[] = [];
  const title = coerceText(candidate.title);
  if (title) {
    parts.push(title);
  }
  const segmentTitle = coerceText(candidate.segment_title);
  if (segmentTitle && segmentTitle !== title) {
    parts.push(segmentTitle);
  }
  const transcript = truncateText(
    coerceText(candidate.transcript_text ?? candidate.description),
    1500
  );
  if (transcript) {
    parts.push(transcript);
  }
  const visual = truncateText(
    coerceText(candidate.visual_text_content ?? candidate.visual_description ?? candidate.visual_summary),
    500
  );
  if (visual) {
    parts.push(visual);
  }
  return parts.length > 0 ? parts.join("\n") : "N/A";
}

function buildRerankPrompt(query: string, candidate: Record<string, unknown>, templateName = "default"): string {
  if (templateName !== "default") {
    // Keep parity with Python behavior: unknown templates silently fall back.
  }
  const transcriptText = truncateText(coerceText(candidate.transcript_text ?? candidate.description), 2500);
  const visualDescription = truncateText(
    coerceText(
      candidate.visual_text_content ??
      candidate.visual_description ??
      candidate.visual_summary ??
      candidate.description
    ),
    1000
  );
  const visualType = coerceText(candidate.visual_type) || "unknown";
  const videoTitle = coerceText(candidate.title);
  const speaker = coerceText(candidate.speaker) || "Unknown speaker";
  const segmentTitle = coerceText(candidate.segment_title);

  return (
    "Search query:\n" +
    `${query}\n\n` +
    "Candidate segment:\n" +
    `Video title: ${videoTitle || "Untitled video"}\n` +
    `Segment title: ${segmentTitle || "Untitled segment"}\n` +
    `Speaker: ${speaker}\n` +
    `Transcript:\n${transcriptText || "N/A"}\n\n` +
    `Visual type: ${visualType}\n` +
    `Visual evidence:\n${visualDescription || "N/A"}\n\n` +
    "Score how useful this segment is for answering the search query.\n" +
    "Use 0 for irrelevant and 10 for highly relevant evidence.\n" +
    'Return JSON only, for example: {"score": 8.5}.'
  );
}

function extractMessageContent(payload: any): string {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map((item) => (typeof item?.text === "string" ? item.text : "")).join("").trim();
  }
  throw new Error("LLM response did not include message content.");
}

async function scoreWithJina(env: Bindings, modelName: string, query: string, candidates: Array<Record<string, unknown>>): Promise<number[]> {
  const apiKey = (env.JINA_API_KEY ?? "").trim();
  if (!apiKey) {
    throw new Error("JINA_API_KEY is not set.");
  }

  const response = await fetch(`${DEFAULT_JINA_BASE_URL}/rerank`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: modelName,
      query,
      documents: candidates.map(buildJinaDocument),
      top_n: candidates.length,
      truncation: true,
      return_documents: false
    })
  });
  if (!response.ok) {
    throw new Error(`Jina rerank request failed: ${response.status}`);
  }

  const payload = await response.json();
  const scores = new Array<number>(candidates.length).fill(0);
  for (const result of Array.isArray(payload?.results) ? payload.results : []) {
    const index = Number(result?.index ?? 0);
    if (index >= 0 && index < scores.length) {
      const relevanceScore = Number(result?.relevance_score ?? 0);
      scores[index] = Math.max(0, Math.min(relevanceScore, 1)) * 10;
    }
  }
  return scores;
}

async function scoreWithOpenAI(
  env: Bindings,
  config: AppConfig,
  modelName: string,
  query: string,
  candidates: Array<Record<string, unknown>>
): Promise<number[]> {
  const apiKey = (env.OPENAI_API_KEY ?? "").trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set.");
  }

  const baseUrl = DEFAULT_OPENAI_BASE_URL;
  const responses = await Promise.all(
    candidates.map(async (candidate) => {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: modelName,
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content: "You score how relevant a video segment is to a search query. Return JSON with a single numeric field named score from 0 to 10."
            },
            {
              role: "user",
              content: buildRerankPrompt(query, candidate, config.knowledge.rerankPromptTemplate)
            }
          ]
        })
      });
      if (!response.ok) {
        throw new Error(`OpenAI rerank request failed: ${response.status}`);
      }
      const payload = await response.json();
      const content = extractMessageContent(payload);
      const parsed = JSON.parse(content);
      return clampScore(Number(parsed.score ?? 0));
    })
  );

  return responses;
}

export class LLMReranker {
  private readonly topN: number;

  constructor(
    private readonly env: Bindings,
    private readonly config: AppConfig,
    topN?: number
  ) {
    this.topN = topN ?? config.knowledge.rerankTopN;
  }

  async rerank(query: string, candidates: Array<Record<string, unknown>>, topN?: number): Promise<Array<Record<string, unknown>>> {
    if (candidates.length === 0) {
      return [];
    }

    const candidateLimit = Math.min(topN ?? this.topN, candidates.length);
    const rerankCandidates = candidates.slice(0, candidateLimit).map((candidate) => ({ ...candidate }));
    const remainingCandidates = candidates.slice(candidateLimit).map((candidate) => ({ ...candidate }));
    const modelName = this.config.knowledge.rerankModel || DEFAULT_RERANK_MODEL;

    let scores: number[];
    try {
      scores = modelName.toLowerCase().includes("jina")
        ? await scoreWithJina(this.env, modelName, query, rerankCandidates)
        : await scoreWithOpenAI(this.env, this.config, modelName, query, rerankCandidates);
    } catch {
      return [...candidates].sort((left, right) => Number(right.score ?? 0) - Number(left.score ?? 0));
    }

    const scoredCandidates = rerankCandidates.map((candidate, index) => {
      const rerankScore = Math.max(0, Math.min(scores[index] / 10, 1));
      return {
        candidate: {
          ...candidate,
          llm_score: scores[index],
          rerank_score: rerankScore
        },
        rerankScore,
        index
      };
    });

    scoredCandidates.sort((left, right) => {
      if (right.rerankScore !== left.rerankScore) {
        return right.rerankScore - left.rerankScore;
      }
      return left.index - right.index;
    });

    return [...scoredCandidates.map((item) => item.candidate), ...remainingCandidates];
  }
}
