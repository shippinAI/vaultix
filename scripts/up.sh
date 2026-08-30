#!/bin/bash
# Bring up a Vaultix instance from this repo (self by default).
# The engine is core/ (Infisical renamed). The panel is overlay only.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/compose"
if [ ! -f vaultix.env ]; then
  echo "copy compose/self.env.example or hosted.env.example to compose/vaultix.env and fill keys" >&2
  exit 2
fi

compose() {
  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    docker compose "$@"
    return
  fi
  if command -v podman >/dev/null 2>&1; then
    podman compose "$@"
    return
  fi
  return 127
}

if compose -f vaultix.yml version >/dev/null 2>&1; then
  if [[ "${VAULTIX_PULL:-}" == "1" ]]; then
    compose -f vaultix.yml pull || true
  fi
  if [[ -n "${VAULTIX_ENGINE_IMAGE:-}" || "${VAULTIX_PULL:-}" == "1" ]]; then
    compose -f vaultix.yml up -d
  else
    compose -f vaultix.yml up -d --build
  fi
  echo "Vaultix engine: http://127.0.0.1:8200   (GHCR: ghcr.io/shippinai/vaultix)"
  echo "Vaultix overlay: http://127.0.0.1:8201/viewport/  manager: http://127.0.0.1:8201/manager/"
  echo "First operator:  http://127.0.0.1:8200/admin/signup"
  exit 0
fi
echo "docker/podman compose not found — native core:"
echo "  $ROOT/scripts/run-core.sh"
echo "  (frontend: cd $ROOT/core/frontend && npx vite --host 127.0.0.1 --port 3000 — UI http://127.0.0.1:3000)"
exit 1
