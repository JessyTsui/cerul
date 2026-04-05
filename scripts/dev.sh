#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_DIR="${ROOT_DIR}/frontend"
ENV_FILE="${CERUL_ENV_FILE:-${ROOT_DIR}/.env}"
FRONTEND_HOST="${FRONTEND_HOST:-127.0.0.1}"
FRONTEND_PORT="${FRONTEND_PORT:-}"

extract_url_authority() {
  local url="$1"
  local authority="${url#*://}"
  printf '%s\n' "${authority%%/*}"
}

extract_url_host() {
  local authority
  authority="$(extract_url_authority "$1")"

  if [[ "${authority}" == \[*\]* ]]; then
    printf '%s]\n' "${authority%%]*}"
    return 0
  fi

  printf '%s\n' "${authority%%:*}"
}

extract_url_port() {
  local authority
  authority="$(extract_url_authority "$1")"

  if [[ "${authority}" == \[*\]*:* ]]; then
    printf '%s\n' "${authority##*:}"
    return 0
  fi

  if [[ "${authority}" == *:* ]]; then
    printf '%s\n' "${authority##*:}"
  fi
}

is_loopback_host() {
  case "$1" in
    localhost|127.0.0.1|::1|"[::1]")
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

port_from_loopback_url() {
  local url="$1"
  local host
  local port

  if [[ -z "${url}" ]]; then
    return 1
  fi

  host="$(extract_url_host "${url}")"
  port="$(extract_url_port "${url}")"

  if ! is_loopback_host "${host}" || [[ -z "${port}" ]]; then
    return 1
  fi

  printf '%s\n' "${port}"
}

require_command() {
  local name="$1"

  if ! command -v "${name}" >/dev/null 2>&1; then
    echo "[dev] Missing required command: ${name}" >&2
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

load_env() {
  load_env_file "${ENV_FILE}"

  if [[ -z "${FRONTEND_PORT}" ]]; then
    FRONTEND_PORT="$(port_from_loopback_url "${NEXT_PUBLIC_SITE_URL:-${WEB_BASE_URL:-}}" || true)"
  fi

  FRONTEND_PORT="${FRONTEND_PORT:-${WEB_PORT:-3000}}"

  export CERUL_ENV="${CERUL_ENV:-development}"
  export DEMO_MODE="${DEMO_MODE:-true}"
  export WEB_BASE_URL="${WEB_BASE_URL:-http://${FRONTEND_HOST}:${FRONTEND_PORT}}"
  export NEXT_PUBLIC_SITE_URL="${NEXT_PUBLIC_SITE_URL:-${WEB_BASE_URL}}"
  export API_BASE_URL="${API_BASE_URL:-${NEXT_PUBLIC_API_BASE_URL:-http://127.0.0.1:8787}}"
  export NEXT_PUBLIC_API_BASE_URL="${NEXT_PUBLIC_API_BASE_URL:-${API_BASE_URL}}"
}

load_env

echo "[dev] Starting Cerul frontend on ${FRONTEND_HOST}:${FRONTEND_PORT}"
run_frontend_pnpm dev --hostname "${FRONTEND_HOST}" --port "${FRONTEND_PORT}"
