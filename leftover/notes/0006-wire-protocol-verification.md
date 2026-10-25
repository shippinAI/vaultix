# 0006 — Wire protocol verified against source; bootstrap; smoke runbook

**Status:** historical (2026-08-29). Leftover wire notes for one-way import
only. Live store is `vaultix_*` (doc 0011).
**Owner:** AngryVibes LLC. **Host:** shippin.ai. **Product:** Vaultix.
**Method:** three parallel source-research passes over the pinned upstream
tree (v0.162.19, sparse scratchpad checkout) reading the actual Fastify/zod
route schemas, plus live `/api/status` checks. No credentials used; the
`consider-upstream.sh` gate untouched.

## 1. What verification changed

The first panel client was written from API convention. Source verification
found and fixed:

| Assumption | Reality (source) | Action |
|---|---|---|
| `/api/v1/workspace`, `/api/v3/secrets` are the API | Both live in files upstream literally names `deprecated-*`; modern surface is `/api/v1/projects` + `/api/v4/secrets` | `wire.go` moved to the non-deprecated surface |
| Project create takes `organizationId` | No such field exists; org comes from the identity's token; unknown fields silently ignored | Field and `VAULTIX_LOCAL_ORG_ID` removed |
| Create-project response `{project}` | Confirmed — but the *deprecated* v2 route also returns `{project}` despite its `/workspace` path | n/a (was correct by luck) |
| Project GET returns the project | Envelope key is `.optional()` — a 200 can be `{}` | Client errors on missing key |
| Write success = HTTP 200 | 200 is a **union**: `{secret(s)}` applied or `{approval}` held by a protection policy — not written | Client returns `ErrApprovalRequired`; importer surfaces it; test covers it |
| Listed values are real values | `secretValueHidden: true` means a placeholder the identity may not read | Importer refuses the env rather than import placeholders; test covers it |
| Boolean query params are booleans | They are string enums (`"true"`/`"false"`); a real boolean is a 400 | Client sends literals; fake enforces it |
| Import = N single upserts | `POST/PATCH /api/v4/secrets/batch` exist; arrays uncapped in zod but bounded by the ~1 MB Fastify body limit | Importer batches, chunked at 100 items / 512 KB |
| List can be paged | **No pagination exists**; `recursive=true` returns the whole tree in one payload | Documented; partition by path if an estate outgrows this |

Independent check: every path now in `wire.go` is a source-verified core row
in `schemas/upstream.core.v0.162.19.endpoints.tsv`, enforced by
`panel/alignment_test.go`.

## 2. Token + lockout facts the client encodes

- Universal-auth login: `{clientId, clientSecret}` → flat
  `{accessToken, expiresIn, accessTokenMaxTTL, tokenType:"Bearer"}`.
  Defaults: TTL 30 days; `accessTokenNumUsesLimit` 0 (unlimited).
  The client tracks `expiresIn` and re-logins inside a minute of expiry.
- `POST /api/v1/auth/token/renew` exists (token in body) but is capped by
  `accessTokenMaxTTL`; fresh login avoids the ceiling — our runs are short.
- **Lockout defaults on**: 3 bad logins → 5-minute lock
  (`.../clear-lockouts` to recover). The client never retry-loops a login.
- Rate limits: secret reads and writes share one `secretsLimit` bucket;
  batch spends one token per call instead of N — another reason to batch.
  Buckets are super-admin tunable on self-host (`PUT /api/v1/rate-limit`).

## 3. Identity bootstrap (from source; script: `scripts/bootstrap-identity.sh`)

Read-only link identity (source side) and write identity (local side):

