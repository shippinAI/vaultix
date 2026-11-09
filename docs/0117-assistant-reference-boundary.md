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
| `id.discovery` | `GET /api/v1/vaultix/auth/config` lists `builtin-password`, `builtin-universal`, and `builtin-token` with `headlessRequiresSso` false. Configured `NOMEN_OIDC_ISSUER` adds `sso`. `deviceAuthorization` stays false. | Mounted route test. Local issuer and empty-issuer Go tests passed. Database universal-auth: 12 passed. Loopback CLI `--universal` and `--token` passed. Packaged `scripts/test-cli-headless.mjs` passed 17 checks on image `sha256:cb2e170c6186e8af1e637438b8a7e3873f310e2c6e6f2f18cfb2a0acda5290d1`, including token login and machine-identity login. | The CLI does not call `/auth/config`. No live issuer. Native device grant is not on the public Node port. |
| `ui.entry-setup` | No UI behavior change. | `node scripts/test-app-entry.mjs` reads source and checks `/`, `/help`, `/login`, and `/admin/setup`. | No browser session. |

## Package 04 slice

`pkg.04-go-read-cutover` is partial. The served project-permission contract sorts allows before forbids and expands a forbid of `describeSecret` or `readValue` so it also forbids legacy `read`. CASL's last match then makes a matching forbid win. The Go project-rule builder now does the same expansion and ordering. Its deny-first check matches that result. `vaultixpolicy.Can` is unchanged for other callers. Product `$all` tag checks match CASL containment.

`reference.PublicOwner` stays `typescript` for an unset dispatch. `VAULTIX_REFERENCE_DISPATCH=go` sends HTTP and authenticated MCP reference actions to the native service, with the public error string, a 60-per-minute self-hosted budget, and included 365-day retention capped by a shorter project policy. Guidance and MCP session negotiation stay on TypeScript. The packaged image sets the Go dispatch. No new owner decision is required for the forbid-wins result: that is the behavior the current route already serves.

## Loopback integration setup

This host has no systemd. `policy-rc.d` denies service starts, so PostgreSQL 16 and Redis 7 were installed with apt and started directly: `pg_ctlcluster 16 main start` and `redis-server --bind 127.0.0.1 --protected-mode yes`. The e2e schema drop needs `max_locks_per_transaction` of at least 256; this host uses 512. `node scripts/prepare-local-integration.mjs` creates only the loopback role and database `vaultix_itest` and writes gitignored `core/.env.test`. It does not print generated secrets. It refuses a non-loopback URL, refuses to drop `vaultix_itest` when another role owns it, refuses to drop the role when that role owns any other database, and refuses to replace `core/.env.test` when that file points at a different database. `node --test scripts/prepare-local-integration.test.mjs` covers those guards.

`node scripts/run-local-auth-e2e.mjs password|machine|references` runs the existing specs. `node core/backend/node_modules/tsx/dist/cli.mjs core/backend/scripts/local-headless-cli.ts` starts the API from that file and exercises the CLI. These commands are local fixtures. They are not a live Nomen session.

`e2e-test/routes/v1/vaultix-references.spec.ts` passed 5 tests, including a foreign organization whose project is absent from lists and returns the same not-found response as a missing project. Reference responses did not contain the planted value.

## Packaged image acceptance

`node scripts/build-self-hosted.mjs` passed for commit `d3214bf5336506398d5e29597aadaa804a3d4533`. The image is `sha256:cb2e170c6186e8af1e637438b8a7e3873f310e2c6e6f2f18cfb2a0acda5290d1`, tagged `vaultix:d3214bf5336506398d5e29597aadaa804a3d4533`. No registry push or deployment was performed. The receipt is local under `.cache/self-hosted-build-K2I3gQ/result.json`.

That run includes Dragonfly and Redis smoke, encrypted recovery (9 checks), `scripts/test-tenant-isolation.mjs` (14 checks), proxy boundary (4 checks), and production admission on both caches. Identity-policy startup passed 18 cases. The Dragonfly smoke also ran the disposable browser application proof.

`node scripts/build-cli.mjs` then `node scripts/test-cli-headless.mjs sha256:cb2e170c6186e8af1e637438b8a7e3873f310e2c6e6f2f18cfb2a0acda5290d1` with the Linux/amd64 `vaultix` binary passed 17 checks. The image resources stayed on Docker bridge networks with disposable credentials. These packaged checks are separate from the loopback database specs above and from an installed Grok or Codex session.

This host needed Docker Compose v2 and the Buildx plugin. `iptables-legacy` FORWARD policy `DROP` blocked container-to-container TCP. A temporary policy `ACCEPT` was used for the image run, then replaced by accept rules for `br+` interfaces and the policy was set back to `DROP`. PostgreSQL 16 inside the image smoke uses the script's fixed smoke password, not `core/.env.test`.

## Verification that did not run

The full `npm run test:e2e` directory was not run. MCP session quota against Redis stays skipped unless `VAULTIX_TEST_MCP_CACHE_URL` is set. No live Nomen issuer was contacted. No assistant connector was installed. The public host was not modified. Whole-tree backend and frontend lint were already failing before this package; the files touched here pass eslint. `node scripts/map-capabilities.mjs --check` was already stale and was not regenerated.
