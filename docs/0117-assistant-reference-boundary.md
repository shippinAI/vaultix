# Assistant reference boundary

Package `pkg.01-reference-boundary` from the execution plan. Later packages stay planned. This file does not close CLOUD gates, built-in device login, or the Go read cutover.

Naming decisions: [docs/plan/naming.md](plan/naming.md). Row-level status: [docs/plan/traceability.md](plan/traceability.md). Workstream ids remain those in `docs/migration/workstreams.json`.

## What this package changes

A custom role with `secrets:describeSecret` and without `secrets:readValue` can list secret names through the core reference service. The same role is denied by `secretV2BridgeService.getSecrets` when `viewSecretValue` and `throwOnMissingReadValuePermission` are both true, which is the raw list default, and the decryptor is not called. An actor with neither permission does not load secret rows. Viewer rules in `default-roles.ts` are unchanged.

Anonymous MCP guidance does not create a session. An authenticated client that negotiates the Vaultix app still receives `Mcp-Session-Id`. `contracts/vaultix.core.v1.json` now says both of those sentences. The strings live in `core/backend/src/services/vaultix/mcp-session-contract.ts`, and a unit test fails if the contract drops them.

Connection text in the catalog and `core/ai/README.md` tells a Grok bot or other MCP client to use `POST /api/v1/vaultix/mcp` or `vaultix mcp`. The panel MCP is not the connector. Bearers stay in the CLI credential file or the client host secret store.

## Status

| Task | Status |
| --- | --- |
| `authz.assistant-role` | Unit-verified for a describe-only fixture. Viewer unchanged. |
| `sec.raw-compat` | Unit-verified on the v2 raw read path. Legacy route behavior was not given a separate database test. |
| `ai.core-mcp-boundary` | Unit-verified for tool names, read-only annotations, and value stripping. |
| `ai.client-connection` | Catalog and README text updated and asserted. No live Grok or Codex session. |
| `fnd.contract-session` | Contract and router session rule covered by a unit test. |
| `cli.stdio-mcp` | No CLI code change. `go test -count=1 ./internal/api ./internal/cli` passed. |
| `pkg.02-identity-discovery` and later | Planned. |
| Mesh, plugin publication, mail, backups, keys, DNS, live host | Blocked. Not authorized here. |
| Built-in Viewer `readValue` | Blocked on Jesse. Not changed. |
| Open pull request 24 | Blocked until its diff is reviewed. Not duplicated. |
| `fnd.catalog-pipeline` | Planned. `node scripts/map-capabilities.mjs --check` still fails with `Stale capability map: catalog.json`. That failure predates this package. `--write` was not run. |

## Verification that did not run

Docker is not installed, so image smoke, tenant-isolation image runs, and Go integration tests were not run. `npm run test:e2e` was not run: `core/.env.test` is absent. MCP session quota against a real Redis cache stays skipped unless `VAULTIX_TEST_MCP_CACHE_URL` is set. The public host was not modified. Whole-tree backend and frontend lint were already failing before this package; the files touched here pass eslint.
