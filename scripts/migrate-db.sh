#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS_DIR="${ROOT_DIR}/db/migrations"
ENV_FILE="${ROOT_DIR}/.env"
DATABASE_URL_OVERRIDE=""
FROM_MIGRATION=""
TO_MIGRATION=""
MIGRATION_TABLE="public.schema_migrations"
MIGRATION_NAME_COLUMN=""

print_help() {
  cat <<'EOF'
Usage: ./scripts/migrate-db.sh [options]

Options:
  --database-url URL   Override DATABASE_URL for this run
  --env-file PATH      Load environment variables from a different env file
  --from NAME          Start from a specific migration filename (inclusive)
  --to NAME            Stop at a specific migration filename (inclusive)
  --help, -h           Show this help

Examples:
  ./scripts/migrate-db.sh
  DATABASE_URL='postgresql://...' ./scripts/migrate-db.sh
  ./scripts/migrate-db.sh --from 002_better_auth.sql
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --database-url)
      DATABASE_URL_OVERRIDE="${2:-}"
      shift 2
      ;;
    --env-file)
      ENV_FILE="${2:-}"
      shift 2
      ;;
    --from)
      FROM_MIGRATION="${2:-}"
      shift 2
      ;;
    --to)
      TO_MIGRATION="${2:-}"
      shift 2
      ;;
    --help|-h)
      print_help
      exit 0
      ;;
    *)
      echo "[migrate-db] Unknown option: $1" >&2
      print_help
      exit 1
      ;;
  esac
done

require_command() {
  local name="$1"

  if ! command -v "$name" >/dev/null 2>&1; then
    echo "[migrate-db] Missing required command: ${name}" >&2
    exit 1
  fi
}

compute_checksum() {
  local file_path="$1"

  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "${file_path}" | awk '{print $1}'
    return 0
  fi

  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "${file_path}" | awk '{print $1}'
    return 0
  fi

  if command -v openssl >/dev/null 2>&1; then
    openssl dgst -sha256 -r "${file_path}" | awk '{print $1}'
    return 0
  fi

  echo "[migrate-db] Missing checksum utility (shasum, sha256sum, or openssl)." >&2
  exit 1
}

escape_sql_literal() {
  printf "%s" "$1" | sed "s/'/''/g"
}

load_env() {
  if [[ -n "${ENV_FILE}" && -f "${ENV_FILE}" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "${ENV_FILE}"
    set +a
  fi
}

resolve_database_url() {
  local url=""

  if [[ -n "${DATABASE_URL_OVERRIDE}" ]]; then
    url="${DATABASE_URL_OVERRIDE}"
  elif [[ -n "${DATABASE_URL:-}" ]]; then
    url="${DATABASE_URL}"
  else
    echo "[migrate-db] DATABASE_URL is not set. Provide it in ${ENV_FILE} or use --database-url." >&2
    exit 1
  fi

  # Ensure a connect_timeout is set (Neon serverless can take seconds to wake)
  if [[ "${url}" != *"connect_timeout"* ]]; then
    if [[ "${url}" == *"?"* ]]; then
      url="${url}&connect_timeout=30"
    else
      url="${url}?connect_timeout=30"
    fi
  fi

  printf '%s\n' "${url}"
}

should_include_migration() {
  local migration_name="$1"

  if [[ -n "${FROM_MIGRATION}" && "${migration_name}" < "${FROM_MIGRATION}" ]]; then
    return 1
  fi

  if [[ -n "${TO_MIGRATION}" && "${migration_name}" > "${TO_MIGRATION}" ]]; then
    return 1
  fi

  return 0
}

psql_query() {
  local sql="$1"
  local output
  local attempt

  for attempt in 1 2 3; do
    if output="$(psql "${DATABASE_URL_VALUE}" -Atqc "${sql}" 2>&1)"; then
      printf '%s' "${output}"
      return 0
    fi

    if [[ ${attempt} -lt 3 ]]; then
      echo "[migrate-db] psql query failed (attempt ${attempt}/3), retrying in 2s..." >&2
      sleep 2
    fi
  done

  echo "[migrate-db] psql query failed after 3 attempts: ${output}" >&2
  return 1
}

ensure_migration_table() {
  local table_exists
  table_exists="$(psql_query "SELECT CASE WHEN to_regclass('${MIGRATION_TABLE}') IS NULL THEN 'false' ELSE 'true' END")" || {
    echo "[migrate-db] Failed to check migration table existence." >&2
    exit 1
  }

  if [[ "${table_exists}" != "true" ]]; then
    psql "${DATABASE_URL_VALUE}" -v ON_ERROR_STOP=1 <<SQL >/dev/null
CREATE TABLE ${MIGRATION_TABLE} (
    name TEXT PRIMARY KEY,
    checksum TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
SQL
  fi

  local has_checksum
  has_checksum="$(psql_query "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'schema_migrations' AND column_name = 'checksum')")" || exit 1
  if [[ "${has_checksum}" != "t" ]]; then
    psql "${DATABASE_URL_VALUE}" -v ON_ERROR_STOP=1 -c "ALTER TABLE ${MIGRATION_TABLE} ADD COLUMN checksum TEXT"
  fi

  local has_applied_at
  has_applied_at="$(psql_query "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'schema_migrations' AND column_name = 'applied_at')")" || exit 1
  if [[ "${has_applied_at}" != "t" ]]; then
    psql "${DATABASE_URL_VALUE}" -v ON_ERROR_STOP=1 -c "ALTER TABLE ${MIGRATION_TABLE} ADD COLUMN applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()"
  fi

  local has_name
  has_name="$(psql_query "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'schema_migrations' AND column_name = 'name')")" || exit 1
  if [[ "${has_name}" == "t" ]]; then
    MIGRATION_NAME_COLUMN="name"
    return 0
  fi

  local has_filename
  has_filename="$(psql_query "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'schema_migrations' AND column_name = 'filename')")" || exit 1
  if [[ "${has_filename}" == "t" ]]; then
    MIGRATION_NAME_COLUMN="filename"
    return 0
  fi

  echo "[migrate-db] ${MIGRATION_TABLE} must contain either a 'name' or 'filename' column." >&2
  exit 1
}

