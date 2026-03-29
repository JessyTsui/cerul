import { canonicalUrl } from "./site-url";

export type DocSection = {
  title: string;
  body: string;
  bullets?: string[];
  code?: string;
  language?: string;
  filename?: string;
};

export type DocPage = {
  slug: string;
  title: string;
  summary: string;
  kicker: string;
  readingTime: string;
  sections: DocSection[];
};

export type DocsNavItem = {
  title: string;
  href: string;
  slug?: string;
  description?: string;
};

export type DocsNavGroup = {
  title: string;
  items: DocsNavItem[];
};

export type DocsFeatureCard = {
  title: string;
  description: string;
  snippet: string;
  href: string;
};

export type ApiReferenceParameter = {
  name: string;
  type: string;
  required: string;
  description: string;
};

export type ApiReferenceCodeExample = {
  label: string;
  language: string;
  filename: string;
  code: string;
};

export type ApiReferenceEndpoint = {
  id: string;
  group: string;
  method: "GET" | "POST" | "DELETE";
  path: string;
  title: string;
  description: string;
  authLabel: string;
  authDescription: string;
  parameters: ApiReferenceParameter[];
  requestExamples: ApiReferenceCodeExample[];
  responseSchema: string;
  responseExample: string;
};

export type DocsSearchEntry = {
  title: string;
  description: string;
  href: string;
  category: string;
};

// Base URL for API
export const API_BASE_URL = "https://api.cerul.ai";

export const docsNavigation = [
  { href: "#introduction", label: "Introduction", index: "01" },
  { href: "#authentication", label: "Authentication", index: "02" },
  { href: "#search", label: "Search API", index: "03" },
  { href: "#index", label: "Index API", index: "04" },
  { href: "#usage", label: "Usage API", index: "05" },
  { href: "#response", label: "Response Format", index: "06" },
] as const;

export const docsLandingSections = [
  {
    id: "introduction",
    kicker: "Getting Started",
    title: "Cerul API Overview",
    description:
      "The Cerul API provides video understanding capabilities for AI agents. Search what is shown in videos, not just what is said. All API requests are made to the base URL with your API key included in the Authorization header.",
    list: [
      "Base URL: https://api.cerul.ai",
      "All requests require Bearer token authentication",
      "JSON request and response bodies",
      "UTF-8 encoding required",
    ],
    code: undefined,
  },
  {
    id: "authentication",
    kicker: "Authentication",
    title: "API Key Authentication",
    description:
      "All API requests must include your API key in the Authorization header using the Bearer token format. You can create and manage API keys from your dashboard.",
    list: [
      "Include API key in every request",
      "Use 'Authorization: Bearer YOUR_API_KEY' header",
      "Keep your API keys secure",
      "Rotate keys periodically from the dashboard",
    ],
    code: `curl "${API_BASE_URL}/v1/search" \\
  -H "Authorization: Bearer YOUR_CERUL_API_KEY" \\
  -H "Content-Type: application/json"`,
    language: "bash",
    filename: "auth.sh",
  },
  {
    id: "search",
    kicker: "Search Endpoint",
    title: "POST /v1/search",
    description:
      "The search endpoint is the primary retrieval surface. Cerul automatically blends summary, speech, and visual matches without asking callers to choose a track.",
    list: [
      "No search_type field",
      "max_results: 1-50 (default: 10)",
      "include_answer: true for AI-generated summaries",
      "filters: speaker, published_after, min_duration, max_duration, source",
    ],
    code: `curl "${API_BASE_URL}/v1/search" \\
  -H "Authorization: Bearer YOUR_CERUL_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "query": "Sam Altman explains the AGI timeline",
    "max_results": 5,
    "filters": {
      "speaker": "Sam Altman",
      "source": "youtube"
    }
  }'`,
    language: "bash",
    filename: "search.sh",
  },
  {
    id: "index",
    kicker: "Index Endpoint",
    title: "POST /v1/index",
    description:
      "Index YouTube, Pexels, Pixabay, and direct video URLs through one worker-backed pipeline. Indexing is free and scoped to the API key owner.",
    list: [
      "YouTube, Pexels, Pixabay, and direct video URLs supported",
      "force: true to re-index existing videos",
      "GET /v1/index/{video_id} returns processing status",
      "GET /v1/index lists the current user's indexed videos",
    ],
    code: `curl "${API_BASE_URL}/v1/index" \\
  -H "Authorization: Bearer YOUR_CERUL_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "url": "https://www.youtube.com/watch?v=hmtuvNfytjM"
  }'`,
    language: "bash",
    filename: "index.sh",
  },
  {
    id: "usage",
    kicker: "Usage Endpoint",
    title: "GET /v1/usage",
    description:
      "Check your current usage, credit balance, and rate limits. This endpoint is useful for monitoring your consumption and preventing unexpected quota exhaustion.",
    list: [
      "Returns current tier information",
      "Shows credits used and remaining",
      "Includes rate limit status",
      "Real-time credit tracking",
    ],
    code: `curl "${API_BASE_URL}/v1/usage" \\
  -H "Authorization: Bearer YOUR_CERUL_API_KEY"`,
    language: "bash",
    filename: "usage.sh",
  },
  {
    id: "response",
    kicker: "Response Format",
    title: "Understanding API Responses",
    description:
      "API responses follow a consistent JSON structure. Successful requests return HTTP 200 with result data. Errors return appropriate HTTP status codes with detailed error messages.",
    list: [
      "Results array contains video matches",
      "Each result includes a Cerul tracking URL",
      "Score indicates relevance (0.0-1.0)",
      "unit_type tells you whether the match is summary, speech, or visual",
    ],
    code: `{
  "results": [
    {
      "id": "unit_hmtuvNfytjM_1223",
      "score": 0.92,
      "url": "https://cerul.ai/v/a8f3k2x",
      "title": "Sam Altman on AGI Timeline",
      "snippet": "AGI is coming sooner than most people expect.",
      "thumbnail_url": "https://i.ytimg.com/vi/hmtuvNfytjM/hqdefault.jpg",
      "keyframe_url": "https://cdn.cerul.ai/frames/hmtuvNfytjM/f012.jpg",
      "duration": 5400,
      "source": "youtube",
      "speaker": "Sam Altman",
      "timestamp_start": 1223.0,
      "timestamp_end": 1345.0,
      "unit_type": "speech"
    }
  ],
  "answer": "Cerul summarizes the grounded evidence when include_answer is true.",
  "credits_used": 1,
  "credits_remaining": 999,
  "request_id": "req_abc123xyz"
}`,
    language: "json",
    filename: "response.json",
  },
] as const;

