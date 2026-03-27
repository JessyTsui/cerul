import type { DatabaseClient } from "../db/client";
import type { Bindings } from "../types";

type QueryParam =
  | string
  | number
  | boolean
  | null
  | Date
  | Uint8Array
  | Record<string, unknown>
  | Array<unknown>;

function utcNow(): Date {
  return new Date();
}

function coerceJsonValue(value: unknown): unknown {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

function asInt(value: unknown): number {
  return value == null ? 0 : Math.trunc(Number(value));
}

function notCancelledJobCondition(alias?: string): string {
  const prefix = alias ? `${alias}.` : "";
  return `COALESCE((${prefix}input_payload->>'cancelled_by_user')::boolean, FALSE) = FALSE`;
}

function extractStepLogs(artifacts: unknown): Array<Record<string, unknown>> {
  const payload = coerceJsonValue(artifacts);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return [];
  }
  const rawLogs = (payload as any).logs;
  if (!Array.isArray(rawLogs)) {
    return [];
  }
  return rawLogs
    .filter((item) => item && typeof item === "object" && String((item as any).message ?? "").trim())
    .map((item: any) => ({
      at: item.at ?? null,
      level: String(item.level ?? "info"),
      message: String(item.message ?? "").trim(),
      details: item.details && typeof item.details === "object" && !Array.isArray(item.details) ? item.details : null
    }));
}

function extractStepGuidance(artifacts: unknown): string | null {
  const payload = coerceJsonValue(artifacts);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const guidance = String((payload as any).guidance ?? "").trim();
  return guidance || null;
}

function stepDurationMs(input: {
  started_at?: unknown;
  completed_at?: unknown;
  updated_at?: unknown;
  reference_now: Date;
}): number | null {
  if (input.started_at == null) {
    return null;
  }
  const startedAt = new Date(String(input.started_at));
  const completedAt = input.completed_at == null ? null : new Date(String(input.completed_at));
  const updatedAt = input.updated_at == null ? null : new Date(String(input.updated_at));
  const end = completedAt ?? updatedAt ?? input.reference_now;
  return Math.max(end.getTime() - startedAt.getTime(), 0);
}

function jobDurationMs(input: {
  started_at?: unknown;
  created_at?: unknown;
  completed_at?: unknown;
  updated_at?: unknown;
  reference_now: Date;
}): number | null {
  const startedAt = input.started_at == null ? null : new Date(String(input.started_at));
  const createdAt = input.created_at == null ? null : new Date(String(input.created_at));
  const start = startedAt ?? createdAt;
  if (start == null) {
    return null;
  }
  const completedAt = input.completed_at == null ? null : new Date(String(input.completed_at));
  const updatedAt = input.updated_at == null ? null : new Date(String(input.updated_at));
  const end = completedAt ?? updatedAt ?? input.reference_now;
  return Math.max(end.getTime() - start.getTime(), 0);
}

function normalizeSourceSlug(value: string): string {
  const slug = String(value).trim().toLowerCase();
  if (!slug) {
    throw new Error("Content source slug is required.");
  }
  return slug;
}

function normalizeSourceTrack(value: string): string {
  const track = String(value).trim().toLowerCase();
  if (!["broll", "knowledge", "shared", "unified"].includes(track)) {
    throw new Error("Content source track must be one of: broll, knowledge, shared, unified.");
  }
  return track;
}

function normalizeSourceDisplayName(value: string): string {
  const displayName = String(value).trim();
  if (!displayName) {
    throw new Error("Content source display_name is required.");
  }
  return displayName;
}

function normalizeSourceBaseUrl(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized || null;
}

function normalizeSourceType(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  const normalized = String(value).trim().toLowerCase();
  return normalized || null;
}

function normalizeSourceSyncCursor(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized || null;
}

function normalizeSourceMapping(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return { ...(value as Record<string, unknown>) };
}

function inferSourceType(input: {
  track: string;
  slug: string;
  base_url: string | null;
  config: Record<string, unknown>;
  metadata: Record<string, unknown>;
  source_type?: string | null;
}): string | null {
  const explicitSourceType = normalizeSourceType(input.source_type);
  if (explicitSourceType) {
    return explicitSourceType;
  }

  for (const candidateKey of ["source_type", "provider", "source", "source_name"]) {
    const candidate =
      normalizeSourceType(input.config[candidateKey]) ??
      normalizeSourceType(input.metadata[candidateKey]);
    if (candidate) {
      return candidate;
    }
  }

  if (input.track === "knowledge") {
    return "youtube";
  }

  const normalizedSlug = input.slug.toLowerCase();
  const normalizedBaseUrl = (input.base_url ?? "").toLowerCase();
  for (const candidate of ["youtube", "pexels", "pixabay"]) {
    if (normalizedSlug.includes(candidate) || normalizedBaseUrl.includes(candidate)) {
      return candidate;
    }
  }

  return null;
}

function serializeAdminSource(row: Record<string, unknown>): Record<string, unknown> {
  const config = normalizeSourceMapping(coerceJsonValue(row.config));
  const metadata = normalizeSourceMapping(coerceJsonValue(row.metadata));
  return {
    id: String(row.id),
    slug: String(row.slug),
    track: String(row.track),
    source_type: normalizeSourceType(row.source_type),
    display_name: String(row.display_name),
    base_url: row.base_url == null ? null : String(row.base_url),
    is_active: Boolean(row.is_active),
    config,
    sync_cursor: normalizeSourceSyncCursor(row.sync_cursor),
    metadata,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean((error as any)?.code === "23505");
}

export async function fetchSources(db: DatabaseClient): Promise<Record<string, unknown>> {
  const rows = await db.fetch(
    `
      SELECT
          id::text AS id,
          slug,
          track,
          source_type,
          display_name,
          base_url,
          is_active,
          config,
          sync_cursor,
          metadata,
          created_at,
          updated_at
      FROM content_sources
      ORDER BY display_name ASC, slug ASC
    `
  );
  return {
    generated_at: utcNow(),
    sources: rows.map((row) => serializeAdminSource(row))
  };
}

export async function createSource(db: DatabaseClient, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const slug = normalizeSourceSlug(String(payload.slug ?? ""));
  const track = normalizeSourceTrack(String(payload.track ?? ""));
  const baseUrl = normalizeSourceBaseUrl(payload.base_url);
  const config = normalizeSourceMapping(payload.config);
  const metadata = normalizeSourceMapping(payload.metadata);
  const effectiveConfig = Object.keys(config).length === 0 && Object.keys(metadata).length > 0 ? { ...metadata } : config;
  const sourceType = inferSourceType({
    track,
    slug,
    base_url: baseUrl,
    config: effectiveConfig,
    metadata,
    source_type: payload.source_type == null ? null : String(payload.source_type)
  });

  try {
    const row = await db.fetchrow(
      `
        INSERT INTO content_sources (
            slug,
            track,
            source_type,
            display_name,
            base_url,
            is_active,
            config,
            sync_cursor,
            metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb)
        RETURNING
            id::text AS id,
            slug,
            track,
            source_type,
            display_name,
            base_url,
            is_active,
            config,
            sync_cursor,
            metadata,
            created_at,
            updated_at
      `,
      slug,
      track,
      sourceType,
      normalizeSourceDisplayName(String(payload.display_name ?? "")),
      baseUrl,
      Boolean(payload.is_active ?? true),
      JSON.stringify(effectiveConfig),
      normalizeSourceSyncCursor(payload.sync_cursor),
      JSON.stringify(metadata)
    );
    if (!row) {
      throw new Error("Unable to create content source.");
    }
    return serializeAdminSource(row);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new Error("Content source slug already exists.");
    }
    throw error;
  }
}

