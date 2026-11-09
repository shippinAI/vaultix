# Vaultix action plan

Repository copy of the execution plan. Package 01 remains partial: raw-route denial is unit-verified, and client or image gates are open. Package 02 keeps both auth modes. Headless `--token` and `--universal` do not use Nomen. Interactive terminal SSO stays the existing client and is config-driven through `NOMEN_OIDC_ISSUER`; self-hosted core does not require it. The enterprise and hosting panel stays a separate surface. Package 04 has `$all` reference parity and leaves the public route on TypeScript. Detail is in `docs/0117-assistant-reference-boundary.md`.


Commit: `eb61496c` (`eb61496c8483692506813567712c9fece3101cac`). `git status -sb` showed `main...origin/main` with no ahead/behind against the local origin ref. This pass did not fetch, so a newer remote commit is unverified. The audit file `vaultix-roadmap-audit.md` describes this same commit. No repository files were edited. No pull request, deploy, or live write is authorized.

Traceability: `vaultix-traceability.md` and `vaultix-traceability.json`. Naming: `vaultix-naming-proposal.md`.

## Coverage

| Set | Mapped | Unmapped |
| --- | ---: | ---: |
| Audit rows | 584 | 0 |
| Roadmap obligations from that audit | 310 | 0 |
| Evidence rows (112 plan documents, 154 TODO/FIXME markers, 8 live checks) | 274 | 0 |

The 310 obligations split into 202 deliverables, 97 rollups, 6 merges, and 5 external items. Rollups, merges, documents, and TODO comments are not second implementations. Two package tasks, `cli.stdio-mcp` and `sec.raw-compat`, are implementation splits of package 01. They have no audit id of their own.

Canonical workstreams, in dependency order, use the ids in `docs/migration/workstreams.json`:

`foundation`, `identity`, `authorization`, `ui`, `secrets`, `ai`, `delivery`, `cli`, `automation`, `integrations`, `audit`, `kms`, `pki`, `pam`, `scanning`, `legacy-panel`, `intake`.

There are 17 workstreams, 57 tasks, and 13 packages. Counts are row mappings, not percent complete.

## Current architecture

Vaultix is a multi-tenant secrets manager. The running product is the TypeScript API and React UI in `core/`, built by `core/Dockerfile.standalone-vaultix`, with PostgreSQL and Dragonfly. `https://vaultix.cloud` answered read-only checks on 2026-11-08: invite-only, mail off, core MCP present, `GET /api/v1/vaultix/auth/config` missing, panel trust and health missing. The deployed git revision was not identifiable.

Go code in `core/backend-go` is a partial rewrite. The public process does not forward business routes to it. The CLI in `cmd/vaultix` and `internal/` can read and write secret values through `/api/v3/secrets/raw`. Core MCP cannot. The optional panel has a different MCP.

## Proposed architecture

Keep one encrypted store and one product MCP. TypeScript remains the owner of a route until a package proves the Go owner and switches that route only. Built-in identity works without Nomen. Federation, including Nomen, is optional. Assistants receive names and catalog text. Values go to an application process through the CLI inject path, not through the model. The panel stays an overlay until `panel.retire`. Mesh stays held.

Public cloud gates in `docs/0054` stay open until their own image receipts exist. The hostname being up does not close them.

## Non-goals

- A second secrets store, table-prefix isolation, or an import of `leftover/`.
- Panel `vaultix.source.act` as the assistant API.
- Secret-changing MCP tools before `sec.lifecycle`, `authz.approvals`, and `cli.inject`.
- Changing the built-in Viewer role inside package 01.
- Mesh runtime work.
- Publishing a Cursor or Grok plugin from this repository.
- Claiming image acceptance from missing `.cache` files.
- A completion percentage.

## Packages

Packages are the PR-sized batches. Later PRs stack on earlier ones. A package is planned until its exit checks pass on a recorded commit.

