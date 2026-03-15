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

// Base URL for API
export const API_BASE_URL = "https://api.cerul.ai";

export const docsNavigation = [
  { href: "#introduction", label: "Introduction", index: "01" },
  { href: "#authentication", label: "Authentication", index: "02" },
  { href: "#search", label: "Search API", index: "03" },
  { href: "#usage", label: "Usage API", index: "04" },
  { href: "#response", label: "Response Format", index: "05" },
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
      "The search endpoint is the primary interface for retrieving video content. Use search_type to specify whether you want b-roll footage or knowledge segments. The endpoint returns matching results with metadata and direct video URLs.",
    list: [
      "search_type: 'broll' for stock footage",
      "search_type: 'knowledge' for educational content",
      "max_results: 1-50 (default: 10)",
      "include_answer: true for AI-generated summaries",
    ],
    code: `curl "${API_BASE_URL}/v1/search" \\
  -H "Authorization: Bearer YOUR_CERUL_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "query": "cinematic drone shot of coastal highway at sunset",
    "search_type": "broll",
    "max_results": 5,
    "filters": {
      "min_duration": 5,
      "max_duration": 30,
      "source": "pexels"
    }
  }'`,
    language: "bash",
    filename: "search_broll.sh",
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
      "Each result includes direct video URL",
      "Score indicates relevance (0.0-1.0)",
      "Metadata varies by search_type",
    ],
    code: `{
  "results": [
    {
      "id": "pexels_28192743",
      "score": 0.89,
      "title": "Aerial drone shot of coastal highway",
      "description": "Cinematic 4K drone footage of winding coastal road at golden hour",
      "video_url": "https://videos.pexels.com/video-files/28192743/abc123.mp4",
      "thumbnail_url": "https://images.pexels.com/photos/28192743/pexels-photo-28192743.jpeg",
      "duration": 18,
      "source": "pexels",
      "license": "pexels-license"
    }
  ],
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
          "Use curl to make a test request. Replace YOUR_CERUL_API_KEY with your actual API key. This example searches for b-roll footage of coastal highways.",
        code: `curl "${API_BASE_URL}/v1/search" \\
  -H "Authorization: Bearer YOUR_CERUL_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "query": "cinematic drone shot of coastal highway",
    "search_type": "broll",
    "max_results": 3
  }'`,
        language: "bash",
        filename: "first_request.sh",
      },
      {
        title: "Understanding the response",
        body:
          "The API returns a JSON object containing an array of results. Each result includes a direct video_url you can use to download or embed the video, along with metadata like duration, source, and relevance score.",
        code: `{
  "results": [
    {
      "id": "pexels_28192743",
      "score": 0.89,
      "title": "Aerial drone shot of coastal highway",
      "video_url": "https://videos.pexels.com/video-files/28192743/abc123.mp4",
      "thumbnail_url": "https://images.pexels.com/photos/28192743/pexels-photo-28192743.jpeg",
      "duration": 18,
      "source": "pexels"
    }
  ],
  "credits_used": 1,
  "credits_remaining": 999
}`,
        language: "json",
        filename: "first_response.json",
      },
      {
        title: "Using the video URL",
        body:
          "The video_url in the response is a direct link to the video file. You can use this URL to embed the video in your application, download it for processing, or serve it to your users. The URL is valid for 24 hours.",
        bullets: [
          "video_url: Direct link to MP4 file",
          "thumbnail_url: Preview image",
          "duration: Length in seconds",
          "License info included for compliance",
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
          "All search requests share a common structure. The search_type parameter determines which retrieval system to use.",
        code: `{
  "query": string,           // Required: Search query
  "search_type": string,     // Required: "broll" or "knowledge"
  "max_results": number,     // Optional: 1-50 (default: 10)
  "include_answer": boolean, // Optional: AI summary (default: false)
  "filters": {               // Optional: Track-specific filters
    "min_duration": number,
    "max_duration": number,
    "source": string
  }
}`,
        language: "json",
        filename: "request_params.json",
      },
      {
        title: "B-roll search example",
        body:
          "Search for stock footage and b-roll content. Results include direct video URLs from sources like Pexels and Pixabay.",
        code: `curl "${API_BASE_URL}/v1/search" \\
  -H "Authorization: Bearer YOUR_CERUL_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "query": "business handshake in modern office",
    "search_type": "broll",
    "max_results": 5,
    "filters": {
      "min_duration": 3,
      "max_duration": 15
    }
  }'`,
        language: "bash",
        filename: "broll_search.sh",
      },
      {
        title: "Knowledge search example",
        body:
          "Search educational and informational video content. Results include timestamps and optional AI-generated answers.",
        code: `curl "${API_BASE_URL}/v1/search" \\
  -H "Authorization: Bearer YOUR_CERUL_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "query": "sam altman explains the agi timeline",
    "search_type": "knowledge",
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
          "The response contains an array of results, each with standardized fields and track-specific metadata.",
        code: `{
  "results": [{
    "id": string,           // Unique result identifier
    "score": number,        // Relevance score (0.0-1.0)
    "title": string,        // Video title
    "description": string,  // Video description
    "video_url": string,    // Direct MP4 URL
    "thumbnail_url": string,// Preview image
    "duration": number,     // Length in seconds
    "source": string,       // Content source

    // B-roll specific:
    "license": string,      // Usage license

    // Knowledge specific:
    "timestamp_start": number,
    "timestamp_end": number,
    "answer": string        // If include_answer: true
  }],
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
          "2. Query is parsed and routed to the correct search track",
          "3. Vector search retrieves matching candidates",
          "4. Results are ranked and formatted",
          "5. Direct video URLs are generated",
          "6. Response is returned with usage tracking",
        ],
      },
      {
        title: "B-roll vs Knowledge",
        body:
          "The two search tracks use different indexing strategies and data sources, but share the same API interface.",
        code: `B-roll Track:
- Sources: Pexels, Pixabay (stock footage)
- Indexing: CLIP visual embeddings
- Results: Asset-level (entire video)
- Metadata: License, duration, resolution

Knowledge Track:
- Sources: YouTube educational content
- Indexing: Whisper + GPT-4o + CLIP
- Results: Segment-level (timestamped clips)
- Metadata: Speaker, transcript, timestamps`,
        language: "text",
        filename: "track_comparison.txt",
      },
      {
        title: "Technology stack",
        body:
          "Cerul is built on modern infrastructure designed for scalability and reliability.",
        bullets: [
          "Frontend: Next.js 16 with React Server Components",
          "API: FastAPI with async request handling",
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
    title: "Usage summary",
    description: "Monitor tier, billing period, remaining credits, and active API keys.",
    snippet: "GET /v1/usage",
    href: "/docs/usage-api",
  },
  {
    title: "Service metadata",
    description: "Sanity-check the public service identity and environment wiring.",
    snippet: "GET /v1/meta",
    href: "/docs/api-reference",
  },
] as const;

export const apiReferenceEndpoints: ApiReferenceEndpoint[] = [
  {
    id: "search-v1",
    group: "Search",
    method: "POST",
    path: "/v1/search",
    title: "Search videos",
    description:
      "Unified retrieval endpoint for both b-roll assets and timestamped knowledge segments.",
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
        name: "search_type",
        type: "\"broll\" | \"knowledge\"",
        required: "Yes",
        description: "Select asset retrieval or timestamped knowledge retrieval.",
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
        description: "Only valid for knowledge searches. Adds a synthesized answer.",
      },
      {
        name: "filters",
        type: "object",
        required: "No",
        description:
          "Track-specific filters such as duration/source for b-roll or speaker/published_after for knowledge.",
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
    "search_type": "knowledge",
    "max_results": 3,
    "include_answer": true
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
    "search_type": "knowledge",
    "max_results": 3,
    "include_answer": True,
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
      "title": "string",
      "description": "string",
      "video_url": "string",
      "thumbnail_url": "string",
      "duration": "integer",
      "source": "string",
      "license": "string",
      "timestamp_start": "number | omitted for broll",
      "timestamp_end": "number | omitted for broll",
      "answer": "string | null"
    }
  ],
  "credits_used": "integer",
  "credits_remaining": "integer",
  "request_id": "req_<24 hex>"
}`,
    responseExample: `{
  "results": [
    {
      "id": "yt_talk_segment_12",
      "score": 0.93,
      "title": "AI video tools discussion",
      "description": "Segment covering current views on AI video generation tooling.",
      "video_url": "https://cdn.cerul.ai/previews/yt_talk_segment_12.mp4",
      "thumbnail_url": "https://cdn.cerul.ai/previews/yt_talk_segment_12.jpg",
      "duration": 42,
      "source": "youtube",
      "license": "source-license",
      "timestamp_start": 812.4,
      "timestamp_end": 854.6,
      "answer": "The speaker frames current AI video generation tools as improving quickly, but still constrained by controllability and production reliability."
    }
  ],
  "credits_used": 3,
  "credits_remaining": 997,
  "request_id": "req_9f8c1d5b2a9f7d1a8c4e6b02"
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
