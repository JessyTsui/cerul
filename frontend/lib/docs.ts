import { canonicalUrl } from "./site-url";

export type DocSection = {
  title: string;
  body: string;
  bullets?: string[];
  code?: string;
};

export type DocPage = {
  slug: string;
  title: string;
  summary: string;
  kicker: string;
  readingTime: string;
  sections: DocSection[];
};

export const docsNavigation = [
  { href: "#surface", label: "Public surface", index: "01" },
  { href: "#search", label: "Search endpoint", index: "02" },
  { href: "#usage", label: "Usage endpoint", index: "03" },
  { href: "#architecture", label: "Platform model", index: "04" },
  { href: "#config", label: "Runtime config", index: "05" },
] as const;

export const docsLandingSections = [
  {
    id: "surface",
    kicker: "Public surface",
    title: "Start with the smallest stable contract.",
    description:
      "Cerul intentionally avoids a sprawling first release. The public API focuses on search and usage, while dashboard features stay on a private surface and ingestion remains worker-owned.",
    list: [
      "POST /v1/search for b-roll and knowledge retrieval",
      "GET /v1/usage for tier and credit visibility",
      "Dashboard-only endpoints stay private",
      "Agent skills call the same HTTP surface as direct users",
    ],
    code: undefined,
  },
  {
    id: "search",
    kicker: "Search endpoint",
    title: "One request shape, different retrieval behaviors.",
    description:
      "Search stays structurally uniform even as the backing retrieval changes. B-roll returns asset-level matches, while knowledge search returns segment-level evidence and optional generated answers.",
    list: [
      "Consistent request envelope across tracks",
      "Search type routes to the correct service internally",
      "Failure does not spend credits",
      "Result IDs are captured in query logs for later evaluation",
    ],
    code: `POST /v1/search

{
  "query": "sam altman agi timeline",
  "search_type": "knowledge",
  "max_results": 5,
  "include_answer": true,
  "filters": {
    "speaker": "Sam Altman",
    "published_after": "2023-01-01"
  }
}`,
  },
  {
    id: "usage",
    kicker: "Usage endpoint",
    title: "Treat credits and rate limits as first-class product data.",
    description:
      "Usage is not just billing plumbing. It is part of the operator experience, which is why the console and the public API should share the same underlying ledger and aggregation model.",
    list: [
      "Credits limit and remaining balance",
      "Active API key count",
      "Monthly window visibility",
      "Rate limit policy surfaced as product state",
    ],
    code: `GET /v1/usage

{
  "tier": "free",
  "period_start": "2026-03-01",
  "period_end": "2026-03-31",
  "credits_limit": 1000,
  "credits_used": 128,
  "credits_remaining": 872,
  "rate_limit_per_sec": 1,
  "api_keys_active": 1
}`,
  },
  {
    id: "architecture",
    kicker: "Platform model",
    title: "Frontend stays presentational, workers keep the weight.",
    description:
      "The web app should explain, demo, and operate the system. It should not become the second business-logic core. Heavy media processing belongs in workers, and the API layer remains an orchestration plane.",
    list: [
      "Next.js for landing pages, docs, dashboard, and demo shells",
      "FastAPI for auth, usage, routing, and thin orchestration",
      "Python workers for ingestion, indexing, and media-heavy steps",
      "Neon PostgreSQL + pgvector for usage and retrieval primitives",
    ],
    code: undefined,
  },
  {
    id: "config",
    kicker: "Runtime config",
    title: "Public-safe defaults in YAML, secrets in environment.",
    description:
      "Frontend browser code should consume a derived public config subset. Raw secrets stay out of the browser and public-safe defaults stay versioned in config/*.yaml.",
    list: [
      "CERUL_ENV selects development or production profile",
      "Public web and API URLs derive from config plus optional env overrides",
      "Search tuning values should remain configurable, not hardcoded",
      "Frontend should never read private repo config directly in browser code",
    ],
    code: `# Runtime profile
CERUL_ENV=development

# Optional public overrides
API_BASE_URL=http://localhost:8000
WEB_BASE_URL=http://localhost:3000`,
  },
] as const;

