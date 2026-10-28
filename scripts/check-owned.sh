#!/bin/bash
# Fail if this tree is still a leftover clone, a toy store, or customer chrome
# still carries the snapshot product brand.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
fail=0
say() { printf '%s\n' "$*"; }
bad() { printf 'FAIL  %s\n' "$*"; fail=1; }
ok()  { printf 'ok    %s\n' "$*"; }

if [[ -d "$ROOT/core/frontend" && -d "$ROOT/core/backend" ]]; then
  ok "core/ is the vaultix MIT pin"
else
  bad "core/ frontend+backend missing — Vaultix is vaultix renamed, not panel/internal/vault"
fi

if [[ -d "$ROOT/core/.git" ]]; then
  bad "core/ contains nested git metadata; do not contact a snapshot remote"
elif grep -q 'v0.162.19' "$ROOT/core/PIN" "$ROOT/core/SHIPPIN.md" 2>/dev/null; then
  ok "core pin v0.162.19 (SHIPPIN.md / PIN; nested .git not published)"
else
  bad "core pin v0.162.19 not recorded"
fi

if grep -q '<title>Vaultix</title>' "$ROOT/core/frontend/index.html"; then
  ok "frontend title Vaultix"
else
  bad "frontend title is not Vaultix"
fi

if grep -q 'Dockerfile.standalone-vaultix' "$ROOT/compose/vaultix.yml" \
   && grep -q 'VAULTIX_ENGINE_IMAGE:-vaultix:local' "$ROOT/compose/vaultix.yml" \
   && ! grep -q 'vaultix/vaultix:' "$ROOT/compose/vaultix.yml"; then
  ok "compose defaults to the local Vaultix canonical build"
else
  bad "compose missing the local canonical image default or points at a leftover image"
fi

if grep -q 'org.opencontainers.image.title="Vaultix"' "$ROOT/core/Dockerfile.standalone-vaultix" \
   && ! grep -q 'artifacts-cli.vaultix.com' "$ROOT/core/Dockerfile.standalone-vaultix" \
   && grep -q 'TELEMETRY_ENABLED false' "$ROOT/core/Dockerfile.standalone-vaultix"; then
  ok "engine image is labelled Vaultix, no leftover CLI, telemetry off"
else
  bad "engine Dockerfile still leftover-labelled, installs leftover CLI, or telemetry on"
fi

if [[ -f "$ROOT/core/Dockerfile.ghcr" ]] \
   && grep -q 'org.opencontainers.image.title="Vaultix"' "$ROOT/core/Dockerfile.ghcr"; then
  ok "GHCR engine Dockerfile.ghcr is labelled Vaultix"
else
  bad "core/Dockerfile.ghcr missing or unlabelled"
fi

if [[ -f "$ROOT/.github/workflows/ghcr.yml" ]] \
   && grep -q 'vaultix-panel' "$ROOT/.github/workflows/ghcr.yml"; then
  ok "GHCR workflow publishes vaultix + vaultix-panel"
else
  bad ".github/workflows/ghcr.yml missing"
fi

if grep -q 'default("")' "$ROOT/core/backend/src/lib/config/env.ts" \
   && grep -q 'LICENSE_SERVER_V2_MODE: z.enum' "$ROOT/core/backend/src/lib/config/env.ts"; then
  if grep -n 'LICENSE_SERVER_V2_MODE' "$ROOT/core/backend/src/lib/config/env.ts" | grep -q 'default("off")'; then
    ok "license server default empty, v2 off"
  else
    bad "LICENSE_SERVER_V2_MODE is not default off"
  fi
else
  bad "LICENSE_SERVER_URL default is not empty"
fi

# Customer chrome: no leftover vendor name in the live UI tree (not stories, not wasm).
hits="$(rg -n --glob '!*.stories.*' --glob '!**/ironrdp-decoder/**' --glob '!**/external-vaultix*' \
  -e '\bvalutix\b' -e 'valutix\.com' -e 'support@valutix' \
  "$ROOT/core/frontend/src" "$ROOT/core/frontend/index.html" 2>/dev/null || true)"
if [[ -n "$hits" ]]; then
  bad "customer chrome still carries the snapshot brand:"
  printf '%s\n' "$hits" | sed 's/^/      /' | head -40
else
  ok "frontend src has no snapshot customer chrome"
fi

for asset in images/vaultix-mark.svg images/vaultix-wordmark.svg images/vaultix-loading.svg images/vaultix-social.png; do
  if [[ ! -s "$ROOT/core/frontend/public/$asset" ]]; then bad "missing authored asset: $asset"; fi
done
for asset in valutix.ico images/biglogo.png images/logotransparent.png images/logotransparent_trimmed.png images/loading/loading.gif lotties/valutix_loading.json lotties/vaultix_loading.json; do
  if [[ -f "$ROOT/core/frontend/public/$asset" ]]; then bad "retired brand artwork still ships: $asset"; fi
done
if rg -n '/images/(logotransparent|gradientLogo|message\.png|loading/loading\.gif)' "$ROOT/core/frontend/src" >/dev/null; then
  bad "live UI still requests retired product artwork"
else
  ok "native UI uses owned Vaultix artwork"
fi

if [[ -f "$ROOT/docs/0015-frozen-no-connection.md" ]]; then
  ok "docs/0015 frozen-no-connection exists"
else
  bad "docs/0015-frozen-no-connection.md missing"
fi

cu="$ROOT/leftover/consider-upstream.sh"
if [[ -f "$cu" ]]; then
  if grep -E 'github.com|https://' "$cu" >/dev/null 2>&1; then
    bad "leftover/consider-upstream.sh still contains a host"
  else
    ok "consider-upstream.sh has no host"
  fi
  if "$cu" >/dev/null 2>&1; then
    bad "consider-upstream.sh must exit 2"
  else
    ok "consider-upstream.sh refuses"
  fi
else
  ok "consider-upstream.sh absent"
fi

hits="$(rg -n 'git clone|git remote add|git fetch' \
  "$ROOT/leftover" --glob '*.sh' 2>/dev/null || true)"
if [[ -n "$hits" ]]; then
  bad "leftover scripts still clone/fetch/remote:"
  printf '%s\n' "$hits" | sed 's/^/      /'
else
  ok "leftover scripts do not clone/fetch/remote"
fi

if [[ -f "$ROOT/panel/internal/vault/engine.go" ]]; then
  ok "panel/internal/vault is overlay/test fallback (not the product engine)"
else
  bad "panel/internal/vault missing (tests still use it as fallback)"
fi

if [[ "$fail" -ne 0 ]]; then
  say "vaultix owned check failed"
  exit 1
fi
say "vaultix owned check passed"
