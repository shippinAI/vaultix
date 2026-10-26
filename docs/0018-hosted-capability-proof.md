# Hosted Vaultix capability verification

Hosted Vaultix operated by shippin.ai is the first release target. Self-hosted
deployments use the same engine and included software capabilities. Release
claims require passing workflows; an included feature flag is not evidence.

## Native AI surface

The native UI and MCP share `vaultix.projects.list` and
`vaultix.secrets.references`. The actor and organization come from validated
authentication, never from tool arguments. Project and per-secret permissions
apply before returning metadata. The reference DAL selects only ID, name,
version, timestamps, and permission tags; it does not load ciphertext, decrypt
values, or return comments/custom metadata. Reference reads use the existing
audit service. The catalog authors the visible action labels.

References cover shared secrets in one environment/folder. Imports, personal
overrides, writes, rotation, and injection redemption are deliberately absent
from this initial native action set. Existing engine workflows remain available
to authenticated users during migration. Legacy value-returning routes are not
approved model tools.

Native actions currently accept the existing core user and machine identity
authentication adapters. This does not establish Nomen integration. Hosted
release requires a registered Nomen client/audience and an explicit organization
mapping, then tests for discovery, issuer, audience, expiry, revocation, logout,
and cross-tenant denial. Vaultix must not create a second identity session store.

## Reproduce the evidence

```sh
docker build -f core/Dockerfile.standalone-vaultix -t vaultix:hosted-verify core
bash scripts/smoke-image.sh vaultix:hosted-verify dragonfly
bash scripts/smoke-image.sh vaultix:hosted-verify redis
docker build --target backend-build -f core/Dockerfile.standalone-vaultix -t vaultix:verify-backend core
node scripts/test-unit-core.mjs
node scripts/test-core.mjs dragonfly
node scripts/test-core.mjs redis
# After installing core/e2e dependencies and Playwright Chromium, and building
# core/backend and core/frontend locally:
node scripts/test-native-ui.mjs
```

The database runner creates disposable, uniquely named containers with generated
test credentials. It never uses the operator's environment file or existing
database/cache. Source and tests are copied into the test container, avoiding
host dependency directories. Cleanup removes only those test resources. JSON
results are saved under `.cache/core-proof-*/test-results.json`; unit results
use `.cache/unit-proof-*`. GHCR publication runs the database checks before
pushing the engine image and retains results as workflow artifacts. Browser
checks use the built UI and real authored catalog with fixture authentication
and action responses; they verify navigation, scope selection, metadata-only
rendering, empty/error states, mobile layout and rejection of unknown catalog
components. They do not establish Nomen sign-in.

The backend production dependency audit on 2026-10-26 found six critical package
findings. Targeted updates to Handlebars, scim-patch, proxy-addr, shell-quote,
tar and websocket-driver removed those findings. A follow-up compatible update
pass reduced the remaining findings from 72 to **44 (10 high, 29 moderate,
5 low)**. See [dependency triage](0019-hosted-dependency-triage.md) for the
remaining groups and their acceptance work. These are still release work. CI
retains the audit report and blocks publication on critical findings; that
threshold is an artifact gate, not hosted release approval.

## Capability ledger

Verified locally on 2026-10-26 after the targeted dependency updates:

| Run | Result |
| --- | --- |
| Backend unit suite in Linux image | 116 files; 1,838 passed, 22 skipped, zero failures |
| PostgreSQL + Dragonfly | 9 suites; 156 passed, zero failures |
| PostgreSQL + Redis | Same 9 suites; 156 passed, zero failures |
| Built native UI in desktop/mobile browser | Passed; real catalog and fixture authentication/action responses |
| Backend TypeScript and changed-file lint | Passed |
| Standalone image on Dragonfly and Redis | Startup/migrations, UI, public MCP, anonymous reference denial, BullMQ and engine restart passed |