export async function updateSource(db: DatabaseClient, sourceId: string, payload: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const keys = Object.keys(payload);
  if (keys.length === 0) {
    throw new Error("At least one field must be provided.");
  }

  const assignments: string[] = [];
  const params: QueryParam[] = [];
  let normalizedConfig: Record<string, unknown> | undefined;
  let normalizedMetadata: Record<string, unknown> | undefined;

  if ("slug" in payload) {
    if (payload.slug == null) {
      throw new Error("'slug' cannot be null.");
    }
    params.push(normalizeSourceSlug(String(payload.slug)));
    assignments.push(`slug = $${params.length}`);
  }
  if ("track" in payload) {
    if (payload.track == null) {
      throw new Error("'track' cannot be null.");
    }
    params.push(normalizeSourceTrack(String(payload.track)));
    assignments.push(`track = $${params.length}`);
  }
  if ("source_type" in payload) {
    if (payload.source_type == null) {
      throw new Error("'source_type' cannot be null.");
    }
    params.push(normalizeSourceType(payload.source_type));
    assignments.push(`source_type = $${params.length}`);
  }
  if ("display_name" in payload) {
    if (payload.display_name == null) {
      throw new Error("'display_name' cannot be null.");
    }
    params.push(normalizeSourceDisplayName(String(payload.display_name)));
    assignments.push(`display_name = $${params.length}`);
  }
  if ("base_url" in payload) {
    params.push(normalizeSourceBaseUrl(payload.base_url));
    assignments.push(`base_url = $${params.length}`);
  }
  if ("is_active" in payload) {
    if (payload.is_active == null) {
      throw new Error("'is_active' cannot be null.");
    }
    params.push(Boolean(payload.is_active));
    assignments.push(`is_active = $${params.length}`);
  }
  if ("config" in payload) {
    normalizedConfig = normalizeSourceMapping(payload.config);
    params.push(JSON.stringify(normalizedConfig));
    assignments.push(`config = $${params.length}::jsonb`);
  }
  if ("sync_cursor" in payload) {
    params.push(normalizeSourceSyncCursor(payload.sync_cursor));
    assignments.push(`sync_cursor = $${params.length}`);
  }
  if ("metadata" in payload) {
    normalizedMetadata = normalizeSourceMapping(payload.metadata);
    params.push(JSON.stringify(normalizedMetadata));
    assignments.push(`metadata = $${params.length}::jsonb`);
  }

  if (assignments.length === 0) {
    throw new Error("At least one field must be provided.");
  }

  params.push(sourceId);

  try {
    const row = await db.fetchrow(
      `
        UPDATE content_sources
        SET ${assignments.join(", ")},
            updated_at = NOW()
        WHERE id = $${params.length}::uuid
        RETURNING
            id::text AS id,
            slug,
            track,
            source_type,
            display_name,
            base_url,
            is_active,
            config,
            sync_cursor,
            metadata,
            created_at,
            updated_at
      `,
      ...params
    );
    return row ? serializeAdminSource(row) : null;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new Error("Content source slug already exists.");
    }
    throw error;
  }
}

export async function deleteSource(db: DatabaseClient, sourceId: string): Promise<boolean> {
  const row = await db.fetchrow(
    `
      DELETE FROM content_sources
      WHERE id = $1::uuid
      RETURNING id
    `,
    sourceId
  );
  return row != null;
}

export async function retryJob(db: DatabaseClient, jobId: string): Promise<Record<string, unknown> | null> {
  return db.fetchrow(
    `
      UPDATE processing_jobs
      SET status = 'pending',
          attempts = 0,
          error_message = NULL,
          locked_by = NULL,
          locked_at = NULL,
          next_retry_at = NULL,
          updated_at = NOW()
      WHERE id = $1::uuid
        AND status = 'failed'
        AND ${notCancelledJobCondition()}
      RETURNING id
    `,
    jobId
  );
}

export async function killJob(db: DatabaseClient, jobId: string): Promise<Record<string, unknown> | null> {
  return db.fetchrow(
    `
      DELETE FROM processing_jobs
      WHERE id = $1::uuid
        AND status = 'failed'
        AND ${notCancelledJobCondition()}
      RETURNING id
    `,
    jobId
  );
}