| Order | Package | Tasks | Depends on |
| --- | --- | --- | --- |
| 1 | `pkg.01-reference-boundary` | `authz.assistant-role`, `sec.raw-compat`, `ai.core-mcp-boundary`, `ai.client-connection`, `fnd.contract-session`, `cli.stdio-mcp` | none |
| 2 | `pkg.02-identity-discovery` | `id.preserve-builtin`, `id.discovery`, `ui.entry-setup` | package 01 does not block it; do not regress the MCP tests |
| 3 | `pkg.03-device-login` | `id.device-login`, `id.federation`, `cli.builtin-login` | package 02 |
| 4 | `pkg.04-go-read-cutover` | `sec.reference-reads`, `authz.permission-parity` | package 01 |
| 5 | `pkg.05-secret-lifecycle` | `sec.lifecycle`, `authz.approvals`, `authz.assume`, `ai.mutations-hold` | package 04 |
| 6 | `pkg.06-inject` | `cli.local-cache`, `cli.inject` | package 05 |
| 7 | `pkg.07-cloud-recovery` | `del.image-harness`, `del.encrypted-recovery`, `del.operations`, `id.recovery`, `del.user-lifecycle`, `authz.tenant`, `del.tenant-fairness`, `del.capacity` | Docker, and Jesse's exposure decision before any public change |
| 8 | `pkg.08-releases` | `fnd.acceptance-runner`, `del.signed-release`, `del.ha-upgrade`, `ai.client-proof` | packages 03, 06, and 07 |
| 9 | `pkg.09-ui` | `ui.workflows`, `ui.a11y`, `ui.teaching`, `ui.gov-mfa`, `ai.visible-assist` | packages 02 and 05 |
| 10 | `pkg.10-automation` | `auto.rotation`, `auto.leases`, `auto.queues`, `int.connections`, `int.providers`, `del.queue-durability` | package 05 and `aud.outbox` may start its schema inside package 11's first slice if a write needs an audit row |
| 11 | `pkg.11-trust-services` | `aud.outbox`, `aud.export`, `kms.custody`, `pki.lifecycle`, `pam.sessions`, `scan.detectors`, `del.devscif-profile` | package 05. DevSCIF profile is last in this package |
| 12 | `pkg.12-panel` | `panel.boundary`, `panel.retire` | package 01 now for the boundary; retire waits for packages 06 and 08 |
| 13 | `pkg.13-authorship` | `fnd.catalog-pipeline`, `fnd.doc-aliases`, `intake.authorship`, `intake.markers`, `intake.mesh-hold` | catalog regeneration can be its own small PR at any time; it must not be mixed with product behavior |

`SECURITY-01` is one rollup under `kms.custody`. It also needs `pki.lifecycle`, `pam.sessions`, `scan.detectors`, and `id.federation`. It is not five extra copies.

## First package: `pkg.01-reference-boundary`

Goal: an assistant can use the core connector with a credential that lists secret names and cannot read values. The public login, Go cutover, image cloud gates, and plugin catalog are out of this package.

### Files to touch

| Path | Change |
| --- | --- |
| `core/backend/src/ee/services/permission/` | Test a custom role that grants `secrets:describeSecret` and does not grant `secrets:readValue`. Do not edit the Viewer rule set |
| `core/backend/src/server/routes/v3/deprecated-secret-router.ts` and the raw service it calls | Assert that role is denied. Response body has no `secretValue` |
| `core/backend/src/services/vaultix/reference-service.ts` | Same role can list references. Payload fields stay id, name, version, createdAt, updatedAt |
| `core/backend/src/server/routes/vaultix-router.ts` | No new tools. Session behavior either documented or narrowed to match the contract |
| `core/backend/src/services/vaultix/catalog.ts` and `mcp.ts` | Connection text names core HTTP and `vaultix mcp`. It says the panel MCP is not the connector |
| `contracts/vaultix.core.v1.json` | One sentence for when a session id exists |
| `core/ai/README.md`, `core/ai/clyffy/SKILL.md` | Same boundary. No token samples |
| `internal/cli/mcp.go`, `internal/api/mcp.go`, `internal/api/secrets.go` | Stdio proxy unchanged in behavior. A test shows the raw client is a different call from MCP |

### Pass

All of these are true on one commit:

1. A fixture actor with only `describeSecret` calls `vaultix.secrets.references` and receives names. The same actor calls `GET /api/v3/secrets/raw` for that project and is denied. The denial body does not contain the planted value.
2. An actor with neither describe nor read is denied on both the MCP reference tools and the raw GET.
3. Anonymous `tools/list` returns exactly `vaultix.guidance.get`, `vaultix.catalog.get`, `vaultix.configure.show`, `vaultix.connections.get`, `vaultix.specialist.instructions`, and `vaultix.learning.profile.get`.
4. A planted value, comment, and custom metadata string are absent from the reference JSON.
5. The contract and the router agree about sessions. A unit test fails if they diverge.
6. Tool annotations for the eight tools stay read-only. No new tool name appears.
7. `cd core/backend && npm run test:unit -- src/services/vaultix src/server/routes/vaultix-router.test.ts src/server/routes/vaultix-reference-router.test.ts` passes, including the new denial test.
8. `cd core/backend && node --max-old-space-size=6144 ./node_modules/.bin/tsc --noEmit` passes.
9. `go test ./internal/api ./internal/cli` passes.
10. The connection paragraph tells a Grok or other MCP client to use `POST /api/v1/vaultix/mcp` or stdio `vaultix mcp`, and to keep the bearer in the host secret store or the CLI credential file.

### Fail

- Any of the commands above fails, is skipped, or is replaced by a missing `.cache` receipt.
- The test uses a Viewer, admin, or owner token as the assistant example.
- Viewer rules change in this package.
- A secret value, token, or connection string is added to a doc or skill.
- The panel tool list is documented as the connector.
- The package claims `IDENTITY-02`, CLOUD gates, or a published plugin.

### Completion evidence

A short receipt in the PR: commit, commands, pass counts, and the sentence "Viewer unchanged; describe-only fixture denied on raw read." No screenshot of a secret. No live write to vaultix.cloud.

## Test environment

| Need | Used by | Audit result on this machine |
| --- | --- | --- |
| Node 22 and npm `>=11.10.0` | Backend and frontend | npm 11.10.0 installed outside the repo. System npm 10.9.9 is too old for `engines` |
| `cd core/backend && npm ci` and frontend `npm ci` | Unit, lint, typecheck, build | Both installs passed |
| Backend unit tests | Package 01 | 2208 passed, 23 skipped, 1 file skipped. The skipped file name was not in the dot report |
| Backend `tsc` with a 6 GB heap | Package 01 | Passed |
| Frontend `tsc` and `npm run build` | UI packages | Passed only with an 8 GB heap. Default heap aborted, exit 134 |
| Frontend and backend `npm run lint` | Any UI or API PR | Failed. Frontend 72 errors and 5 warnings. Backend 26 errors and 4 warnings. Mostly Prettier. Do not autofix inside an unrelated package |
| Docker | Image, tenant, smoke, Go integration | `docker: command not found`. Go integration panicked `rootless Docker not found` |
| Loopback Postgres, Redis, and `core/.env.test` | `node scripts/prepare-local-integration.mjs`, then `node scripts/run-local-auth-e2e.mjs password`, `machine`, and `references` | Password 6 passed, universal-auth 12 passed, reference boundary 5 passed. The rest of `npm run test:e2e` was not run. `max_locks_per_transaction` must be at least 256. |
| `node scripts/map-capabilities.mjs --check` | Catalog edits | Failed: stale `catalog.json` |
| `node scripts/test-capability-map.mjs` | Catalog structure | Passed |
| Operator mail, keys, and DNS | Packages 07 and 08 | Not available in this plan. Live `emailConfigured` was false |

Repository work is the packages above. External setup, which this repo cannot finish alone:

- SMTP and the public DNS or edge in front of vaultix.cloud.
- Encryption-key custody and backups.
- A Grok or Agent SDK project in another repo, with `defineConnection` to the core MCP URL and the token stored by that host.
- A Cursor plugin catalog submission, if Jesse asks for one after package 01 passes.
- Nomen client registration, if federation is turned on.
- GitHub release assets and signing keys.
- The open pull request `https://github.com/shippinAI/vaultix/pull/24`. Its body was still the empty template. Do not reimplement it until its diff is reviewed.

## Decisions that belong to Jesse

These are not decided by this plan.

