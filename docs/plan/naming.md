# Vaultix canonical naming and organization

Status: adopted for execution. Package 01 did not rename files. `docs/plan/canonical-ids.json` is still not created. Duplicate `0110` and `0112` filenames stay until a later alias index.

Prefer names and folders that already exist. Do not mass-rename, except the table and API namespaces the owner decided on 2026-11-10 ([0119](../0119-schema-and-api-namespaces.md)). A new id is an alias until the old path has no remaining readers.

## Single sources of truth

| Topic | Existing source | Do not treat as the source |
| --- | --- | --- |
| Workstream names | `docs/migration/workstreams.json` | A new workstream list in a later PR |
| Capability requirements | `docs/capabilities/catalog.mjs` | `docs/capabilities/generated/catalog.json` by itself |
| Generated explorer data | Output of `node scripts/map-capabilities.mjs` | Hand edits to `generated/catalog.json` |
| Delivery cases that are still planned | `docs/delivery/acceptance.md` | A green checklist copied from an old `.cache` path |
| Implementation register | `docs/delivery/implementation.md` | The same short id in the capability catalog |
| Product HTTP and MCP behavior | `core/backend/src/server/routes/vaultix-router.ts` plus `core/backend/src/services/vaultix/` | `panel/internal/mcp/server.go` |
| Native contract | `contracts/vaultix.core.v1.json`, after it matches the router | The panel contract |
| Panel overlay | `contracts/shippin.vaultix.panel.v1.json` and `panel/` | The product entry |
| CLI | `cmd/vaultix` and `internal/` | A second CLI tree |
| Encrypted store | PostgreSQL used by `core/backend`, with `vx_<group>_<entity>` tables per [0119](../0119-schema-and-api-namespaces.md) | `panel/internal/vault`, `leftover/`, or any other table naming |
| Vaultix API | `/api/vx/v1/<domain>/` per [0119](../0119-schema-and-api-namespaces.md); inherited prefixes stay until each domain's replacement is tested | A new prefix outside `/api/vx/` |
| Authorship ledger | `docs/code-audit/reviews.json` | Proof that a use case is migrated |
| Migration discovery | `docs/migration/generated/summary.json` | A migrated-module count. The file says no module is marked migrated |
| This plan | `vaultix-action-plan.md` and `vaultix-traceability.json` in the artifacts store | A percentage of completion |

On 2026-11-08, `node scripts/map-capabilities.mjs --check` failed with `AssertionError: Stale capability map: catalog.json`. `node scripts/test-capability-map.mjs` passed. Those are different checks. The JSON still records `baselineCommit` `1b08567bf7a6346d474988bbce841370526bd68c`, which is not `eb61496c`. Task `fnd.catalog-pipeline` regenerates the JSON with `--write` only in an authorized edit, then `--check` must pass. This planning pass did not run `--write`.

## Collisions

| Collision | What exists | Canonical choice | What not to do |
| --- | --- | --- | --- |
| Two `0110` documents | `docs/0110-invite-only-instance.md` and `docs/0110-verified-release-download.md` | Keep both filenames. Future alias ids: `doc.invite-only` and `doc.release-download`. Proposed index path, not created: `docs/plan/canonical-ids.json` | Do not rename either file in the first packages |
| Two `0112` documents | `docs/0112-early-access-requests.md` and `docs/0112-real-codex-acceptance.md` | Aliases `doc.early-access` and `doc.codex-client` | Do not merge the subjects |
| Short id `S01` | Capability `S01` create/edit. Acceptance `CASE-S01` cache identity. Register `TASK-S01` cache isolation | Always prefix: `cap.S01`, `case.S01`, `impl.S01`. Plan tasks use dotted ids such as `sec.lifecycle` and `cli.local-cache` | Do not close one because another `S01` moved |
| `A01`, `G01`, `O01`, `U01`, `L01`, `H01`, `P01` | Same pattern across catalog, acceptance cases, and the implementation register. Catalog `P01` is PKI. Phase `P0` is a rollup. Register `P00` is a prerequisite repair | Prefix every citation | Do not use a bare `P0` in a commit message |
| Core MCP vs panel MCP | Core tools: six guidance tools plus `vaultix.projects.list` and `vaultix.secrets.references`. Panel tools include `vaultix.runtime.answer`, `vaultix.viewport.get`, `vaultix.source.act` | Product connector is `POST /api/v1/vaultix/mcp` on the core. Server name in code is `vaultix-clyffy` | Do not point a Grok bot at the panel. Do not revive `vaultix.source.act` as the product tool |
| TypeScript vs Go ownership | Live reads and writes are TypeScript. Go reference and device code exist. Forwarding in `core/backend/src/server/routes/index.ts` is commented out. Shadowing is optional | One owner per route after a differential test. Until then TypeScript is the owner | Do not enable the forwarding plugin as a drive-by |
| `vaultix` and `vaultixl` | Same Go program, two names | Either name is the CLI. Help text must accept both | Do not fork the commands |
| Host names | CLI default `https://vaultix.cloud`. Compose hosted example `https://vaultix.shippin.cloud` | The public product host is `vaultix.cloud` when that is the instance the operator selected. Self-hosted uses the operator URL | Do not hard-code the shippin host into new CLI defaults |
| Identity default | `internal/cli/auth_cmds.go` defaults a terminal to Nomen. `docs/0074` requires built-in identity without Nomen | Built-in is the default once `id.discovery` is accepted. Nomen is `id.federation` | Do not remove the explicit `--sso` path while changing the default |
| Stateless MCP vs session | Contract summary says stateless. The router can set `Mcp-Session-Id`. Live `GET /mcp` says stateless | `fnd.contract-session` writes one rule: anonymous guidance is stateless; a session exists only for an authenticated app negotiation | Do not describe both as universally true |
| Viewer vs assistant | Viewer includes `describeSecret` and `readValue` in `default-roles.ts`. MCP reference SQL omits ciphertext. `internal/api/secrets.go` returns `secretValue` | Assistant credentials are a custom role proved by `authz.assistant-role`. Viewer stays as it is until Jesse decides otherwise | Do not weaken Viewer inside the first package |
| Trust and health | `AGENTS.md` names overlay `GET /api/v1/vaultix/trust` and `/health`. Those handlers are on the panel. The public core returned 404 | Call them panel routes. Core health for operators remains `GET /api/status` | Do not add the same paths to the core just to match the agent note |
| xAI template vs Grok bot | `proxiedServiceTemplates.ts` key `xai` stores an API key for `api.x.ai` | That is a secret-proxy template. The assistant connector is core MCP | Do not send secret values into either one |
| Mesh schemas | `contracts/vaultix.mesh-*.json`, `docs/0115`, `docs/0116` | Held as `intake.mesh-hold` | Do not import a mesh runtime in this sequence |

