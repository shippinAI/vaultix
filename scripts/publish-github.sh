#!/bin/bash
# Publish this tree to github.com/shippinAI/vaultix (private), same home as Nomen.
# Does not nest core/.git. Does not upload node_modules, run/, leftover dumps, or
# leftover docs screenshots. First push creates the repo if you are an org admin.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OWNER="${VAULTIX_GH_OWNER:-shippinAI}"
REPO="${VAULTIX_GH_REPO:-vaultix}"
# HTTPS + gh credential helper. SSH keys are not assumed on this box.
REMOTE="https://github.com/${OWNER}/${REPO}.git"

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI required" >&2
  exit 2
fi
gh auth setup-git >/dev/null

if ! gh repo view "${OWNER}/${REPO}" >/dev/null 2>&1; then
  echo "creating ${OWNER}/${REPO}"
  gh repo create "${OWNER}/${REPO}" --private --disable-wiki --description "Vaultix - Shippin secrets you own. A SHIPPIN.AI SERVICE. AngryVibes LLC."
fi

STAGE="$(mktemp -d /tmp/vaultix-publish.XXXXXX)"
cleanup() { rm -rf "$STAGE"; }
trap cleanup EXIT

rsync -a --delete \
  --exclude '.git/' \
  --exclude '**/node_modules/' \
  --exclude 'run/' \
  --exclude 'core/.git/' \
  --exclude 'core/.github/' \
  --exclude 'core/docs/images/' \
  --exclude 'core/Dockerfile.standalone-vaultix' \
  --exclude 'core/Dockerfile.fips.standalone-vaultix' \
  --exclude 'leftover/schema-dump/' \
  --exclude 'leftover/api-inventory/__pycache__/' \
  --exclude 'compose/vaultix.env' \
  --exclude 'panel/vaultix' \
  --exclude 'panel/vaultix-panel' \
  --exclude '.chat/' \
  "$ROOT"/ "$STAGE"/

cd "$STAGE"
git init -b main
git add -A
if git diff --cached --quiet; then
  echo "nothing to commit" >&2
  exit 1
fi
git -c user.email="vaultix@shippin.ai" -c user.name="Vaultix publish" \
  commit -m "Vaultix: owned engine + overlay for GHCR (ghcr.io/shippinai/vaultix)"

git remote add origin "$REMOTE"
# First publish. Refuse to overwrite a repo that already has commits unless
# VAULTIX_FORCE_PUBLISH=1.
if git ls-remote --heads origin main 2>/dev/null | grep -q .; then
  if [[ "${VAULTIX_FORCE_PUBLISH:-}" != "1" ]]; then
    echo "${OWNER}/${REPO} already has main. Set VAULTIX_FORCE_PUBLISH=1 to overwrite." >&2
    exit 3
  fi
  git fetch origin main 2>/dev/null || true
  git push --force origin main
else
  git push -u origin main
fi

echo "pushed ${REMOTE}"
echo "GHCR: Actions → GHCR  →  ghcr.io/shippinai/vaultix  and  ghcr.io/shippinai/vaultix-panel"
