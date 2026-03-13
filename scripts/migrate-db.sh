#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS_DIR="${ROOT_DIR}/db/migrations"
ENV_FILE="${ROOT_DIR}/.env"
DATABASE_URL_OVERRIDE=""
FROM_MIGRATION=""
TO_MIGRATION=""

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

load_env() {
  if [[ -n "${ENV_FILE}" && -f "${ENV_FILE}" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "${ENV_FILE}"
    set +a
  fi
}

resolve_database_url() {
  if [[ -n "${DATABASE_URL_OVERRIDE}" ]]; then
    printf '%s\n' "${DATABASE_URL_OVERRIDE}"
    return 0
  fi

  if [[ -n "${DATABASE_URL:-}" ]]; then
    printf '%s\n' "${DATABASE_URL}"
    return 0
  fi

  echo "[migrate-db] DATABASE_URL is not set. Provide it in ${ENV_FILE} or use --database-url." >&2
  exit 1
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

load_env
require_command psql

if [[ ! -d "${MIGRATIONS_DIR}" ]]; then
  echo "[migrate-db] Migrations directory not found: ${MIGRATIONS_DIR}" >&2
  exit 1
fi

DATABASE_URL_VALUE="$(resolve_database_url)"
INITIAL_SCHEMA_PRESENT="$(
  psql "${DATABASE_URL_VALUE}" -Atqc \
    "SELECT CASE WHEN to_regclass('public.user_profiles') IS NULL THEN 'false' ELSE 'true' END"
)"

echo "=========================================="
echo "  Cerul Database Migration Runner"
echo "=========================================="
echo "[migrate-db] env file: ${ENV_FILE}"
echo "[migrate-db] migrations: ${MIGRATIONS_DIR}"
echo ""

mapfile -t MIGRATION_FILES < <(find "${MIGRATIONS_DIR}" -maxdepth 1 -type f -name '*.sql' | sort)

if [[ ${#MIGRATION_FILES[@]} -eq 0 ]]; then
  echo "[migrate-db] No migration files found." >&2
  exit 1
fi

APPLIED_COUNT=0

for migration_file in "${MIGRATION_FILES[@]}"; do
  migration_name="$(basename "${migration_file}")"

  if ! should_include_migration "${migration_name}"; then
    continue
  fi

  if [[ "${migration_name}" == 001_* && "${INITIAL_SCHEMA_PRESENT}" == "true" ]]; then
    echo "[migrate-db] Skipping ${migration_name} because the base schema already exists."
    continue
  fi

  echo "[migrate-db] Applying ${migration_name}"
  psql "${DATABASE_URL_VALUE}" -v ON_ERROR_STOP=1 -f "${migration_file}"
  APPLIED_COUNT=$((APPLIED_COUNT + 1))
done

echo ""
echo "[migrate-db] Completed. Applied ${APPLIED_COUNT} migration(s)."
