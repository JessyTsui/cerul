import { demoModes } from "./site";

export type DemoMode = keyof typeof demoModes;

export type DemoSearchResult = {
  id: string;
  title: string;
  score: number;
  source: string;
  detail: string;
  href: string;
};

export type DemoSearchResponse = {
  requestId: string;
  mode: DemoMode;
  query: string;
  latencyMs: number;
  creditsUsed: number;
  creditsRemaining: number;
  answer?: string;
  diagnostics: string[];
  results: DemoSearchResult[];
};

export type DemoSearchInput = {
  mode: DemoMode;
  query: string;
};

export type DemoSearchRequestValidation =
  | {
      ok: true;
      value: DemoSearchInput;
    }
  | {
      ok: false;
      error: string;
    };

export type OverviewCard = {
  label: string;
  value: string;
  caption: string;
};

export type SearchMixItem = {
  label: string;
  value: number;
};

export type LiveStatus = {
  health: "Healthy" | "Degraded";
  freshness: string;
  activeWorkers: number;
  queueDepth: number;
  summary: string;
  updatedAt: string;
};

export type DemoApiKey = {
  name: string;
  prefix: string;
  status: "Active" | "Paused";
  scope: string;
  lastUsed: string;
};

export type RecentQuery = {
  query: string;
  track: "broll" | "knowledge";
  latency: string;
  status: "OK";
};

export type UsageLedgerEntry = {
  label: string;
  requests: string;
  credits: string;
  note: string;
};

export type PipelineRun = {
  id: string;
  source: string;
  stage: string;
  progress: number;
  status: "running" | "queued" | "completed";
  note: string;
};

export type SettingsPanel = {
  title: string;
  description: string;
  value: string;
};

export type DashboardSnapshot = {
  overviewCards: OverviewCard[];
  searchMix: SearchMixItem[];
  liveStatus: LiveStatus;
  apiKeys: DemoApiKey[];
  recentQueries: RecentQuery[];
  usageLedger: UsageLedgerEntry[];
  pipelineRuns: PipelineRun[];
  settingsPanels: SettingsPanel[];
};

function hashString(input: string): number {
  let hash = 0;

  for (let index = 0; index < input.length; index += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(index);
    hash |= 0;
  }

  return Math.abs(hash);
}

function scoreFor(seed: number, index: number, base: number) {
  return Number((base - index * 0.06 + (seed % 5) * 0.007).toFixed(2));
}

function timestampLabel(date: Date) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

