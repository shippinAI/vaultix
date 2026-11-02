#!/bin/bash
# Run the Vaultix engine from core/ without Docker.
# Overlay (PIN / Clyffy / manager) is scripts/up.sh → panel, not this process.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CORE="$ROOT/core"
ENVF="$ROOT/run/core.env"

if [[ ! -f "$ENVF" ]]; then
  echo "missing $ENVF — copy keys from compose/self.env.example into run/core.env" >&2
  exit 2
fi

# unixODBC: the engine's odbc native module needs libodbc.so.2 (package unixodbc).
if ! ldconfig -p 2>/dev/null | grep -q 'libodbc.so.2'; then
  echo "libodbc.so.2 missing — install unixodbc (vaultix odbc binding)" >&2
  exit 2
fi

set -a
# shellcheck disable=SC1090
. "$ENVF"
set +a

export VAULTIX_CACHE_PROVIDER="${VAULTIX_CACHE_PROVIDER:-dragonfly}"
echo "Cache provider: $VAULTIX_CACHE_PROVIDER (start your configured cache before the engine)"

if [[ ! -d "$CORE/backend/node_modules" ]]; then
  echo "install backend dependencies using the repository's supported npm version" >&2
  (cd "$CORE/backend" && npm ci --no-audit --no-fund)
fi
if [[ ! -d "$CORE/frontend/node_modules" ]]; then
  echo "install frontend deps" >&2
  (cd "$CORE/frontend" && npm ci --no-audit --no-fund)
fi

echo "Vaultix core API  http://127.0.0.1:${PORT:-8200}"
echo "Vaultix core UI   http://127.0.0.1:3000"
echo "First operator:   http://127.0.0.1:3000/admin/signup"

cd "$CORE/backend"
npm run build:transport
exec npx tsx ./src/main.ts --config tsconfig.dev.json