export async function fetchIndexedVideos(
  db: DatabaseClient,
  query?: string | null,
  limit = 10,
  offset = 0
): Promise<Record<string, unknown>> {
  const normalizedQuery = String(query ?? "").trim();
  const safeLimit = Math.max(1, Math.min(Number(limit) || 10, 100));
  const safeOffset = Math.max(Number(offset) || 0, 0);
  const conditions: string[] = [];
  const params: QueryParam[] = [];

  if (normalizedQuery) {
    params.push(`%${normalizedQuery}%`);
    const searchParam = `$${params.length}`;
    conditions.push(
      `(v.title ILIKE ${searchParam} OR COALESCE(v.source_url, '') ILIKE ${searchParam} OR COALESCE(v.video_url, '') ILIKE ${searchParam} OR v.source_video_id ILIKE ${searchParam})`
    );
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const total = asInt(
    await db.fetchval(
      `
        SELECT COUNT(*)
        FROM videos AS v
        ${whereClause}
      `,
      ...params
    )
  );

  params.push(safeLimit, safeOffset);
  const rows = await db.fetch(
    `
      SELECT
          v.id::text AS video_id,
          v.source,
          v.source_video_id,
          v.title,
          v.source_url,
          v.video_url,
          v.speaker,
          v.created_at,
          v.updated_at,
          COALESCE(ru_counts.units_created, 0) AS units_created,
          last_job.status AS last_job_status,
          COALESCE(last_job.updated_at, last_job.completed_at, last_job.created_at) AS last_job_at
      FROM videos AS v
      LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS units_created
          FROM retrieval_units
          WHERE video_id = v.id
      ) AS ru_counts ON TRUE
      LEFT JOIN LATERAL (
          SELECT status, updated_at, completed_at, created_at
          FROM processing_jobs
          WHERE input_payload->>'video_id' = v.id::text
          ORDER BY created_at DESC
          LIMIT 1
      ) AS last_job ON TRUE
      ${whereClause}
      ORDER BY
          COALESCE(last_job.updated_at, last_job.completed_at, v.updated_at, v.created_at) DESC,
          v.created_at DESC
      LIMIT $${params.length - 1}
      OFFSET $${params.length}
    `,
    ...params
  );

  return {
    generated_at: utcNow(),
    videos: rows.map((row) => ({
      video_id: String(row.video_id),
      source: String(row.source),
      source_video_id: String(row.source_video_id),
      title: String(row.title),
      source_url: row.source_url == null ? null : String(row.source_url),
      video_url: row.video_url == null ? null : String(row.video_url),
      speaker: row.speaker == null ? null : String(row.speaker),
      created_at: row.created_at,
      updated_at: row.updated_at,
      units_created: asInt(row.units_created),
      last_job_status: row.last_job_status == null ? null : String(row.last_job_status),
      last_job_at: row.last_job_at ?? null
    })),
    total,
    limit: safeLimit,
    offset: safeOffset,
    query: normalizedQuery || null
  };
}

export async function deleteIndexedVideoData(db: DatabaseClient, videoId: string): Promise<Record<string, unknown> | null> {
  return db.transaction(async (tx) => {
    const videoRow = await tx.fetchrow(
      `
        SELECT id::text AS video_id, title
        FROM videos
        WHERE id = $1::uuid
      `,
      videoId
    );
    if (!videoRow) {
      return null;
    }

    const unitsDeleted = asInt(
      await tx.fetchval(
        `
          SELECT COUNT(*)
          FROM retrieval_units
          WHERE video_id = $1::uuid
        `,
        videoId
      )
    );
    const processingJobsDeleted = asInt(
      await tx.fetchval(
        `
          SELECT COUNT(*)
          FROM processing_jobs
          WHERE input_payload->>'video_id' = $1::text
        `,
        videoId
      )
    );

    await tx.execute(
      `
        DELETE FROM processing_jobs
        WHERE input_payload->>'video_id' = $1::text
      `,
      videoId
    );
    await tx.execute(
      `
        DELETE FROM videos
        WHERE id = $1::uuid
      `,
      videoId
    );

    return {
      ok: true,
      video_id: String(videoRow.video_id),
      title: String(videoRow.title),
      units_deleted: unitsDeleted,
      processing_jobs_deleted: processingJobsDeleted
    };
  });
}

async function fetchWorkerSteps(db: DatabaseClient, jobIds: string[], referenceNow: Date): Promise<Map<string, Record<string, unknown>[]>> {
  if (jobIds.length === 0) {
    return new Map();
  }

  const rows = await db.fetch(
    `
      SELECT
          job_id,
          step_name,
          status,
          artifacts,
          started_at,
          completed_at,
          updated_at,
          error_message
      FROM processing_job_steps
      WHERE job_id = ANY($1::uuid[])
      ORDER BY created_at
    `,
    jobIds
  );

  const stepsByJob = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const jobId = String(row.job_id);
    const artifacts = coerceJsonValue(row.artifacts) ?? {};
    const steps = stepsByJob.get(jobId) ?? [];
    steps.push({
      step_name: String(row.step_name),
      status: String(row.status),
      artifacts,
      started_at: row.started_at ?? null,
      completed_at: row.completed_at ?? null,
      updated_at: row.updated_at ?? null,
      duration_ms: stepDurationMs({
        started_at: row.started_at,
        completed_at: row.completed_at,
        updated_at: row.updated_at,
        reference_now: referenceNow
      }),
      guidance: extractStepGuidance(artifacts),
      logs: extractStepLogs(artifacts),
      error_message: row.error_message == null ? null : String(row.error_message)
    });
    stepsByJob.set(jobId, steps);
  }
  return stepsByJob;
}

