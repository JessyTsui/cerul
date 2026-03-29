"use client";

import type { Route } from "next";
import Link from "next/link";
import { startTransition, useDeferredValue, useState } from "react";

type PlaygroundSurface = "search" | "index" | "usage";
type ResponseView = "response" | "code";
type CodeLanguage = "curl" | "javascript" | "python";

type SearchResult = {
  id: string;
  title: string;
  source: string;
  unitType: "summary" | "speech" | "visual";
  score: number;
  detail: string;
  href: string;
};

type SearchResponse = {
  request_id: string;
  query: string;
  answer?: string;
  latency_ms: number;
  credits_used: number;
  credits_remaining: number;
  results: SearchResult[];
};

type IndexResponse = {
  request_id: string;
  video_id: string;
  source: string;
  status: "queued" | "processing";
  force: boolean;
  estimated_steps: string[];
};

type UsageResponse = {
  tier: string;
  credits_used: number;
  credits_remaining: number;
  request_count: number;
  rate_limit_per_sec: number;
};

const surfaceTabs: Array<{
  id: PlaygroundSurface;
  label: string;
  description: string;
}> = [
  {
    id: "search",
    label: "Search",
    description: "Query the unified retrieval surface.",
  },
  {
    id: "index",
    label: "Index",
    description: "Send a video into the worker pipeline.",
  },
  {
    id: "usage",
    label: "Usage",
    description: "Inspect credits, limits, and request volume.",
  },
];

const searchPresets = [
  "What are the latest updates with Nvidia?",
  "Find the moment where Sam Altman discusses AI video generation",
  "Product demos with charts, slides, and interface closeups",
];

const unitTypeLabel: Record<SearchResult["unitType"], string> = {
  summary: "Summary",
  speech: "Speech",
  visual: "Visual",
};

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function formatScore(score: number): string {
  return `${Math.round(score * 100)}%`;
}

function buildSearchResponse({
  query,
  includeAnswer,
  speaker,
  source,
}: {
  query: string;
  includeAnswer: boolean;
  speaker: string;
  source: string;
}): SearchResponse {
  const normalizedQuery = query.trim() || searchPresets[0];
  const seed = hashString(`${normalizedQuery}:${speaker}:${source}`);
  const inferredSource = source === "all" ? "YouTube" : source;
  const inferredSpeaker = speaker.trim() || "Sam Altman";

  const results: SearchResult[] = [
    {
      id: "summary_unit_01",
      title: `${inferredSpeaker} summary with slide-backed evidence`,
      source: inferredSource,
      unitType: "summary",
      score: Number((0.94 - (seed % 3) * 0.01).toFixed(2)),
      detail:
        "One retrieval unit combines the core claim, the visible slide context, and creator metadata so downstream agents can cite it cleanly.",
      href: "/docs/search-api",
    },
    {
      id: "speech_unit_02",
      title: `Timestamped transcript segment related to “${normalizedQuery}”`,
      source: inferredSource,
      unitType: "speech",
      score: Number((0.89 - (seed % 4) * 0.01).toFixed(2)),
      detail:
        "Speech-level evidence keeps timestamps and source links attached so users can jump out to the exact segment immediately.",
      href: "/docs/api-reference",
    },
    {
      id: "visual_unit_03",
      title: "Visual-only match with strong on-screen cues",
      source: inferredSource,
      unitType: "visual",
      score: Number((0.84 - (seed % 5) * 0.01).toFixed(2)),
      detail:
        "Frame-heavy moments still rank alongside transcript and summary evidence, which is the whole point of Cerul's unified search surface.",
      href: "/docs/quickstart",
    },
  ];

  return {
    request_id: `req_${seed.toString(16).padStart(10, "0").slice(0, 10)}`,
    query: normalizedQuery,
    answer: includeAnswer
      ? "Cerul returns one ranked response that can blend summary, speech, and visual evidence without a search_type switch."
      : undefined,
    latency_ms: 128 + (seed % 80),
    credits_used: includeAnswer ? 2 : 1,
    credits_remaining: 996 - (seed % 140),
    results,
  };
}

