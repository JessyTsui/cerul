import { Hono } from "hono";

import type { DatabaseClient } from "../db/client";
import { sha256Hex } from "../utils/crypto";

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

function renderDetailPage(trackingRow: Record<string, unknown>, shortId: string): string {
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
          <a class="button" href="/v/${escapeHtml(shortId)}/go">Watch on Source</a>
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

async function fetchTrackingRow(db: DatabaseClient, shortId: string): Promise<Record<string, unknown> | null> {
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
          COALESCE(v.speaker, tl.speaker) AS speaker
      FROM tracking_links AS tl
      LEFT JOIN retrieval_units AS ru
          ON ru.id = tl.unit_id
      LEFT JOIN videos AS v
          ON v.id = tl.video_id
      WHERE tl.short_id = $1
    `,
    shortId
  );
}

async function recordTrackingEvent(
  db: DatabaseClient,
  shortId: string,
  eventType: string,
  trackingRow: Record<string, unknown>,
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
      String(trackingRow.request_id ?? ""),
      Number(trackingRow.result_rank ?? 0),
      String(trackingRow.unit_id ?? ""),
      String(trackingRow.video_id ?? ""),
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

  router.get("/v/:shortId", async (c: any) => {
    const db = c.get("db") as DatabaseClient;
    const shortId = c.req.param("shortId");
    const trackingRow = await fetchTrackingRow(db, shortId);
    if (!trackingRow) {
      return c.html(renderNotFoundPage(shortId), 404);
    }
    await recordTrackingEvent(db, shortId, "redirect", trackingRow, c.req.raw);
    return c.redirect(String(trackingRow.target_url), 302);
  });

  router.get("/v/:shortId/detail", async (c: any) => {
    const db = c.get("db") as DatabaseClient;
    const shortId = c.req.param("shortId");
    const trackingRow = await fetchTrackingRow(db, shortId);
    if (!trackingRow) {
      return c.html(renderNotFoundPage(shortId), 404);
    }
    await recordTrackingEvent(db, shortId, "page_view", trackingRow, c.req.raw);
    return c.html(renderDetailPage(trackingRow, shortId), 200);
  });

  router.get("/v/:shortId/go", async (c: any) => {
    const db = c.get("db") as DatabaseClient;
    const shortId = c.req.param("shortId");
    const trackingRow = await fetchTrackingRow(db, shortId);
    if (!trackingRow) {
      return c.html(renderNotFoundPage(shortId), 404);
    }
    await recordTrackingEvent(db, shortId, "outbound_click", trackingRow, c.req.raw);
    return c.redirect(String(trackingRow.target_url), 302);
  });

  return router;
}