export const docsPages: DocPage[] = [
  {
    slug: "quickstart",
    title: "Quickstart Guide",
    summary: "Get up and running with the Cerul API in under 5 minutes. Learn how to make your first search request and understand the response format.",
    kicker: "Start here",
    readingTime: "5 min read",
    sections: [
      {
        title: "Get your API key",
        body:
          "Before making any requests, you need an API key. Sign up for a free account at cerul.ai and create your first API key from the dashboard. The free tier includes 1,000 credits to get started.",
        bullets: [
          "Create account at https://cerul.ai",
          "Navigate to Dashboard > API Keys",
          "Click 'Create new key'",
          "Copy your key (starts with 'cerul_')",
        ],
      },
      {
        title: "Make your first request",
        body:
          "Use curl to make a test request. Replace YOUR_CERUL_API_KEY with your actual API key. This example searches the unified retrieval surface without a search_type field.",
        code: `curl "${API_BASE_URL}/v1/search" \\
  -H "Authorization: Bearer YOUR_CERUL_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "query": "Sam Altman explains the AGI timeline",
    "max_results": 3
  }'`,
        language: "bash",
        filename: "first_request.sh",
      },
      {
        title: "Understanding the response",
        body:
          "The API returns a JSON object containing an array of results. Each result includes a Cerul tracking URL, metadata, timestamps when available, and optional answer text at the top level.",
        code: `{
  "results": [
    {
      "id": "unit_hmtuvNfytjM_1223",
      "score": 0.92,
      "url": "https://cerul.ai/v/a8f3k2x",
      "title": "Sam Altman on AGI Timeline",
      "snippet": "AGI is coming sooner than most people expect.",
      "thumbnail_url": "https://i.ytimg.com/vi/hmtuvNfytjM/hqdefault.jpg",
      "duration": 5400,
      "source": "youtube",
      "unit_type": "speech"
    }
  ],
  "answer": "Cerul can optionally synthesize an answer grounded in returned units.",
  "credits_used": 1,
  "credits_remaining": 999
}`,
        language: "json",
        filename: "first_response.json",
      },
      {
        title: "Using the tracking URL",
        body:
          "The url in the response is a Cerul tracking link. It redirects to the source video, records click events, and can also power detail pages inside Cerul-owned surfaces.",
        bullets: [
          "url: Tracking redirect to the source video",
          "thumbnail_url: Preview image",
          "keyframe_url: Optional frame-level context",
          "unit_type: summary, speech, or visual",
        ],
      },
    ],
  },
  {
    slug: "search-api",
    title: "Search API Reference",
    summary: "Complete reference for the /v1/search endpoint. Learn about request parameters, filters, and response fields for the public search API.",
    kicker: "API Reference",
    readingTime: "8 min read",
    sections: [
      {
        title: "Endpoint",
        body:
          "The search endpoint accepts POST requests with a JSON body containing your search parameters.",
        code: `POST ${API_BASE_URL}/v1/search
Content-Type: application/json
Authorization: Bearer YOUR_CERUL_API_KEY`,
        language: "http",
        filename: "endpoint.http",
      },
      {
        title: "Request parameters",
        body:
          "All search requests share one structure. Cerul handles retrieval-unit mixing automatically, so there is no search_type field.",
        code: `{
  "query": string,           // Required: Search query
  "max_results": number,     // Optional: 1-50 (default: 10)
  "include_answer": boolean, // Optional: AI summary (default: false)
  "filters": {               // Optional: Unified filters
    "speaker": string,
    "published_after": string,
    "min_duration": number,
    "max_duration": number,
    "source": string
  }
}`,
        language: "json",
        filename: "request_params.json",
      },
      {
        title: "Unified search example",
        body:
          "Search the unified retrieval layer with optional filters. Cerul may return summary, speech, or visual units depending on what matches best.",
        code: `curl "${API_BASE_URL}/v1/search" \\
  -H "Authorization: Bearer YOUR_CERUL_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "query": "business handshake in modern office",
    "max_results": 5,
    "filters": {
      "min_duration": 3,
      "max_duration": 15,
      "source": "pexels"
    }
  }'`,
        language: "bash",
        filename: "search_filtered.sh",
      },
      {
        title: "Search with answer generation",
        body:
          "Ask for a grounded answer when you want Cerul to summarize the best matching evidence for you.",
        code: `curl "${API_BASE_URL}/v1/search" \\
  -H "Authorization: Bearer YOUR_CERUL_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "query": "sam altman explains the agi timeline",
    "max_results": 5,
    "include_answer": true,
    "filters": {
      "speaker": "Sam Altman",
      "published_after": "2023-01-01"
    }
  }'`,
        language: "bash",
        filename: "knowledge_search.sh",
      },
      {
        title: "Response fields",
        body:
          "The response contains an array of results, each with standardized fields across summaries, speech units, and visual units.",
        code: `{
  "results": [{
    "id": string,           // Unique result identifier
    "score": number,        // Relevance score (0.0-1.0)
    "url": string,          // Cerul tracking URL
    "title": string,        // Video title
    "snippet": string,      // Transcript or visual summary
    "thumbnail_url": string,// Preview image
    "keyframe_url": string, // Optional keyframe image
    "duration": number,     // Length in seconds
    "source": string,       // Content source
    "speaker": string,      // Optional speaker
    "timestamp_start": number,
    "timestamp_end": number,
    "unit_type": string     // summary | speech | visual
  }],
  "answer": string,         // If include_answer: true
  "credits_used": number,
  "credits_remaining": number,
  "request_id": string
}`,
        language: "json",
        filename: "response_fields.json",
      },
    ],
  },
  {
    slug: "usage-api",
    title: "Usage API Reference",
    summary: "Monitor your API consumption with the /v1/usage endpoint. Track credits, rate limits, and billing information.",
    kicker: "API Reference",
    readingTime: "4 min read",
    sections: [
      {
        title: "Check usage",
        body:
          "The usage endpoint returns your current credit balance and consumption statistics. Use this to monitor your quota and prevent service interruption.",
        code: `curl "${API_BASE_URL}/v1/usage" \\
  -H "Authorization: Bearer YOUR_CERUL_API_KEY"`,
        language: "bash",
        filename: "check_usage.sh",
      },
      {
        title: "Response format",
        body:
          "The usage response includes your current tier, billing period, and credit information.",
        code: `{
  "tier": "free",           // free, builder, or enterprise
  "period_start": "2026-03-01",
  "period_end": "2026-03-31",
  "credits_limit": 1000,
  "credits_used": 128,
  "credits_remaining": 872,
  "rate_limit_per_sec": 1,
  "api_keys_active": 1
}`,
        language: "json",
        filename: "usage_response.json",
      },
      {
        title: "Rate limiting",
        body:
          "API requests are rate-limited based on your tier. The rate_limit_per_sec field shows your current limit. Exceeding the limit returns HTTP 429.",
        bullets: [
          "Free tier: 1 request/second",
          "Builder tier: 10 requests/second",
          "Enterprise: Custom limits",
          "Rate limit resets every second",
        ],
      },
    ],
  },
  {
    slug: "architecture",
    title: "System Architecture",
    summary: "Understand how Cerul processes video search requests. Learn about our distributed architecture and data flow.",
    kicker: "System Design",
    readingTime: "6 min read",
    sections: [
      {
        title: "Request flow",
        body:
          "When you make a search request, it travels through several components to deliver results. Understanding this flow helps optimize your integration.",
        bullets: [
          "1. API Gateway validates your API key",
          "2. Query is embedded into the unified retrieval space",
          "3. Search mixes summary, speech, and visual candidates with diversity caps",
          "4. Results are ranked and formatted",
          "5. Tracking URLs are generated",
          "6. Response is returned with usage tracking",
        ],
      },
      {
        title: "Unified retrieval units",
        body:
          "Cerul indexes each video into multiple retrieval-unit types instead of forcing callers to choose a product track up front.",
        code: `Summary units:
- One high-level entry point per video
- Good for broad semantic recall

Speech units:
- Timestamped transcript-backed segments
- Good for quoted claims and spoken explanations

Visual units:
- Keyframe-backed descriptions
- Good for slides, charts, demos, and on-screen evidence`,
        language: "text",
        filename: "retrieval_units.txt",
      },
      {
        title: "Technology stack",
        body:
          "Cerul is built on modern infrastructure designed for scalability and reliability.",
        bullets: [
          "Frontend: Next.js 16 with React Server Components",
          "API: Hono running on Cloudflare Workers",
          "Database: Neon PostgreSQL with pgvector",
          "Search: Vector similarity with HNSW indexing",
          "Workers: Python for video processing and indexing",
          "CDN: Global edge caching for video delivery",
        ],
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
    href: `/docs/${page.slug}` as const,
  }));
}

