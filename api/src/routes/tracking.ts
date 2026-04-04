import { Hono } from "hono";

import type { DatabaseClient } from "../db/client";
import type { AppConfig } from "../types";
import { sha256Hex } from "../utils/crypto";

type TrackingContext = {
  requestId: string | null;
  resultRank: number | null;
};

function buildSnippet(trackingRow: Record<string, unknown>): string {
  const value = trackingRow.transcript ?? trackingRow.visual_desc ?? "";
  const text = String(value).trim();
  return text.length <= 240 ? text : `${text.slice(0, 237).trimEnd()}...`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeOptionalText(value: unknown): string | null {
  const text = typeof value === "string" ? value.trim() : String(value ?? "").trim();
  return text ? text : null;
}

function normalizeOptionalRank(value: unknown): number | null {
  if (value == null) {
    return null;
  }
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function buildTrackingPath(shortId: string, suffix: "" | "/go", context: TrackingContext): string {
  const encodedShortId = encodeURIComponent(shortId);
  if (context.requestId) {
    const encodedReq = encodeURIComponent(context.requestId);
    const rank = context.resultRank ?? 0;
    return `/v/${encodedShortId}/${encodedReq}/${rank}${suffix}`;
  }
  return `/v/${encodedShortId}${suffix}`;
}

function renderDetailPage(trackingRow: Record<string, unknown>, shortId: string, context: TrackingContext): string {
  const title = escapeHtml(String(trackingRow.title ?? "Cerul video"));
  const snippet = escapeHtml(buildSnippet(trackingRow));
  const mediaUrl = escapeHtml(String(trackingRow.thumbnail_url ?? trackingRow.keyframe_url ?? ""));
  const speaker = escapeHtml(String(trackingRow.speaker ?? ""));
  const source = escapeHtml(String(trackingRow.source ?? ""));
  const timestampStart = trackingRow.timestamp_start;
  const timestampEnd = trackingRow.timestamp_end;
  const timeRange =
    timestampStart != null && timestampEnd != null
      ? `${Number(timestampStart).toFixed(1)}s - ${Number(timestampEnd).toFixed(1)}s`
      : "";
  const goHref = escapeHtml(buildTrackingPath(shortId, "/go", context));

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title} | Cerul</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #0a0a0f;
        --panel: rgba(255,255,255,0.04);
        --border: rgba(255,255,255,0.1);
        --text: #fafafa;
        --muted: #a1a1aa;
        --accent: #22d3ee;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background:
          radial-gradient(circle at top, rgba(34,211,238,0.18), transparent 40%),
          var(--bg);
        color: var(--text);
        font-family: ui-sans-serif, system-ui, sans-serif;
      }
      .card {
        width: min(720px, calc(100vw - 32px));
        border: 1px solid var(--border);
        background: var(--panel);
        border-radius: 24px;
        overflow: hidden;
        backdrop-filter: blur(18px);
      }
      .media {
        aspect-ratio: 16 / 9;
        background: #111118;
      }
      .media img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }
      .content {
        padding: 24px;
      }
      .eyebrow {
        color: var(--accent);
        font-size: 12px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }
      h1 {
        margin: 10px 0 12px;
        font-size: clamp(28px, 5vw, 40px);
        line-height: 1.1;
      }
      p {
        color: var(--muted);
        line-height: 1.6;
      }
      .meta {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
        color: var(--muted);
        font-size: 14px;
      }
      .actions {
        margin-top: 24px;
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
      }
      .button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 12px 16px;
        border-radius: 999px;
        text-decoration: none;
        color: #001018;
        background: var(--accent);
        font-weight: 700;
      }
      .ghost {
        color: var(--text);
        background: transparent;
        border: 1px solid var(--border);
      }
    </style>
  </head>
  <body>
    <main class="card">
      <div class="media">${mediaUrl ? `<img src="${mediaUrl}" alt="${title}" />` : ""}</div>
      <div class="content">
        <div class="eyebrow">Cerul Tracking Link</div>
        <h1>${title}</h1>
        <div class="meta">
          <span>${source}</span>
          ${speaker ? `<span>${speaker}</span>` : ""}
          ${timeRange ? `<span>${escapeHtml(timeRange)}</span>` : ""}
        </div>
        <p>${snippet}</p>
        <div class="actions">
          <a class="button" href="${goHref}">Watch on Source</a>
          <a class="button ghost" href="/">Back to Cerul</a>
        </div>
      </div>
    </main>
  </body>
</html>`;
}

function renderNotFoundPage(shortId: string): string {
  const escapedShortId = escapeHtml(shortId);
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Cerul Link Not Found</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #0a0a0f;
        color: #fafafa;
        font-family: ui-sans-serif, system-ui, sans-serif;
      }
      .card {
        width: min(560px, calc(100vw - 32px));
        padding: 28px;
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 24px;
        background: rgba(255,255,255,0.04);
      }
      a {
        color: #22d3ee;
      }
    </style>
  </head>
  <body>
    <main class="card">
      <p>Cerul tracking link not found.</p>
      <h1>${escapedShortId}</h1>
      <p>The video link may have expired or was never created. <a href="/">Return to Cerul</a>.</p>
    </main>
  </body>
</html>`;
}

