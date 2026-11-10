# 0117 — Provider import: review, approve, import

Status: implemented 2026-11-09 for Doppler and for instances speaking the Vaultix API
(Infisical Cloud, self-hosted Infisical, another Vaultix). Extends
[0023](0023-capability-convergence.md) and [0026](0026-capability-preservation.md):
provider names stay provider names.

## What it does

A person importing into one Vaultix folder:

1. **Review.** Vaultix reads the source on the server and returns names only:
   `create`, `exists` (left unchanged), `denied` (the actor may not create it there)
   or `unreadable` (the source identity cannot read the value; never imported). The
   review also reports whether the destination path has an approval policy.
2. **Approve.** The person picks exactly which `create` names to bring over.
3. **Import.** Vaultix re-reads both sides. If any approved name is gone from the
   source or now exists in the destination, the whole import is refused with
   `error: "StaleImportReview"` and nothing is written. Otherwise it writes exactly
   the approved names through `secretService.createManySecretsRaw`, so a governed
   path opens a change request instead (`status: "approval-required"`). Direct writes
   are audited as `CREATE_SECRETS`, change requests as `SECRET_APPROVAL_REQUEST`.

Values move from the provider into encrypted storage on the server. No response,
UI state, chat or AI context carries one.

## Contract

`/api/vx/v1/connect/imports`, the Vaultix API ([0119](0119-schema-and-api-namespaces.md)),
signed-in users only:

- `GET /providers?projectId=` — the provider runtime: each provider's usable
  connections (`listAvailableAppConnectionsForUser`), `unavailableReason`, lifecycle.
- `POST /:provider/review` — body `{connectionId, source, target}`.
- `POST /:provider/import` — the same body plus `keys` (1–5000).

These routes first shipped on 2026-11-09 under `/api/v3/external-migration/providers`
and moved on 2026-11-10, before any client outside this repository used them.

`provider` is `doppler` or `external-vaultix` (the existing instance connection:
instance URL plus a machine identity with Universal Auth). Doppler sources are a
project slug and config; instance sources are a project ID, environment slug and
folder path, read with `GET /api/v3/secrets/raw` (shared secrets of one folder,
no imports, references unexpanded). The older `/doppler/*` routes stay for
compatibility; the product UI uses this lifecycle.

## UI

- Secrets overview › Add › Import from: one entry per connected provider and
  "Browse import providers…", which opens the provider cards.
- Provider cards (`components/vaultix/ProviderImportStudio.tsx`) show connection
  status from the runtime, a live read of the first connection, capability and
  lifecycle tooltips, and Connect / Review import. Disabled actions say why.
- `/admin/mcpl` binds the same runtime. Provider action status is resolved from it
  (`resolveMcplActions`), actions without a real destination are disabled, and
  module toggles are a view filter only.

## Evidence and gaps

- `provider-import.test.ts`: planning, de-duplication, stale detection, no values.
- `scripts/test-provider-import-image.mjs` (stage `provider-import` of
  `build-self-hosted`): two instances of the canonical image on a private network.
  A machine identity reads the source; the target reviews, imports exactly the
  approved name with the source value, keeps an existing one, refuses a stale
  import, reports an approval policy and opens a change request without writing, and
  refuses an unknown connection, a mismatched provider and an anonymous call. Every
  response body is checked for source values.
- Not covered: Infisical Cloud or a real Infisical server, Doppler's live API,
  approving and merging the change request, a browser run of the dialog, folder-tree
  (recursive) import, and tags, metadata or references beyond the raw value.
