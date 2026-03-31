import type { Metadata } from "next";
import Link from "next/link";
import { AIToolbar } from "@/components/ai-toolbar";
import { CodeBlock } from "@/components/code-block";
import { DocsHeader } from "@/components/docs-header";
import { DocsSidebar } from "@/components/docs-sidebar";
import { DocsTabs } from "@/components/docs-tabs";
import { DocsToc, type TocItem } from "@/components/docs-toc";
import { SiteFooter } from "@/components/site-footer";
import { FadeIn } from "@/components/animations";

export const metadata: Metadata = {
  title: "Search API",
  description: "Full reference for POST /v1/search — parameters, response fields, and examples in cURL, Python, and JavaScript.",
  alternates: {
    canonical: "/docs/search-api",
  },
};

const tocItems: TocItem[] = [
  { id: "overview", text: "Overview", level: 1 },
  { id: "try-it", text: "Try it", level: 1 },
  { id: "parameters", text: "Parameters", level: 1 },
  { id: "filters", text: "Filters", level: 1 },
  { id: "response", text: "Response", level: 1 },
  { id: "errors", text: "Errors", level: 1 },
];

const parameters = [
  {
    name: "query",
    type: "string",
    required: true,
    description: "Natural-language search query. Max 400 characters.",
  },
  {
    name: "max_results",
    type: "integer",
    required: false,
    description: "Number of results to return. 1–20, default 5.",
  },
  {
    name: "include_answer",
    type: "boolean",
    required: false,
    description: "Generate an AI summary grounded in the matched evidence. Default false.",
  },
  {
    name: "ranking_mode",
    type: "string",
    required: false,
    description: "\"embedding\" (default) for vector similarity, or \"rerank\" for LLM-based reranking with higher relevance.",
  },
  {
    name: "filters",
    type: "object",
    required: false,
    description: "Narrow results by speaker, source, date, or duration. See Filters below.",
  },
];

const filters = [
  { name: "speaker", type: "string", description: "Filter by speaker name." },
  { name: "source", type: "string", description: "Filter by content source (e.g. \"youtube\")." },
  { name: "published_after", type: "string", description: "ISO date (YYYY-MM-DD). Only return content published after this date." },
  { name: "min_duration", type: "integer", description: "Minimum video duration in seconds." },
  { name: "max_duration", type: "integer", description: "Maximum video duration in seconds." },
];

const responseFields = [
  { name: "results", type: "array", description: "Array of matched video segments." },
  { name: "results[].id", type: "string", description: "Unique result identifier." },
  { name: "results[].score", type: "number", description: "Relevance score, 0.0 to 1.0." },
  { name: "results[].url", type: "string", description: "Cerul tracking URL — redirects to the source video." },
  { name: "results[].title", type: "string", description: "Video title." },
  { name: "results[].snippet", type: "string", description: "Matched transcript or visual description." },
  { name: "results[].thumbnail_url", type: "string", description: "Preview image URL." },
  { name: "results[].source", type: "string", description: "Content source (e.g. \"youtube\")." },
  { name: "results[].speaker", type: "string | null", description: "Speaker name, if detected." },
  { name: "results[].timestamp_start", type: "number | null", description: "Start time in seconds." },
  { name: "results[].timestamp_end", type: "number | null", description: "End time in seconds." },
  { name: "results[].unit_type", type: "string", description: "\"summary\", \"speech\", or \"visual\"." },
  { name: "answer", type: "string | null", description: "AI-generated summary. Only present when include_answer is true." },
  { name: "credits_used", type: "integer", description: "Credits consumed by this request." },
  { name: "credits_remaining", type: "integer", description: "Remaining credits in current billing period." },
  { name: "request_id", type: "string", description: "Unique request identifier for debugging." },
];

const errors = [
  { code: "400", description: "Invalid request body or missing required field." },
  { code: "401", description: "Missing or invalid API key." },
  { code: "429", description: "Rate limit exceeded. Retry after the limit resets." },
  { code: "500", description: "Internal server error." },
];