| # | Call | Notes |
|---|---|---|
| 1 | `POST /api/v1/identities` `{name, organizationId, role}` | `role`: `no-access` (read case) / `admin` (write case). Default is `no-access` — fail-safe |
| 2 | `POST /api/v1/auth/universal-auth/identities/{id}` `{}` | all fields defaulted; response carries `clientId` |
| 3 | `POST .../{id}/client-secrets` `{description, ttl:0, numUsesLimit:0}` | **plaintext `clientSecret` appears only in this response** |
| 4 | `POST /api/v1/projects/{projectId}/memberships/identities/{id}` `{"roles":[{"role":"viewer","isTemporary":false}]}` | read case, per project. Omitting `roles` silently grants `no-access` — always send it |
| 5 | `POST /api/v1/auth/universal-auth/login` | unauthenticated by design; verifies the credential |

Fully unattended path for fresh instances: `POST /api/v1/admin/bootstrap`
`{email, password, organization}` (unauthenticated, works once) returns an
admin **identity token** usable for steps 1–4 — no human web login needed.

## 4. Live-instance findings (2026-08-19)

- `inviteOnlySignup: true` — signup lock confirmed done.
- **`emailConfigured: false`** — SMTP is not wired. Doc 0004's PIN-reset
  ("Authentik re-auth + email confirm") has a dead email leg, and instance
  invites cannot send. Either configure SMTP in
  `/opt/vaultix/secrets/backend.env` or amend 0004 to drop the email step
  during beta. Decision open.
- `maxIdentityAccessTokenTTL: 7776000` (90 d) — instance ceiling on TTLs.

## 5. Smoke runbook (needs credentials; ~5 minutes)

On the Zuul host (or anywhere that reaches both cores):

```bash
# 0. one-time: operator JWT from https://vaultix.shippin.cloud web login
#    (or the /api/v1/admin/bootstrap identity token on a fresh instance)

# 1. local write identity
AUTH_TOKEN=<jwt> ./scripts/bootstrap-identity.sh write \
    https://vaultix.shippin.cloud <orgId> vaultix-panel
#    -> CLIENT_ID/CLIENT_SECRET into /opt/vaultix/secrets/panel.env
#       as VAULTIX_LOCAL_CLIENT_ID / VAULTIX_LOCAL_CLIENT_SECRET

# 2. cloud read identity (app.vaultix.com, same wire protocol)
AUTH_TOKEN=<cloud jwt> ./scripts/bootstrap-identity.sh read \
    https://app.vaultix.com <cloudOrgId> vaultix-link <cloudProjectId>
#    NOTE: first verify the "viewer" role slug exists:
#    GET /api/v1/projects/<cloudProjectId>/roles

# 3. deploy panel, then end-to-end through the panel API:
curl -fsS localhost:8201/api/v1/vaultix/health
#    set PIN -> stepup -> POST /link (cloud clientId/secret + mappings)
#    -> POST /import -> report shows envsImported + secretsWritten,
#       and the values appear in the local instance UI
```

Pass criteria: link returns 201 (credential verified against the cloud
before storage), import report has no `envsFailed`, spot-check one secret
value in the local UI, and the source org's audit log shows only reads.

## 6. Open items

1. **`viewer` role slug**: built-in and reserved per source, but the enum's
   literal strings live in `db/schemas` (not in the sparse checkout).
   Verify via `GET /api/v1/projects/{id}/roles` before the first read grant
   (step in runbook).
2. **Folder auto-creation**: whether a batch write to a not-yet-existing
   `secretPath` creates the folder or 404s is service-layer behavior we
   could not read. Import groups by path and reports per-path errors, so a
   failure is contained and named; verify on first real import with folders.
3. **Value trimming fidelity**: upstream write schemas `.trim()` secret
   values (single trailing newline preserved). Values with leading/trailing
   whitespace do not survive any vaultix-API migration byte-identical —
   upstream behavior, worth one line in the migration copy.
4. **Devstation script**: `/usr/local/bin/warden-vaultix-bootstrap` is
   unreachable from this sandbox; diff it against
   `scripts/bootstrap-identity.sh` when on the devstation.
5. **SMTP decision** (§4) — configure or amend doc 0004.