export function getDocsPageCanonical(slug: string): string {
  return canonicalUrl(`/docs/${slug}`);
}

export const docsSidebarGroups: DocsNavGroup[] = [
  {
    title: "Getting Started",
    items: [
      {
        title: "Overview",
        href: "/docs",
        description: "Landing page and quick navigation",
      },
      {
        title: "Quickstart",
        href: "/docs/quickstart",
        slug: "quickstart",
        description: "Create a key and make the first request",
      },
    ],
  },
  {
    title: "API Guides",
    items: [
      {
        title: "Search API",
        href: "/docs/search-api",
        slug: "search-api",
        description: "Primary retrieval endpoint",
      },
      {
        title: "Usage API",
        href: "/docs/usage-api",
        slug: "usage-api",
        description: "Credits and rate posture",
      },
      {
        title: "API Reference",
        href: "/docs/api-reference",
        slug: "api-reference",
        description: "Structured endpoint reference",
      },
    ],
  },
  {
    title: "Platform",
    items: [
      {
        title: "Architecture",
        href: "/docs/architecture",
        slug: "architecture",
        description: "Request flow and retrieval backbone",
      },
    ],
  },
];

export const docsShellTabs = [
  { label: "Home", href: "/docs" },
  { label: "Introduction", href: "/docs/quickstart" },
  { label: "API & SDKs", href: "/docs/api-reference" },
  { label: "Playground", href: "/search" },
  { label: "Pricing", href: "/pricing" },
] as const;