1. Whether the built-in Viewer role should lose `readValue` later. Package 01 leaves Viewer as it is.
2. Whether `https://vaultix.cloud` stays online while CLOUD-01 through CLOUD-08 are open. It was online on 2026-11-08. Taking it down or leaving it invite-only is an operator decision.
3. Resolved as architecture: the hosted deployment uses Nomen, and the distributable core keeps built-in password, universal-auth, and token login without requiring Nomen. The hosting panel is a separate surface. Core discovery does not hardcode an issuer. Whether built-in accounts work on the live host is still unverified.
4. Where the Grok bot repository lives, and whether a plugin is published. This repo should only grow the connection text.
5. Mesh stays unauthorized until a separate yes.
6. Duplicate `0110` and `0112` files stay under those names until `docs/plan/canonical-ids.json` exists. Confirm the four alias ids in the naming proposal before a rename.
7. Go becomes owner one use case at a time, starting with reference reads. The served contract already makes a matching forbid win, and the Go project-rule builder now follows that expansion and order. TypeScript remains the public owner until the HTTP, MCP, audit, and rate-limit gates in `docs/0066` pass together.
8. Who holds SMTP, backups, and the encryption key for the public instance.
9. Whether pull request 24 is the upgrade-path change to continue, or whether it should be closed and replaced.

## Workstream handoffs

Each block is the context for the next edit in that area. Receipts from the audit are observations, not acceptance.

### foundation

Authoritative files: `contracts/vaultix.core.v1.json`, `docs/capabilities/catalog.mjs`, `docs/migration/workstreams.json`, `docs/delivery/acceptance.md`.

Decisions: generated JSON is not hand-authored. Acceptance cases stay planned until a runner executes them. The compile failure described for `TestCommandName` in `docs/delivery/implementation.md` does not reproduce on this commit; `go test ./internal/cli` passed. The rest of register `P00` is still open.

Dependencies: none for the contract sentence inside package 01. The runner waits for package 08.

Constraints: `node scripts/map-capabilities.mjs --check` currently fails. Do not run `--write` except in `fnd.catalog-pipeline`.

Next task: `fnd.contract-session` inside package 01. `fnd.catalog-pipeline` can be a separate docs PR.

Receipt: contract says stateless; router can issue a session; catalog check is stale.

### identity

Authoritative files: `core/backend/src/server/routes/v3/login-router.ts`, signup and auth-token services, `core/backend-go/internal/services/auth/device/`, `internal/cli/auth_cmds.go`, `internal/oidc/`.

Decisions: built-in password, universal-auth, and token login work with Nomen absent. Interactive terminal SSO uses a configured issuer and is not required for headless access. The Go device grant stays flag-off and is not the public Node route. `GET /api/v1/vaultix/auth/config` returned 404 on the public host when last checked; this branch serves it.

Dependencies: package 02, then package 03 for the existing device grant only when its approval UI, ingress, and CLI consumers pass together.

Constraints: do not copy a Nomen runtime into this repo. Do not accept an ID token as an API bearer. Do not remove `--sso`, `--token`, or `--universal`. Do not change `chooseLogin` to force one mode.

Next task: database proof of the existing login routes. `cli.builtin-login` stays in package 03.

Receipt: `internal/cli/login_mode_test.go` locks terminal SSO and non-interactive token. `TestHeadlessUniversalLoginDoesNotCallSso` locks `--universal` to `/api/v1/auth/universal-auth/login`. That terminal default is not a blocker for headless login.

### authorization

Authoritative files: `core/backend/src/ee/services/permission/default-roles.ts`, `permission-service.ts`, Go `internal/services/permission`.

Decisions: assistant least privilege is a custom role, not a Viewer edit, until Jesse says otherwise. Cross-tenant denial is an image test, not a unit-test claim.

Dependencies: package 01 for the role proof. Package 04 for Go parity. Package 07 for the image isolation run.

Constraints: forbidden and missing resources on the native reference API both surface as the same not-found style error. Keep that. Do not log values.

Next task: `authz.assistant-role`.

Receipt: Viewer includes both `describeSecret` and `readValue` at `default-roles.ts` around the `buildViewerPermissionRules` function.

### ui

Authoritative files: `core/frontend/src/pages/`, `core/frontend/src/hooks/api/vaultix/`, `docs/0025`, `docs/0050`.

Decisions: `/` is the product. `/help` is optional. Lessons do not submit forms. Accessibility for the whole UI is package 09, not package 01.

Dependencies: identity discovery for the entry work. Secret lifecycle for the full secret workflows.

Constraints: frontend lint is currently red. Do not format the whole tree inside a feature PR. Typecheck and build need an 8 GB Node heap on this machine.

Next task: `ui.entry-setup` in package 02.

