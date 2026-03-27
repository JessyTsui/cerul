import type { Bindings } from "../types";

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_ANSWER_MODEL = "gpt-4o";

function coerceText(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function truncateText(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 3).trimEnd()}...`;
}

function formatTimestamp(value: unknown): string {
  const totalSeconds = Math.max(Math.trunc(Number(value ?? 0)), 0);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatTimestampRange(start: unknown, end: unknown): string {
  return `${formatTimestamp(start)}-${formatTimestamp(end)}`;
}

function buildVisualEvidenceBlock(segment: Record<string, unknown>): string {
  const visualDescription = truncateText(
    coerceText(segment.visual_description ?? segment.visual_summary ?? segment.description),
    900
  );
  const visualTextContent = truncateText(coerceText(segment.visual_text_content), 300);
  const lines: string[] = [];
  if (visualDescription) {
    lines.push(`Scene: ${visualDescription}`);
  }
  if (visualTextContent) {
    lines.push(`On-screen text: ${visualTextContent}`);
  }
  return lines.join("\n");
}

function buildAnswerPrompt(query: string, segments: Array<Record<string, unknown>>): string {
  const segmentBlocks = segments.map((segment, index) =>
    [
      `Segment ${index + 1}:`,
      `Video title: ${coerceText(segment.title) || "Untitled video"}`,
      `Segment title: ${coerceText(segment.segment_title) || "Untitled segment"}`,
      `Speaker: ${coerceText(segment.speaker) || "Unknown speaker"}`,
      `Timestamp range: ${formatTimestampRange(segment.timestamp_start, segment.timestamp_end)}`,
      "Transcript:",
      truncateText(coerceText(segment.transcript_text), 3000) || "N/A",
      "Visual evidence:",
      buildVisualEvidenceBlock(segment) || "N/A"
    ].join("\n")
  );

  return (
    "User query:\n" +
    `${query}\n\n` +
    "Retrieved evidence segments:\n" +
    `${segmentBlocks.join("\n\n")}\n\n` +
    "Write a concise synthesized answer grounded only in these segments.\n" +
    "Every factual claim must include at least one timestamp citation.\n" +
    "If the evidence is incomplete, say that explicitly instead of guessing."
  );
}

function extractMessageContent(payload: any): string {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string") {
    return content.trim();
  }
  if (Array.isArray(content)) {
    return content.map((item) => (typeof item?.text === "string" ? item.text : "")).join("").trim();
  }
  throw new Error("LLM response did not include message content.");
}

export class AnswerGenerator {
  constructor(private readonly env: Bindings) {}

  async generate(query: string, segments: Array<Record<string, unknown>>): Promise<string | null> {
    if (segments.length === 0) {
      return null;
    }

    const apiKey = (this.env.OPENAI_API_KEY ?? "").trim();
    if (!apiKey) {
      return null;
    }

    try {
      const response = await fetch(`${DEFAULT_OPENAI_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: DEFAULT_ANSWER_MODEL,
          temperature: 0.2,
          messages: [
            {
              role: "system",
              content: "You answer knowledge search queries using only the provided video segments. Cite claims inline with timestamp references in the exact format [Video Title, m:ss-m:ss] or [Video Title, h:mm:ss-h:mm:ss]."
            },
            {
              role: "user",
              content: buildAnswerPrompt(query, segments)
            }
          ]
        })
      });
      if (!response.ok) {
        throw new Error(`Answer request failed: ${response.status}`);
      }
      const payload = await response.json();
      const content = extractMessageContent(payload);
      return content || null;
    } catch {
      return null;
    }
  }
}
