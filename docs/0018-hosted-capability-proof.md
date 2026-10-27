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

### Accessibility checkpoint, 2026-10-26

The subsequent native accessibility changes passed frontend TypeScript/build,
changed-file ESLint and `scripts/test-native-ui.mjs` with Edge and axe-core 4.14.0.
Ten states reported zero detected WCAG A/AA violations, covering workspace,
connections, reference denial/results and sign-in at desktop/mobile/320-pixel
widths. Keyboard assertions verify skip activation, changed-view heading focus,
radio arrow selection and focusable connection scrolling. The baseline scan
reproduced name/label contrast failures before the fixes.

Initial evidence: `.cache/ui-proof-VhpsQq/accessibility.json` and screenshots,
source commit `8d4fe11`. Its three sign-in scans retained an unresolved gradient
contrast item. Reading the sign-in implementation identified a gradient title
without heading semantics and placeholder-only inputs. The follow-up adds a
flat semantic heading and persistent email/password labels, retains password
manager autocomplete, and links the visibility control to its input.

Follow-up evidence: `.cache/ui-proof-8gRbT0/accessibility.json` and screenshots.
All ten scans now report zero violations and zero incomplete rules. Frontend
build and changed-file lint passed. Additional keyboard checks prove horizontal
connection scrolling and password show/hide without submitting credentials.
Non-text contrast, real screen-reader tests, browser zoom and unscanned
authenticated routes remain open. Authentication/action responses remain
fixtures. CI runs the same scans and retains their reports.

The canonical standalone image built successfully from runtime source `9b1dce4`:

```text
vaultix:hosted-verify
sha256:fb841587bc1bff0e0abc03c36fb26e111a9d61b078fd87d12b7ed51db16043ea
```

UI assets extracted from this image passed the same browser/accessibility checks
(`.cache/ui-proof-HIaFHT/`). Both Dragonfly and Redis image smoke tests passed,
including migrations/startup, product/API identity, UI, MCP, anonymous denial,
BullMQ execution and engine restart. Logs: `.cache/a11y-smoke-dragonfly.log` and
`.cache/a11y-smoke-redis.log`. This is a local image ID, not a registry digest.
Independent GitHub verification/publication is tracked by
[run 40435314857](https://github.com/shippinAI/vaultix/actions/runs/40435314857).

Expanding the fixture to configured social/SSO methods reproduced another shared
component defect: the field separator text rendered at 4.05:1 contrast. Removing
its opacity reduction fixes that use and other consumers of the shared separator.
The permanent runner now covers email-only and federated layouts, including
keyboard SSO expansion and focus transfer. Its 14-state run passed with zero
violations and zero incomplete rules (`.cache/ui-proof-MQayyC/`); the frontend
bundle and changed-file lint also passed. No provider redirect or real sign-in
was performed. Other authenticated screens remain outside this evidence.
See [all-UI acceptance](0022-accessibility-acceptance.md) and
[capability convergence](0023-capability-convergence.md) for required follow-up.

### Previously published runtime checkpoint

Verified locally on 2026-10-26 after the targeted dependency updates and native
DevSCIF workspace and sign-in changes in source revision `12ec63b`:

| Run | Result |
| --- | --- |
| Backend unit suite in Linux image | 117 files; 1,839 passed, 22 skipped, zero failures; updated Swagger parameter assertion also passed separately |
| PostgreSQL + Dragonfly | 9 suites; 156 passed, zero failures |
| PostgreSQL + Redis | Same 9 suites; 156 passed, zero failures |
| Built native UI in desktop/mobile browser | Passed against UI files extracted from the final image; real catalog and fixture authentication/action responses |
| Backend TypeScript and changed-file lint | Passed |
| Standalone image on Dragonfly and Redis | Startup/migrations, UI, Vaultix API identity/docs, public MCP, anonymous reference denial, BullMQ and engine restart passed |

The local verified image is `vaultix:hosted-verify`, image ID
`sha256:9abd59f3403008d509597c306bdb94a9a6aeb4e214606d69ff2e65d550214d4c`.
It was built from `core/Dockerfile.standalone-vaultix`. Docker Desktop reassigns ephemeral ports
on restart, so the smoke runner resolves the published port again before
checking recovery.

GitHub [run 40350888894](https://github.com/shippinAI/vaultix/actions/runs/40350888894)
also passed for source commit `12ec63baab380944e19b1179400067d8687a77d3` and
published the independently built engine image on 2026-10-26:

```text
ghcr.io/shippinai/vaultix:12ec63baab380944e19b1179400067d8687a77d3
sha256:c6fd5587ef4f0c2330a1b3010dd9f6a4a92c22c27ba00b4af3ced287b9567f34
```

The `latest` and `0.162.19` tags were pushed to that same registry digest.
Registry pulls require authentication: an independent anonymous manifest request
returned 401. The digest above comes from the successful CI push, not a claimed
anonymous/local pull of that registry artifact.
The run retained browser screenshots, the dependency audit, and JSON capability
results. Downloaded reports confirm 1,839 unit tests passed with 22 skipped and
156 database tests passed per cache, with zero failures. Both image smoke tests
and the browser checks passed. Publication is a development checkpoint, not
deployment or acceptance of the hosted service. Whole-tree authorship and the
Vaultix.cloud/DevSCIF.com suite review are tracked in
[0021](0021-product-authorship-review.md).

Browser coverage includes all three authored AI connection options, exact
clipboard output, reference-name copying and filtering, keyboard entry,
desktop sidebar bounds, mobile wheel scrolling, denied/empty states, and
rejection of unsupported catalog content and external MCP connection paths.
The revised sign-in layout is also checked at desktop and mobile sizes.
The mobile wheel test reproduced the inherited page overflow bug before the
native workspace gained its own scroll container, then passed after the fix.
Screenshots were reviewed; fixture sign-in is not real Nomen acceptance.

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
