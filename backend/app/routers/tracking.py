from __future__ import annotations

import hashlib
import html
import logging
from typing import Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse, RedirectResponse

from app.db import get_db

logger = logging.getLogger(__name__)

router = APIRouter(tags=["tracking"])


async def _fetch_tracking_row(db: Any, short_id: str) -> dict[str, Any] | None:
    row = await db.fetchrow(
        """
        SELECT
            tl.short_id,
            tl.request_id,
            tl.result_rank,
            tl.unit_id::text AS unit_id,
            tl.video_id::text AS video_id,
            tl.target_url,
            ru.unit_type,
            ru.timestamp_start,
            ru.timestamp_end,
            ru.transcript,
            ru.visual_desc,
            ru.keyframe_url,
            v.title,
            v.thumbnail_url,
            v.source,
            v.speaker
        FROM tracking_links AS tl
        JOIN retrieval_units AS ru
            ON ru.id = tl.unit_id
        JOIN videos AS v
            ON v.id = tl.video_id
        WHERE tl.short_id = $1
        """,
        short_id,
    )
    return dict(row) if row is not None else None


async def _record_tracking_event(
    db: Any,
    *,
    short_id: str,
    event_type: str,
    tracking_row: dict[str, Any],
    request: Request,
) -> None:
    client_ip = request.client.host if request.client is not None else None
    ip_hash = (
        hashlib.sha256(client_ip.encode("utf-8")).hexdigest()
        if client_ip
        else None
    )
    try:
        await db.execute(
            """
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
            """,
            short_id,
            event_type,
            tracking_row["request_id"],
            tracking_row["result_rank"],
            tracking_row["unit_id"],
            tracking_row["video_id"],
            request.headers.get("referer"),
            request.headers.get("user-agent"),
            ip_hash,
        )
    except Exception as exc:  # pragma: no cover - best effort for redirect path
        logger.warning("Failed to record tracking event %s for %s: %s", event_type, short_id, exc)


def _build_snippet(tracking_row: dict[str, Any]) -> str:
    unit_type = str(tracking_row.get("unit_type") or "")
    if unit_type == "visual":
        value = tracking_row.get("visual_desc")
    else:
        value = tracking_row.get("transcript") or tracking_row.get("visual_desc")
    text = str(value or "").strip()
    if len(text) <= 240:
        return text
    return text[:237].rstrip() + "..."


def _render_detail_page(tracking_row: dict[str, Any], *, short_id: str) -> str:
    title = html.escape(str(tracking_row.get("title") or "Cerul video"))
    snippet = html.escape(_build_snippet(tracking_row))
    thumbnail_url = html.escape(str(tracking_row.get("thumbnail_url") or ""))
    speaker = html.escape(str(tracking_row.get("speaker") or ""))
    source = html.escape(str(tracking_row.get("source") or ""))
    timestamp_start = tracking_row.get("timestamp_start")
    timestamp_end = tracking_row.get("timestamp_end")
    time_range = ""
    if timestamp_start is not None and timestamp_end is not None:
        time_range = f"{float(timestamp_start):.1f}s - {float(timestamp_end):.1f}s"

    return f"""<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{title} | Cerul</title>
    <style>
      :root {{
        color-scheme: dark;
        --bg: #0a0a0f;
        --panel: rgba(255,255,255,0.04);
        --border: rgba(255,255,255,0.1);
        --text: #fafafa;
        --muted: #a1a1aa;
        --accent: #22d3ee;
      }}
      body {{
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background:
          radial-gradient(circle at top, rgba(34,211,238,0.18), transparent 40%),
          var(--bg);
        color: var(--text);
        font-family: ui-sans-serif, system-ui, sans-serif;
      }}
      .card {{
        width: min(720px, calc(100vw - 32px));
        border: 1px solid var(--border);
        background: var(--panel);
        border-radius: 24px;
        overflow: hidden;
        backdrop-filter: blur(18px);
      }}
      .media {{
        aspect-ratio: 16 / 9;
        background: #111118;
      }}
      .media img {{
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }}
      .content {{
        padding: 24px;
      }}
      .eyebrow {{
        color: var(--accent);
        font-size: 12px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }}
      h1 {{
        margin: 10px 0 12px;
        font-size: clamp(28px, 5vw, 40px);
        line-height: 1.1;
      }}
      p {{
        color: var(--muted);
        line-height: 1.6;
      }}
      .meta {{
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
        color: var(--muted);
        font-size: 14px;
      }}
      .actions {{
        margin-top: 24px;
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
      }}
      .button {{
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 12px 16px;
        border-radius: 999px;
        text-decoration: none;
        color: #001018;
        background: var(--accent);
        font-weight: 700;
      }}
      .ghost {{
        color: var(--text);
        background: transparent;
        border: 1px solid var(--border);
      }}
    </style>
  </head>
  <body>
    <main class="card">
      <div class="media">{f'<img src="{thumbnail_url}" alt="{title}" />' if thumbnail_url else ''}</div>
      <div class="content">
        <div class="eyebrow">Cerul Tracking Link</div>
        <h1>{title}</h1>
        <div class="meta">
          <span>{source}</span>
          {f"<span>{speaker}</span>" if speaker else ""}
          {f"<span>{html.escape(time_range)}</span>" if time_range else ""}
        </div>
        <p>{snippet}</p>
        <div class="actions">
          <a class="button" href="/v/{html.escape(short_id)}/go">Watch on Source</a>
          <a class="button ghost" href="/">Back to Cerul</a>
        </div>
      </div>
    </main>
  </body>
</html>"""


