#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="${ROOT_DIR}/frontend"
API_DIR="${ROOT_DIR}/api"
WORKERS_DIR="${ROOT_DIR}/workers"
WORKERS_VENV="${WORKERS_DIR}/.venv"
FAST_MODE="false"
SKIP_MIGRATIONS="true"
ENV_FILE="${CERUL_ENV_FILE:-${ROOT_DIR}/.env}"

FRONTEND_PORT="${FRONTEND_PORT:-}"
API_PORT="${API_PORT:-}"

print_help() {
  cat <<'EOF'
Usage: ./rebuild.sh [--fast]

Options:
  --fast, -f   Skip dependency reinstall and only clear generated caches before restarting
  --migrate      Run database migrations before starting (skipped by default)
  --env-file PATH  Load runtime variables from a specific env file
  --help, -h   Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --fast|-f)
      FAST_MODE="true"
      shift
      ;;
    --migrate)
      SKIP_MIGRATIONS="false"
      shift
      ;;
    --env-file)
      ENV_FILE="${2:-}"
      shift 2
      ;;
    --help|-h)
      print_help
      exit 0
      ;;
    *)
      echo "[rebuild] Unknown option: $1" >&2
      print_help
      exit 1
      ;;
  esac
done

if [ -f "${ENV_FILE}" ]; then
  set -a
  . "${ENV_FILE}"
  set +a
fi

FRONTEND_PORT="${FRONTEND_PORT:-${WEB_PORT:-3000}}"
API_PORT="${API_PORT:-8787}"

require_command() {
  local name="$1"

  if ! command -v "$name" >/dev/null 2>&1; then
    echo "[rebuild] Missing required command: ${name}" >&2
    exit 1
  fi
}

require_frontend_package_manager() {
  if command -v corepack >/dev/null 2>&1; then
    return 0
  fi

  require_command pnpm
}

run_frontend_pnpm() {
  if command -v corepack >/dev/null 2>&1; then
    (
      cd "${FRONTEND_DIR}"
      corepack pnpm "$@"
    )
    return
  fi

  pnpm --dir "${FRONTEND_DIR}" "$@"
}

run_api_npm() {
  (
    cd "${API_DIR}"
    npm "$@"
  )
}

kill_port() {
  local port="$1"

  if ! command -v lsof >/dev/null 2>&1; then
    echo "[rebuild] lsof is unavailable; skipping port ${port} cleanup."
    return 0
  fi

  local pids
  pids="$(lsof -tiTCP:"${port}" -sTCP:LISTEN || true)"

  if [ -z "${pids}" ]; then
    return 0
  fi

  echo "[rebuild] Releasing port ${port} (${pids})"

  for pid in ${pids}; do
    kill "${pid}" >/dev/null 2>&1 || true
  done

  sleep 1

  for pid in ${pids}; do
    if kill -0 "${pid}" >/dev/null 2>&1; then
      kill -9 "${pid}" >/dev/null 2>&1 || true
    fi
  done
}

clean_frontend() {
  rm -rf "${FRONTEND_DIR}/.next"
  rm -rf "${FRONTEND_DIR}/coverage"
  rm -rf "${FRONTEND_DIR}/dist"
  rm -rf "${FRONTEND_DIR}/.turbo"
  rm -rf "${FRONTEND_DIR}/.vercel"
  rm -f "${FRONTEND_DIR}/tsconfig.tsbuildinfo"

  if [ "${FAST_MODE}" = "false" ]; then
    rm -rf "${FRONTEND_DIR}/node_modules"
  fi
}

clean_api() {
  rm -rf "${API_DIR}/.wrangler"

  if [ "${FAST_MODE}" = "false" ]; then
    rm -rf "${API_DIR}/node_modules"
  fi
}

clean_workers() {
  find "${WORKERS_DIR}" -type d -name "__pycache__" -prune -exec rm -rf {} +
  find "${WORKERS_DIR}" -type f -name "*.pyc" -delete
  rm -rf "${WORKERS_DIR}/.pytest_cache"
  rm -rf "${WORKERS_DIR}/.mypy_cache"
  rm -rf "${WORKERS_DIR}/.ruff_cache"

  if [ "${FAST_MODE}" = "false" ]; then
    rm -rf "${WORKERS_VENV}"
  fi
}

install_frontend() {
  require_frontend_package_manager
  echo "[install] Installing frontend dependencies..."
  run_frontend_pnpm install --frozen-lockfile
}

install_api() {
  require_command npm
  echo "[install] Installing API dependencies..."
  run_api_npm ci
}

install_workers() {
  require_command python3
  echo "[install] Creating worker virtualenv..."
  python3 -m venv "${WORKERS_VENV}"
  echo "[install] Installing worker dependencies..."
  "${WORKERS_VENV}/bin/python" -m pip install --upgrade pip
  "${WORKERS_VENV}/bin/python" -m pip install -r "${WORKERS_DIR}/requirements.txt"
}

run_migrations() {
  if [ "${SKIP_MIGRATIONS}" = "true" ]; then
    return 0
  fi

  if [ ! -x "${ROOT_DIR}/scripts/migrate-db.sh" ]; then
    echo "[rebuild] Migration runner is missing or not executable." >&2
    exit 1
  fi

  if [ -z "${DATABASE_URL:-}" ]; then
    echo "[rebuild] DATABASE_URL is not set; skipping migrations."
    return 0
  fi

  echo "[rebuild] Applying database migrations..."
  "${ROOT_DIR}/scripts/migrate-db.sh" --env-file "${ENV_FILE}"

  if [ -f "${ROOT_DIR}/scripts/seed-sources.sql" ]; then
    echo "[rebuild] Seeding content sources..."
    psql "${DATABASE_URL}" -f "${ROOT_DIR}/scripts/seed-sources.sql" 2>/dev/null || \
      echo "[rebuild] Content source seeding skipped (non-fatal)."
  fi
}

ensure_local_infra() {
  if [ ! -x "${ROOT_DIR}/scripts/ensure-local-infra.sh" ]; then
    echo "[rebuild] Local infrastructure helper is missing or not executable." >&2
    exit 1
  fi

  "${ROOT_DIR}/scripts/ensure-local-infra.sh" --env-file "${ENV_FILE}"
}

echo "=========================================="
if [ "${FAST_MODE}" = "true" ]; then
  echo "  Cerul - Fast Rebuild"
else
  echo "  Cerul - Clean Rebuild"
fi
echo "=========================================="
echo "[rebuild] env file: ${ENV_FILE}"

kill_port "${FRONTEND_PORT}"
kill_port "${API_PORT}"
echo "[clean] Clearing generated files..."
clean_frontend
clean_api
clean_workers

if [ "${FAST_MODE}" = "false" ]; then
  install_frontend
  install_api
  install_workers
else
  if [ ! -d "${FRONTEND_DIR}/node_modules" ]; then
    install_frontend
  fi

  if [ ! -d "${API_DIR}/node_modules" ]; then
    install_api
  fi

  if [ ! -x "${WORKERS_VENV}/bin/python" ]; then
    install_workers
  fi
fi

ensure_local_infra
run_migrations

echo ""
echo "[rebuild] Restarting Cerul development environment..."
echo ""

export CERUL_ENV_FILE="${ENV_FILE}"
export CERUL_LOCAL_INFRA_READY="1"
exec "${ROOT_DIR}/scripts/dev.sh"