Receipt: live `/` returned the Vite shell. Sign-in was not exercised.

### secrets

Authoritative files: `core/backend/src/services/vaultix/reference-service.ts`, `secret-v2-bridge-dal.ts` `findReferencePage`, `internal/api/secrets.go`, `core/backend-go/internal/services/secretmanager/reference/`.

Decisions: reference SQL selects id, key, version, timestamps, and tag slugs for permission checks. Raw GET returns values for the CLI. Go reads are not the public owner.

Dependencies: package 01 keeps the split. Package 04 moves the read. Package 05 moves writes.

Constraints: one store. No value in MCP. Personal overrides stay out of the shared reference list.

Next task: prove the packaged image with `VAULTIX_REFERENCE_DISPATCH=go` on the revision that contains the native reference handler. The code default remains TypeScript. Secret writes stay behind that image proof. Forbid-wins and `$all` parity are tested.

Receipt: `findReferencePage` comment says the path must not load ciphertext.

### ai

Authoritative files: `core/backend/src/services/vaultix/mcp.ts`, `catalog.ts`, `core/ai/clyffy/SKILL.md`, `internal/cli/mcp.go`.

Decisions: core MCP is the connector. Mutations stay off (`ai.mutations-hold`) until writes and inject exist. A Grok bot is an external client of this MCP. Historical `docs/0009` and `docs/0012` are superseded for the tool list.

Dependencies: package 01. Real Codex or Grok proof is `ai.client-proof` in package 08 and needs Docker plus a signed-in client. Do not collect that client's credentials.

Constraints: eight read-only tools maximum until a later package adds one on purpose. Anonymous callers see six.

Next task: `ai.core-mcp-boundary`.

Receipt: live anonymous tool list matched those six names. Reference calls without a credential returned 401 `Sign in to access your vault.`

### delivery

Authoritative files: `compose/vaultix.yml`, `scripts/build-self-hosted.mjs`, `scripts/smoke-image.sh`, `internal/release/`, `docs/0054`, `docs/0048`, `docs/0055`.

Decisions: image proofs require Docker. This environment cannot produce them. Public exposure while gates are open is Jesse's decision. Mail is off on the live host.

Dependencies: package 07, then package 08.

Constraints: do not cite `.cache` paths that are not in the tree. 709 cited paths were absent. Do not treat `GET /api/status` 200 as CLOUD-05.

Next task: `del.image-harness` when a Docker host exists. It is not package 01.

Receipt: `docker version` exited 127. `build-self-hosted.mjs --check` failed the tool preflight. `gh release list` was empty.

### cli

Authoritative files: `cmd/vaultix`, `internal/cli/auth_cmds.go`, `internal/cli/mcp.go`, `internal/api/secrets.go`, `internal/api/mcp.go`, `internal/store/`.

Decisions: `vaultix` and `vaultixl` stay one program. Stdio MCP does not load the local value store. `vaultix run` is not the assistant boundary. Inject is package 06.

Dependencies: package 01 for stdio tests. Package 03 for built-in login. Package 06 for inject.

Constraints: headless POSIX may use a 0600 credential file. Do not print tokens. Windows Credential Manager was not tested here.

Next task: `cli.stdio-mcp` tests in package 01. `cli.builtin-login` waits for `id.device-login`.

Receipt: root `go test ./...` passed, including `internal/cli`.

### automation

Authoritative files: `core/backend/src/queue/`, secret-rotation and dynamic-secret services.

Decisions: BullMQ for events, cron manager for schedules, as the backend guide already says. No second queue framework.

Dependencies: secret lifecycle and audit outbox.

Constraints: retries must be safe to repeat. Provider calls stay outside short database transactions.

Next task: `auto.queues` inside package 10, after package 05.

Receipt: none from this audit beyond code presence. Capability evidence is `Not accepted end to end`.

### integrations

Authoritative files: `core/backend/src/services/app-connection/`, `core/backend/src/ee/routes/v1/app-connection-routers/`.

Decisions: each provider is its own acceptance. The xAI template is a stored API key, not the Grok connector.

Dependencies: package 05, then package 10.

Constraints: do not log webhook URLs that contain secrets. Sync metadata may be shown to an assistant. Synced values may not.

Next task: `int.connections` in package 10.

Receipt: many routers exist. No provider outage test was run.

### audit