function buildTargetUrl(trackingRow: Record<string, unknown>, webBaseUrl: string): string {
  const storedTargetUrl = normalizeOptionalText(trackingRow.target_url);
  if (storedTargetUrl) {
    return storedTargetUrl;
  }

  const sourceUrl = normalizeOptionalText(trackingRow.source_url ?? trackingRow.video_url);
  if (!sourceUrl) {
    return webBaseUrl.replace(/\/+$/, "");
  }

  const timestampStart = trackingRow.timestamp_start == null ? null : Number(trackingRow.timestamp_start);
  if (timestampStart == null || !Number.isFinite(timestampStart)) {
    return sourceUrl;
  }

  if (String(trackingRow.source ?? "").trim().toLowerCase() === "youtube") {
    try {
      const url = new URL(sourceUrl);
      url.searchParams.set("t", String(Math.max(Math.trunc(timestampStart), 0)));
      return url.toString();
    } catch {
      return sourceUrl;
    }
  }

  return sourceUrl;
}

function resolveTrackingContext(c: any, trackingRow: Record<string, unknown>): TrackingContext {
  return {
    requestId:
      normalizeOptionalText(c.req.param("requestId")) ??
      normalizeOptionalText(c.req.query("req")) ??
      normalizeOptionalText(trackingRow.request_id),
    resultRank:
      normalizeOptionalRank(c.req.param("rank")) ??
      normalizeOptionalRank(c.req.query("rank")) ??
      normalizeOptionalRank(trackingRow.result_rank)
  };
}

async function fetchPermanentTrackingRow(db: DatabaseClient, shortId: string): Promise<Record<string, unknown> | null> {
  const shortIdSql =
    "COALESCE(" +
    "ru.short_id, " +
    "SUBSTRING(ENCODE(DIGEST(CONCAT_WS(':', ru.video_id::text, ru.unit_type, ru.unit_index::text), 'sha256'), 'hex') FROM 1 FOR 12)" +
    ")";

  return db.fetchrow(
    `
      SELECT
          ${shortIdSql} AS short_id,
          NULL::text AS request_id,
          NULL::smallint AS result_rank,
          ru.id::text AS unit_id,
          ru.video_id::text AS video_id,
          NULL::text AS target_url,
          ru.unit_type,
          ru.timestamp_start,
          ru.timestamp_end,
          ru.transcript,
          ru.visual_desc,
          ru.keyframe_url,
          v.title,
          v.thumbnail_url,
          v.source,
          v.speaker,
          v.source_url,
          v.video_url
      FROM retrieval_units AS ru
      JOIN videos AS v
          ON v.id = ru.video_id
      WHERE ${shortIdSql} = $1
      LIMIT 1
    `,
    shortId
  );
}

async function fetchLegacyTrackingRow(db: DatabaseClient, shortId: string): Promise<Record<string, unknown> | null> {
  return db.fetchrow(
    `
      SELECT
          tl.short_id,
          tl.request_id,
          tl.result_rank,
          tl.unit_id::text AS unit_id,
          tl.video_id::text AS video_id,
          tl.target_url,
          COALESCE(ru.unit_type, tl.unit_type) AS unit_type,
          COALESCE(ru.timestamp_start, tl.timestamp_start) AS timestamp_start,
          COALESCE(ru.timestamp_end, tl.timestamp_end) AS timestamp_end,
          COALESCE(ru.transcript, tl.transcript) AS transcript,
          COALESCE(ru.visual_desc, tl.visual_desc) AS visual_desc,
          COALESCE(ru.keyframe_url, tl.keyframe_url) AS keyframe_url,
          COALESCE(v.title, tl.title) AS title,
          COALESCE(v.thumbnail_url, tl.thumbnail_url) AS thumbnail_url,
          COALESCE(v.source, tl.source) AS source,
          COALESCE(v.speaker, tl.speaker) AS speaker,
          v.source_url,
          v.video_url
      FROM tracking_links AS tl
      LEFT JOIN retrieval_units AS ru
          ON ru.id = tl.unit_id
      LEFT JOIN videos AS v
          ON v.id = tl.video_id
      WHERE tl.short_id = $1
      LIMIT 1
    `,
    shortId
  );
}

async function fetchTrackingRow(db: DatabaseClient, shortId: string): Promise<Record<string, unknown> | null> {
  const permanentRow = await fetchPermanentTrackingRow(db, shortId);
  if (permanentRow) {
    return permanentRow;
  }
  return fetchLegacyTrackingRow(db, shortId);
}

