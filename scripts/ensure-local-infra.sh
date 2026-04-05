#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${CERUL_ENV_FILE:-${ROOT_DIR}/.env}"

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

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "[infra] DATABASE_URL is not set; nothing to verify."
  exit 0
fi

echo "[infra] cerul no longer starts local backend infrastructure."
echo "[infra] Start Postgres, cerul-api, and cerul-worker from their sibling repositories when full-stack development is needed."
