#!/usr/bin/env bash

COMPOSE_FILE=""
COMPOSE_CMD=()

set_compose_file() {
  local root_dir="$1"

  if [[ -f "${root_dir}/docker-compose.yml" ]]; then
    COMPOSE_FILE="${root_dir}/docker-compose.yml"
    return 0
  fi

  if [[ -f "${root_dir}/docker-compose.yaml" ]]; then
    COMPOSE_FILE="${root_dir}/docker-compose.yaml"
    return 0
  fi

  echo "[compose] ERROR: no docker compose file found in ${root_dir}." >&2
  return 1
}

resolve_compose_command() {
  if [[ ${#COMPOSE_CMD[@]} -gt 0 ]]; then
    return 0
  fi

  if [[ -z "${COMPOSE_FILE}" ]]; then
    echo "[compose] ERROR: compose file is not set." >&2
    return 1
  fi

  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    COMPOSE_CMD=(docker compose -f "${COMPOSE_FILE}")
    return 0
  fi

  if command -v docker-compose >/dev/null 2>&1; then
    COMPOSE_CMD=(docker-compose -f "${COMPOSE_FILE}")
    return 0
  fi

  echo "[compose] ERROR: neither 'docker compose' nor 'docker-compose' is available." >&2
  return 1
}

compose() {
  resolve_compose_command || return 1
  "${COMPOSE_CMD[@]}" "$@"
}
