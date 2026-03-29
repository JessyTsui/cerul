BEGIN;

CREATE TABLE IF NOT EXISTS worker_heartbeats (
    worker_id       TEXT PRIMARY KEY,
    hostname        TEXT NOT NULL,
    pid             INTEGER,
    slots           INTEGER NOT NULL DEFAULT 1,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_heartbeat  TIMESTAMPTZ NOT NULL DEFAULT now(),
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_worker_heartbeats_last
    ON worker_heartbeats (last_heartbeat);

COMMIT;
