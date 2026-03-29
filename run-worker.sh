#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKERS_DIR="${ROOT_DIR}/workers"
WORKERS_VENV="${WORKERS_DIR}/.venv"
ENV_FILE="${CERUL_ENV_FILE:-${ROOT_DIR}/.env}"

# Defaults
CONCURRENCY=""
WORKER_ID=""
POLL_INTERVAL=""

print_help() {
  cat <<'EOF'
Usage: ./run-worker.sh [OPTIONS]

Start the Cerul indexing worker independently from the dev server.

Options:
  -c, --concurrency N   Number of concurrent jobs (default: auto based on CPU)
  -i, --worker-id ID    Custom worker identifier (default: hostname-based)
  -p, --poll-interval S  Polling interval in seconds (default: 5)
  --env-file PATH        Load runtime variables from a specific env file
  -h, --help             Show this help

Examples:
  ./run-worker.sh                     # Start with defaults
  ./run-worker.sh -c 2                # 2 concurrent jobs
  ./run-worker.sh -c 4 -p 10          # 4 concurrent, poll every 10s
  ./run-worker.sh -i my-local-worker  # Custom worker ID
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -c|--concurrency)
      CONCURRENCY="${2:-}"
      shift 2
      ;;
    -i|--worker-id)
      WORKER_ID="${2:-}"
      shift 2
      ;;
    -p|--poll-interval)
      POLL_INTERVAL="${2:-}"
      shift 2
      ;;
    --env-file)
      ENV_FILE="${2:-}"
      shift 2
      ;;
    -h|--help)
      print_help
      exit 0
      ;;
    *)
      echo "[worker] Unknown option: $1" >&2
      print_help
      exit 1
      ;;
  esac
done

# Load env
if [ -f "${ENV_FILE}" ]; then
  set -a
  . "${ENV_FILE}"
  set +a
fi

# Validate
if [ ! -x "${WORKERS_VENV}/bin/python" ]; then
  echo "[worker] Worker virtualenv is missing. Run ./rebuild.sh first." >&2
  exit 1
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "[worker] DATABASE_URL is required. Set it in ${ENV_FILE} or export it." >&2
  exit 1
fi

# Build args — DATABASE_URL is read from the environment by worker.py
# so we do NOT pass --db-url to avoid leaking credentials via `ps`.
ARGS=()

if [ -n "${CONCURRENCY}" ]; then
  ARGS+=("--concurrency" "${CONCURRENCY}")
fi

if [ -n "${WORKER_ID}" ]; then
  ARGS+=("--worker-id" "${WORKER_ID}")
fi

if [ -n "${POLL_INTERVAL}" ]; then
  ARGS+=("--poll-interval" "${POLL_INTERVAL}")
fi

echo "=========================================="
echo "  Cerul Worker"
echo "=========================================="
echo "[worker] env file:     ${ENV_FILE}"
echo "[worker] concurrency:  ${CONCURRENCY:-auto}"
echo "[worker] worker-id:    ${WORKER_ID:-auto}"
echo "[worker] poll-interval: ${POLL_INTERVAL:-5}s"
echo ""

cd "${ROOT_DIR}"
exec "${WORKERS_VENV}/bin/python" -m workers.worker "${ARGS[@]}"
