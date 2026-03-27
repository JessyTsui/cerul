import type { DatabaseClient } from "../db/client";
import type { AuthContext, Bindings, DeleteIndexResponse, IndexListResponse, IndexStatusResponse, SubmitIndexResponse } from "../types";
import { apiError } from "../utils/http";
import { randomHex, sha256Hex } from "../utils/crypto";

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"]);
const DIRECT_VIDEO_EXTENSIONS = [".mp4", ".webm", ".mov", ".m4v"];
const INDEX_LIMITS_BY_TIER: Record<string, number> = {
  free: 50,
  builder: 500,
  pro: 5000,
  enterprise: 50000
};
const MAX_INDEX_DURATION_SECONDS = 4 * 60 * 60;

function normalizeVideoId(videoId: string): string {
  const normalized = String(videoId);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) {
    apiError(404, "Indexed video not found.");
  }
  return normalized;
}

function isPrivateIpv4(ip: string): boolean {
  const octets = ip.split(".").map((part) => Number.parseInt(part, 10));
  if (octets.length !== 4 || octets.some((value) => !Number.isFinite(value))) {
    return false;
  }
  if (octets[0] === 10 || octets[0] === 127 || octets[0] === 0) {
    return true;
  }
  if (octets[0] === 169 && octets[1] === 254) {
    return true;
  }
  if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) {
    return true;
  }
  if (octets[0] === 192 && octets[1] === 168) {
    return true;
  }
  return false;
}

function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  return normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:");
}

function coerceDurationSeconds(value: unknown): number | null {
  if (value == null || typeof value === "boolean") {
    return null;
  }
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseIso8601Duration(value: string | null | undefined): number | null {
  const source = (value ?? "").trim();
  if (!source) {
    return null;
  }
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(source);
  if (!match) {
    return null;
  }
  const [, days, hours, minutes, seconds] = match;
  return (
    Number.parseInt(days ?? "0", 10) * 86400 +
    Number.parseInt(hours ?? "0", 10) * 3600 +
    Number.parseInt(minutes ?? "0", 10) * 60 +
    Number.parseInt(seconds ?? "0", 10)
  );
}

async function resolvePublicHost(hostname: string): Promise<void> {
  try {
    const ipResponse = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=A`, {
      headers: {
        accept: "application/dns-json"
      }
    });
    if (ipResponse.ok) {
      const payload = await ipResponse.json() as { Answer?: Array<{ data?: string }> };
      const addresses = Array.isArray(payload.Answer) ? payload.Answer.map((answer) => String(answer.data ?? "")).filter(Boolean) : [];
      if (addresses.length === 0) {
        apiError(422, "Direct video host could not be resolved.");
      }
      for (const address of addresses) {
        if (isPrivateIpv4(address) || isPrivateIpv6(address)) {
          apiError(422, "Direct video URLs must resolve to public internet addresses.");
        }
      }
      return;
    }
  } catch {
    // Fall through to generic resolution error below.
  }

  apiError(422, "Direct video host could not be resolved.");
}

async function fetchYoutubeVideoDuration(env: Bindings, videoId: string): Promise<number | null> {
  const apiKey = (env.YOUTUBE_API_KEY ?? "").trim();
  if (!apiKey) {
    return null;
  }
  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.searchParams.set("id", videoId);
  url.searchParams.set("part", "contentDetails");
  url.searchParams.set("key", apiKey);
  const response = await fetch(url);
  if (!response.ok) {
    return null;
  }
  const payload = await response.json() as any;
  return parseIso8601Duration(payload?.items?.[0]?.contentDetails?.duration);
}

async function fetchPexelsDuration(env: Bindings, videoId: string): Promise<number | null> {
  const apiKey = (env.PEXELS_API_KEY ?? "").trim();
  if (!apiKey) {
    return null;
  }
  const response = await fetch(`https://api.pexels.com/videos/videos/${videoId}`, {
    headers: { authorization: apiKey }
  });
  if (!response.ok) {
    return null;
  }
  const payload = await response.json() as any;
  return coerceDurationSeconds(payload?.duration);
}