export const docsUtilityLinks = [
  {
    title: "API Playground",
    href: "/search",
    description: "Test one request in the Cerul playground.",
  },
  {
    title: "GitHub",
    href: "https://github.com/JessyTsui/cerul",
    description: "Inspect the public repository and examples.",
  },
  {
    title: "Support",
    href: "mailto:team@cerul.ai",
    description: "Reach the team when a public route is unclear.",
  },
] as const;

export const docsPopularTopics = [
  {
    title: "Rate limits and quotas",
    href: "/docs/usage-api",
    description: "Understand credit posture before wiring high-volume traffic.",
  },
  {
    title: "Search payload design",
    href: "/docs/search-api",
    description: "Shape one request body cleanly and know which fields change result behavior.",
  },
  {
    title: "Response schemas",
    href: "/docs/api-reference",
    description: "See the exact request and response envelopes for the public API.",
  },
  {
    title: "First request flow",
    href: "/docs/quickstart",
    description: "Generate a key, send a request, and inspect usage in one pass.",
  },
] as const;

export const docsFeatureCards: DocsFeatureCard[] = [
  {
    title: "Authentication",
    description: "Secure your requests with API keys created from the dashboard.",
    snippet: "Authorization: Bearer <TOKEN>",
    href: "/docs/quickstart",
  },
  {
    title: "Search endpoint",
    description: "Retrieve matched video results from one public route.",
    snippet: "POST /v1/search",
    href: "/docs/search-api",
  },
  {
    title: "Index endpoint",
    description: "Submit videos for indexing and poll status through one shared pipeline.",
    snippet: "POST /v1/index",
    href: "/docs/api-reference",
  },
  {
    title: "Usage summary",
    description: "Monitor tier, billing period, remaining credits, and active API keys.",
    snippet: "GET /v1/usage",
    href: "/docs/usage-api",
  },
] as const;