The local verified image is `vaultix:hosted-verify`, image ID
`sha256:8e279e8e718aee9236e41605da78ca04c19e6ee7d74c78045190a831c6766efb`.
It was built from `core/Dockerfile.standalone-vaultix`; it has not been published
or deployed as the hosted service. Docker Desktop reassigns ephemeral ports
on restart, so the smoke runner resolves the published port again before
checking recovery.

The database runs include all SCIM tests after the scim-patch update. The
reference tests verify ciphertext at rest, absence of payload columns from
metadata queries, shared HTTP/MCP output, invalid-token rejection and
cross-tenant denial. Unit tests also cover name/tag-scoped reference access.

| Capability | Evidence path | Remaining hosted acceptance |
| --- | --- | --- |
| Image and cache | `scripts/smoke-image.sh`: migrations/startup, health, UI, product stamp, packaged AI instructions, MCP, BullMQ execution and engine restart; run against Dragonfly and Redis | Cache/DB failover, backups/restores, TLS ingress, resource limits, production observability |
| Secret CRUD and versions | `e2e-test/routes/v4/secrets.spec.ts` against a real database | Native write/injection contract, rollback/recovery, authenticated UI migration |
| AI references and isolation | `e2e-test/routes/v1/vaultix-references.spec.ts`; native unit/HTTP tests | Real Nomen client sign-in; browser workflow with real issuer |
| Secret/access approvals | `e2e-test/routes/v1/secret-approval-policy.spec.ts`, `access-approval-policy.spec.ts` | Complete request/review/apply and denial paths in native UI |
| Machine identity and delegated scopes | `e2e-test/routes/v1/identity-access-token-redesign.spec.ts`, `oauth-scope.spec.ts` | Nomen subject mapping, revocation propagation and production workload credentials |
| Environments and references | `e2e-test/routes/v1/project-env.spec.ts`, `v3/secret-reference.spec.ts` | Native authored workflows, external provider integration |
| SCIM, groups, RBAC, SSO/MFA | `e2e-test/routes/v1/scim.spec.ts`; existing permission/auth suites | Nomen provisioning lifecycle, custom-role matrix, SAML/OIDC tenant isolation, IP allowlists |
| Audit, streams, reports and insights | Existing `src/ee/services/audit-*` unit suites | Durable delivery, retention, export, tamper evidence and redaction under failure |
| Rotation and dynamic leases | Existing rotation, dynamic-secret and lease services | Per-provider create/renew/revoke, retry, rollback, credential cleanup |
| Secret/certificate sync and app connections | Existing source connector and sync services | Per-provider success/failure/recovery evidence; no blanket provider parity claim |
| PKI, EST, ACME, SCEP, CRL and PQC | Existing PKI services and ACME/SCEP unit suites; PQC tools in standalone image | Issue/renew/revoke/validate across supported algorithms and clients |
| KMS, HSM, KMIP and external KMS | Existing KMS/HSM/KMIP services | Real hardware/provider encryption, rotation, recovery and access denial; no FIPS certification claim |
| PAM, gateways, pools, sessions and brokering | Existing PAM/gateway/proxied-service modules | Provider sessions, recordings, privilege expiry, rotation and outage handling |
| Scanning and honeytokens | Existing scanning/honeytoken modules and scanning unit suites | Scanner execution, detection, alert delivery, false-positive handling |
| Events, alerts and templates | Existing event, alert, project-template and identity-template services | End-to-end delivery/retries and authorization on template application |
| Suborganizations and cross-project sharing | Existing sub-org/project-folder-grant services | Parent/child tenant boundaries and grant revocation |
| ElastiCache | Configuration validation | AWS TLS, ACL, cluster/failover and queue tests; IAM refresh/serverless are not established |
| Supply chain | Locked packages, retained third-party notices | Triage production dependency audit findings before offering the hosted release |

All engine test paths in this table are relative to `core/backend/`. A test path
identifies where evidence belongs, not a claim that every scenario in that
capability passed. Provider/hardware-dependent capabilities remain unverified
until their external prerequisites and acceptance tests are available.
