#!/bin/bash
# Run the renamed vaultix engine from core/ without Docker.
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

# Redis for queues. The engine will not start without it.
if ! redis-cli ping >/dev/null 2>&1; then
  mkdir -p /tmp/vaultix-redis
  redis-server --daemonize yes --port 6379 --bind 127.0.0.1 \
    --dir /tmp/vaultix-redis --dbfilename dump.rdb --protected-mode yes
  sleep 0.3
  redis-cli ping >/dev/null
fi

set -a
# shellcheck disable=SC1090
. "$ENVF"
set +a

if [[ ! -d "$CORE/backend/node_modules" ]]; then
  echo "install backend deps with npm 10.9.0 (lockfile is npm-10; npm 11 rejects optional quic-linux-arm)" >&2
  (cd "$CORE/backend" && npx -y npm@10.9.0 ci --no-audit --no-fund)
fi
if [[ ! -d "$CORE/frontend/node_modules" ]]; then
  echo "install frontend deps" >&2
  (cd "$CORE/frontend" && npx -y npm@10.9.0 ci --no-audit --no-fund)
fi

echo "Vaultix core API  http://127.0.0.1:${PORT:-8200}"
echo "Vaultix core UI   http://127.0.0.1:3000"
echo "First operator:   http://127.0.0.1:3000/admin/signup"

cd "$CORE/backend"
exec npx tsx ./src/main.ts --config tsconfig.dev.json
