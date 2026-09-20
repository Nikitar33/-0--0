#!/usr/bin/env bash
set -euo pipefail

PEER="${1:-phone1}"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required to generate peer config." >&2
  exit 1
fi

cd "$(dirname "$0")/.."

docker compose exec -T wireguard /app/show-peer "$PEER"