async function fetchPixabayDuration(env: Bindings, videoId: string): Promise<number | null> {
  const apiKey = (env.PIXABAY_API_KEY ?? "").trim();
  if (!apiKey) {
    return null;
  }
  const url = new URL("https://pixabay.com/api/videos/");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("id", videoId);
  const response = await fetch(url);
  if (!response.ok) {
    return null;
  }
  const payload = await response.json() as any;
  return coerceDurationSeconds(payload?.hits?.[0]?.duration);
}

export class UnifiedIndexService {
  constructor(
    private readonly db: DatabaseClient,
    private readonly env: Bindings
  ) {}

  generateRequestId(): string {
    return `req_${randomHex(24)}`;
  }

  async resolveSource(url: string): Promise<{ source: string; source_video_id: string }> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      apiError(422, "Unsupported URL format");
    }

    const hostname = parsed.hostname.trim().toLowerCase();
    const path = parsed.pathname.trim();
    const youtubeId = this.extractYoutubeVideoId(parsed);
    if (youtubeId) {
      return { source: "youtube", source_video_id: youtubeId };
    }

    const pexelsMatch = /\/video\/[^/]*-([0-9]+)\/?$/i.exec(path);
    if (this.hostMatchesDomain(hostname, "pexels.com") && pexelsMatch) {
      return { source: "pexels", source_video_id: pexelsMatch[1] };
    }

    const pixabayMatch = /\/videos\/(?:[^/]*-)?([0-9]+)\/?$/i.exec(path);
    if (this.hostMatchesDomain(hostname, "pixabay.com") && pixabayMatch) {
      return { source: "pixabay", source_video_id: pixabayMatch[1] };
    }

    if (DIRECT_VIDEO_EXTENSIONS.some((extension) => path.toLowerCase().endsWith(extension))) {
      this.validateDirectVideoUrlStructure(parsed);
      const urlHash = await sha256Hex(url);
      return {
        source: "upload",
        source_video_id: urlHash.slice(0, 24)
      };
    }

    apiError(422, "Unsupported URL format");
  }

  async submit(url: string, force: boolean, auth: AuthContext): Promise<SubmitIndexResponse> {
    await this.enforceSubmitRateLimit(auth.userId);
    const resolved = await this.resolveSource(url);
    if (resolved.source === "upload") {
      await this.validateDirectVideoUrl(url);
    }
    await this.enforceMaxDuration(url, resolved.source, resolved.source_video_id);
    const requestId = this.generateRequestId();

    return this.db.transaction(async (tx) => {
      await tx.fetchval(
        `
          SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))
        `,
        resolved.source,
        resolved.source_video_id
      );

      const existingVideo = await tx.fetchrow<{ id: string }>(
        `
          SELECT id::text AS id
          FROM videos
          WHERE source = $1
            AND source_video_id = $2
        `,
        resolved.source,
        resolved.source_video_id
      );

      let createdPlaceholder = false;
      let videoId = existingVideo?.id ?? crypto.randomUUID();
      if (!existingVideo) {
        const placeholder = await tx.fetchrow<{ id: string }>(
          `
            INSERT INTO videos (
                id,
                source,
                source_video_id,
                source_url,
                video_url,
                title,
                description,
                metadata
            )
            VALUES ($1::uuid, $2, $3, $4, $5, $6, '', '{}'::jsonb)
            ON CONFLICT (source, source_video_id) DO NOTHING
            RETURNING id::text AS id
          `,
          videoId,
          resolved.source,
          resolved.source_video_id,
          url,
          url,
          this.buildPlaceholderTitle(url, resolved.source, resolved.source_video_id)
        );
        if (placeholder) {
          createdPlaceholder = true;
          videoId = placeholder.id;
        } else {
          const canonical = await tx.fetchrow<{ id: string }>(
            `
              SELECT id::text AS id
              FROM videos
              WHERE source = $1
                AND source_video_id = $2
            `,
            resolved.source,
            resolved.source_video_id
          );
          if (!canonical) {
            throw new Error("Failed to resolve canonical indexed video after placeholder conflict.");
          }
          videoId = canonical.id;
        }
      }

      const hasAccess = await tx.fetchval<boolean>(
        `
          SELECT TRUE
          FROM video_access
          WHERE video_id = $1::uuid
            AND owner_id = $2
          LIMIT 1
        `,
        videoId,
        auth.userId
      );

      if (!hasAccess) {
        try {
          await this.enforceVideoLimit(auth.userId, auth.tier, tx);
        } catch (error) {
          if (createdPlaceholder) {
            await tx.execute(
              `
                DELETE FROM videos
                WHERE id = $1::uuid
                  AND NOT EXISTS (
                      SELECT 1
                      FROM video_access
                      WHERE video_id = $1::uuid
                  )
              `,
              videoId
            );
          }
          throw error;
        }

        await tx.execute(
          `
            INSERT INTO video_access (video_id, owner_id)
            VALUES ($1::uuid, $2)
            ON CONFLICT (video_id, owner_scope) DO NOTHING
          `,
          videoId,
          auth.userId
        );
      }

      const existingJob = await tx.fetchrow<{ status: string; request_id: string }>(
        `
          SELECT
              status,
              input_payload->>'request_id' AS request_id
          FROM processing_jobs
          WHERE track = 'unified'
            AND input_payload->>'video_id' = $1
            AND status IN ('pending', 'running', 'retrying')
          ORDER BY created_at DESC
          LIMIT 1
        `,
        videoId
      );
      if (existingJob) {
        return {
          video_id: videoId,
          status: String(existingJob.status),
          request_id: String(existingJob.request_id)
        };
      }

      const completedUnits = await tx.fetchval<number>(
        `
          SELECT COUNT(*)
          FROM retrieval_units
          WHERE video_id = $1::uuid
        `,
        videoId
      );
      if (Number(completedUnits ?? 0) > 0 && !force) {
        return {
          video_id: videoId,
          status: "completed",
          request_id: requestId
        };
      }

      await tx.execute(
        `
          INSERT INTO processing_jobs (
              track,
              source_id,
              job_type,
              status,
              input_payload
          )
          VALUES (
              'unified',
              NULL,
              'index_video',
              'pending',
              $1::jsonb
          )
        `,
        JSON.stringify({
          request_id: requestId,
          video_id: videoId,
          owner_id: auth.userId,
          url,
          source: resolved.source,
          source_video_id: resolved.source_video_id,
          force
        })
      );

      return {
        video_id: videoId,
        status: "processing",
        request_id: requestId
      };
    });
  }

  async getStatus(videoId: string, auth: AuthContext): Promise<IndexStatusResponse> {
    const normalizedVideoId = normalizeVideoId(videoId);
    const row = await this.db.fetchrow<Record<string, unknown>>(
      `
        SELECT
            v.id::text AS video_id,
            v.title,
            v.duration_seconds,
            COALESCE(ru_counts.units_created, 0) AS units_created,
            pj.status AS job_status,
            pj.error_message,
            pj.created_at AS job_created_at,
            pj.completed_at AS job_completed_at,
            pj.updated_at AS job_updated_at,
            pj.input_payload->>'request_id' AS request_id,
            latest_success.created_at AS latest_success_created_at,
            latest_success.completed_at AS latest_success_completed_at,
            step_counts.steps_completed,
            step_counts.steps_total,
            active_step.current_step
        FROM videos AS v
        JOIN video_access AS va
            ON va.video_id = v.id
        LEFT JOIN LATERAL (
            SELECT COUNT(*)::int AS units_created
            FROM retrieval_units
            WHERE video_id = v.id
        ) AS ru_counts ON TRUE
        LEFT JOIN LATERAL (
            SELECT *
            FROM processing_jobs
            WHERE track = 'unified'
              AND input_payload->>'video_id' = v.id::text
            ORDER BY created_at DESC
            LIMIT 1
        ) AS pj ON TRUE
        LEFT JOIN LATERAL (
            SELECT created_at, completed_at
            FROM processing_jobs
            WHERE track = 'unified'
              AND input_payload->>'video_id' = v.id::text
              AND status = 'completed'
            ORDER BY completed_at DESC NULLS LAST, created_at DESC
            LIMIT 1
        ) AS latest_success ON TRUE
        LEFT JOIN LATERAL (
            SELECT
                COUNT(*) FILTER (WHERE status = 'completed')::int AS steps_completed,
                COUNT(*)::int AS steps_total
            FROM processing_job_steps
            WHERE job_id = pj.id
        ) AS step_counts ON TRUE
        LEFT JOIN LATERAL (
            SELECT step_name AS current_step
            FROM processing_job_steps
            WHERE job_id = pj.id
              AND status IN ('pending', 'running', 'failed')
            ORDER BY updated_at DESC
            LIMIT 1
        ) AS active_step ON TRUE
        WHERE v.id = $1::uuid
          AND va.owner_id = $2
        LIMIT 1
      `,
      normalizedVideoId,
      auth.userId
    );
    if (!row) {
      apiError(404, "Indexed video not found.");
    }

    const unitsCreated = Number(row.units_created ?? 0);
    const jobStatus = String(row.job_status ?? "").trim();
    const statusValue =
      ["pending", "running", "retrying"].includes(jobStatus)
        ? "processing"
        : unitsCreated > 0
          ? "completed"
          : jobStatus === "failed"
            ? "failed"
            : "processing";

    const completedWithPreviousUnits = statusValue === "completed" && jobStatus === "failed" && unitsCreated > 0;
    const createdAt = completedWithPreviousUnits
      ? String(row.latest_success_created_at ?? row.job_created_at ?? row.job_updated_at)
      : String(row.job_created_at ?? row.job_updated_at);
    const completedAt = completedWithPreviousUnits
      ? String(row.latest_success_completed_at ?? row.job_completed_at ?? row.job_updated_at)
      : row.job_completed_at == null ? null : String(row.job_completed_at);

    return {
      video_id: String(row.video_id),
      status: statusValue,
      title: row.title == null ? null : String(row.title),
      current_step: completedWithPreviousUnits ? null : (row.current_step == null ? null : String(row.current_step)),
      steps_completed: completedWithPreviousUnits ? null : Number(row.steps_completed ?? 0),
      steps_total: completedWithPreviousUnits ? null : Number(row.steps_total ?? 0),
      duration: row.duration_seconds == null ? null : Number(row.duration_seconds),
      units_created: unitsCreated,
      error: statusValue === "failed" ? String(row.error_message ?? "") : null,
      created_at: createdAt,
      completed_at: completedAt,
      failed_at: statusValue === "failed" ? String(row.job_updated_at ?? "") : null
    };
  }

  async listVideos(auth: AuthContext, page: number, perPage: number): Promise<IndexListResponse> {
    const offset = Math.max(page - 1, 0) * perPage;
    const rows = await this.db.fetch<Record<string, unknown>>(
      `
        SELECT
            v.id::text AS video_id,
            v.title,
            va.created_at,
            COALESCE(ru_counts.units_created, 0) AS units_created,
            pj.status AS job_status,
            pj.completed_at,
            latest_success.completed_at AS latest_success_completed_at
        FROM videos AS v
        JOIN video_access AS va
            ON va.video_id = v.id
        LEFT JOIN LATERAL (
            SELECT COUNT(*)::int AS units_created
            FROM retrieval_units
            WHERE video_id = v.id
        ) AS ru_counts ON TRUE
        LEFT JOIN LATERAL (
            SELECT status, completed_at
            FROM processing_jobs
            WHERE track = 'unified'
              AND input_payload->>'video_id' = v.id::text
            ORDER BY created_at DESC
            LIMIT 1
        ) AS pj ON TRUE
        LEFT JOIN LATERAL (
            SELECT completed_at
            FROM processing_jobs
            WHERE track = 'unified'
              AND input_payload->>'video_id' = v.id::text
              AND status = 'completed'
            ORDER BY completed_at DESC NULLS LAST, created_at DESC
            LIMIT 1
        ) AS latest_success ON TRUE
        WHERE va.owner_id = $1
        ORDER BY va.created_at DESC
        LIMIT $2 OFFSET $3
      `,
      auth.userId,
      perPage,
      offset
    );

    const total = Number(
      (await this.db.fetchval(
        `
          SELECT COUNT(*)
          FROM video_access
          WHERE owner_id = $1
        `,
        auth.userId
      )) ?? 0
    );

    return {
      videos: rows.map((row) => ({
        video_id: String(row.video_id),
        title: String(row.title ?? ""),
        status: ["pending", "running", "retrying"].includes(String(row.job_status ?? ""))
          ? "processing"
          : Number(row.units_created ?? 0) > 0
            ? "completed"
            : String(row.job_status ?? "processing"),
        units_created: Number(row.units_created ?? 0),
        created_at: String(row.created_at ?? ""),
        completed_at:
          String(row.job_status ?? "") === "failed" && Number(row.units_created ?? 0) > 0
            ? String(row.latest_success_completed_at ?? "")
            : row.completed_at == null ? null : String(row.completed_at)
      })),
      total,
      page,
      per_page: perPage
    };
  }

  async delete(videoId: string, auth: AuthContext): Promise<DeleteIndexResponse> {
    const normalizedVideoId = normalizeVideoId(videoId);
    const deleted = await this.db.fetchval<boolean>(
      `
        DELETE FROM video_access
        WHERE video_id = $1::uuid
          AND owner_id = $2
        RETURNING TRUE
      `,
      normalizedVideoId,
      auth.userId
    );
    if (!deleted) {
      apiError(404, "Indexed video not found.");
    }

    const remainingAccess = Number(
      (await this.db.fetchval(
        `
          SELECT COUNT(*)
          FROM video_access
          WHERE video_id = $1::uuid
        `,
        normalizedVideoId
      )) ?? 0
    );

    if (remainingAccess === 0) {
      await this.cancelVideoJobs(normalizedVideoId);
      await this.db.execute("DELETE FROM videos WHERE id = $1::uuid", normalizedVideoId);
    }

    return { deleted: true };
  }

  private async cancelVideoJobs(videoId: string): Promise<void> {
    await this.db.execute(
      `
        UPDATE processing_jobs
        SET
            status = CASE
                WHEN status IN ('pending', 'running', 'retrying') THEN 'failed'
                ELSE status
            END,
            error_message = CASE
                WHEN status IN ('pending', 'running', 'retrying')
                    THEN 'Cancelled by user.'
                ELSE error_message
            END,
            completed_at = CASE
                WHEN status IN ('pending', 'running', 'retrying') THEN NOW()
                ELSE completed_at
            END,
            next_retry_at = NULL,
            locked_by = NULL,
            locked_at = NULL,
            input_payload = jsonb_set(
                COALESCE(input_payload, '{}'::jsonb),
                '{cancelled_by_user}',
                'true'::jsonb,
                true
            ),
            updated_at = NOW()
        WHERE input_payload->>'video_id' = $1::text
      `,
      videoId
    );

    await this.db.execute(
      `
        UPDATE processing_job_steps
        SET
            status = 'skipped',
            error_message = 'Cancelled by user.',
            completed_at = COALESCE(completed_at, NOW()),
            updated_at = NOW()
        WHERE status IN ('pending', 'running')
          AND job_id IN (
              SELECT id
              FROM processing_jobs
              WHERE input_payload->>'video_id' = $1::text
          )
      `,
      videoId
    );
  }

  private async enforceSubmitRateLimit(userId: string): Promise<void> {
    const recentCount = Number(
      (await this.db.fetchval(
        `
          SELECT COUNT(*)
          FROM processing_jobs
          WHERE track = 'unified'
            AND input_payload->>'owner_id' = $1
            AND created_at > NOW() - INTERVAL '1 minute'
        `,
        userId
      )) ?? 0
    );
    if (recentCount >= 10) {
      apiError(429, "Index rate limit exceeded.");
    }
  }

  private async enforceVideoLimit(userId: string, tier: string, db: DatabaseClient): Promise<void> {
    const limit = INDEX_LIMITS_BY_TIER[tier] ?? INDEX_LIMITS_BY_TIER.free;
    const count = Number(
      (await db.fetchval(
        `
          SELECT COUNT(*)
          FROM video_access
          WHERE owner_id = $1
        `,
        userId
      )) ?? 0
    );
    if (count >= limit) {
      apiError(403, "Indexed video limit reached for this account.");
    }
  }

  private async validateDirectVideoUrl(url: string): Promise<void> {
    const parsed = new URL(url);
    const hostname = this.validateDirectVideoUrlStructure(parsed);
    try {
      if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
        if (isPrivateIpv4(hostname)) {
          apiError(422, "Direct video URLs must resolve to public internet addresses.");
        }
        return;
      }
      if (hostname.startsWith("[") || hostname.includes(":")) {
        const bare = hostname.replace(/^\[|\]$/g, "");
        if (isPrivateIpv6(bare)) {
          apiError(422, "Direct video URLs must resolve to public internet addresses.");
        }
        return;
      }
      await resolvePublicHost(hostname);
    } catch (error) {
      if (error instanceof Error && "status" in error) {
        throw error;
      }
      apiError(422, "Direct video host could not be resolved.");
    }
  }

  private validateDirectVideoUrlStructure(parsed: URL): string {
    const scheme = parsed.protocol.replace(":", "").trim().toLowerCase();
    const hostname = parsed.hostname.trim().toLowerCase();
    if (!["http", "https"].includes(scheme)) {
      apiError(422, "Direct video URLs must use http or https.");
    }
    if (!hostname) {
      apiError(422, "Direct video URLs must include a valid host.");
    }
    if (parsed.username || parsed.password) {
      apiError(422, "Direct video URLs must not include embedded credentials.");
    }
    if (hostname === "localhost" || hostname.endsWith(".local")) {
      apiError(422, "Direct video URLs must be publicly reachable.");
    }
    return hostname;
  }

  private async enforceMaxDuration(url: string, source: string, sourceVideoId: string): Promise<void> {
    const durationSeconds = await this.fetchSourceDurationSeconds(url, source, sourceVideoId);
    if (durationSeconds != null && durationSeconds > MAX_INDEX_DURATION_SECONDS) {
      apiError(422, "Videos longer than 4 hours are not supported.");
    }
  }

  private async fetchSourceDurationSeconds(url: string, source: string, sourceVideoId: string): Promise<number | null> {
    try {
      if (source === "youtube") {
        return fetchYoutubeVideoDuration(this.env, sourceVideoId);
      }
      if (source === "pexels") {
        return fetchPexelsDuration(this.env, sourceVideoId);
      }
      if (source === "pixabay") {
        return fetchPixabayDuration(this.env, sourceVideoId);
      }
    } catch {
      return null;
    }

    if (source === "upload" && DIRECT_VIDEO_EXTENSIONS.some((extension) => url.toLowerCase().endsWith(extension))) {
      return null;
    }

    return null;
  }

  private extractYoutubeVideoId(parsedUrl: URL): string | null {
    const host = parsedUrl.hostname.toLowerCase();
    const path = parsedUrl.pathname.replace(/^\/+/, "");
    if (host === "youtu.be" && path) {
      return path.split("/", 1)[0];
    }
    if (!YOUTUBE_HOSTS.has(host)) {
      return null;
    }
    const videoId = parsedUrl.searchParams.get("v");
    if (videoId) {
      return videoId;
    }
    if (path.startsWith("shorts/")) {
      return path.split("/", 2)[1] ?? null;
    }
    return null;
  }

  private hostMatchesDomain(hostname: string, domain: string): boolean {
    const normalizedHost = hostname.replace(/\.+$/, "");
    const normalizedDomain = domain.replace(/\.+$/, "");
    return normalizedHost === normalizedDomain || normalizedHost.endsWith(`.${normalizedDomain}`);
  }

  private buildPlaceholderTitle(url: string, source: string, sourceVideoId: string): string {
    const parsed = new URL(url);
    const slug = parsed.pathname.replace(/\/+$/, "").split("/").pop() ?? "";
    const normalized = slug.replace(/[-_]+/g, " ").trim();
    return normalized || `${source} ${sourceVideoId}`;
  }
}
