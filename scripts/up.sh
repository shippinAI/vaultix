#!/bin/bash
# Bring up the native Vaultix engine from a local build or explicitly selected image.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/compose"
if [ ! -f vaultix.env ]; then
  echo "copy compose/self.env.example to compose/vaultix.env and fill keys" >&2
  exit 2
fi

compose() {
  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    docker compose --env-file vaultix.env "$@"
    return
  fi
  if command -v podman >/dev/null 2>&1; then
    podman compose --env-file vaultix.env "$@"
    return
  fi
  return 127
}

if compose -f vaultix.yml version >/dev/null 2>&1; then
  if [[ "${VAULTIX_PULL:-}" == "1" ]]; then
    compose -f vaultix.yml pull
  fi
  if [[ -n "${VAULTIX_ENGINE_IMAGE:-}" || "${VAULTIX_PULL:-}" == "1" ]]; then
    compose -f vaultix.yml up -d --no-build
  else
    compose -f vaultix.yml up -d --build
  fi
  echo "Vaultix engine: http://127.0.0.1:8200"
  echo "Vaultix UI:     http://127.0.0.1:8200/"
  echo "Clyffy guide:   http://127.0.0.1:8200/api/v1/vaultix/mcp"
  exit 0
fi
echo "docker/podman compose not found — native core:"
echo "  $ROOT/scripts/run-core.sh"
echo "  (frontend: cd $ROOT/core/frontend && npx vite --host 127.0.0.1 --port 3000 — UI http://127.0.0.1:3000)"
exit 1