const templateResults: Record<DemoMode, Omit<DemoSearchResult, "score">[]> = {
  knowledge: [
    {
      id: "seg_yt_roadmap_1823_1945",
      title: "AGI roadmap slide and timeline discussion",
      source: "YouTube keynote",
      detail:
        "Returns a timestamped segment with slide context, transcript snippet, and a source URL for citation.",
      href: "/docs/search-api",
    },
    {
      id: "seg_yt_policy_941_1022",
      title: "Supply-chain bottlenecks with on-screen chart",
      source: "Industry panel",
      detail:
        "Combines spoken analysis with a chart visible in the frame, useful for evidence-backed summaries.",
      href: "/docs/search-api",
    },
  ],
  broll: [
    {
      id: "pexels_28192743",
      title: "Aerial coastal highway at sunset",
      source: "Pexels",
      detail:
        "Asset-level retrieval with preview imagery, duration filtering, and source metadata.",
      href: "/docs/search-api",
    },
    {
      id: "pixabay_1198221",
      title: "Robotic arm sorting packages",
      source: "Pixabay",
      detail:
        "Fast CLIP-style matching over preview frames without transcript requirements.",
      href: "/docs",
    },
  ],
  agent: [
    {
      id: "agent_brief_01",
      title: "Research brief pack with citations",
      source: "Cerul skill",
      detail:
        "Structured output tuned for downstream agent orchestration, including timestamp URLs and evidence snippets.",
      href: "/docs/usage-api",
    },
    {
      id: "agent_brief_02",
      title: "Key claim extraction bundle",
      source: "Shared API",
      detail:
        "Returns source-ready evidence so multi-step agent workflows can cite what the model saw.",
      href: "/docs/search-api",
    },
  ],
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateDemoSearchRequestBody(
  input: unknown,
): DemoSearchRequestValidation {
  if (!isPlainObject(input)) {
    return {
      ok: false,
      error: "Request body must be a JSON object.",
    };
  }

  const { mode, query } = input;

  if (
    mode !== undefined &&
    (typeof mode !== "string" || !Object.hasOwn(demoModes, mode))
  ) {
    return {
      ok: false,
      error: "Invalid demo mode.",
    };
  }

  if (query !== undefined && typeof query !== "string") {
    return {
      ok: false,
      error: "Query must be a string.",
    };
  }

  return {
    ok: true,
    value: {
      mode: (mode as DemoMode | undefined) ?? "knowledge",
      query: query ?? "",
    },
  };
}

export function simulateDemoSearch(input: DemoSearchInput): DemoSearchResponse {
  const normalizedQuery = input.query.trim() || demoModes[input.mode].query;
  const seed = hashString(`${input.mode}:${normalizedQuery}`);
  const latencyMs = 120 + (seed % 95);
  const creditsUsed = input.mode === "knowledge" ? 3 : input.mode === "agent" ? 2 : 1;
  const creditsRemaining = 1000 - ((seed % 120) + creditsUsed);
  const requestId = `req_${seed.toString(36).slice(0, 10)}`;

  const answerByMode: Record<DemoMode, string | undefined> = {
    knowledge:
      "Cerul would return the segment where the roadmap slide appears, then summarize the speaker's timeline claim with a timestamp URL for citation.",
    broll: undefined,
    agent:
      "Cerul would bundle sources, timestamps, and evidence-oriented snippets so the downstream agent can cite the visual material directly.",
  };

  return {
    requestId,
    mode: input.mode,
    query: normalizedQuery,
    latencyMs,
    creditsUsed,
    creditsRemaining,
    answer: answerByMode[input.mode],
    diagnostics: [
      `retrieval mode: ${input.mode}`,
      `normalized query length: ${normalizedQuery.length}`,
      `fresh index window: ${15 + (seed % 11)} min`,
    ],
    results: templateResults[input.mode].map((result, index) => ({
      ...result,
      score: scoreFor(seed, index, input.mode === "broll" ? 0.9 : 0.94),
    })),
  };
}

export function getDashboardSnapshot(): DashboardSnapshot {
  const now = new Date();
  const stamp = timestampLabel(now);

  return {
    overviewCards: [
      {
        label: "Credits used",
        value: "128",
        caption: "Current monthly consumption across all active keys.",
      },
      {
        label: "Remaining",
        value: "872",
        caption: "Available before the current free-tier limit resets.",
      },
      {
        label: "p50 latency",
        value: "182 ms",
        caption: "Median search latency over the last 24 hours.",
      },
      {
        label: "Active keys",
        value: "3",
        caption: "Keys currently enabled for direct API traffic and demo integrations.",
      },
    ],
    searchMix: [
      { label: "B-roll", value: 64 },
      { label: "Knowledge", value: 86 },
      { label: "Answer generation", value: 42 },
      { label: "Preview fetch", value: 57 },
    ],
    liveStatus: {
      health: "Healthy",
      freshness: "3h 14m",
      activeWorkers: 6,
      queueDepth: 18,
      summary:
        "Scheduler backlog is within threshold and both product tracks are indexing normally.",
      updatedAt: stamp,
    },
    apiKeys: [
      {
        name: "Default key",
        prefix: "cer_live_••••f7a1",
        status: "Active",
        scope: "Knowledge + b-roll",
        lastUsed: "Used 9 minutes ago",
      },
      {
        name: "Demo sandbox",
        prefix: "cer_test_••••2ca9",
        status: "Active",
        scope: "B-roll demo only",
        lastUsed: "Used 43 minutes ago",
      },
      {
        name: "Old staging key",
        prefix: "cer_old_••••901d",
        status: "Paused",
        scope: "Disabled",
        lastUsed: "Last used 8 days ago",
      },
    ],
    recentQueries: [
      {
        query: "coastal highway at sunset",
        track: "broll",
        latency: "140 ms",
        status: "OK",
      },
      {
        query: "Sam Altman AGI timeline slide",
        track: "knowledge",
        latency: "198 ms",
        status: "OK",
      },
      {
        query: "screen demo explaining vector search",
        track: "knowledge",
        latency: "225 ms",
        status: "OK",
      },
    ],
    usageLedger: [
      {
        label: "This month",
        requests: "4,128",
        credits: "128 / 1,000",
        note: "Healthy usage curve with room for demo expansion.",
      },
      {
        label: "Last 7 days",
        requests: "1,064",
        credits: "36",
        note: "Most traffic came from knowledge search experiments.",
      },
      {
        label: "Peak day",
        requests: "281",
        credits: "11",
        note: "Peak usage tied to benchmark and prompt iteration runs.",
      },
    ],
    pipelineRuns: [
      {
        id: "job_12912",
        source: "pexels: coastal batch",
        stage: "GenerateClipEmbeddingStep",
        progress: 72,
        status: "running",
        note: "Preview frames already persisted; embedding pass is active.",
      },
      {
        id: "job_12907",
        source: "youtube: keynote sync",
        stage: "AnalyzeFramesWithGPT4oStep",
        progress: 44,
        status: "running",
        note: "Frame interpretation is the longest-running segment in this queue.",
      },
      {
        id: "job_12898",
        source: "pixabay: nightly refresh",
        stage: "Queued",
        progress: 0,
        status: "queued",
        note: "Awaiting worker availability in the b-roll lane.",
      },
      {
        id: "job_12870",
        source: "youtube: partner set",
        stage: "PersistKnowledgeIndexStep",
        progress: 100,
        status: "completed",
        note: "Segment and metadata upsert completed successfully.",
      },
    ],
    settingsPanels: [
      {
        title: "Default search track",
        description: "Sets the product's default experience for unauthenticated demos.",
        value: "broll",
      },
      {
        title: "Usage alert threshold",
        description: "Operator notification threshold before free-tier credits run low.",
        value: "20% remaining",
      },
      {
        title: "Demo mode",
        description: "Controls whether the public frontend shows sandboxed examples.",
        value: "enabled in development",
      },
    ],
  };
}