get_recorded_checksum() {
  local migration_name="$1"
  local escaped_name
  escaped_name="$(escape_sql_literal "${migration_name}")"

  psql_query "SELECT checksum FROM ${MIGRATION_TABLE} WHERE ${MIGRATION_NAME_COLUMN} = '${escaped_name}'"
}

record_migration() {
  local migration_name="$1"
  local checksum="$2"
  local escaped_name
  local escaped_checksum

  escaped_name="$(escape_sql_literal "${migration_name}")"
  escaped_checksum="$(escape_sql_literal "${checksum}")"

  psql "${DATABASE_URL_VALUE}" -v ON_ERROR_STOP=1 <<SQL >/dev/null
INSERT INTO ${MIGRATION_TABLE} (${MIGRATION_NAME_COLUMN}, checksum)
VALUES ('${escaped_name}', '${escaped_checksum}')
ON CONFLICT (${MIGRATION_NAME_COLUMN})
DO UPDATE SET
    checksum = EXCLUDED.checksum,
    applied_at = NOW();
SQL
}

migration_matches_schema() {
  local migration_name="$1"
  local result=""

  case "${migration_name}" in
    001_initial_schema.sql)
      result="$(psql_query "SELECT CASE WHEN to_regclass('public.user_profiles') IS NULL THEN 'false' ELSE 'true' END")"
      ;;
    002_better_auth.sql)
      result="$(psql_query "SELECT CASE WHEN to_regclass('public.\"user\"') IS NOT NULL AND to_regclass('public.session') IS NOT NULL AND to_regclass('public.account') IS NOT NULL AND to_regclass('public.verification') IS NOT NULL THEN 'true' ELSE 'false' END")"
      ;;
    002_embedding_768.sql)
      result="$(psql_query "SELECT CASE WHEN (SELECT format_type(a.atttypid, a.atttypmod) FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'broll_assets' AND a.attname = 'embedding' AND a.attnum > 0 AND NOT a.attisdropped) = 'vector(768)' AND (SELECT format_type(a.atttypid, a.atttypmod) FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'knowledge_segments' AND a.attname = 'embedding' AND a.attnum > 0 AND NOT a.attisdropped) = 'vector(768)' THEN 'true' ELSE 'false' END")"
      ;;
    003_worker_retry.sql)
      result="$(psql_query "SELECT CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'processing_jobs' AND column_name = 'attempts') AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'processing_jobs' AND column_name = 'max_attempts') AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'processing_jobs' AND column_name = 'locked_by') AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'processing_jobs' AND column_name = 'locked_at') AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'processing_jobs' AND column_name = 'next_retry_at') AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'processing_jobs_status_check' AND pg_get_constraintdef(oid) LIKE '%retrying%') THEN 'true' ELSE 'false' END")"
      ;;
    004_admin_console.sql)
      result="$(psql_query "SELECT CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'user_profiles' AND column_name = 'console_role') AND to_regclass('public.admin_metric_targets') IS NOT NULL THEN 'true' ELSE 'false' END")"
      ;;
    010_hnsw_index.sql)
      local retrieval_units_embedding_type
      retrieval_units_embedding_type="$(psql_query "SELECT format_type(a.atttypid, a.atttypmod) FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'retrieval_units' AND a.attname = 'embedding' AND a.attnum > 0 AND NOT a.attisdropped")"

      if [[ "${retrieval_units_embedding_type}" == "vector(3072)" ]]; then
        if should_include_migration "011_rebuild_retrieval_units_hnsw_index.sql"; then
          result="true"
        else
          result="$(psql_query "SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'retrieval_units' AND indexname = 'idx_retrieval_units_embedding_hnsw' AND indexdef LIKE '%halfvec_cosine_ops%') THEN 'true' ELSE 'false' END")"
        fi
      else
        result="false"
      fi
      ;;
    *)
      result="false"
      ;;
  esac

  [[ "${result}" == "true" ]]
}