export const docsPages: DocPage[] = [
  {
    slug: "quickstart",
    title: "Quickstart",
    summary: "Get a local integration running with the smallest public setup.",
    kicker: "Start here",
    readingTime: "4 min read",
    sections: [
      {
        title: "Environment shape",
        body:
          "Cerul keeps public-safe defaults in versioned YAML and secrets in environment variables. The frontend should consume a derived public config subset, while API and worker runtimes read the full private configuration set.",
        bullets: [
          "Copy .env.example to .env",
          "Set CERUL_ENV to development or production",
          "Provide DATABASE_URL and provider keys outside public docs examples",
        ],
      },
      {
        title: "First request",
        body:
          "The first public integration path is direct HTTP. Keep the client thin, use API keys, and treat b-roll and knowledge as the same route with different search_type values.",
        code: `curl "${"${CERUL_BASE_URL:-https://api.cerul.ai}"}/v1/search" \\
  -H "Authorization: Bearer $CERUL_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "query": "cinematic drone shot of coastal highway at sunset",
    "search_type": "broll",
    "max_results": 5
  }'`,
      },
      {
        title: "What comes next",
        body:
          "Once the search path is working, operators should move immediately to usage visibility, API key rotation, and demo instrumentation. Those surfaces share the same request and credit model.",
      },
    ],
  },
  {
    slug: "search-api",
    title: "Search API",
    summary: "Understand request shape, routing behavior, and response differences by track.",
    kicker: "Public endpoint",
    readingTime: "6 min read",
    sections: [
      {
        title: "One route, two tracks",
        body:
          "Cerul exposes a single search entrypoint, but the underlying retrieval stack differs by track. B-roll resolves at the asset level, while knowledge resolves at segment granularity with optional answer generation.",
        bullets: [
          "Set search_type to broll for asset retrieval",
          "Set search_type to knowledge for segment retrieval",
          "Do not treat answer generation as mandatory for every request",
        ],
      },
      {
        title: "Request example",
        body:
          "The request envelope is intentionally stable. Filters may vary by track, but the core shape remains the same for clients and skills.",
        code: `{
  "query": "sam altman agi timeline",
  "search_type": "knowledge",
  "max_results": 5,
  "include_answer": true,
  "filters": {
    "speaker": "Sam Altman",
    "published_after": "2023-01-01"
  }
}`,
      },
      {
        title: "Response contract",
        body:
          "Clients should expect result IDs, source URLs, and track-specific metadata. Knowledge results can include timestamps and answer text, while b-roll focuses on preview assets and descriptive metadata.",
      },
    ],
  },
  {
    slug: "usage-api",
    title: "Usage API",
    summary: "Expose credits, active keys, and rate limits as product-visible state.",
    kicker: "Operational visibility",
    readingTime: "4 min read",
    sections: [
      {
        title: "Why it exists",
        body:
          "Usage is a first-class operator surface, not a hidden billing detail. This endpoint keeps API clients and dashboard users aligned on one understanding of credits and limits.",
      },
      {
        title: "Response example",
        body:
          "The shape should remain simple enough for direct rendering in the dashboard and lightweight enough for programmatic polling.",
        code: `{
  "tier": "free",
  "period_start": "2026-03-01",
  "period_end": "2026-03-31",
  "credits_limit": 1000,
  "credits_used": 128,
  "credits_remaining": 872,
  "rate_limit_per_sec": 1,
  "api_keys_active": 1
}`,
      },
      {
        title: "Implementation note",
        body:
          "The same underlying ledger should power both dashboard analytics and public usage responses. Search success writes usage and query logs together, while failures do not spend credits.",
      },
    ],
  },
  {
    slug: "architecture",
    title: "Architecture",
    summary: "Map the shared platform backbone across frontend, API, workers, and storage.",
    kicker: "System model",
    readingTime: "7 min read",
    sections: [
      {
        title: "Boundary discipline",
        body:
          "Cerul's product quality depends on not collapsing all logic into one surface. The frontend explains and operates the system, the API orchestrates requests, and workers own heavy ingestion and indexing.",
        bullets: [
          "Next.js for public pages, docs, and dashboard surfaces",
          "FastAPI for auth, usage, thin orchestration, and public responses",
          "Python workers for ingestion, indexing, and media-heavy computation",
        ],
      },
      {
        title: "Shared retrieval foundation",
        body:
          "B-roll and knowledge differ in workload shape, but they should share the same underlying platform services: auth, usage, storage, and retrieval abstractions.",
      },
      {
        title: "Open-source boundary",
        body:
          "Public code should remain reusable and infrastructure-oriented. Production indexes, prompts, tuned ranking parameters, and internal evaluation assets stay out of the repository.",
        code: `frontend/   Next.js application
backend/    FastAPI orchestration layer
workers/    Ingestion and indexing pipelines
db/         Public-safe migrations and seed artifacts
skills/     Installable agent skills`,
      },
    ],
  },
];

export function getDocBySlug(slug: string): DocPage | undefined {
  return docsPages.find((page) => page.slug === slug);
}

export function getDocsStaticParams() {
  return docsPages.map((page) => ({ slug: page.slug }));
}

export function getDocsIndexCards() {
  return docsPages.map((page) => ({
    slug: page.slug,
    title: page.title,
    summary: page.summary,
    kicker: page.kicker,
    readingTime: page.readingTime,
    href: `/docs/${page.slug}`,
  }));
}

export function getDocsPageCanonical(slug: string): string {
  return canonicalUrl(`/docs/${slug}`);
}
