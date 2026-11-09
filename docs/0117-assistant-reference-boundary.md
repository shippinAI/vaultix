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

## Package 02 slice

`pkg.02-identity-discovery` is partial. Both modes stay. Headless machine login is the existing `--token` and `--universal` client, and a non-interactive stdin selects token. Those paths do not call Nomen. A terminal with no flags still uses the existing SSO client in `internal/oidc`; that is the hosted interactive default, not a requirement for self-hosted headless access. This slice does not change `chooseLogin`. Core discovery does not hardcode an issuer. An empty `--issuer` and empty `NOMEN_OIDC_ISSUER` no longer fall back to a hosted IdP. An `sso` profile appears only when `NOMEN_OIDC_ISSUER` is set, and userinfo is stripped. The Go device-grant HTTP handler remains flag-off and is not registered on the Node listener.

| Task | Implementation | Unit or static check | Not verified |
| --- | --- | --- | --- |
| `id.preserve-builtin` | Existing `POST /api/v3/auth/login` and `POST /api/v1/auth/universal-auth/login` left in place. No auth data migration. | Mounted route tests with mocked services. Database specs `e2e-test/routes/v1/login.spec.ts` and `e2e-test/routes/v3/auth-email-login.spec.ts`: 6 passed on loopback Postgres and Redis. | MFA, signup, and invite-only behavior. The full e2e directory was not run. |
| `id.discovery` | `GET /api/v1/vaultix/auth/config` lists `builtin-password`, `builtin-universal`, and `builtin-token` with `headlessRequiresSso` false. Configured `NOMEN_OIDC_ISSUER` adds `sso`. `deviceAuthorization` stays false. | Mounted route test. Local issuer and empty-issuer Go tests passed. `e2e-test/routes/v1/identity-access-token-redesign.spec.ts`: 12 passed. `core/backend/scripts/local-headless-cli.ts` logged in with `--universal` and `--token` against `http://127.0.0.1:8200` and rejected a wrong machine secret. Empty `--sso` failed before any issuer request. | The CLI does not call `/auth/config`. No live issuer. Native device grant is not on the public Node port. |
| `ui.entry-setup` | No UI behavior change. | `node scripts/test-app-entry.mjs` reads source and checks `/`, `/help`, `/login`, and `/admin/setup`. | No browser session. |

## Loopback integration setup

This host has no systemd. `policy-rc.d` denies service starts, so PostgreSQL 16 and Redis 7 were installed with apt and started directly: `pg_ctlcluster 16 main start` and `redis-server --bind 127.0.0.1 --protected-mode yes`. The e2e schema drop needs `max_locks_per_transaction` of at least 256; this host uses 512. `node scripts/prepare-local-integration.mjs` creates the loopback role `vaultix_itest` and writes gitignored `core/.env.test`. It refuses any host other than `127.0.0.1` or `localhost` and does not print the generated secrets.

`node scripts/run-local-auth-e2e.mjs password|machine|references` runs the existing specs. `node core/backend/node_modules/tsx/dist/cli.mjs core/backend/scripts/local-headless-cli.ts` starts the API from that file and exercises the CLI. These commands are local fixtures. They are not a live Nomen session.

`e2e-test/routes/v1/vaultix-references.spec.ts` passed 5 tests, including a foreign organization whose project is absent from lists and returns the same not-found response as a missing project. Reference responses did not contain the planted value.

## Verification that did not run

Docker 29.1.3 runs when `dockerd` is started manually. `docker run --rm hello-world` passed. The packaged tenant and headless proofs still need a built `core/Dockerfile.standalone-vaultix` image, so `node scripts/test-tenant-isolation.mjs` and `node scripts/test-cli-headless.mjs` were not run. The full `npm run test:e2e` directory was not run. MCP session quota against Redis stays skipped unless `VAULTIX_TEST_MCP_CACHE_URL` is set. The public host was not modified. Whole-tree backend and frontend lint were already failing before this package; the files touched here pass eslint.