export async function fetchWorkerLive(
  db: DatabaseClient,
  failedLimit = 10,
  failedOffset = 0
): Promise<Record<string, unknown>> {
  const counts = (
    await db.fetchrow(
      `
        SELECT
            COUNT(*) FILTER (WHERE status = 'pending')   AS pending,
            COUNT(*) FILTER (WHERE status = 'running')   AS running,
            COUNT(*) FILTER (WHERE status = 'retrying')  AS retrying,
            COUNT(*) FILTER (WHERE status = 'completed') AS completed,
            COUNT(*) FILTER (
                WHERE status = 'failed'
                  AND ${notCancelledJobCondition()}
            ) AS failed
        FROM processing_jobs
      `
    )
  ) ?? {};

  const activeRows = await db.fetch(
    `
      SELECT
          pj.id,
          pj.track,
          pj.status,
          input_payload->>'source' AS source,
          input_payload->>'video_id' AS video_id,
          COALESCE(
              v.title,
              input_payload->'source_metadata'->>'title',
              input_payload->>'title',
              input_payload->>'video_id'
          ) AS title,
          pj.attempts,
          pj.max_attempts,
          pj.error_message,
          pj.started_at,
          pj.created_at,
          pj.updated_at
      FROM processing_jobs AS pj
      LEFT JOIN videos AS v
          ON v.id::text = pj.input_payload->>'video_id'
      WHERE pj.status IN ('running', 'retrying', 'pending')
      ORDER BY
          CASE pj.status
              WHEN 'running' THEN 0
              WHEN 'retrying' THEN 1
              ELSE 2
          END,
          pj.started_at NULLS LAST,
          pj.created_at
      LIMIT 20
    `
  );

  const generatedAt = utcNow();
  const activeJobIds = activeRows.map((row) => String(row.id));
  const failedJobsTotal = asInt(
    await db.fetchval(
      `
        SELECT COUNT(*)
        FROM processing_jobs
        WHERE status = 'failed'
          AND ${notCancelledJobCondition()}
      `
    )
  );

  const failedRows = await db.fetch(
    `
      SELECT
          pj.id,
          pj.track,
          pj.status,
          input_payload->>'source' AS source,
          input_payload->>'video_id' AS video_id,
          COALESCE(
              v.title,
              input_payload->'source_metadata'->>'title',
              input_payload->>'title',
              input_payload->>'video_id'
          ) AS title,
          pj.attempts,
          pj.max_attempts,
          pj.error_message,
          pj.started_at,
          pj.completed_at,
          pj.created_at,
          pj.updated_at
      FROM processing_jobs AS pj
      LEFT JOIN videos AS v
          ON v.id::text = pj.input_payload->>'video_id'
      WHERE pj.status = 'failed'
        AND ${notCancelledJobCondition("pj")}
      ORDER BY pj.updated_at DESC
      LIMIT $1
      OFFSET $2
    `,
    failedLimit,
    failedOffset
  );

  const stepsByJob = await fetchWorkerSteps(
    db,
    [...activeJobIds, ...failedRows.map((row) => String(row.id))],
    generatedAt
  );

  const activeJobs = activeRows.map((row) => ({
    job_id: String(row.id),
    track: String(row.track),
    status: String(row.status),
    source: row.source == null ? null : String(row.source),
    video_id: row.video_id == null ? null : String(row.video_id),
    title: row.title == null ? null : String(row.title),
    started_at: row.started_at ?? null,
    created_at: row.created_at,
    last_activity_at: row.updated_at ?? null,
    attempts: asInt(row.attempts),
    max_attempts: asInt(row.max_attempts),
    total_duration_ms: jobDurationMs({
      started_at: row.started_at,
      created_at: row.created_at,
      completed_at: row.completed_at,
      updated_at: row.updated_at,
      reference_now: generatedAt
    }),
    error_message: row.error_message == null ? null : String(row.error_message),
    steps: stepsByJob.get(String(row.id)) ?? []
  }));

  const completedRows = await db.fetch(
    `
      SELECT
          pj.id,
          COALESCE(
              pj.input_payload->>'source_video_id',
              pj.input_payload->'item'->>'video_id',
              pj.input_payload->>'video_id'
          ) AS video_id,
          COALESCE(
              v.title,
              pj.input_payload->'source_metadata'->>'title',
              pj.input_payload->'item'->>'title',
              pj.input_payload->>'title',
              pj.input_payload->>'source_video_id'
          ) AS title,
          pj.completed_at,
          pj.started_at,
          pj.created_at,
          pj.updated_at,
          COUNT(ru.id) FILTER (WHERE ru.unit_type = 'speech') AS segment_count
      FROM processing_jobs pj
      LEFT JOIN content_sources cs
          ON cs.id = pj.source_id
      LEFT JOIN LATERAL (
          SELECT v.*
          FROM videos v
          WHERE v.source_video_id = COALESCE(
              pj.input_payload->>'source_video_id',
              pj.input_payload->'item'->>'video_id',
              pj.input_payload->>'video_id'
          )
          ORDER BY
              CASE
                  WHEN COALESCE(
                      NULLIF(BTRIM(pj.input_payload->>'source'), ''),
                      NULLIF(BTRIM(cs.source_type), ''),
                      NULLIF(BTRIM(cs.metadata->>'source_type'), ''),
                      NULLIF(BTRIM(cs.metadata->>'provider'), ''),
                      NULLIF(BTRIM(cs.metadata->>'source'), '')
                  ) IS NOT NULL
                  AND v.source = COALESCE(
                      NULLIF(BTRIM(pj.input_payload->>'source'), ''),
                      NULLIF(BTRIM(cs.source_type), ''),
                      NULLIF(BTRIM(cs.metadata->>'source_type'), ''),
                      NULLIF(BTRIM(cs.metadata->>'provider'), ''),
                      NULLIF(BTRIM(cs.metadata->>'source'), '')
                  )
                  THEN 0
                  ELSE 1
              END,
              v.updated_at DESC,
              v.created_at DESC
          LIMIT 1
      ) v
          ON TRUE
      LEFT JOIN retrieval_units ru
          ON ru.video_id = v.id
      WHERE pj.status = 'completed'
      GROUP BY pj.id, pj.input_payload, pj.completed_at, v.title
      ORDER BY pj.completed_at DESC NULLS LAST
      LIMIT 8
    `
  );

  const recentCompleted = completedRows.map((row) => ({
    job_id: String(row.id),
    video_id: row.video_id == null ? null : String(row.video_id),
    title: row.title == null ? null : String(row.title),
    segment_count: asInt(row.segment_count),
    completed_at: row.completed_at ?? null,
    total_duration_ms: jobDurationMs({
      started_at: row.started_at,
      created_at: row.created_at,
      completed_at: row.completed_at,
      updated_at: row.updated_at,
      reference_now: generatedAt
    })
  }));

  const failedJobs = failedRows.map((row) => ({
    job_id: String(row.id),
    track: String(row.track),
    status: String(row.status),
    source: row.source == null ? null : String(row.source),
    video_id: row.video_id == null ? null : String(row.video_id),
    title: row.title == null ? null : String(row.title),
    started_at: row.started_at ?? null,
    created_at: row.created_at,
    last_activity_at: row.updated_at ?? null,
    attempts: asInt(row.attempts),
    max_attempts: asInt(row.max_attempts),
    total_duration_ms: jobDurationMs({
      started_at: row.started_at,
      created_at: row.created_at,
      completed_at: row.completed_at,
      updated_at: row.updated_at,
      reference_now: generatedAt
    }),
    error_message: row.error_message == null ? null : String(row.error_message),
    steps: stepsByJob.get(String(row.id)) ?? []
  }));

  return {
    generated_at: generatedAt,
    queue: {
      pending: asInt(counts.pending),
      running: asInt(counts.running),
      retrying: asInt(counts.retrying),
      completed: asInt(counts.completed),
      failed: asInt(counts.failed)
    },
    active_jobs: activeJobs,
    recent_completed: recentCompleted,
    failed_jobs: failedJobs,
    failed_jobs_total: failedJobsTotal,
    failed_jobs_limit: failedLimit,
    failed_jobs_offset: failedOffset
  };
}