async function recordTrackingEvent(
  db: DatabaseClient,
  shortId: string,
  eventType: string,
  trackingRow: Record<string, unknown>,
  trackingContext: TrackingContext,
  request: Request
): Promise<void> {
  const rawIp = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const ipHash = rawIp ? await sha256Hex(rawIp) : null;
  try {
    await db.execute(
      `
        INSERT INTO tracking_events (
            short_id,
            event_type,
            request_id,
            result_rank,
            unit_id,
            video_id,
            referrer,
            user_agent,
            ip_hash
        )
        VALUES ($1, $2, $3, $4, $5::uuid, $6::uuid, $7, $8, $9)
      `,
      shortId,
      eventType,
      trackingContext.requestId,
      trackingContext.resultRank,
      normalizeOptionalText(trackingRow.unit_id),
      normalizeOptionalText(trackingRow.video_id),
      request.headers.get("referer"),
      request.headers.get("user-agent"),
      ipHash
    );
  } catch {
    // Best-effort logging on the redirect path.
  }
}

export function createTrackingRouter(): any {
  const router = new Hono();

  // Path-based tracking URLs: /v/{shortId}/{requestId}/{rank}
  // LLMs strip query params but preserve path segments.
  router.get("/v/:shortId/:requestId/:rank", async (c: any) => {
    const db = c.get("db") as DatabaseClient;
    const config = c.get("config") as AppConfig;
    const shortId = c.req.param("shortId");
    const trackingRow = await fetchTrackingRow(db, shortId);
    if (!trackingRow) {
      return c.html(renderNotFoundPage(shortId), 404);
    }
    const trackingContext = resolveTrackingContext(c, trackingRow);
    await recordTrackingEvent(db, shortId, "redirect", trackingRow, trackingContext, c.req.raw);
    return c.redirect(buildTargetUrl(trackingRow, config.public.webBaseUrl), 302);
  });

  router.get("/v/:shortId/:requestId/:rank/detail", async (c: any) => {
    const db = c.get("db") as DatabaseClient;
    const shortId = c.req.param("shortId");
    const trackingRow = await fetchTrackingRow(db, shortId);
    if (!trackingRow) {
      return c.html(renderNotFoundPage(shortId), 404);
    }
    const trackingContext = resolveTrackingContext(c, trackingRow);
    await recordTrackingEvent(db, shortId, "page_view", trackingRow, trackingContext, c.req.raw);
    return c.html(renderDetailPage(trackingRow, shortId, trackingContext), 200);
  });

  router.get("/v/:shortId/:requestId/:rank/go", async (c: any) => {
    const db = c.get("db") as DatabaseClient;
    const config = c.get("config") as AppConfig;
    const shortId = c.req.param("shortId");
    const trackingRow = await fetchTrackingRow(db, shortId);
    if (!trackingRow) {
      return c.html(renderNotFoundPage(shortId), 404);
    }
    const trackingContext = resolveTrackingContext(c, trackingRow);
    await recordTrackingEvent(db, shortId, "outbound_click", trackingRow, trackingContext, c.req.raw);
    return c.redirect(buildTargetUrl(trackingRow, config.public.webBaseUrl), 302);
  });

  // Legacy query-param routes: /v/{shortId}?req=...&rank=...
  router.get("/v/:shortId", async (c: any) => {
    const db = c.get("db") as DatabaseClient;
    const config = c.get("config") as AppConfig;
    const shortId = c.req.param("shortId");
    const trackingRow = await fetchTrackingRow(db, shortId);
    if (!trackingRow) {
      return c.html(renderNotFoundPage(shortId), 404);
    }
    const trackingContext = resolveTrackingContext(c, trackingRow);
    await recordTrackingEvent(db, shortId, "redirect", trackingRow, trackingContext, c.req.raw);
    return c.redirect(buildTargetUrl(trackingRow, config.public.webBaseUrl), 302);
  });

  router.get("/v/:shortId/detail", async (c: any) => {
    const db = c.get("db") as DatabaseClient;
    const shortId = c.req.param("shortId");
    const trackingRow = await fetchTrackingRow(db, shortId);
    if (!trackingRow) {
      return c.html(renderNotFoundPage(shortId), 404);
    }
    const trackingContext = resolveTrackingContext(c, trackingRow);
    await recordTrackingEvent(db, shortId, "page_view", trackingRow, trackingContext, c.req.raw);
    return c.html(renderDetailPage(trackingRow, shortId, trackingContext), 200);
  });

  router.get("/v/:shortId/go", async (c: any) => {
    const db = c.get("db") as DatabaseClient;
    const config = c.get("config") as AppConfig;
    const shortId = c.req.param("shortId");
    const trackingRow = await fetchTrackingRow(db, shortId);
    if (!trackingRow) {
      return c.html(renderNotFoundPage(shortId), 404);
    }
    const trackingContext = resolveTrackingContext(c, trackingRow);
    await recordTrackingEvent(db, shortId, "outbound_click", trackingRow, trackingContext, c.req.raw);
    return c.redirect(buildTargetUrl(trackingRow, config.public.webBaseUrl), 302);
  });

  return router;
}
