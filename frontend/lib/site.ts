export const primaryNavigation = [
  { label: "Home", href: "/" },
  { label: "Docs", href: "/docs" },
  { label: "Pricing", href: "/pricing" },
  { label: "Dashboard", href: "/dashboard" },
] as const;

export const ACCOUNT_SETTINGS_ROUTE = "/dashboard/settings#account" as const;

export const marketingMetrics = [
  {
    label: "Visual search",
    value: "See what's on screen",
    caption:
      "Slides, charts, demos, and whiteboard sketches become searchable context for your agent.",
  },
  {
    label: "Speech + transcript",
    value: "Hear what's said",
    caption:
      "Every spoken word is indexed and aligned with the visual timeline, so you can search both.",
  },
  {
    label: "One API call",
    value: "Built for agents",
    caption:
      "A single endpoint returns grounded results with timestamps, relevance scores, and source links.",
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
      "Hono on Cloudflare Workers handles auth, usage, and response shaping. Indexing and other media-heavy work stay in Python workers.",
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
      "A lightweight showcase that proves the value of visual search quickly, with lower indexing cost and immediate demo value.",
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
    caption: "Healthy request success rate across the shared retrieval surface.",
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
    cadence: "to get started",
    description:
      "1,000 free credits per month to try the API with no card on file.",
    ctaLabel: "Start free",
    ctaHref: "/login?mode=signup",
    accent: "sky",
    features: [
      "1,000 credits / month",
      "Full public search API access",
      "Community support",
    ],
  },
  {
    name: "Monthly",
    price: "$30",
    cadence: "per month",
    description:
      "5,000 included credits every month with higher rate limits for production workloads.",
    ctaLabel: "Subscribe",
    ctaHref: "/login?mode=signup",
    accent: "blue",
    features: [
      "5,000 included credits / month",
      "Top up anytime with prepaid credit packs",
      "Higher rate limits",
      "Priority email support",
    ],
  },
  {
    name: "Enterprise",
    price: "Custom",
    cadence: "let\u2019s talk",
    description:
      "For production deployments with private indexing, SLA expectations, and compliance review.",
    ctaLabel: "Talk to us",
    ctaHref: "mailto:support@cerul.ai",
    accent: "ink",
    features: [
      "Custom volume pricing",
      "Private indexing workflows",
      "Dedicated onboarding and review",
      "Enterprise security and SLAs",
    ],
  },
] as const;

export const topupPackages = [
  {
    name: "Top-up 1,000",
    price: "$8",
    cadence: "one time",
    description: "Prepaid credits for bursty traffic or trial workloads.",
    features: ["1,000 credits", "Promo codes supported", "12-month expiry"],
  },
  {
    name: "Top-up 5,000",
    price: "$36",
    cadence: "one time",
    description: "Better effective rate for recurring non-subscription usage.",
    features: ["5,000 credits", "$7.20 / 1K effective rate", "12-month expiry"],
  },
  {
    name: "Top-up 20,000",
    price: "$120",
    cadence: "one time",
    description: "Best self-serve rate for sustained agent traffic.",
    features: ["20,000 credits", "$6 / 1K effective rate", "12-month expiry"],
  },
] as const;

export const pricingFaqs = [
  {
    question: "How do credits map to API usage?",
    answer:
      "A standard search costs 1 credit. A search with include_answer=true costs 2 credits. Credits are the only billing unit shown in the product and API docs.",
  },
  {
    question: "What happens when I burn through the included monthly credits?",
    answer:
      "Cerul does not auto-bill overages in v1. Once included credits run low, you can buy prepaid top-up packs and the system will spend those after bonus credits and before blocking requests.",
  },
  {
    question: "Why buy top-ups if Monthly already includes credits?",
    answer:
      "Top-ups are useful for spikes, launches, and teams that want prepaid control. The larger packs also lower the effective per-credit rate without forcing a subscription.",
  },
  {
    question: "How do referral and promo credits work?",
    answer:
      "Stripe promotion codes apply discounts at checkout. Cerul referral codes are separate: once a referred account completes its first paid order and keeps it for 7 days, both sides receive 500 bonus credits.",
  },
  {
    question: "When does enterprise make sense?",
    answer:
      "Once a team needs private indexing, custom rate limits, security review, or volume pricing, reach out and we\u2019ll put together a plan that fits.",
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
  { label: "Usage", href: "/dashboard/usage", meta: "02" },
  { label: "Settings", href: "/dashboard/settings", meta: "03" },
] as const;

export const adminRoutes = [
  { label: "Overview", href: "/admin", meta: "A1" },
  { label: "Requests", href: "/admin/requests", meta: "A2" },
  { label: "Workers", href: "/admin/workers", meta: "A3" },
  { label: "Sources", href: "/admin/sources", meta: "A4" },
  { label: "Content", href: "/admin/content", meta: "A5" },
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

export function isAdminRouteActive(currentPath: string, href: string): boolean {
  if (href === "/admin") {
    return currentPath === "/admin";
  }

  return currentPath === href || currentPath.startsWith(`${href}/`);
}
