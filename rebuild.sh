#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="${ROOT_DIR}/frontend"
ENV_FILE="${CERUL_ENV_FILE:-${ROOT_DIR}/.env}"
FAST_MODE="false"

print_help() {
  cat <<'EOF'
Usage: ./rebuild.sh [options]

Options:
  --fast, -f       Skip dependency reinstall
  --env-file PATH  Load environment variables from a specific env file
  --help, -h       Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --fast|-f)
      FAST_MODE="true"
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

require_command() {
  local name="$1"

  if ! command -v "${name}" >/dev/null 2>&1; then
    echo "[rebuild] Missing required command: ${name}" >&2
    exit 1
  fi
}

run_frontend_pnpm() {
  if command -v corepack >/dev/null 2>&1; then
    (
      cd "${FRONTEND_DIR}"
      corepack pnpm "$@"
    )
    return 0
  fi

  require_command pnpm
  pnpm --dir "${FRONTEND_DIR}" "$@"
}

load_env_file() {
  local env_file="$1"

  if [[ ! -f "${env_file}" ]]; then
    return 0
  fi

  while IFS= read -r line || [[ -n "${line}" ]]; do
    line="${line%$'\r'}"

    [[ "${line}" =~ ^[[:space:]]*# ]] && continue
    [[ "${line}" =~ ^[[:space:]]*$ ]] && continue
    [[ "${line}" != *=* ]] && continue

    local key="${line%%=*}"
    local value="${line#*=}"

    key="${key#"${key%%[![:space:]]*}"}"
    key="${key%"${key##*[![:space:]]}"}"

    if [[ "${value}" =~ ^\".*\"$ ]] || [[ "${value}" =~ ^\'.*\'$ ]]; then
      value="${value:1:${#value}-2}"
    fi

    export "${key}=${value}"
  done < "${env_file}"
}

load_env_file "${ENV_FILE}"

if [[ "${FAST_MODE}" == "false" ]]; then
  echo "[rebuild] Installing frontend dependencies..."
  run_frontend_pnpm install --frozen-lockfile
fi

echo "[rebuild] Building frontend..."
run_frontend_pnpm build

echo "[rebuild] Starting frontend dev server..."
export CERUL_ENV_FILE="${ENV_FILE}"
exec "${ROOT_DIR}/scripts/dev.sh"
