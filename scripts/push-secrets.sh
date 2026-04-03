#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env"

if [ -f "$ENV_FILE" ]; then
  set -a
  . "$ENV_FILE"
  set +a
fi

cd "$ROOT_DIR/api"

SECRETS=(
  STRIPE_SECRET_KEY
  STRIPE_WEBHOOK_SECRET
  STRIPE_PRO_PRICE_ID
  RESEND_API_KEY
  EMAIL_FROM
)

for secret in "${SECRETS[@]}"; do
  value="${!secret:-}"
  if [ -z "$value" ]; then
    echo "[push-secrets] Skipping $secret (empty)"
    continue
  fi
  echo "[push-secrets] Setting $secret..."
  echo "$value" | npx wrangler secret put "$secret" --env="" 2>&1 && \
    echo "[push-secrets] ✓ $secret set" || \
    echo "[push-secrets] ✗ $secret failed"
done

echo ""
echo "[push-secrets] Done. Verify with: npx wrangler secret list"
