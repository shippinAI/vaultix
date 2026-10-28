#!/usr/bin/env bash
set -euo pipefail

fail() { printf '%s\n' "$1" >&2; exit 2; }
mode="${1:---push}"
if [[ "$#" -gt 1 ]]; then fail "Usage: publish-github.sh [--check|--push]"; fi
case "$mode" in
  --check|--push) ;;
  --help) printf '%s\n' 'Usage: publish-github.sh [--check|--push]' 'Publish the existing committed main; --check never pushes.'; exit 0 ;;
  *) fail "Usage: publish-github.sh [--check|--push]" ;;
esac

ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
OWNER="${VAULTIX_GH_OWNER:-shippinAI}"
REPO="${VAULTIX_GH_REPO:-vaultix}"
[[ "$OWNER" =~ ^[A-Za-z0-9][A-Za-z0-9-]{0,38}$ ]] || fail "Invalid GitHub owner name."
[[ "$REPO" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$ ]] || fail "Invalid GitHub repository name."
[[ -z "${VAULTIX_FORCE_PUBLISH:-}" ]] || fail "VAULTIX_FORCE_PUBLISH is no longer supported. History must be preserved."
destination="https://github.com/${OWNER}/${REPO}.git"

cd "$ROOT"
command -v git >/dev/null 2>&1 || fail "Git is required."
top="$(git rev-parse --show-toplevel 2>/dev/null)" || fail "Run from the existing Vaultix checkout."
[[ "$(cd "$top" && pwd -P)" == "$ROOT" ]] || fail "The script must belong to the repository root being published."
branch="$(git symbolic-ref --quiet --short HEAD 2>/dev/null)" || fail "Detached HEAD cannot be published. Check out main."
[[ "$branch" == main ]] || fail "Only the existing main branch can be published."
pending="$(git status --porcelain=v1 --untracked-files=normal)" || fail "Cannot verify the checkout state."
[[ -z "$pending" ]] || fail "Commit or preserve pending work before publication; the tree must be clean."
head="$(git rev-parse --verify HEAD)"

origin="$(git config --get-all remote.origin.url || true)"
case "$origin" in
  "$destination"|"https://github.com/${OWNER}/${REPO}"|"git@github.com:${OWNER}/${REPO}.git") ;;
  *) fail "Origin does not match the expected GitHub repository. No destination was changed." ;;
esac
push_url="$(git config --get-all remote.origin.pushurl || true)"
[[ -z "$push_url" || "$push_url" == "$destination" ]] || fail "An alternate origin push URL makes publication ambiguous."
rewrites="$(git config --get-regexp '^url\..*\.(insteadof|pushinsteadof)$' || true)"
[[ -z "$rewrites" ]] || fail "Git URL rewrites must be resolved before publishing to an exact destination."

for path in core/Dockerfile.standalone-vaultix core/Dockerfile.fips.standalone-vaultix .github/workflows/ghcr.yml; do
  git cat-file -e "$head:$path" 2>/dev/null || fail "The committed application is missing $path."
done
if git cat-file -e "$head:compose/vaultix.env" 2>/dev/null; then
  fail "Operator compose/vaultix.env must not be tracked in the publication commit."
fi

remote_refs="$(git ls-remote --exit-code --heads "$destination" refs/heads/main 2>/dev/null)" || fail "Cannot read the existing GitHub main. Check repository access; nothing was created or fetched."
[[ "$remote_refs" =~ ^([a-f0-9]{40}|[a-f0-9]{64})[[:space:]]+refs/heads/main$ ]] || fail "The remote main response is missing or ambiguous."
remote_head="${BASH_REMATCH[1]}"
git cat-file -e "$remote_head^{commit}" 2>/dev/null || fail "Remote main is not available locally. Reconcile history explicitly before publishing."
git merge-base --is-ancestor "$remote_head" "$head" || fail "Remote main is not an ancestor of this commit. Reconcile history without overwriting it."

printf 'Verified committed Vaultix main: %s\n' "$head"
if [[ "$mode" == --check ]]; then
  printf '%s\n' 'Preflight passed; no push or image publication was performed.'
  exit 0
fi

pending="$(git status --porcelain=v1 --untracked-files=normal)" || fail "Cannot verify the checkout state."
[[ "$(git rev-parse HEAD)" == "$head" && -z "$pending" ]] || fail "The checkout changed during preflight. Run publication again after reviewing it."
# Push the checked object, not a branch name that can move during verification.
git push "$destination" "$head:refs/heads/main" || fail "Source push failed. No force push or retry was attempted."
printf 'Published source commit: https://github.com/%s/%s/commit/%s\n' "$OWNER" "$REPO" "$head"
printf 'Verify the GHCR workflow before using an image: https://github.com/%s/%s/actions/workflows/ghcr.yml\n' "$OWNER" "$REPO"
printf '%s\n' 'A source push does not establish a published or deployed container image.'
