#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${CERUL_ENV_FILE:-${ROOT_DIR}/.env}"

# shellcheck source=scripts/lib/compose.sh
source "${ROOT_DIR}/scripts/lib/compose.sh"

print_help() {
  cat <<'EOF'
Usage: ./scripts/ensure-local-infra.sh [--env-file PATH]

Options:
  --env-file PATH  Load environment variables from a specific env file
  --help, -h       Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file)
      ENV_FILE="${2:-}"
      shift 2
      ;;
    --help|-h)
      print_help
      exit 0
      ;;
    *)
      echo "[infra] Unknown option: $1" >&2
      print_help
      exit 1
      ;;
  esac
done

if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "[infra] DATABASE_URL is not set; skipping local infrastructure startup."
  exit 0
fi

readarray -t DB_INFO < <(
  python3 - "${DATABASE_URL}" <<'PY'
from urllib.parse import urlparse, unquote
import sys

url = urlparse(sys.argv[1])
host = url.hostname or ""
port = str(url.port or 5432)
user = unquote(url.username or "")
database = (url.path or "/").lstrip("/")
print(host)
print(port)
print(user)
print(database)
PY
)

DB_HOST="${DB_INFO[0]:-}"
DB_PORT="${DB_INFO[1]:-5432}"
DB_USER="${DB_INFO[2]:-}"
DB_NAME="${DB_INFO[3]:-}"

if [[ "${DB_HOST}" != "127.0.0.1" && "${DB_HOST}" != "localhost" ]]; then
  echo "[infra] DATABASE_URL points to ${DB_HOST}; skipping local docker startup."
  exit 0
fi

if [[ "${DB_PORT}" != "54329" ]]; then
  echo "[infra] DATABASE_URL points to local port ${DB_PORT}, not the compose-managed port 54329; skipping docker startup."
  exit 0
fi

set_compose_file "${ROOT_DIR}"
compose_services="$(compose config --services)"

if ! printf '%s\n' "${compose_services}" | grep -Fxq "db"; then
  echo "[infra] ERROR: local compose file does not define a 'db' service." >&2
  exit 1
fi

echo "[infra] Starting local Postgres container..."
compose up -d db

echo "[infra] Waiting for local Postgres to become ready..."
until compose exec -T db pg_isready -U "${DB_USER:-cerul}" -d "${DB_NAME:-cerul}" >/dev/null 2>&1; do
  sleep 1
done

echo "[infra] Local Postgres is ready on ${DB_HOST}:${DB_PORT}."