function resolveSourceAnalyticsWindow(rangeKey: string): {
  range_key: string;
  current_start: Date;
  current_end: Date;
  previous_start: Date;
  previous_end: Date;
} {
  const now = utcNow();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const daysMap: Record<string, number> = { "24h": 1, "3d": 3, "7d": 7, "15d": 15, "30d": 30 };
  const days = daysMap[rangeKey] ?? 7;
  const currentStart = new Date(start.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  const currentEnd = now;
  const duration = currentEnd.getTime() - currentStart.getTime();
  const previousEnd = currentStart;
  const previousStart = new Date(previousEnd.getTime() - duration);
  return {
    range_key: rangeKey,
    current_start: currentStart,
    current_end: currentEnd,
    previous_start: previousStart,
    previous_end: previousEnd
  };
}

export async function fetchSourcesAnalytics(db: DatabaseClient, rangeKey = "7d"): Promise<Record<string, unknown>> {
  const window = resolveSourceAnalyticsWindow(rangeKey);
  const rows = await db.fetch(
    `
      SELECT
          cs.id::text AS source_id,
          cs.slug,
          cs.display_name,
          COUNT(pj.id) FILTER (
              WHERE pj.created_at >= $1 AND pj.created_at < $2
          ) AS jobs_created,
          COUNT(pj.id) FILTER (
              WHERE pj.status = 'completed'
                AND pj.updated_at >= $1 AND pj.updated_at < $2
          ) AS jobs_completed,
          COUNT(pj.id) FILTER (
              WHERE pj.status = 'failed'
                AND ${notCancelledJobCondition("pj")}
                AND pj.updated_at >= $1 AND pj.updated_at < $2
          ) AS jobs_failed,
          COUNT(pj.id) FILTER (
              WHERE pj.created_at >= $3 AND pj.created_at < $4
          ) AS prev_jobs_created,
          COUNT(pj.id) FILTER (
              WHERE pj.status = 'completed'
                AND pj.updated_at >= $3 AND pj.updated_at < $4
          ) AS prev_jobs_completed,
          COUNT(pj.id) FILTER (
              WHERE pj.status = 'failed'
                AND ${notCancelledJobCondition("pj")}
                AND pj.updated_at >= $3 AND pj.updated_at < $4
          ) AS prev_jobs_failed
      FROM content_sources AS cs
      LEFT JOIN processing_jobs AS pj ON pj.source_id = cs.id
      WHERE cs.is_active = TRUE
      GROUP BY cs.id, cs.slug, cs.display_name
      ORDER BY cs.display_name
    `,
    window.current_start,
    window.current_end,
    window.previous_start,
    window.previous_end
  );
  return {
    generated_at: utcNow(),
    range_key: window.range_key,
    current_start: window.current_start,
    current_end: window.current_end,
    sources: rows.map((row) => ({
      source_id: String(row.source_id),
      slug: String(row.slug),
      display_name: String(row.display_name),
      jobs_created: asInt(row.jobs_created),
      jobs_completed: asInt(row.jobs_completed),
      jobs_failed: asInt(row.jobs_failed),
      prev_jobs_created: asInt(row.prev_jobs_created),
      prev_jobs_completed: asInt(row.prev_jobs_completed),
      prev_jobs_failed: asInt(row.prev_jobs_failed)
    }))
  };
}

export async function fetchSourcesRecentVideos(db: DatabaseClient, limit = 3): Promise<Record<string, unknown>> {
  const rows = await db.fetch(
    `
      WITH ranked AS (
          SELECT
              pj.source_id,
              cs.slug,
              pj.input_payload->>'source_item_id' AS video_id,
              COALESCE(
                  pj.input_payload->'item'->>'title',
                  pj.input_payload->>'title',
                  ''
              ) AS title,
              pj.input_payload->'item'->>'thumbnail_url' AS thumbnail_url,
              pj.input_payload->'item'->>'view_count' AS view_count,
              pj.input_payload->'item'->>'duration_seconds' AS duration_seconds,
              pj.input_payload->'item'->>'published_at' AS published_at,
              ROW_NUMBER() OVER (
                  PARTITION BY pj.source_id
                  ORDER BY pj.created_at DESC
              ) AS rn
          FROM processing_jobs AS pj
          JOIN content_sources AS cs ON cs.id = pj.source_id
          WHERE cs.is_active = TRUE
            AND cs.source_type = 'youtube'
      )
      SELECT * FROM ranked WHERE rn <= $1
      ORDER BY slug, rn
    `,
    limit
  );

  const sourcesMap = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const sourceId = String(row.source_id);
    const entry = sourcesMap.get(sourceId) ?? {
      source_id: sourceId,
      slug: String(row.slug),
      videos: [] as Record<string, unknown>[]
    };
    (entry.videos as Record<string, unknown>[]).push({
      video_id: String(row.video_id ?? ""),
      title: String(row.title ?? ""),
      thumbnail_url: row.thumbnail_url ?? null,
      view_count: row.view_count == null ? null : asInt(row.view_count),
      duration_seconds: row.duration_seconds == null ? null : Math.trunc(Number(row.duration_seconds)),
      published_at: row.published_at == null ? null : String(row.published_at)
    });
    sourcesMap.set(sourceId, entry);
  }

  return {
    generated_at: utcNow(),
    sources: [...sourcesMap.values()]
  };
}

const YT_CHANNEL_ID_RE = /UC[\w-]{20,}/;

function extractChannelIdFromUrl(url: string): [string | null, string | null] {
  const trimmed = url.trim();
  if (YT_CHANNEL_ID_RE.test(trimmed)) {
    return [trimmed, null];
  }

  try {
    const parsed = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
    if (!(parsed.hostname ?? "").includes("youtube.com")) {
      return [null, null];
    }
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length === 0) {
      return [null, null];
    }
    if (parts[0] === "channel" && parts[1]) {
      return [parts[1], null];
    }
    if (parts[0].startsWith("@")) {
      return [null, parts[0].slice(1)];
    }
    if ((parts[0] === "c" || parts[0] === "user") && parts[1]) {
      return [null, parts[1]];
    }
  } catch {
    return [null, null];
  }

  return [null, null];
}

async function resolveChannelId(env: Bindings, handle: string): Promise<string | null> {
  const apiKey = (env.YOUTUBE_API_KEY ?? "").trim();
  if (!apiKey) {
    return null;
  }
  const url = new URL("https://www.googleapis.com/youtube/v3/channels");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("forHandle", handle);
  url.searchParams.set("part", "id");
  const response = await fetch(url);
  if (!response.ok) {
    return null;
  }
  const payload = await response.json() as any;
  return payload?.items?.[0]?.id ? String(payload.items[0].id) : null;
}

