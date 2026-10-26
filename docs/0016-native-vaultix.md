# Native Vaultix migration

Accepted product direction, 2026-10-25. Owner: AngryVibes LLC.

Release priority updated 2026-10-26: hosted Vaultix first. Implement and prove
the code before offering the hosted service. Track capability evidence in
[0018](0018-hosted-capability-proof.md); an enabled plan flag is not a test.

Vaultix is a secrets product built in `core/`, with a native UI and API, and
Clyffy as its AI specialist. Software capabilities are included for every
deployment. Hosting, support, and the user's AI subscription are separate
services. Membership is not a security-feature paywall.

This supersedes the paid-tier policy in 0013 and the requirement in 0011/0014
to deploy the panel beside the engine. It does not authorize a second vault,
an authentication runtime fork, or work on mesh. Nomen remains the identity
boundary. The existing encrypted engine and its migrations remain the store.

## Landed in this migration

- Core routes under `/api/v1/vaultix` serve product identity, the authored
  catalog, configure steps, specialist instructions, and read-only MCP.
- The core frontend home route renders those same catalog/configure objects.
  The authenticated application still uses the existing core routes and store.
- The core feature service supplies included capabilities locally. It has no
  license client, seat billing, trial mutation, or license polling job. Existing
  permission checks still control who can act. The Go sidecar has the same
  included policy. Legacy license settings are ignored at startup.
- All panel feature grants include the same capabilities. Operational switches
  remain opt-in; an included capability does not bypass approval or RBAC.
- Dragonfly is the default local Compose cache. Explicit Redis and ElastiCache
  configurations are accepted by the existing Redis-protocol clients. The
  Node launcher passes the resolved configuration to the Go sidecar.
- GHCR uses the same `Dockerfile.standalone-vaultix` as local builds. The panel
  is an optional profile. AI instructions are baked into the engine image.
- Broken source filenames and three fictional package coordinates from the
  earlier text replacement have been repaired. Third-party packages retain
  their actual published coordinates through pinned Vaultix import aliases.

## What inclusion means

The feature policy enables the existing capability checks. It is not proof
that every inherited workflow is correct or fully rewritten. In particular,
FIPS capability access is not a certification claim, HSM features require
hardware/configuration, and provider integrations need credentials and tests.
Audit retention currently defaults to 365 days. Rate limits remain operational
controls. Seats, projects, identities, and environments have no paid limits.

Do not change third-party notices or claim that all inherited code has become
MIT merely because the product is free. Preserve the archived operator grant
and component provenance while rewriting code in place.

## Remaining release gates

### Local verification, 2026-10-26

- Backend and frontend TypeScript checks and production bundles passed.
- The Go sidecar builds; its included-feature/cache configuration tests and
  vendored permission evaluator tests passed. The panel suite passed.
- The backend unit suite passed 1,838 tests with 22 skipped. Native API, MCP,
  feature policy, reference input, and cache tests are included.
- Desktop and mobile browser checks passed for catalog rendering, navigation,
  connection copying, overflow, and rejecting unknown catalog components.
  These checks used mock authentication, not a working Nomen session.
- Ownership guards, shell syntax, and configuration parsing passed.
- Root CLI tests have an existing Windows failure in
  `TestRoundTripEncrypted`: its Unix `0600` assertion sees `0666` on Windows.
  This needs platform-specific permission verification; it was not suppressed.
- The standalone image built and passed startup/migration, UI, packaged AI
  instructions, MCP, BullMQ and engine restart smoke tests against Dragonfly
  and Redis. Real
  database tests now cover secrets, approval policies, native reference reads,
  tenant isolation, delegated scopes, identity tokens, environments and SCIM.
  Full evidence and remaining release gates are tracked in 0018. AWS
  ElastiCache verification remains unexecuted.

### Acceptance work

| Area | Required acceptance evidence |
| --- | --- |
| Image | Build the standalone image; start it against PostgreSQL and Dragonfly; verify migrations, health, UI assets, and restart recovery. |
| Secrets | Create/update/version/rollback/delete in the real database; ciphertext at rest; no values in metadata, logs, or AI output. |
| Native API | Move project, environment, secret metadata, write, and single-use injection flows into the versioned native contract using existing services and authorization. Legacy `/api/v1`–`/api/v4` compatibility routes are not a metadata-only model API. |
| UI | Replace the remaining inherited authenticated screens with authored Vaultix workflows in `core/frontend`; test keyboard, empty, loading, failure, and permission states. |
| Nomen | Verify issuer discovery, audience, token exchange, session ownership, expiry, logout, and tenant isolation against the real issuer. |
| Clyffy | Project/reference source actions now share UI/MCP authorization and audit reference reads. Verify real Nomen client sign-in, visible execution history and target-process-only injection. |
| Policies | Cross-tenant denial, scoped RBAC, custom roles, approvals, temporary access, IP allowlists, groups, SSO, SCIM, and identity revocation. |
| Automation | Rotation/retry/rollback, dynamic leases and revocation, sync retries, event subscriptions, and failure recovery. |
| Audit | Audit retention and exports, streaming, tamper evidence, sensitive-field redaction, and operator access controls. |
| Security services | Secret scanning, honeytokens, KMS/HSM, certificates/PKI, PAM, gateways, and provider-specific enterprise connectors. Inventory and test each provider before declaring parity. |
| Cache | Real Redis and Dragonfly queue/Lua/TTL/pubsub/restart tests; ElastiCache TLS/ACL/failover/cluster tests in AWS. |

Implement these by replacing modules in place and preserving data migration
paths. Do not delete working engine capabilities in favor of a new small store.
Do not mark this migration complete based solely on entitlement or unit tests.

Read [cache deployment](0017-cache-deployment.md) and
[Clyffy instructions](../core/ai/README.md) before changing those boundaries.