load_env
require_command psql

if [[ ! -d "${MIGRATIONS_DIR}" ]]; then
  echo "[migrate-db] Migrations directory not found: ${MIGRATIONS_DIR}" >&2
  exit 1
fi

DATABASE_URL_VALUE="$(resolve_database_url)"

echo "=========================================="
echo "  Cerul Database Migration Runner"
echo "=========================================="
echo "[migrate-db] env file: ${ENV_FILE}"
echo "[migrate-db] migrations: ${MIGRATIONS_DIR}"
echo ""

# Verify database connectivity before proceeding (psql_query retries internally)
psql_query "SELECT 1" >/dev/null || {
  echo "[migrate-db] Cannot connect to database after retries. Check DATABASE_URL and ensure the database is reachable." >&2
  exit 1
}

ensure_migration_table

mapfile -t MIGRATION_FILES < <(find "${MIGRATIONS_DIR}" -maxdepth 1 -type f -name '*.sql' | sort)

if [[ ${#MIGRATION_FILES[@]} -eq 0 ]]; then
  echo "[migrate-db] No migration files found." >&2
  exit 1
fi

APPLIED_COUNT=0
BASELINED_COUNT=0
SKIPPED_COUNT=0

for migration_file in "${MIGRATION_FILES[@]}"; do
  migration_name="$(basename "${migration_file}")"
  migration_checksum="$(compute_checksum "${migration_file}")"
  recorded_checksum="$(get_recorded_checksum "${migration_name}")"

  if ! should_include_migration "${migration_name}"; then
    continue
  fi

  if [[ -n "${recorded_checksum}" ]]; then
    if [[ "${recorded_checksum}" != "${migration_checksum}" ]]; then
      echo "[migrate-db] Refusing to continue: ${migration_name} is recorded with a different checksum." >&2
      echo "[migrate-db] recorded: ${recorded_checksum}" >&2
      echo "[migrate-db] current:  ${migration_checksum}" >&2
      exit 1
    fi

    echo "[migrate-db] Skipping ${migration_name} (already recorded)"
    SKIPPED_COUNT=$((SKIPPED_COUNT + 1))
    continue
  fi

  if migration_matches_schema "${migration_name}"; then
    echo "[migrate-db] Baselining ${migration_name} because the schema already matches."
    record_migration "${migration_name}" "${migration_checksum}"
    BASELINED_COUNT=$((BASELINED_COUNT + 1))
    continue
  fi

  echo "[migrate-db] Applying ${migration_name}"
  psql "${DATABASE_URL_VALUE}" -v ON_ERROR_STOP=1 -f "${migration_file}"
  record_migration "${migration_name}" "${migration_checksum}"
  APPLIED_COUNT=$((APPLIED_COUNT + 1))
done

echo ""
echo "[migrate-db] Completed. Applied ${APPLIED_COUNT} migration(s), baselined ${BASELINED_COUNT}, skipped ${SKIPPED_COUNT}."