async function fetchChannelMetadata(env: Bindings, channelId: string): Promise<Record<string, unknown>> {
  const apiKey = (env.YOUTUBE_API_KEY ?? "").trim();
  if (!apiKey) {
    throw new Error("YOUTUBE_API_KEY is not configured.");
  }

  const url = new URL("https://www.googleapis.com/youtube/v3/channels");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("id", channelId);
  url.searchParams.set("part", "snippet,statistics,brandingSettings");
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`YouTube channel lookup failed: ${response.status}`);
  }

  const payload = await response.json() as any;
  const item = payload?.items?.[0];
  if (!item) {
    throw new Error(`YouTube channel not found: ${channelId}`);
  }
  const snippet = item.snippet ?? {};
  const stats = item.statistics ?? {};
  const branding = item.brandingSettings?.channel ?? {};
  const thumbnails = snippet.thumbnails ?? {};
  let thumbnailUrl: string | null = null;
  for (const key of ["high", "medium", "default"]) {
    if (thumbnails[key]?.url) {
      thumbnailUrl = String(thumbnails[key].url);
      break;
    }
  }
  const keywords: string[] = [];
  const rawKeywords = String(branding.keywords ?? "");
  if (rawKeywords) {
    for (const match of rawKeywords.matchAll(/"([^"]+)"|(\S+)/g)) {
      const keyword = (match[1] ?? match[2] ?? "").trim();
      if (keyword) {
        keywords.push(keyword);
      }
    }
  }
  return {
    title: String(snippet.title ?? channelId),
    description: String(snippet.description ?? "").trim(),
    thumbnail_url: thumbnailUrl,
    custom_url: snippet.customUrl ?? null,
    country: snippet.country ?? null,
    subscriber_count: stats.subscriberCount == null ? null : asInt(stats.subscriberCount),
    video_count: stats.videoCount == null ? null : asInt(stats.videoCount),
    view_count: stats.viewCount == null ? null : asInt(stats.viewCount),
    keywords
  };
}

function slugify(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "channel";
}

export async function createSourceFromUrl(
  db: DatabaseClient,
  env: Bindings,
  url: string
): Promise<Record<string, unknown>> {
  let [channelId, handle] = extractChannelIdFromUrl(url);
  if (!channelId && handle) {
    channelId = await resolveChannelId(env, handle);
  }
  if (!channelId) {
    throw new Error("Could not resolve channel. Please provide a channel URL (youtube.com/channel/UC... or youtube.com/@handle) or a channel ID.");
  }

  const existing = await db.fetchrow(
    `
      SELECT id
      FROM content_sources
      WHERE config->>'channel_id' = $1
    `,
    channelId
  );
  if (existing) {
    const source = await db.fetchrow(
      `
        SELECT id::text AS id, slug, track, source_type, display_name, base_url,
               is_active, config, sync_cursor, metadata, created_at, updated_at
        FROM content_sources
        WHERE id = $1
      `,
      String(existing.id)
    );
    if (!source) {
      throw new Error("Existing content source could not be loaded.");
    }
    return {
      ok: true,
      source: serializeAdminSource(source),
      already_exists: true
    };
  }

  const meta = await fetchChannelMetadata(env, channelId);
  let slug = slugify(String(meta.title));
  const slugExists = await db.fetchval(
    `
      SELECT 1 FROM content_sources WHERE slug = $1
    `,
    slug
  );
  if (slugExists) {
    slug = `${slug}-${channelId.slice(-6).toLowerCase()}`;
  }

  const row = await db.fetchrow(
    `
      INSERT INTO content_sources (
          id, slug, track, source_type, display_name,
          is_active, config, sync_cursor, metadata
      )
      VALUES (gen_random_uuid(), $1, 'unified', 'youtube', $2,
              TRUE, $3::jsonb, NULL, $4::jsonb)
      RETURNING id::text AS id, slug, track, source_type, display_name, base_url,
                is_active, config, sync_cursor, metadata, created_at, updated_at
    `,
    slug,
    String(meta.title),
    JSON.stringify({ channel_id: channelId, max_results: 30 }),
    JSON.stringify({
      thumbnail_url: meta.thumbnail_url ?? null,
      description: meta.description ?? "",
      custom_url: meta.custom_url ?? null,
      country: meta.country ?? null,
      subscriber_count: meta.subscriber_count ?? null,
      video_count: meta.video_count ?? null,
      view_count: meta.view_count ?? null,
      keywords: meta.keywords ?? []
    })
  );

  if (!row) {
    throw new Error("Unable to create content source.");
  }

  return {
    ok: true,
    source: serializeAdminSource(row),
    already_exists: false
  };
}

export async function triggerYoutubeSearch(
  db: DatabaseClient,
  env: Bindings,
  input: {
    query: string;
    max_results?: number;
    min_view_count?: number;
    min_duration_seconds?: number;
  }
): Promise<Record<string, unknown>> {
  const apiKey = (env.YOUTUBE_API_KEY ?? "").trim();
  if (!apiKey) {
    throw new Error("YOUTUBE_API_KEY is not configured.");
  }

  const maxResults = Math.min(input.max_results ?? 20, 50);
  const searchUrl = new URL("https://www.googleapis.com/youtube/v3/search");
  searchUrl.searchParams.set("key", apiKey);
  searchUrl.searchParams.set("q", input.query);
  searchUrl.searchParams.set("type", "video");
  searchUrl.searchParams.set("part", "snippet");
  searchUrl.searchParams.set("maxResults", String(maxResults));
  searchUrl.searchParams.set("order", "relevance");
  searchUrl.searchParams.set("relevanceLanguage", "en");

  const searchResponse = await fetch(searchUrl);
  if (!searchResponse.ok) {
    throw new Error(`YouTube search failed: ${searchResponse.status}`);
  }
  const searchPayload = await searchResponse.json() as any;
  const videoIds = (Array.isArray(searchPayload.items) ? searchPayload.items : [])
    .map((item: any) => item?.id?.videoId)
    .filter((value: unknown): value is string => typeof value === "string" && value.length > 0);

  if (videoIds.length === 0) {
    return { ok: true, jobs_created: 0, videos_found: 0, videos_filtered: 0 };
  }

  const videosUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
  videosUrl.searchParams.set("key", apiKey);
  videosUrl.searchParams.set("id", videoIds.join(","));
  videosUrl.searchParams.set("part", "snippet,contentDetails,statistics");
  const videosResponse = await fetch(videosUrl);
  if (!videosResponse.ok) {
    throw new Error(`YouTube videos lookup failed: ${videosResponse.status}`);
  }
  const videosPayload = await videosResponse.json() as any;
  const items = Array.isArray(videosPayload.items) ? videosPayload.items : [];

  let jobsCreated = 0;
  let videosFiltered = 0;
  for (const item of items) {
    const videoId = String(item.id ?? "");
    const snippet = item.snippet ?? {};
    const stats = item.statistics ?? {};
    const content = item.contentDetails ?? {};

    let duration = 0;
    const match = String(content.duration ?? "").match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (match) {
      duration =
        asInt(match[1]) * 3600 +
        asInt(match[2]) * 60 +
        asInt(match[3]);
    }

    const views = asInt(stats.viewCount);
    const live = String(snippet.liveBroadcastContent ?? "none").toLowerCase();
    if (
      duration < (input.min_duration_seconds ?? 180) ||
      live !== "none" ||
      views < (input.min_view_count ?? 5000)
    ) {
      videosFiltered += 1;
      continue;
    }

    const exists = await db.fetchval(
      `
        SELECT 1 FROM processing_jobs
        WHERE input_payload->>'source_video_id' = $1
        LIMIT 1
      `,
      videoId
    );
    if (exists) {
      continue;
    }

    const thumbnails = snippet.thumbnails ?? {};
    let thumbnailUrl: string | null = null;
    for (const key of ["maxres", "standard", "high", "medium", "default"]) {
      if (thumbnails[key]?.url) {
        thumbnailUrl = String(thumbnails[key].url);
        break;
      }
    }

    const meta = {
      source: "youtube",
      source_video_id: videoId,
      video_id: videoId,
      source_url: `https://www.youtube.com/watch?v=${videoId}`,
      video_url: `https://www.youtube.com/watch?v=${videoId}`,
      thumbnail_url: thumbnailUrl,
      title: String(snippet.title ?? ""),
      description: String(snippet.description ?? ""),
      channel_title: snippet.channelTitle ?? null,
      channel_id: snippet.channelId ?? null,
      published_at: snippet.publishedAt ?? null,
      duration_seconds: duration,
      view_count: views
    };

    await db.execute(
      `
        INSERT INTO processing_jobs (track, source_id, job_type, status, input_payload)
        VALUES ('unified', NULL, 'index_video', 'pending', $1::jsonb)
      `,
      JSON.stringify({
        track: "unified",
        discovery_track: "unified",
        source_slug: "manual-search",
        source_type: "youtube_search",
        source_item_id: videoId,
        source: "youtube",
        source_video_id: videoId,
        url: meta.video_url,
        owner_id: null,
        item: meta,
        source_metadata: meta,
        manual_search: true,
        search_query: input.query
      })
    );
    jobsCreated += 1;
  }

  return {
    ok: true,
    jobs_created: jobsCreated,
    videos_found: items.length,
    videos_filtered: videosFiltered
  };
}