Authoritative files: `core/backend/src/ee/services/audit-log/`, Go audit producer tests if a slice moves.

Decisions: audit rows store actor and action, not secret values. High-cardinality tenant ids stay out of metric labels.

Dependencies: package 11, with a thin slice earlier if package 05 writes need an outbox.

Constraints: `SECURITY-01` is not done when the audit slice lands.

Next task: `aud.outbox`.

Receipt: live status said `auditLogStorageDisabled` false. That flag is not an export or retention proof.

### kms

Authoritative files: `core/backend/src/services/kms/`, `core/backend/src/ee/services` HSM and external KMS modules.

Decisions: losing `ENCRYPTION_KEY` makes the database unreadable. Key custody is operator work. HSM connectors are not accepted.

Dependencies: package 05, then package 11.

Constraints: tests use fixtures. Do not print key material.

Next task: `kms.custody`.

Receipt: capability `K03` is existing and not accepted end to end.

### pki

Authoritative files: `core/backend/src/ee` certificate and PKI services, `core/frontend/src/pages/cert-manager/`.

Decisions: card and dashboard tests in old docs are not issuance proofs.

Dependencies: `kms.custody`.

Constraints: deprecated certificate routes stay until a package names their replacement.

Next task: `pki.lifecycle` in package 11.

Receipt: none beyond code presence.

### pam

Authoritative files: `core/backend/src/ee/services/pam/`, `core/wasm/` for the remote-desktop decoder.

Decisions: PAM sessions are not MCP tools. Recordings must not flow into the assistant.

Dependencies: approvals and audit.

Constraints: read `core/backend/src/ee/services/pam/CLAUDE.md` before an edit. This plan does not expand it.

Next task: `pam.sessions`.

Receipt: none from a live session.

### scanning

Authoritative files: secret-scanning services and `core/backend/src/server/plugins/secret-scanner.ts`.

Decisions: findings shown to a model are redacted. Live status reported `secretScanningConfigured` false.

Dependencies: integrations and audit.

Constraints: do not enable scanning on the public host from this plan.

Next task: `scan.detectors`.

Receipt: the status flag only.

### legacy-panel

Authoritative files: `panel/internal/mcp/server.go`, `panel/internal/httpapi/server.go`, `compose/vaultix.yml` profile `panel`, `contracts/shippin.vaultix.panel.v1.json`.

Decisions: panel is not the product entry and not the connector. `panel.boundary` is package 12 and can ship as a doc and test guard in the same week as package 01 if it stays a negative test. Retirement waits.

Dependencies: package 01 for the negative test. Packages 06 and 08 before deletion.

Constraints: `scripts/check-owned.sh` already says `panel/internal/vault` is an overlay fallback. Keep that test green.

Next task: `panel.boundary`.

Receipt: public `GET /api/v1/vaultix/trust` and `/health` returned 404. Panel unit tests passed.

### intake

Authoritative files: `docs/code-audit/reviews.json`, `docs/migration/generated/summary.json`, `docs/0021`, TODO comments, `contracts/vaultix.mesh-*`, `docs/0115`, `docs/0116`.

Decisions: 797 reviewed files and 767 `modify` decisions are a ledger. The migration summary says no module is marked migrated. Mesh is held. TODO comments are not 154 features.

Dependencies: catalog regeneration is package 13 and can be earlier as a docs-only PR.

Constraints: do not mark a review `verified` to close a product task. Do not import mesh.

Next task: `fnd.catalog-pipeline` because `--check` is already failing. `intake.mesh-hold` is a standing non-action.

Receipt: `map-capabilities.mjs --check` exit 1. `test-migration-map.mjs` passed during the audit.

## Suggested PR sequence

1. Package 01 only. Exit criteria above. One PR.
2. Optional docs PR: `fnd.catalog-pipeline` (`map-capabilities.mjs --write` and `--check`). Separate from package 01 so behavior and generated JSON do not mix.
3. Package 02, then 03.
4. Package 04 before any claim that Go owns reads.
5. Packages 05 and 06 before any assistant write or inject story.
6. Packages 07 and 08 on a Docker host, after Jesse's exposure and mail decisions.
7. Packages 09 through 13 as their dependencies land.

Each PR names its package id, the task ids it closes, the audit ids it moves, and the checks it actually ran. It does not mark a rollup complete because one child passed.
