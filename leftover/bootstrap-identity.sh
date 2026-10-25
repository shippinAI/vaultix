#!/bin/bash
# Bootstrap a Vaultix machine identity (doc 0006 §4).
#
# Creates an identity, attaches universal auth, mints a client secret, and
# (read mode) grants per-project roles. Works against the local core or the
# external source (same wire protocol).
#
# Usage:
#   AUTH_TOKEN=<operator JWT or identity access token> \
#   ./bootstrap-identity.sh read  <base-url> <org-id> <name> <projectId>[,projectId...]
#   ./bootstrap-identity.sh write <base-url> <org-id> <name>
#
# read  = org role no-access + per-project "viewer" role (link identity)
# write = org role admin (local panel identity; can create projects)
#
# The client secret is printed ONCE and never retrievable again. Store it in
# /opt/vaultix/secrets/panel.env (local) or the panel link form (source).
set -euo pipefail

MODE="${1:?mode: read|write}"
BASE="${2:?base url}"
case "$BASE" in
  *vaultix.com*|*github.com/vaultix*|*github.com/vaultix*)
    echo "refused: no connection to a snapshot host" >&2
    exit 2
    ;;
esac
ORG_ID="${3:?organization id}"
NAME="${4:?identity name}"
PROJECTS="${5:-}"
: "${AUTH_TOKEN:?AUTH_TOKEN env var required (operator JWT or identity access token)}"

req() { # method path json-body
  curl -fsS -m 30 -X "$1" "$BASE$2" \
    -H "Authorization: Bearer $AUTH_TOKEN" \
    -H "Content-Type: application/json" \
    ${3:+-d "$3"}
}

case "$MODE" in
  read)  ORG_ROLE="no-access"; [[ -n "$PROJECTS" ]] || { echo "read mode needs project ids" >&2; exit 2; } ;;
  write) ORG_ROLE="admin" ;;
  *) echo "mode must be read or write" >&2; exit 2 ;;
esac

echo "# 1/4 create identity '$NAME' (org role: $ORG_ROLE)"
IDENTITY_ID=$(req POST /api/v1/identities \
  "{\"name\":\"$NAME\",\"organizationId\":\"$ORG_ID\",\"role\":\"$ORG_ROLE\"}" \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['identity']['id'])")
echo "   identityId: $IDENTITY_ID"

echo "# 2/4 attach universal auth (defaults: 30d TTL, unlimited uses, lockout 3/300s)"
CLIENT_ID=$(req POST "/api/v1/auth/universal-auth/identities/$IDENTITY_ID" "{}" \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['identityUniversalAuth']['clientId'])")
echo "   clientId: $CLIENT_ID"

echo "# 3/4 mint client secret (ttl 0 = no expiry, uses 0 = unlimited)"
CLIENT_SECRET=$(req POST "/api/v1/auth/universal-auth/identities/$IDENTITY_ID/client-secrets" \
  "{\"description\":\"vaultix $MODE identity\",\"ttl\":0,\"numUsesLimit\":0}" \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['clientSecret'])")

if [[ "$MODE" == "read" ]]; then
  echo "# 4/4 grant per-project viewer role"
  IFS=',' read -ra PIDS <<< "$PROJECTS"
  for PID in "${PIDS[@]}"; do
    # Built-in role slugs are reserved but not enumerable from source alone;
    # verify "viewer" exists on this instance first (doc 0006 §7).
    req POST "/api/v1/projects/$PID/memberships/identities/$IDENTITY_ID" \
      '{"roles":[{"role":"viewer","isTemporary":false}]}' >/dev/null
    echo "   $PID: viewer"
  done
else
  echo "# 4/4 org admin: no per-project grant needed"
fi

echo "# verify: login as the identity"
req POST /api/v1/auth/universal-auth/login \
  "{\"clientId\":\"$CLIENT_ID\",\"clientSecret\":\"$CLIENT_SECRET\"}" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'   ok: token expires in {d[\"expiresIn\"]}s')"

cat <<EOF

# ---- record these NOW; the secret is not retrievable again ----
CLIENT_ID=$CLIENT_ID
CLIENT_SECRET=$CLIENT_SECRET
# lockout: 3 bad logins locks this identity for 5 min; recover with
#   POST /api/v1/auth/universal-auth/identities/$IDENTITY_ID/clear-lockouts
EOF
