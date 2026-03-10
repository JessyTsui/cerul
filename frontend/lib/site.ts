export const primaryNavigation = [
  { label: "Home", href: "/" },
  { label: "Docs", href: "/docs" },
  { label: "Pricing", href: "/pricing" },
  { label: "Dashboard", href: "/dashboard" },
] as const;

export const marketingMetrics = [
  {
    label: "Shared backbone",
    value: "2 tracks",
    caption: "B-roll and knowledge retrieval on the same platform spine.",
  },
  {
    label: "Public API",
    value: "2 endpoints",
    caption: "Search and usage first. Heavy processing stays behind workers.",
  },
  {
    label: "Agent path",
    value: "Skill-first",
    caption: "Installable skills and direct HTTP before extra adapters.",
  },
] as const;

export const capabilityHighlights = [
  {
    kicker: "Visual retrieval",
    title: "Ground on-screen evidence",
    description:
      "Slides, charts, product demos, whiteboards, and screen recordings become searchable context for downstream reasoning.",
  },
  {
    kicker: "Thin orchestration",
    title: "Keep the API layer narrow",
    description:
      "FastAPI handles auth, usage, and response shaping. Ingestion, indexing, and media-heavy work stay in Python workers.",
  },
  {
    kicker: "Replaceable models",
    title: "Do not lock product logic to one model",
    description:
      "CLIP, OpenAI embeddings, or future internal models can slot into the same shared retrieval backbone.",
  },
] as const;

export const searchTracks = [
  {
    badge: "Launch track",
    name: "B-roll",
    grain: "asset-level",
    description:
      "A lightweight showcase that proves the value of visual search quickly, with lower ingestion cost and immediate demo value.",
    points: [
      "Semantic search over stock footage sources such as Pexels and Pixabay",
      "Fast CLIP-based indexing without ASR",
      "Low-cost lead generation surface",
      "Ideal for public demos and partner onboarding",
    ],
  },
  {
    badge: "Core moat",
    name: "Knowledge",
    grain: "segment-level",
    description:
      "Long-form talks, podcasts, product keynotes, and technical videos indexed into segments that reflect what was said and shown.",
    points: [
      "Scene detection and key-frame analysis",
      "Timestamp-aware retrieval and answer generation",
      "Built for evidence-backed agent workflows",
      "Higher-value foundation for enterprise search",
    ],
  },
] as const;

export const benchmarkRows = [
  {
    label: "Slide recall",
    description: "How well the system captures text and chart evidence from frames",
    score: 93,
  },
  {
    label: "Demo grounding",
    description: "Whether product screens and on-screen actions remain queryable",
    score: 88,
  },
  {
    label: "Transcript-only gap",
    description: "How much signal is lost if the system reads words but ignores visuals",
    score: 71,
  },
] as const;

export const dashboardSignals = [
  {
    label: "Usage ledger",
    value: "128 credits",
    change: "+16 today",
    caption: "Monthly credit accounting with the same request IDs used for search logs.",
  },
  {
    label: "Index freshness",
    value: "3h 14m",
    change: "Within target",
    caption: "Current lag between source discovery and available search results.",
  },
  {
    label: "Search health",
    value: "99.94%",
    change: "Stable",
    caption: "Healthy request success rate across both product tracks.",
  },
] as const;

export const demoModes = {
  knowledge: {
    label: "knowledge",
    query: "Find the segment where the speaker explains the AGI timeline and shows a roadmap slide.",
    tags: ["timestamp url", "speaker filters", "answer optional"],
    surface: "Segment retrieval",
    output: "Summary plus time range",
  },
  broll: {
    label: "broll",
    query: "Cinematic close-up of a robotic arm sorting packages in a bright warehouse.",
    tags: ["preview image", "duration filters", "source metadata"],
    surface: "Asset retrieval",
    output: "Thumbnail, preview, duration",
  },
  agent: {
    label: "agent skill",
    query: "Return sources and timestamps I can cite in an autonomous research brief about AI chip supply constraints.",
    tags: ["citations", "api keys", "direct http"],
    surface: "Skill integration",
    output: "Structured references for downstream agents",
  },
} as const;

export const pricingTiers = [
  {
    name: "Free",
    price: "$0",
    cadence: "for early evaluation",
    description:
      "Best for trying the public API surface and validating early demo integrations.",
    ctaLabel: "Start free",
    ctaHref: "/signup",
    accent: "sky",
    features: [
      "1,000 monthly credits",
      "B-roll and knowledge search access",
      "Single API key",
      "Community support",
    ],
  },
  {
    name: "Builder",
    price: "$99",
    cadence: "per month",
    description:
      "For teams building agent workflows that need predictable usage and more active keys.",
    ctaLabel: "Request sandbox",
    ctaHref: "/login",
    accent: "orange",
    features: [
      "50,000 monthly credits",
      "5 active API keys",
      "Usage insights and search logs",
      "Priority email support",
    ],
  },
  {
    name: "Enterprise",
    price: "Custom",
    cadence: "volume and support matched",
    description:
      "For production deployments with private ingestion pipelines, SLA expectations, and compliance review.",
    ctaLabel: "Talk to us",
    ctaHref: "mailto:team@cerul.ai",
    accent: "ink",
    features: [
      "Custom credit limits and rate policies",
      "Private indexing workflows",
      "Dedicated onboarding and review",
      "Enterprise security and billing coordination",
    ],
  },
] as const;

export const pricingFaqs = [
  {
    question: "Why start with credits instead of raw request counts?",
    answer:
      "Credits let Cerul price different workloads fairly across b-roll search, knowledge retrieval, and optional answer generation without exposing all internal execution details.",
  },
  {
    question: "Will agent skills use the same pricing model?",
    answer:
      "Yes. Skills are thin clients over the same HTTP API, so usage should map to the same credits and key model.",
  },
  {
    question: "When does enterprise make sense?",
    answer:
      "Once a team needs private ingestion, multiple administrators, security review, or predictable throughput guarantees, the enterprise path becomes the cleaner fit.",
  },
] as const;

export const authValueProps = [
  {
    title: "Shared platform visibility",
    description:
      "Track the same request IDs across public API calls, dashboard usage views, and future worker logs.",
  },
  {
    title: "Thin auth surface",
    description:
      "Web auth remains separate from API key auth, keeping the public integration path simple.",
  },
  {
    title: "Operator-first defaults",
    description:
      "The console is designed around key management, usage control, and pipeline health before deeper product chrome.",
  },
] as const;

export const dashboardRoutes = [
  { label: "Overview", href: "/dashboard", meta: "01" },
  { label: "API keys", href: "/dashboard/keys", meta: "02" },
  { label: "Usage", href: "/dashboard/usage", meta: "03" },
  { label: "Pipelines", href: "/dashboard/pipelines", meta: "04" },
  { label: "Settings", href: "/dashboard/settings", meta: "05" },
] as const;

export function isPrimaryRoute(path: string): boolean {
  return primaryNavigation.some((item) => item.href === path);
}

export function isPrimaryNavigationActive(
  currentPath: string,
  itemHref: (typeof primaryNavigation)[number]["href"],
): boolean {
  if (itemHref === "/") {
    return currentPath === "/";
  }

  return currentPath === itemHref || currentPath.startsWith(`${itemHref}/`);
}

export function isDashboardRouteActive(currentPath: string, href: string): boolean {
  if (href === "/dashboard") {
    return currentPath === "/dashboard";
  }

  return currentPath === href || currentPath.startsWith(`${href}/`);
}