function buildIndexResponse(url: string, force: boolean): IndexResponse {
  const normalizedUrl = url.trim() || "https://www.youtube.com/watch?v=hmtuvNfytjM";
  const seed = hashString(normalizedUrl);
  return {
    request_id: `idx_${seed.toString(16).padStart(10, "0").slice(0, 10)}`,
    video_id: `vid_${seed.toString(16).slice(0, 8)}`,
    source: normalizedUrl.includes("youtube") ? "youtube" : "direct_url",
    status: force ? "processing" : "queued",
    force,
    estimated_steps: [
      "Resolve provider metadata",
      "Fetch media and key frames",
      "Run shared indexing pipeline",
      "Publish retrieval units into the index",
    ],
  };
}

function buildUsageResponse(): UsageResponse {
  return {
    tier: "Researcher",
    credits_used: 214,
    credits_remaining: 786,
    request_count: 138,
    rate_limit_per_sec: 5,
  };
}

function buildCodeSnippet({
  surface,
  language,
  query,
  includeAnswer,
  maxResults,
  source,
  speaker,
  url,
  force,
}: {
  surface: PlaygroundSurface;
  language: CodeLanguage;
  query: string;
  includeAnswer: boolean;
  maxResults: number;
  source: string;
  speaker: string;
  url: string;
  force: boolean;
}): string {
  if (surface === "search") {
    const body = `{
  "query": "${query.trim() || searchPresets[0]}",
  "max_results": ${maxResults},
  "include_answer": ${includeAnswer},
  "filters": {
    "source": "${source}",
    "speaker": "${speaker.trim() || "Sam Altman"}"
  }
}`;
    const pythonBody = `{
    "query": "${query.trim() || searchPresets[0]}",
    "max_results": ${maxResults},
    "include_answer": ${includeAnswer ? "True" : "False"},
    "filters": {
        "source": "${source}",
        "speaker": "${speaker.trim() || "Sam Altman"}"
    }
}`;

    if (language === "javascript") {
      return `const response = await fetch("https://api.cerul.ai/v1/search", {
  method: "POST",
  headers: {
    "Authorization": "Bearer YOUR_CERUL_API_KEY",
    "Content-Type": "application/json"
  },
  body: JSON.stringify(${body})
});

const data = await response.json();
console.log(data);`;
    }

    if (language === "python") {
      return `import requests

response = requests.post(
    "https://api.cerul.ai/v1/search",
    headers={
        "Authorization": "Bearer YOUR_CERUL_API_KEY",
        "Content-Type": "application/json",
    },
    json=${pythonBody}
)

print(response.json())`;
    }

    return `curl "https://api.cerul.ai/v1/search" \\
  -H "Authorization: Bearer YOUR_CERUL_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '${body}'`;
  }

  if (surface === "index") {
    const normalizedUrl = url.trim() || "https://www.youtube.com/watch?v=hmtuvNfytjM";
    const body = `{
  "url": "${normalizedUrl}",
  "force": ${force}
}`;
    const pythonBody = `{
    "url": "${normalizedUrl}",
    "force": ${force ? "True" : "False"}
}`;

    if (language === "javascript") {
      return `const response = await fetch("https://api.cerul.ai/v1/index", {
  method: "POST",
  headers: {
    "Authorization": "Bearer YOUR_CERUL_API_KEY",
    "Content-Type": "application/json"
  },
  body: JSON.stringify(${body})
});

const data = await response.json();
console.log(data);`;
    }

    if (language === "python") {
      return `import requests

response = requests.post(
    "https://api.cerul.ai/v1/index",
    headers={
        "Authorization": "Bearer YOUR_CERUL_API_KEY",
        "Content-Type": "application/json",
    },
    json=${pythonBody}
)

print(response.json())`;
    }

    return `curl "https://api.cerul.ai/v1/index" \\
  -H "Authorization: Bearer YOUR_CERUL_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '${body}'`;
  }

  if (language === "javascript") {
    return `const response = await fetch("https://api.cerul.ai/v1/usage", {
  headers: {
    "Authorization": "Bearer YOUR_CERUL_API_KEY"
  }
});

const data = await response.json();
console.log(data);`;
  }

  if (language === "python") {
    return `import requests

response = requests.get(
    "https://api.cerul.ai/v1/usage",
    headers={"Authorization": "Bearer YOUR_CERUL_API_KEY"},
)

print(response.json())`;
  }

  return `curl "https://api.cerul.ai/v1/usage" \\
  -H "Authorization: Bearer YOUR_CERUL_API_KEY"`;
}