export function getDocsSearchEntries(): DocsSearchEntry[] {
  return [
    ...docsPages.map((page) => ({
      title: page.title,
      description: page.summary,
      href: `/docs/${page.slug}`,
      category: page.kicker,
    })),
    {
      title: "Documentation overview",
      description: "Landing page and quick navigation for the Cerul public docs.",
      href: "/docs",
      category: "Home",
    },
    ...apiReferenceEndpoints.map((endpoint) => ({
      title: `${endpoint.method} ${endpoint.path}`,
      description: endpoint.title,
      href: `/docs/api-reference#${endpoint.id}`,
      category: endpoint.group,
    })),
  ];
}

export const apiReferenceEndpoints: ApiReferenceEndpoint[] = [
  {
    id: "search-v1",
    group: "Search",
    method: "POST",
    path: "/v1/search",
    title: "Search videos",
    description:
      "Unified retrieval endpoint for summary, speech, and visual matches.",
    authLabel: "Bearer API key",
    authDescription:
      "Requires a Cerul API key from the dashboard in the Authorization header.",
    parameters: [
      {
        name: "query",
        type: "string",
        required: "Yes",
        description: "Natural-language search request.",
      },
      {
        name: "max_results",
        type: "integer",
        required: "No",
        description: "Result count from 1 to 50. Defaults to 10.",
      },
      {
        name: "include_answer",
        type: "boolean",
        required: "No",
        description: "Adds a synthesized grounded answer.",
      },
      {
        name: "filters",
        type: "object",
        required: "No",
        description:
          "Unified filters such as speaker, published_after, duration, and source.",
      },
    ],
    requestExamples: [
      {
        label: "cURL",
        language: "bash",
        filename: "search.sh",
        code: `curl "${API_BASE_URL}/v1/search" \\
  -H "Authorization: Bearer YOUR_CERUL_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "query": "Sam Altman views on AI video generation tools",
    "max_results": 3,
    "include_answer": true,
    "filters": {
      "speaker": "Sam Altman",
      "source": "youtube"
    }
  }'`,
      },
      {
        label: "Python",
        language: "python",
        filename: "search.py",
        code: `import requests

headers = {
    "Authorization": "Bearer YOUR_CERUL_API_KEY",
    "Content-Type": "application/json",
}

payload = {
    "query": "Sam Altman views on AI video generation tools",
    "max_results": 3,
    "include_answer": True,
    "filters": {"speaker": "Sam Altman", "source": "youtube"},
}

response = requests.post("${API_BASE_URL}/v1/search", headers=headers, json=payload)
print(response.json())`,
      },
    ],
    responseSchema: `{
  "results": [
    {
      "id": "string",
      "score": "number",
      "url": "string",
      "title": "string",
      "snippet": "string",
      "thumbnail_url": "string",
      "keyframe_url": "string | null",
      "duration": "integer",
      "source": "string",
      "speaker": "string | null",
      "timestamp_start": "number | null",
      "timestamp_end": "number | null",
      "unit_type": "\"summary\" | \"speech\" | \"visual\""
    }
  ],
  "answer": "string | null",
  "credits_used": "integer",
  "credits_remaining": "integer",
  "request_id": "req_<24 hex>"
}`,
    responseExample: `{
  "results": [
    {
      "id": "unit_yt_talk_segment_12",
      "score": 0.93,
      "url": "https://cerul.ai/v/a8f3k2x",
      "title": "AI video tools discussion",
      "snippet": "The speaker frames current AI video generation tools as improving quickly, but still constrained by controllability and reliability.",
      "thumbnail_url": "https://cdn.cerul.ai/previews/yt_talk_segment_12.jpg",
      "keyframe_url": "https://cdn.cerul.ai/frames/yt_talk_segment_12/f012.jpg",
      "duration": 5400,
      "source": "youtube",
      "speaker": "Sam Altman",
      "timestamp_start": 812.4,
      "timestamp_end": 854.6,
      "unit_type": "speech"
    }
  ],
  "answer": "The speaker frames current AI video generation tools as improving quickly, but still constrained by controllability and production reliability.",
  "credits_used": 2,
  "credits_remaining": 998,
  "request_id": "req_9f8c1d5b2a9f7d1a8c4e6b02"
}`,
  },
  {
    id: "index-submit-v1",
    group: "Index",
    method: "POST",
    path: "/v1/index",
    title: "Submit a video for indexing",
    description: "Queue a video URL for unified indexing. Indexing is free and scoped to the current API key owner.",
    authLabel: "Bearer API key",
    authDescription:
      "Requires a Cerul API key. The queued video becomes searchable after processing completes.",
    parameters: [
      {
        name: "url",
        type: "string",
        required: "Yes",
        description: "YouTube, Pexels, Pixabay, or direct video URL to index.",
      },
      {
        name: "force",
        type: "boolean",
        required: "No",
        description: "Re-index the video even if it already exists.",
      },
    ],
    requestExamples: [
      {
        label: "cURL",
        language: "bash",
        filename: "index-submit.sh",
        code: `curl "${API_BASE_URL}/v1/index" \\
  -H "Authorization: Bearer YOUR_CERUL_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "url": "https://www.youtube.com/watch?v=hmtuvNfytjM"
  }'`,
      },
    ],
    responseSchema: `{
  "video_id": "uuid",
  "status": "\"processing\" | \"completed\"",
  "request_id": "req_<24 hex>"
}`,
    responseExample: `{
  "video_id": "2ec9d7af-5d4f-4ec9-9fd9-ecf6bc0ec3d4",
  "status": "processing",
  "request_id": "req_9f8c1d5b2a9f7d1a8c4e6b02"
}`,
  },
  {
    id: "index-status-v1",
    group: "Index",
    method: "GET",
    path: "/v1/index/{video_id}",
    title: "Check index status",
    description: "Return status, timing, and unit counts for one indexed video.",
    authLabel: "Bearer API key",
    authDescription:
      "Requires a Cerul API key belonging to the user who indexed the video.",
    parameters: [],
    requestExamples: [
      {
        label: "cURL",
        language: "bash",
        filename: "index-status.sh",
        code: `curl "${API_BASE_URL}/v1/index/2ec9d7af-5d4f-4ec9-9fd9-ecf6bc0ec3d4" \\
  -H "Authorization: Bearer YOUR_CERUL_API_KEY"`,
      },
    ],
    responseSchema: `{
  "video_id": "uuid",
  "status": "\"processing\" | \"completed\" | \"failed\"",
  "title": "string | null",
  "current_step": "string | null",
  "steps_completed": "integer | null",
  "steps_total": "integer | null",
  "duration": "integer | null",
  "units_created": "integer | null",
  "error": "string | null",
  "created_at": "datetime",
  "completed_at": "datetime | null",
  "failed_at": "datetime | null"
}`,
    responseExample: `{
  "video_id": "2ec9d7af-5d4f-4ec9-9fd9-ecf6bc0ec3d4",
  "status": "completed",
  "title": "Sam Altman on AGI",
  "current_step": null,
  "steps_completed": 8,
  "steps_total": 8,
  "duration": 5400,
  "units_created": 24,
  "error": null,
  "created_at": "2026-03-21T10:00:00Z",
  "completed_at": "2026-03-21T10:03:45Z",
  "failed_at": null
}`,
  },
  {
    id: "index-list-v1",
    group: "Index",
    method: "GET",
    path: "/v1/index",
    title: "List indexed videos",
    description: "Return videos indexed by the current API key owner.",
    authLabel: "Bearer API key",
    authDescription:
      "Requires a Cerul API key. Only videos visible to the current owner are returned.",
    parameters: [],
    requestExamples: [
      {
        label: "cURL",
        language: "bash",
        filename: "index-list.sh",
        code: `curl "${API_BASE_URL}/v1/index?page=1&per_page=20" \\
  -H "Authorization: Bearer YOUR_CERUL_API_KEY"`,
      },
    ],
    responseSchema: `{
  "videos": [
    {
      "video_id": "uuid",
      "title": "string",
      "status": "string",
      "units_created": "integer",
      "created_at": "datetime",
      "completed_at": "datetime | null"
    }
  ],
  "total": "integer",
  "page": "integer",
  "per_page": "integer"
}`,
    responseExample: `{
  "videos": [
    {
      "video_id": "2ec9d7af-5d4f-4ec9-9fd9-ecf6bc0ec3d4",
      "title": "Sam Altman on AGI",
      "status": "completed",
      "units_created": 24,
      "created_at": "2026-03-21T10:00:00Z",
      "completed_at": "2026-03-21T10:03:45Z"
    }
  ],
  "total": 1,
  "page": 1,
  "per_page": 20
}`,
  },
  {
    id: "index-delete-v1",
    group: "Index",
    method: "DELETE",
    path: "/v1/index/{video_id}",
    title: "Delete indexed video access",
    description: "Delete the current user's access to an indexed video.",
    authLabel: "Bearer API key",
    authDescription:
      "Requires a Cerul API key. Shared video data is only deleted when no access rows remain.",
    parameters: [],
    requestExamples: [
      {
        label: "cURL",
        language: "bash",
        filename: "index-delete.sh",
        code: `curl -X DELETE "${API_BASE_URL}/v1/index/2ec9d7af-5d4f-4ec9-9fd9-ecf6bc0ec3d4" \\
  -H "Authorization: Bearer YOUR_CERUL_API_KEY"`,
      },
    ],
    responseSchema: `{
  "deleted": "boolean"
}`,
    responseExample: `{
  "deleted": true
}`,
  },
  {
    id: "usage-v1",
    group: "Usage",
    method: "GET",
    path: "/v1/usage",
    title: "Check usage",
    description: "Return current plan posture, billing window, credit usage, and active key count.",
    authLabel: "Bearer API key",
    authDescription:
      "Requires a Cerul API key. Use it to monitor usage before automating heavier traffic.",
    parameters: [],
    requestExamples: [
      {
        label: "cURL",
        language: "bash",
        filename: "usage.sh",
        code: `curl "${API_BASE_URL}/v1/usage" \\
  -H "Authorization: Bearer YOUR_CERUL_API_KEY"`,
      },
    ],
    responseSchema: `{
  "tier": "string",
  "period_start": "YYYY-MM-DD",
  "period_end": "YYYY-MM-DD",
  "credits_limit": "integer",
  "credits_used": "integer",
  "credits_remaining": "integer",
  "rate_limit_per_sec": "integer",
  "api_keys_active": "integer"
}`,
    responseExample: `{
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
    id: "meta-v1",
    group: "Meta",
    method: "GET",
    path: "/v1/meta",
    title: "Read service metadata",
    description: "Lightweight public metadata route for service identity and environment sanity checks.",
    authLabel: "No auth",
    authDescription: "This route is public and can be used for non-sensitive health or environment checks.",
    parameters: [],
    requestExamples: [
      {
        label: "cURL",
        language: "bash",
        filename: "meta.sh",
        code: `curl "${API_BASE_URL}/v1/meta"`,
      },
    ],
    responseSchema: `{
  "service": "string",
  "framework": "string",
  "environment": "string"
}`,
    responseExample: `{
  "service": "cerul-api",
  "framework": "fastapi",
  "environment": "development"
}`,
  },
] as const;

export function getApiReferenceEndpoint(endpointId = "search-v1") {
  return (
    apiReferenceEndpoints.find((endpoint) => endpoint.id === endpointId)
    ?? apiReferenceEndpoints[0]
  );
}
