# Assistant reference boundary

Package `pkg.01-reference-boundary` from the execution plan. Later packages stay planned. This file does not close CLOUD gates, built-in device login, or the Go read cutover.

Naming decisions: [docs/plan/naming.md](plan/naming.md). Row-level status: [docs/plan/traceability.md](plan/traceability.md). Workstream ids remain those in `docs/migration/workstreams.json`.

## What this package changes

A custom role with `secrets:describeSecret` and without `secrets:readValue` can list secret names through the core reference service. The same role is denied by `GET /api/v3/secrets/raw`, which calls `secret.getSecretsRaw` and then the v2 bridge when the project uses that bridge. The decryptor is not called. The legacy branch of `getSecretsRaw` also denies before loading values. An actor with neither permission does not load secret rows. The route passes the authenticated actor and organization into project resolution; a rejected foreign project does not read secrets. Viewer rules in `default-roles.ts` are unchanged.

Anonymous MCP guidance does not create a session. An authenticated client that negotiates the Vaultix app still receives `Mcp-Session-Id`. `contracts/vaultix.core.v1.json` now says both of those sentences. The strings live in `core/backend/src/services/vaultix/mcp-session-contract.ts`, and a unit test fails if the contract drops them.

Connection text in the catalog and `core/ai/README.md` tells a Grok bot or other MCP client to use `POST /api/v1/vaultix/mcp` or `vaultix mcp`. The panel MCP is not the connector. Bearers stay in the CLI credential file or the client host secret store.

## Status

`implemented` means the code or text for that slice is in this branch. `unit-verified` means an in-process test executed it. `integration-unverified` means no installed client, real session, image, or database e2e ran. A unit-verified slice is not an installed connector.

| Task | Implementation | Unit-verified | Integration-unverified |
| --- | --- | --- | --- |
| `authz.assistant-role` | Describe-only and empty abilities. Viewer rules unchanged. | Permission helper, reference service, and `GET /api/v3/secrets/raw`. | No database-backed membership or image tenant run. |
| `sec.raw-compat` | Route still calls `secret.getSecretsRaw`. No new raw-read scope. | v2 bridge path and legacy bridge-off path through that route. Decryptor not called. | No disposable Postgres. |
| `ai.core-mcp-boundary` | No new tools. Reference mapper still drops values. | Anonymous tool list, read-only annotations, planted-field stripping, tenant 404 without the marker. | No running MCP client. |
| `ai.client-connection` | Catalog and `core/ai/README.md` text only. | Those strings are asserted. | No Grok bot, Codex process, or published plugin. |
| `fnd.contract-session` | Contract sentences match `mcp-session-contract.ts`. Router 405 uses the anonymous sentence. | Contract file test plus existing app-session route tests. | No Redis-backed session quota (`VAULTIX_TEST_MCP_CACHE_URL` unset). |
| `cli.stdio-mcp` | No CLI change. | `go test -count=1 ./internal/api ./internal/cli` only. | `vaultix mcp` was not spawned against a server. |
| `pkg.02-identity-discovery` and later | Not started. | No. | No. |
| Mesh, plugin publication, mail, backups, keys, DNS, live host | Not started. | No. | Blocked. Not authorized. |
| Built-in Viewer `readValue` | Unchanged. | Not a change. | Blocked on Jesse. |
| Open pull request 24 | Not duplicated. | No. | Blocked until its diff is reviewed. |
| `fnd.catalog-pipeline` | Not started. | `node scripts/map-capabilities.mjs --check` still fails: `Stale capability map: catalog.json`. | `--write` was not run. |

## Verification that did not run

Docker is not installed, so image smoke, tenant-isolation image runs, and Go integration tests were not run. `npm run test:e2e` was not run: `core/.env.test` is absent. MCP session quota against a real Redis cache stays skipped unless `VAULTIX_TEST_MCP_CACHE_URL` is set. The public host was not modified. Whole-tree backend and frontend lint were already failing before this package; the files touched here pass eslint.