const YT_VIDEO_ID_RE = /(?:youtube\.com\/watch\?.*v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([A-Za-z0-9_-]{11})/;

function extractYoutubeVideoId(url: string): string | null {
  const trimmed = url.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }
  const match = trimmed.match(YT_VIDEO_ID_RE);
  return match?.[1] ?? null;
}

async function fetchYoutubeVideoMetadata(env: Bindings, videoId: string): Promise<Record<string, unknown>> {
  const apiKey = (env.YOUTUBE_API_KEY ?? "").trim();
  if (!apiKey) {
    throw new Error("YOUTUBE_API_KEY is not configured.");
  }

  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("id", videoId);
  url.searchParams.set("part", "snippet,contentDetails,statistics");
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`YouTube video lookup failed: ${response.status}`);
  }

  const payload = await response.json() as any;
  const item = payload?.items?.[0];
  if (!item) {
    throw new Error(`YouTube video not found: ${videoId}`);
  }

  const snippet = item.snippet ?? {};
  const stats = item.statistics ?? {};
  const content = item.contentDetails ?? {};
  let durationSeconds = 0;
  const match = String(content.duration ?? "").match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (match) {
    durationSeconds =
      asInt(match[1]) * 3600 +
      asInt(match[2]) * 60 +
      asInt(match[3]);
  }

  const thumbnails = snippet.thumbnails ?? {};
  let thumbnailUrl: string | null = null;
  for (const key of ["maxres", "standard", "high", "medium", "default"]) {
    if (thumbnails[key]?.url) {
      thumbnailUrl = String(thumbnails[key].url);
      break;
    }
  }

  return {
    source: "youtube",
    source_video_id: videoId,
    video_id: videoId,
    source_url: `https://www.youtube.com/watch?v=${videoId}`,
    video_url: `https://www.youtube.com/watch?v=${videoId}`,
    thumbnail_url: thumbnailUrl,
    title: String(snippet.title ?? ""),
    description: String(snippet.description ?? ""),
    channel_title: snippet.channelTitle ?? null,
    channel_id: snippet.channelId ?? null,
    published_at: snippet.publishedAt ?? null,
    duration_seconds: durationSeconds,
    view_count: stats.viewCount == null ? null : asInt(stats.viewCount),
    like_count: stats.likeCount == null ? null : asInt(stats.likeCount)
  };
}

export async function submitVideo(db: DatabaseClient, env: Bindings, url: string): Promise<Record<string, unknown>> {
  const videoId = extractYoutubeVideoId(url);
  if (!videoId) {
    throw new Error("Invalid YouTube URL. Supported formats: youtube.com/watch?v=..., youtu.be/..., or a bare video ID.");
  }

  const existing = await db.fetchrow(
    `
      SELECT id::text AS job_id, status
      FROM processing_jobs
      WHERE input_payload->>'source_video_id' = $1
      ORDER BY created_at DESC
      LIMIT 1
    `,
    videoId
  );

  const meta = await fetchYoutubeVideoMetadata(env, videoId);
  if (existing) {
    return {
      ok: true,
      job_id: String(existing.job_id),
      video_id: videoId,
      title: String(meta.title ?? ""),
      thumbnail_url: meta.thumbnail_url ?? null,
      duration_seconds: meta.duration_seconds ?? null,
      channel_title: meta.channel_title ?? null,
      already_exists: true
    };
  }

  const jobId = await db.fetchval(
    `
      INSERT INTO processing_jobs (track, source_id, job_type, status, input_payload)
      VALUES ('unified', NULL, 'index_video', 'pending', $1::jsonb)
      RETURNING id::text
    `,
    JSON.stringify({
      track: "unified",
      discovery_track: "unified",
      source_slug: "manual",
      source_type: "youtube",
      source_item_id: videoId,
      source: "youtube",
      source_video_id: videoId,
      url: meta.video_url,
      owner_id: null,
      item: meta,
      source_metadata: meta,
      manual_submit: true
    })
  );

  return {
    ok: true,
    job_id: String(jobId ?? ""),
    video_id: videoId,
    title: String(meta.title ?? ""),
    thumbnail_url: meta.thumbnail_url ?? null,
    duration_seconds: meta.duration_seconds ?? null,
    channel_title: meta.channel_title ?? null,
    already_exists: false
  };
}