export default function SearchApiPage() {
  return (
    <div className="soft-theme min-h-screen pb-10">
      <DocsHeader currentPath="/docs/search-api" />

      <div className="mx-auto max-w-[1520px] px-4 sm:px-6 lg:px-8">
        <div className="mt-8 grid gap-8 lg:grid-cols-[240px_minmax(0,1fr)_220px]">
          <DocsSidebar currentSlug="search-api" />

          <main data-ai-copy-root="true" className="min-w-0">
            <article className="rounded-[28px] border border-[var(--border)] bg-[rgba(255,252,247,0.78)] px-6 py-8 shadow-[0_18px_48px_rgba(36,29,21,0.08)] backdrop-blur-xl sm:px-8">
              {/* Overview */}
              <section id="overview" className="max-w-4xl border-b border-[var(--border)] pb-10">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="rounded-full border border-[var(--border-brand)] bg-[var(--brand-subtle)] px-3 py-1 text-sm font-semibold text-[var(--brand-bright)]">
                    POST
                  </span>
                  <span className="rounded-full border border-[var(--border)] bg-white/70 px-3 py-1 font-mono text-sm text-[var(--foreground)]">
                    /v1/search
                  </span>
                </div>
                <h1 className="mt-5 text-4xl font-semibold tracking-[-0.05em] text-[var(--foreground)] sm:text-5xl">
                  Search
                </h1>
                <p className="mt-4 max-w-3xl text-[15px] leading-8 text-[var(--foreground-secondary)]">
                  Search across visual scenes, speech, and on-screen text in one call.
                  Returns ranked video segments with relevance scores, timestamps, and source links.
                </p>

                <div className="mt-7" data-docs-ai-anchor="true">
                  <AIToolbar
                    copyRootSelector="[data-ai-copy-root='true']"
                    pageUrl="/docs/search-api"
                    pageTitle="Cerul Search API"
                  />
                </div>
              </section>

              {/* Try it — copy-paste examples */}
              <section id="try-it" className="scroll-mt-28 border-b border-[var(--border)] py-10">
                <FadeIn>
                  <h2 className="text-3xl font-semibold text-[var(--foreground)]">
                    Try it
                  </h2>
                  <p className="mt-3 max-w-3xl text-[15px] leading-8 text-[var(--foreground-secondary)]">
                    Copy and run. Replace YOUR_CERUL_API_KEY with your actual key.
                  </p>
                </FadeIn>

                <div className="mt-6">
                  <DocsTabs
                    items={[
                      {
                        label: "cURL",
                        value: "curl",
                        content: (
                          <CodeBlock
                            code={`curl "https://api.cerul.ai/v1/search" \\
  -H "Authorization: Bearer YOUR_CERUL_API_KEY" \\
  -d '{
    "query": "Sam Altman views on AI video generation"
  }'`}
                            language="bash"
                            filename="search.sh"
                          />
                        ),
                      },
                      {
                        label: "Python",
                        value: "python",
                        content: (
                          <CodeBlock
                            code={`import requests

response = requests.post(
    "https://api.cerul.ai/v1/search",
    headers={"Authorization": "Bearer YOUR_CERUL_API_KEY"},
    json={"query": "Sam Altman views on AI video generation"},
)

print(response.json())`}
                            language="python"
                            filename="search.py"
                          />
                        ),
                      },
                      {
                        label: "JavaScript",
                        value: "javascript",
                        content: (
                          <CodeBlock
                            code={`const response = await fetch("https://api.cerul.ai/v1/search", {
  method: "POST",
  headers: {
    "Authorization": "Bearer YOUR_CERUL_API_KEY",
  },
  body: JSON.stringify({
    query: "Sam Altman views on AI video generation",
  }),
});

const data = await response.json();
console.log(data);`}
                            language="javascript"
                            filename="search.js"
                          />
                        ),
                      },
                      {
                        label: "TypeScript",
                        value: "typescript",
                        content: (
                          <CodeBlock
                            code={`const response = await fetch("https://api.cerul.ai/v1/search", {
  method: "POST",
  headers: {
    "Authorization": "Bearer YOUR_CERUL_API_KEY",
  },
  body: JSON.stringify({
    query: "Sam Altman views on AI video generation",
  }),
});

type SearchResult = {
  id: string;
  score: number;
  url: string;
  title: string;
  snippet: string;
  unit_type: "summary" | "speech" | "visual";
};

type SearchResponse = {
  results: SearchResult[];
  answer: string | null;
  credits_used: number;
  credits_remaining: number;
  request_id: string;
};

const data: SearchResponse = await response.json();
console.log(data);`}
                            language="typescript"
                            filename="search.ts"
                          />
                        ),
                      },
                    ]}
                  />
                </div>

                <div className="mt-6 rounded-[18px] border border-[var(--border)] bg-[var(--background-elevated)] px-5 py-4">
                  <p className="text-sm leading-7 text-[var(--foreground-secondary)]">
                    <strong className="text-[var(--foreground)]">With reranking:</strong>{" "}
                    Add <code className="rounded bg-white/60 px-1.5 py-0.5 font-mono text-xs">{`"ranking_mode": "rerank"`}</code> to
                    use LLM-based reranking for higher relevance. Uses the Jina Reranker by default.
                  </p>
                </div>
              </section>

              {/* Parameters */}
              <section id="parameters" className="scroll-mt-28 border-b border-[var(--border)] py-10">
                <FadeIn>
                  <h2 className="text-3xl font-semibold text-[var(--foreground)]">
                    Parameters
                  </h2>
                  <p className="mt-3 max-w-3xl text-[15px] leading-8 text-[var(--foreground-secondary)]">
                    Only <code className="rounded bg-white/60 px-1.5 py-0.5 font-mono text-xs">query</code> is required. All other fields are optional.
                  </p>
                </FadeIn>

                <div className="mt-6 overflow-hidden rounded-[20px] border border-[var(--border)]">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-[var(--background-elevated)] text-[var(--foreground-secondary)]">
                      <tr>
                        <th className="px-4 py-3 font-medium">Name</th>
                        <th className="px-4 py-3 font-medium">Type</th>
                        <th className="px-4 py-3 font-medium">Required</th>
                        <th className="px-4 py-3 font-medium">Description</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white/65">
                      {parameters.map((param) => (
                        <tr key={param.name} className="border-t border-[var(--border)]">
                          <td className="px-4 py-4 font-mono text-[var(--foreground)]">
                            {param.name}
                          </td>
                          <td className="px-4 py-4 text-[var(--foreground-secondary)]">
                            {param.type}
                          </td>
                          <td className="px-4 py-4 text-[var(--foreground-secondary)]">
                            {param.required ? "Yes" : "No"}
                          </td>
                          <td className="px-4 py-4 text-[var(--foreground-secondary)]">
                            {param.description}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Filters */}
              <section id="filters" className="scroll-mt-28 border-b border-[var(--border)] py-10">
                <FadeIn>
                  <h2 className="text-3xl font-semibold text-[var(--foreground)]">
                    Filters
                  </h2>
                  <p className="mt-3 max-w-3xl text-[15px] leading-8 text-[var(--foreground-secondary)]">
                    Pass these inside the <code className="rounded bg-white/60 px-1.5 py-0.5 font-mono text-xs">filters</code> object. All are optional.
                  </p>
                </FadeIn>

                <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
                  <div className="overflow-hidden rounded-[20px] border border-[var(--border)]">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-[var(--background-elevated)] text-[var(--foreground-secondary)]">
                        <tr>
                          <th className="px-4 py-3 font-medium">Name</th>
                          <th className="px-4 py-3 font-medium">Type</th>
                          <th className="px-4 py-3 font-medium">Description</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white/65">
                        {filters.map((filter) => (
                          <tr key={filter.name} className="border-t border-[var(--border)]">
                            <td className="px-4 py-4 font-mono text-[var(--foreground)]">
                              {filter.name}
                            </td>
                            <td className="px-4 py-4 text-[var(--foreground-secondary)]">
                              {filter.type}
                            </td>
                            <td className="px-4 py-4 text-[var(--foreground-secondary)]">
                              {filter.description}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <CodeBlock
                    code={`curl "https://api.cerul.ai/v1/search" \\
  -H "Authorization: Bearer YOUR_CERUL_API_KEY" \\
  -d '{
    "query": "AGI timeline discussion",
    "max_results": 5,
    "include_answer": true,
    "ranking_mode": "rerank",
    "filters": {
      "speaker": "Sam Altman",
      "source": "youtube"
    }
  }'`}
                    language="bash"
                    filename="with-filters.sh"
                  />
                </div>
              </section>

              {/* Response */}
              <section id="response" className="scroll-mt-28 border-b border-[var(--border)] py-10">
                <FadeIn>
                  <h2 className="text-3xl font-semibold text-[var(--foreground)]">
                    Response
                  </h2>
                </FadeIn>

                <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_460px]">
                  <div className="overflow-hidden rounded-[20px] border border-[var(--border)]">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-[var(--background-elevated)] text-[var(--foreground-secondary)]">
                        <tr>
                          <th className="px-4 py-3 font-medium">Field</th>
                          <th className="px-4 py-3 font-medium">Type</th>
                          <th className="px-4 py-3 font-medium">Description</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white/65">
                        {responseFields.map((field) => (
                          <tr key={field.name} className="border-t border-[var(--border)]">
                            <td className="px-4 py-4 font-mono text-xs text-[var(--foreground)]">
                              {field.name}
                            </td>
                            <td className="whitespace-nowrap px-4 py-4 text-xs text-[var(--foreground-secondary)]">
                              {field.type}
                            </td>
                            <td className="px-4 py-4 text-xs text-[var(--foreground-secondary)]">
                              {field.description}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="space-y-4">
                    <div className="flex items-center gap-3">
                      <span className="rounded-full border border-[rgba(31,141,74,0.18)] bg-[rgba(31,141,74,0.12)] px-3 py-1 text-sm text-[var(--success)]">
                        200 OK
                      </span>
                    </div>
                    <CodeBlock
                      code={`{
  "results": [
    {
      "id": "unit_hmtuvNfytjM_1223",
      "score": 0.93,
      "url": "https://cerul.ai/v/a8f3k2x",
      "title": "Sam Altman on AI video generation",
      "snippet": "Current AI video generation tools are improving quickly but still constrained by controllability.",
      "thumbnail_url": "https://i.ytimg.com/vi/hmtuvNfytjM/hqdefault.jpg",
      "source": "youtube",
      "speaker": "Sam Altman",
      "timestamp_start": 1223.0,
      "timestamp_end": 1345.0,
      "unit_type": "speech"
    }
  ],
  "answer": "Sam Altman frames current AI video generation tools as improving quickly but still constrained by controllability.",
  "credits_used": 2,
  "credits_remaining": 998,
  "request_id": "req_9f8c1d5b2a9f7d1a8c4e6b02"
}`}
                      language="json"
                      filename="response.json"
                    />
                  </div>
                </div>
              </section>

              {/* Errors */}
              <section id="errors" className="scroll-mt-28 pt-10">
                <FadeIn>
                  <h2 className="text-3xl font-semibold text-[var(--foreground)]">
                    Errors
                  </h2>
                </FadeIn>

                <div className="mt-6 overflow-hidden rounded-[20px] border border-[var(--border)]">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-[var(--background-elevated)] text-[var(--foreground-secondary)]">
                      <tr>
                        <th className="px-4 py-3 font-medium">Status</th>
                        <th className="px-4 py-3 font-medium">Description</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white/65">
                      {errors.map((error) => (
                        <tr key={error.code} className="border-t border-[var(--border)]">
                          <td className="px-4 py-4 font-mono text-[var(--foreground)]">
                            {error.code}
                          </td>
                          <td className="px-4 py-4 text-[var(--foreground-secondary)]">
                            {error.description}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-8 flex flex-wrap gap-3">
                  <Link href="/docs" className="button-secondary">
                    Quickstart
                  </Link>
                  <Link href="/docs/usage-api" className="button-secondary">
                    Usage API
                  </Link>
                  <Link href="/docs/api-reference" className="button-secondary">
                    All endpoints
                  </Link>
                </div>
              </section>
            </article>
          </main>

          <DocsToc
            items={tocItems}
            actions={[
              { label: "Get API key", href: "/login?mode=signup" },
              { label: "All endpoints", href: "/docs/api-reference" },
            ]}
          />
        </div>

        <SiteFooter />
      </div>
    </div>
  );
}
