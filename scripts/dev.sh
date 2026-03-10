#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_DIR="${ROOT_DIR}/frontend"
BACKEND_DIR="${ROOT_DIR}/backend"
BACKEND_VENV="${BACKEND_DIR}/.venv"

FRONTEND_HOST="${FRONTEND_HOST:-127.0.0.1}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"
BACKEND_HOST="${BACKEND_HOST:-127.0.0.1}"
BACKEND_PORT="${BACKEND_PORT:-8000}"

load_env() {
  if [ -f "${ROOT_DIR}/.env" ]; then
    set -a
    . "${ROOT_DIR}/.env"
    set +a
  fi

  export NEXT_PUBLIC_SITE_URL="${NEXT_PUBLIC_SITE_URL:-${WEB_BASE_URL:-http://${FRONTEND_HOST}:${FRONTEND_PORT}}}"
  export NEXT_PUBLIC_API_BASE_URL="${NEXT_PUBLIC_API_BASE_URL:-${API_BASE_URL:-http://${BACKEND_HOST}:${BACKEND_PORT}}}"
}

require_command() {
  local name="$1"

  if ! command -v "$name" >/dev/null 2>&1; then
    echo "[dev] Missing required command: ${name}" >&2
    exit 1
  fi
}

cleanup() {
  if [ -n "${FRONTEND_PID:-}" ] && kill -0 "${FRONTEND_PID}" >/dev/null 2>&1; then
    kill "${FRONTEND_PID}" >/dev/null 2>&1 || true
  fi

  if [ -n "${BACKEND_PID:-}" ] && kill -0 "${BACKEND_PID}" >/dev/null 2>&1; then
    kill "${BACKEND_PID}" >/dev/null 2>&1 || true
  fi
}

start_backend() {
  if [ ! -x "${BACKEND_VENV}/bin/python" ]; then
    echo "[dev] Backend virtualenv is missing. Run ./rebuild.sh first." >&2
    exit 1
  fi

  (
    cd "${BACKEND_DIR}"
    exec "${BACKEND_VENV}/bin/python" -m uvicorn app.main:app \
      --reload \
      --host "${BACKEND_HOST}" \
      --port "${BACKEND_PORT}"
  ) &
  BACKEND_PID=$!
}

start_frontend() {
  (
    cd "${ROOT_DIR}"
    exec pnpm --dir frontend dev --hostname "${FRONTEND_HOST}" --port "${FRONTEND_PORT}"
  ) &
  FRONTEND_PID=$!
}

watch_processes() {
  while true; do
    if ! kill -0 "${BACKEND_PID}" >/dev/null 2>&1; then
      wait "${BACKEND_PID}"
      return $?
    fi

    if ! kill -0 "${FRONTEND_PID}" >/dev/null 2>&1; then
      wait "${FRONTEND_PID}"
      return $?
    fi

    sleep 1
  done
}

load_env
require_command pnpm
require_command python3

echo "=========================================="
echo "  Cerul Development Environment"
echo "=========================================="
echo "[dev] frontend: http://${FRONTEND_HOST}:${FRONTEND_PORT}"
echo "[dev] backend:  http://${BACKEND_HOST}:${BACKEND_PORT}"
echo ""

trap cleanup EXIT INT TERM

start_backend
start_frontend
watch_processes
