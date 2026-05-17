#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "deploy-railway-backend: missing required command: $1" >&2
    exit 1
  fi
}

require_cmd railway
require_cmd node

echo "==> Syncing env files"
node scripts/sync-env.mjs >/dev/null

if ! railway status >/dev/null 2>&1; then
  echo "deploy-railway-backend: Railway project/service is not linked. Run 'railway link' first." >&2
  exit 1
fi

BACKEND_ENV="$ROOT_DIR/indexspace/backend/.env"
if [[ ! -f "$BACKEND_ENV" ]]; then
  echo "deploy-railway-backend: missing backend env at $BACKEND_ENV" >&2
  exit 1
fi

echo "==> Pushing backend service variables"
while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  [[ "${line:0:1}" == "#" ]] && continue
  if [[ "$line" != *=* ]]; then
    continue
  fi

  key="${line%%=*}"
  value="${line#*=}"

  if [[ "$key" == NEXT_PUBLIC_* ]]; then
    continue
  fi

  if [[ "$key" == "DB_PATH" ]]; then
    value="data/indexspace.db"
  fi

  railway variable set "${key}=${value}" --skip-deploys >/dev/null
done < "$BACKEND_ENV"

echo "==> Setting Railway Dockerfile path"
railway variable set "RAILWAY_DOCKERFILE_PATH=indexspace/backend/Dockerfile" --skip-deploys >/dev/null

echo "==> Deploying backend"
railway up