export function UnifiedSearchDemo() {
  const [surface, setSurface] = useState<PlaygroundSurface>("search");
  const [query, setQuery] = useState(searchPresets[0]);
  const [includeAnswer, setIncludeAnswer] = useState(true);
  const [maxResults, setMaxResults] = useState(3);
  const [speaker, setSpeaker] = useState("Sam Altman");
  const [source, setSource] = useState("youtube");
  const [url, setUrl] = useState("https://www.youtube.com/watch?v=hmtuvNfytjM");
  const [force, setForce] = useState(false);
  const [responseView, setResponseView] = useState<ResponseView>("response");
  const [codeLanguage, setCodeLanguage] = useState<CodeLanguage>("curl");
  const deferredQuery = useDeferredValue(query);
  const deferredUrl = useDeferredValue(url);

  const searchResponse = buildSearchResponse({
    query: deferredQuery,
    includeAnswer,
    source,
    speaker,
  });
  const indexResponse = buildIndexResponse(deferredUrl, force);
  const usageResponse = buildUsageResponse();

  const responsePayload =
    surface === "search"
      ? searchResponse
      : surface === "index"
        ? indexResponse
        : usageResponse;

  const codeSnippet = buildCodeSnippet({
    surface,
    language: codeLanguage,
    query: deferredQuery,
    includeAnswer,
    maxResults,
    source,
    speaker,
    url: deferredUrl,
    force,
  });

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--brand-bright)]">
            Public API playground
          </p>
          <h1 className="mt-3 text-5xl font-semibold tracking-[-0.06em] text-[var(--foreground)]">
            API Playground
          </h1>
          <p className="mt-3 max-w-3xl text-base leading-8 text-[var(--foreground-secondary)]">
            Borrowing the working parts of Tavily’s product rhythm: one request panel on the left,
            one response surface on the right, and enough context below to make the results feel
            operational instead of decorative.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {["Unified retrieval", "Video-first", "Agent-ready"].map((item) => (
            <span
              key={item}
              className="inline-flex rounded-full border border-[var(--border)] bg-white/72 px-4 py-2 text-sm text-[var(--foreground-secondary)]"
            >
              {item}
            </span>
          ))}
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <article className="surface-elevated rounded-[34px] px-5 py-5 sm:px-6">
          <div className="flex flex-wrap gap-2">
            {surfaceTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  startTransition(() => {
                    setSurface(tab.id);
                    setResponseView(tab.id === "usage" ? "response" : responseView);
                  });
                }}
                className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
                  surface === tab.id
                    ? "border-[var(--border-brand)] bg-[var(--brand-subtle)] text-[var(--foreground)]"
                    : "border-[var(--border)] bg-white/70 text-[var(--foreground-secondary)] hover:border-[var(--border-strong)] hover:bg-white hover:text-[var(--foreground)]"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="mt-5">
            <p className="text-base font-semibold text-[var(--foreground)]">
              {surfaceTabs.find((tab) => tab.id === surface)?.label}
            </p>
            <p className="mt-1 text-sm text-[var(--foreground-secondary)]">
              {surfaceTabs.find((tab) => tab.id === surface)?.description}
            </p>
          </div>

          <div className="mt-6 space-y-4">
            <div>
              <label className="text-sm font-medium text-[var(--foreground)]">API key</label>
              <div className="mt-2 rounded-[18px] border border-[var(--border)] bg-white/78 px-4 py-3 text-sm text-[var(--foreground)]">
                default
              </div>
            </div>

            {surface === "search" ? (
              <>
                <div>
                  <div className="flex items-center justify-between gap-3">
                    <label className="text-sm font-medium text-[var(--foreground)]">Query</label>
                    <button
                      type="button"
                      className="rounded-full border border-[var(--border)] bg-white/72 px-3 py-1 text-xs text-[var(--foreground-secondary)] transition hover:bg-white hover:text-[var(--foreground)]"
                      onClick={() => {
                        startTransition(() => {
                          setQuery(searchPresets[1]);
                        });
                      }}
                    >
                      Try example
                    </button>
                  </div>
                  <textarea
                    value={query}
                    onChange={(event) => {
                      const value = event.target.value;
                      startTransition(() => {
                        setQuery(value);
                      });
                    }}
                    rows={5}
                    className="mt-2 w-full rounded-[20px] border border-[var(--border)] bg-white/78 px-4 py-4 text-sm text-[var(--foreground)] outline-none transition placeholder:text-[var(--foreground-tertiary)] focus:border-[var(--border-brand)]"
                    placeholder="Describe the moment, scene, slide, or speaker you want back."
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="text-sm font-medium text-[var(--foreground)]">
                      Include answer
                    </label>
                    <select
                      value={includeAnswer ? "true" : "false"}
                      onChange={(event) => setIncludeAnswer(event.target.value === "true")}
                      className="mt-2 h-12 w-full rounded-[18px] border border-[var(--border)] bg-white/78 px-4 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--border-brand)]"
                    >
                      <option value="true">true</option>
                      <option value="false">false</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-sm font-medium text-[var(--foreground)]">
                      Max results
                    </label>
                    <select
                      value={String(maxResults)}
                      onChange={(event) => setMaxResults(Number(event.target.value))}
                      className="mt-2 h-12 w-full rounded-[18px] border border-[var(--border)] bg-white/78 px-4 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--border-brand)]"
                    >
                      {[3, 5, 10].map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="text-sm font-medium text-[var(--foreground)]">Source</label>
                    <select
                      value={source}
                      onChange={(event) => setSource(event.target.value)}
                      className="mt-2 h-12 w-full rounded-[18px] border border-[var(--border)] bg-white/78 px-4 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--border-brand)]"
                    >
                      <option value="youtube">youtube</option>
                      <option value="pexels">pexels</option>
                      <option value="all">all</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-sm font-medium text-[var(--foreground)]">Speaker</label>
                    <input
                      value={speaker}
                      onChange={(event) => setSpeaker(event.target.value)}
                      className="mt-2 h-12 w-full rounded-[18px] border border-[var(--border)] bg-white/78 px-4 text-sm text-[var(--foreground)] outline-none transition placeholder:text-[var(--foreground-tertiary)] focus:border-[var(--border-brand)]"
                      placeholder="Optional speaker filter"
                    />
                  </div>
                </div>
              </>
            ) : null}

            {surface === "index" ? (
              <>
                <div>
                  <label className="text-sm font-medium text-[var(--foreground)]">Video URL</label>
                  <input
                    value={url}
                    onChange={(event) => {
                      const value = event.target.value;
                      startTransition(() => {
                        setUrl(value);
                      });
                    }}
                    className="mt-2 h-12 w-full rounded-[18px] border border-[var(--border)] bg-white/78 px-4 text-sm text-[var(--foreground)] outline-none transition placeholder:text-[var(--foreground-tertiary)] focus:border-[var(--border-brand)]"
                    placeholder="https://www.youtube.com/watch?v=..."
                  />
                </div>
                <label className="flex items-center gap-3 rounded-[18px] border border-[var(--border)] bg-white/78 px-4 py-3 text-sm text-[var(--foreground)]">
                  <input
                    type="checkbox"
                    checked={force}
                    onChange={(event) => setForce(event.target.checked)}
                    className="h-4 w-4 rounded border-[var(--border)]"
                  />
                  Force re-index if the video already exists
                </label>
              </>
            ) : null}

            {surface === "usage" ? (
              <div className="rounded-[22px] border border-[var(--border)] bg-white/78 px-4 py-4">
                <p className="text-sm text-[var(--foreground-secondary)]">
                  This route does not need a request body. It only requires your API key.
                </p>
              </div>
            ) : null}
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <button type="button" className="button-primary min-w-[180px]">
              {surface === "search"
                ? "Send request"
                : surface === "index"
                  ? "Queue indexing"
                  : "Check usage"}
            </button>
            <Link href="/docs/api-reference" className="button-secondary">
              API reference
            </Link>
          </div>
        </article>

        <article className="overflow-hidden rounded-[34px] border border-[#2c2723] bg-[#181715] shadow-[0_28px_80px_rgba(17,12,8,0.28)]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/8 px-5 py-4 text-white/75">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setResponseView("response")}
                className={`rounded-full px-4 py-2 text-sm transition ${
                  responseView === "response" ? "bg-white text-[#181715]" : "bg-white/6 hover:bg-white/10"
                }`}
              >
                Response
              </button>
              <button
                type="button"
                onClick={() => setResponseView("code")}
                className={`rounded-full px-4 py-2 text-sm transition ${
                  responseView === "code" ? "bg-white text-[#181715]" : "bg-white/6 hover:bg-white/10"
                }`}
              >
                Code
              </button>
            </div>

            {responseView === "code" ? (
              <div className="flex flex-wrap gap-2">
                {(["curl", "javascript", "python"] as CodeLanguage[]).map((language) => (
                  <button
                    key={language}
                    type="button"
                    onClick={() => setCodeLanguage(language)}
                    className={`rounded-full px-3 py-1.5 text-xs uppercase tracking-[0.14em] transition ${
                      codeLanguage === language
                        ? "bg-white/14 text-white"
                        : "bg-transparent text-white/45 hover:text-white/75"
                    }`}
                  >
                    {language}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="px-5 py-5">
            <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-[24px] bg-[#11100f] px-5 py-5 font-mono text-[13px] leading-7 text-[#f4f0e6]">
              <code>
                {responseView === "response"
                  ? JSON.stringify(responsePayload, null, 2)
                  : codeSnippet}
              </code>
            </pre>
          </div>
        </article>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {surface === "search"
          ? [
              ["Latency", `${searchResponse.latency_ms}ms`],
              ["Credits used", String(searchResponse.credits_used)],
              ["Credits remaining", String(searchResponse.credits_remaining)],
              ["Request ID", searchResponse.request_id],
            ].map(([label, value]) => (
              <article
                key={label}
                className="surface-elevated rounded-[26px] px-5 py-5"
              >
                <p className="text-sm text-[var(--foreground-secondary)]">{label}</p>
                <p className="mt-3 break-all text-2xl font-semibold text-[var(--foreground)]">
                  {value}
                </p>
              </article>
            ))
          : surface === "index"
            ? [
                ["Video ID", indexResponse.video_id],
                ["Source", indexResponse.source],
                ["Status", indexResponse.status],
                ["Request ID", indexResponse.request_id],
              ].map(([label, value]) => (
                <article
                  key={label}
                  className="surface-elevated rounded-[26px] px-5 py-5"
                >
                  <p className="text-sm text-[var(--foreground-secondary)]">{label}</p>
                  <p className="mt-3 break-all text-2xl font-semibold text-[var(--foreground)]">
                    {value}
                  </p>
                </article>
              ))
            : [
                ["Tier", usageResponse.tier],
                ["Credits used", String(usageResponse.credits_used)],
                ["Credits remaining", String(usageResponse.credits_remaining)],
                ["Rate limit", `${usageResponse.rate_limit_per_sec}/s`],
              ].map(([label, value]) => (
                <article
                  key={label}
                  className="surface-elevated rounded-[26px] px-5 py-5"
                >
                  <p className="text-sm text-[var(--foreground-secondary)]">{label}</p>
                  <p className="mt-3 break-all text-2xl font-semibold text-[var(--foreground)]">
                    {value}
                  </p>
                </article>
              ))}
      </section>

      {surface === "search" ? (
        <section className="space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--foreground-tertiary)]">
                Search results
              </p>
              <h2 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-[var(--foreground)]">
                Mixed evidence for “{searchResponse.query}”
              </h2>
            </div>
            <Link href={"/docs/search-api" as Route} className="button-secondary">
              Read search guide
            </Link>
          </div>

          <div className="grid gap-4">
            {searchResponse.results.map((result, index) => (
              <article key={result.id} className="surface-elevated rounded-[30px] px-5 py-5 sm:px-6">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-[var(--border-brand)] bg-[var(--brand-subtle)] px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-[var(--brand-bright)]">
                        Rank {String(index + 1).padStart(2, "0")}
                      </span>
                      <span className="rounded-full border border-[var(--border)] bg-white/72 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-secondary)]">
                        {unitTypeLabel[result.unitType]}
                      </span>
                      <span className="rounded-full border border-[var(--border)] bg-white/72 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-secondary)]">
                        {result.source}
                      </span>
                    </div>
                    <h3 className="mt-4 text-2xl font-semibold text-[var(--foreground)]">
                      {result.title}
                    </h3>
                    <p className="mt-3 max-w-3xl text-sm leading-7 text-[var(--foreground-secondary)]">
                      {result.detail}
                    </p>
                    {searchResponse.answer ? (
                      <p className="mt-4 rounded-[18px] border border-[var(--border)] bg-[var(--background-elevated)] px-4 py-4 text-sm leading-7 text-[var(--foreground-secondary)]">
                        {searchResponse.answer}
                      </p>
                    ) : null}
                  </div>

                  <div className="rounded-[20px] border border-[var(--border)] bg-[var(--background-elevated)] px-4 py-4 lg:min-w-[140px]">
                    <p className="text-xs uppercase tracking-[0.14em] text-[var(--foreground-tertiary)]">
                      Relevance
                    </p>
                    <p className="mt-3 text-3xl font-semibold text-[var(--foreground)]">
                      {formatScore(result.score)}
                    </p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {surface === "index" ? (
        <section className="grid gap-5 xl:grid-cols-[0.92fr_1.08fr]">
          <article className="surface-elevated rounded-[30px] px-6 py-6">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--foreground-tertiary)]">
              Pipeline steps
            </p>
            <div className="mt-5 space-y-3">
              {indexResponse.estimated_steps.map((step, index) => (
                <div
                  key={step}
                  className="rounded-[20px] border border-[var(--border)] bg-[var(--background-elevated)] px-4 py-4"
                >
                  <p className="text-xs uppercase tracking-[0.16em] text-[var(--brand-bright)]">
                    Step {String(index + 1).padStart(2, "0")}
                  </p>
                  <p className="mt-2 text-sm text-[var(--foreground)]">{step}</p>
                </div>
              ))}
            </div>
          </article>

          <article className="surface-elevated rounded-[30px] px-6 py-6">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--foreground-tertiary)]">
              Operator guidance
            </p>
            <div className="mt-5 space-y-3">
              {[
                "Keep API handlers thin and let the worker pipeline own media-heavy steps.",
                "Use force only when you explicitly want to invalidate or refresh an existing indexed record.",
                "The public index route should stay simple even if the worker graph underneath it grows.",
              ].map((item) => (
                <div
                  key={item}
                  className="rounded-[20px] border border-[var(--border)] bg-[var(--background-elevated)] px-4 py-4 text-sm leading-7 text-[var(--foreground-secondary)]"
                >
                  {item}
                </div>
              ))}
            </div>
          </article>
        </section>
      ) : null}

      {surface === "usage" ? (
        <section className="grid gap-5 xl:grid-cols-[0.92fr_1.08fr]">
          <article className="surface-elevated rounded-[30px] px-6 py-6">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--foreground-tertiary)]">
              Usage summary
            </p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {[
                ["Request count", String(usageResponse.request_count)],
                ["Credits used", String(usageResponse.credits_used)],
                ["Credits remaining", String(usageResponse.credits_remaining)],
                ["Rate limit / sec", String(usageResponse.rate_limit_per_sec)],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="rounded-[20px] border border-[var(--border)] bg-[var(--background-elevated)] px-4 py-4"
                >
                  <p className="text-xs text-[var(--foreground-tertiary)]">{label}</p>
                  <p className="mt-2 text-2xl font-semibold text-[var(--foreground)]">{value}</p>
                </div>
              ))}
            </div>
          </article>

          <article className="surface-elevated rounded-[30px] px-6 py-6">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--foreground-tertiary)]">
              What to monitor
            </p>
            <div className="mt-5 space-y-3">
              {[
                "Credit usage tells you whether your search patterns are getting heavier, not just more frequent.",
                "Request count alone can hide expensive queries, so usage and volume should always be read together.",
                "Rate limits belong in the public contract because operational integrations depend on them early.",
              ].map((item) => (
                <div
                  key={item}
                  className="rounded-[20px] border border-[var(--border)] bg-[var(--background-elevated)] px-4 py-4 text-sm leading-7 text-[var(--foreground-secondary)]"
                >
                  {item}
                </div>
              ))}
            </div>
          </article>
        </section>
      ) : null}
    </div>
  );
}