## Folder groups

These directories were present at `eb61496c`.

| Group | Existing path | Owns |
| --- | --- | --- |
| Core API and MCP | `core/backend/src/server/routes/vaultix-router.ts`, `core/backend/src/services/vaultix/` | Product guidance, reference tools, sessions |
| Core secret engine | `core/backend/src/services/secret*`, `core/backend/src/server/routes/v3/` | Encrypted values and the raw API |
| Permissions | `core/backend/src/shippin/services/permission/` | Roles, including Viewer |
| Go services | `core/backend-go/internal/services/` | Device grants, Go reference reads, Go auth. Not the public owner yet |
| Go entry | `core/backend-go/cmd/vaultix/` | Sidecar process |
| UI | `core/frontend/src/pages/`, `core/frontend/src/hooks/api/vaultix/` | Application entry and reference browser |
| Specialist text | `core/ai/` | Clyffy instructions. No secret values |
| CLI | `cmd/vaultix`, `internal/cli`, `internal/api` | Login, stdio MCP, raw pull and run |
| Release and install | `internal/release`, `internal/platform`, `contracts/vaultix.release-*` | Signed artifacts |
| Compose | `compose/vaultix.yml`, `compose/self.env.example` | One backend, Postgres, optional Dragonfly, optional panel |
| Panel | `panel/internal/mcp`, `panel/internal/httpapi` | Overlay only |
| Scripts | `scripts/build-self-hosted.mjs`, `scripts/test-tenant-isolation.mjs`, `scripts/smoke-image.sh` | Image acceptance. They require Docker |
| Contracts | `contracts/` | Published shapes. Mesh files stay held |
| Plan docs | `docs/` | Requirements and historical notes |
| Leftover | `leftover/` | Notes. Do not grow it and do not import it |

Proposed paths that do not exist yet:

| Proposed path | When | Purpose |
| --- | --- | --- |
| `docs/plan/canonical-ids.json` | `fnd.doc-aliases` in `pkg.13-authorship` | Alias index for duplicate doc numbers and short ids |
| None for a second MCP | Never as part of this plan | The connector stays on the core route |
| None for `bot/` in this repo | External | A Grok bot project is a different repository |

## How generated catalogs stay aligned

1. Edit `docs/capabilities/catalog.mjs` when a requirement changes.
2. Run `node scripts/map-capabilities.mjs --write` only in an edit that is allowed to change the tree.
3. Run `node scripts/map-capabilities.mjs --check`, `node scripts/test-capability-map.mjs`, and `node scripts/test-capability-explorer.mjs`.
4. The check must fail if `generated/catalog.json` differs. That failure is already true on this commit.
5. Do not change an evidence label to `accepted` because a unit test passed. `docs/capabilities/README.md` says every requirement is still `Not accepted end to end`.
6. `node scripts/test-migration-map.mjs` passed in the audit. It does not refresh the capability JSON.
7. Workstream file rules stay in `docs/migration/workstreams.json`. New directories get a rule in that file in the same change that adds the directory.

## Compatibility and link updates

- A rename PR updates every reference it finds, including tests and contracts, and leaves a one-release alias if a public URL or CLI flag changes.
- Public HTTP paths `/api/v1/vaultix/*` and `/api/v3/secrets/raw` stay until a package names the replacement and a test covers the old client.
- CLI flags `--domain` and `--api` both remain. `--sso` remains the explicit Nomen path.
- Adding a tool to core MCP is a contract change in the same PR as the router and the catalog text.
- Secret names may appear in tests. Secret values, tokens, and canary strings must not be copied into docs, MCP fixtures that the model sees, or assistant prompts. Compare canaries inside the server and assert absence.

## Assistant context

Clyffy and any Grok bot receive catalog text and secret names. They do not receive values, ciphertext, comments, or custom metadata. They do not receive `ENCRYPTION_KEY`, `AUTH_SECRET`, database URLs with passwords, or the operator's model credentials. `core/ai/clyffy/SKILL.md` is the instruction source. A bot connection document may repeat the URL and the stdio command. It may not embed a bearer token.