def _render_not_found_page(short_id: str) -> str:
    escaped_short_id = html.escape(short_id)
    return f"""<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Cerul Link Not Found</title>
    <style>
      body {{
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #0a0a0f;
        color: #fafafa;
        font-family: ui-sans-serif, system-ui, sans-serif;
      }}
      .card {{
        width: min(560px, calc(100vw - 32px));
        padding: 28px;
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 24px;
        background: rgba(255,255,255,0.04);
      }}
      a {{
        color: #22d3ee;
      }}
    </style>
  </head>
  <body>
    <main class="card">
      <p>Cerul tracking link not found.</p>
      <h1>{escaped_short_id}</h1>
      <p>The video link may have expired or was never created. <a href="/">Return to Cerul</a>.</p>
    </main>
  </body>
</html>"""


@router.get("/v/{short_id}", response_model=None)
async def tracking_redirect(
    short_id: str,
    request: Request,
    db: Any = Depends(get_db),
) -> RedirectResponse | HTMLResponse:
    tracking_row = await _fetch_tracking_row(db, short_id)
    if tracking_row is None:
        return HTMLResponse(_render_not_found_page(short_id), status_code=404)

    await _record_tracking_event(
        db,
        short_id=short_id,
        event_type="redirect",
        tracking_row=tracking_row,
        request=request,
    )
    return RedirectResponse(tracking_row["target_url"], status_code=302)


@router.get("/v/{short_id}/detail", response_model=None)
async def tracking_detail(
    short_id: str,
    request: Request,
    db: Any = Depends(get_db),
) -> HTMLResponse:
    tracking_row = await _fetch_tracking_row(db, short_id)
    if tracking_row is None:
        return HTMLResponse(_render_not_found_page(short_id), status_code=404)

    await _record_tracking_event(
        db,
        short_id=short_id,
        event_type="page_view",
        tracking_row=tracking_row,
        request=request,
    )
    return HTMLResponse(_render_detail_page(tracking_row, short_id=short_id))


@router.get("/v/{short_id}/go", response_model=None)
async def tracking_go(
    short_id: str,
    request: Request,
    db: Any = Depends(get_db),
) -> RedirectResponse | HTMLResponse:
    tracking_row = await _fetch_tracking_row(db, short_id)
    if tracking_row is None:
        return HTMLResponse(_render_not_found_page(short_id), status_code=404)

    await _record_tracking_event(
        db,
        short_id=short_id,
        event_type="outbound_click",
        tracking_row=tracking_row,
        request=request,
    )
    return RedirectResponse(tracking_row["target_url"], status_code=302)