export async function getVideoJobStatus(db: DatabaseClient, videoId: string): Promise<Record<string, unknown>[]> {
  const rows = await db.fetch(
    `
      SELECT
          id::text AS job_id,
          COALESCE(
              input_payload->>'source_video_id',
              input_payload->>'video_id'
          ) AS video_id,
          COALESCE(
              input_payload->'item'->>'title',
              input_payload->>'title'
          ) AS title,
          status,
          created_at,
          started_at,
          completed_at,
          error_message,
          attempts
      FROM processing_jobs
      WHERE input_payload->>'source_video_id' = $1
         OR input_payload->>'video_id' = $1
      ORDER BY created_at DESC
      LIMIT 5
    `,
    videoId
  );
  return rows.map((row) => ({
    job_id: String(row.job_id),
    video_id: row.video_id == null ? videoId : String(row.video_id),
    title: row.title == null ? null : String(row.title),
    status: String(row.status),
    created_at: row.created_at,
    started_at: row.started_at ?? null,
    completed_at: row.completed_at ?? null,
    error_message: row.error_message == null ? null : String(row.error_message),
    attempts: asInt(row.attempts)
  }));
}

export async function syncSource(db: DatabaseClient, env: Bindings, sourceId: string): Promise<Record<string, unknown>> {
  const row = await db.fetchrow(
    `
      SELECT id, slug, track, source_type, config, sync_cursor, metadata
      FROM content_sources
      WHERE id = $1
    `,
    sourceId
  );
  if (!row) {
    throw new Error("Source not found.");
  }

  const config = normalizeSourceMapping(coerceJsonValue(row.config));
  const slug = String(row.slug);
  const sourceType = String(row.source_type ?? "");
  if (sourceType !== "youtube") {
    throw new Error(`Manual sync only supported for YouTube sources (got ${sourceType}).`);
  }
  const channelId = String(config.channel_id ?? "").trim();
  if (!channelId) {
    throw new Error("Source is missing channel_id in config.");
  }

  const apiKey = (env.YOUTUBE_API_KEY ?? "").trim();
  if (!apiKey) {
    throw new Error("YOUTUBE_API_KEY is not configured.");
  }

  const maxResults = asInt(config.max_results || 30);
  const allVideoIds: string[] = [];
  let nextPage: string | null = null;

  while (allVideoIds.length < maxResults) {
    const searchUrl = new URL("https://www.googleapis.com/youtube/v3/search");
    searchUrl.searchParams.set("key", apiKey);
    searchUrl.searchParams.set("channelId", channelId);
    searchUrl.searchParams.set("type", "video");
    searchUrl.searchParams.set("part", "snippet");
    searchUrl.searchParams.set("order", "date");
    searchUrl.searchParams.set("maxResults", String(Math.min(maxResults - allVideoIds.length, 50)));
    if (nextPage) {
      searchUrl.searchParams.set("pageToken", nextPage);
    }

    const response = await fetch(searchUrl);
    if (!response.ok) {
      throw new Error(`YouTube search failed: ${response.status}`);
    }
    const payload = await response.json() as any;
    for (const item of Array.isArray(payload.items) ? payload.items : []) {
      const videoId = item?.id?.videoId;
      if (typeof videoId === "string" && !allVideoIds.includes(videoId)) {
        allVideoIds.push(videoId);
      }
    }
    nextPage = payload.nextPageToken ?? null;
    if (!nextPage) {
      break;
    }
  }

  if (allVideoIds.length === 0) {
    return {
      ok: true,
      source_id: sourceId,
      slug,
      videos_discovered: 0,
      jobs_created: 0,
      skipped: 0
    };
  }

  const videosMeta: Array<Record<string, unknown>> = [];
  for (let index = 0; index < allVideoIds.length; index += 50) {
    const batch = allVideoIds.slice(index, index + 50);
    const url = new URL("https://www.googleapis.com/youtube/v3/videos");
    url.searchParams.set("key", apiKey);
    url.searchParams.set("id", batch.join(","));
    url.searchParams.set("part", "snippet,contentDetails,statistics");
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`YouTube videos lookup failed: ${response.status}`);
    }
    const payload = await response.json() as any;
    for (const item of Array.isArray(payload.items) ? payload.items : []) {
      const videoId = String(item.id ?? "");
      const snippet = item.snippet ?? {};
      const stats = item.statistics ?? {};
      const content = item.contentDetails ?? {};
      let duration = 0;
      const match = String(content.duration ?? "").match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
      if (match) {
        duration = asInt(match[1]) * 3600 + asInt(match[2]) * 60 + asInt(match[3]);
      }
      const thumbnails = snippet.thumbnails ?? {};
      let thumbnailUrl: string | null = null;
      for (const key of ["maxres", "standard", "high", "medium", "default"]) {
        if (thumbnails[key]?.url) {
          thumbnailUrl = String(thumbnails[key].url);
          break;
        }
      }
      videosMeta.push({
        source: "youtube",
        source_video_id: videoId,
        video_id: videoId,
        source_url: `https://www.youtube.com/watch?v=${videoId}`,
        video_url: `https://www.youtube.com/watch?v=${videoId}`,
        thumbnail_url: thumbnailUrl,
        title: String(snippet.title ?? ""),
        description: String(snippet.description ?? ""),
        channel_title: snippet.channelTitle ?? null,
        channel_id: snippet.channelId ?? null,
        published_at: snippet.publishedAt ?? null,
        duration_seconds: duration,
        view_count: stats.viewCount == null ? null : asInt(stats.viewCount),
        like_count: stats.likeCount == null ? null : asInt(stats.likeCount)
      });
    }
  }

  let jobsCreated = 0;
  let skipped = 0;
  for (const meta of videosMeta) {
    const videoId = String(meta.source_video_id);
    const exists = await db.fetchval(
      `
        SELECT 1 FROM processing_jobs
        WHERE source_id = $1 AND input_payload->>'source_item_id' = $2
        LIMIT 1
      `,
      sourceId,
      videoId
    );
    if (exists) {
      skipped += 1;
      continue;
    }

    await db.execute(
      `
        INSERT INTO processing_jobs (track, source_id, job_type, status, input_payload)
        VALUES ('unified', $1, 'index_video', 'pending', $2::jsonb)
      `,
      sourceId,
      JSON.stringify({
        track: "unified",
        discovery_track: "unified",
        source_slug: slug,
        source_type: "youtube",
        source_item_id: videoId,
        source: "youtube",
        source_video_id: videoId,
        url: meta.video_url,
        owner_id: null,
        item: meta,
        source_metadata: meta
      })
    );
    jobsCreated += 1;
  }

  const publishedAtValues = videosMeta
    .map((item) => String(item.published_at ?? ""))
    .filter(Boolean)
    .sort();
  const latest = publishedAtValues.at(-1);
  if (latest) {
    await db.execute(
      `
        UPDATE content_sources SET sync_cursor = $1 WHERE id = $2
      `,
      latest,
      sourceId
    );
  }

  return {
    ok: true,
    source_id: sourceId,
    slug,
    videos_discovered: videosMeta.length,
    jobs_created: jobsCreated,
    skipped
  };
}
