#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="${ROOT_DIR}/frontend"
BACKEND_DIR="${ROOT_DIR}/backend"
BACKEND_VENV="${BACKEND_DIR}/.venv"
FAST_MODE="false"

FRONTEND_PORT="${FRONTEND_PORT:-3000}"
BACKEND_PORT="${BACKEND_PORT:-8000}"

print_help() {
  cat <<'EOF'
Usage: ./rebuild.sh [--fast]

Options:
  --fast, -f   Skip dependency reinstall and only clear generated caches before restarting
  --help, -h   Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --fast|-f)
      FAST_MODE="true"
      shift
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

if [ -f "${ROOT_DIR}/.env" ]; then
  set -a
  . "${ROOT_DIR}/.env"
  set +a
  FRONTEND_PORT="${FRONTEND_PORT:-${WEB_PORT:-3000}}"
  BACKEND_PORT="${BACKEND_PORT:-${API_PORT:-8000}}"
fi

require_command() {
  local name="$1"

  if ! command -v "$name" >/dev/null 2>&1; then
    echo "[rebuild] Missing required command: ${name}" >&2
    exit 1
  fi
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
  echo "[clean] Removing frontend generated files..."
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

clean_backend() {
  echo "[clean] Removing backend generated files..."
  find "${BACKEND_DIR}" -type d -name "__pycache__" -prune -exec rm -rf {} +
  find "${BACKEND_DIR}" -type f -name "*.pyc" -delete
  rm -rf "${BACKEND_DIR}/.pytest_cache"
  rm -rf "${BACKEND_DIR}/.mypy_cache"
  rm -rf "${BACKEND_DIR}/.ruff_cache"
  rm -rf "${BACKEND_DIR}/htmlcov"
  rm -f "${BACKEND_DIR}/.coverage"

  if [ "${FAST_MODE}" = "false" ]; then
    rm -rf "${BACKEND_VENV}"
  fi
}

install_frontend() {
  require_command pnpm
  echo "[install] Installing frontend dependencies..."
  pnpm --dir "${FRONTEND_DIR}" install --frozen-lockfile
}

install_backend() {
  require_command python3
  echo "[install] Creating backend virtualenv..."
  python3 -m venv "${BACKEND_VENV}"
  echo "[install] Installing backend dependencies..."
  "${BACKEND_VENV}/bin/python" -m pip install --upgrade pip
  "${BACKEND_VENV}/bin/python" -m pip install -r "${BACKEND_DIR}/requirements.txt"
}

echo "=========================================="
if [ "${FAST_MODE}" = "true" ]; then
  echo "  Cerul - Fast Rebuild"
else
  echo "  Cerul - Clean Rebuild"
fi
echo "=========================================="

kill_port "${FRONTEND_PORT}"
kill_port "${BACKEND_PORT}"
clean_frontend
clean_backend

if [ "${FAST_MODE}" = "false" ]; then
  install_frontend
  install_backend
else
  if [ ! -d "${FRONTEND_DIR}/node_modules" ]; then
    install_frontend
  fi

  if [ ! -x "${BACKEND_VENV}/bin/python" ]; then
    install_backend
  fi
fi

echo ""
echo "[rebuild] Restarting Cerul development environment..."
echo ""

exec "${ROOT_DIR}/scripts/dev.sh"
