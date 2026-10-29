# Production request admission

Scope: Vaultix.cloud and self-hosted production deployments. This is a scoped
repair toward CLOUD-01/05/07 in [0054](0054-public-cloud-service.md), not closure
of those gates or a public-cloud capacity claim.

## Observed behavior and change

The application registered its inherited API limiter only when production mode
and license-derived `isCloud` were both true. Ordinary standalone installations
therefore did not enforce configured login and other inherited route budgets.
Native Vaultix routes separately registered an in-memory limiter, allowing each
replica and restart to create another budget.

Production now registers one cache-backed limiter independently of license keys
or `VAULTIX_CLOUD`. Native routes inherit that limiter; development and isolated
native route tests retain local limits. Route-specific budgets are preserved,
including 60 authentication requests and 120 native guidance requests per minute.
These are per route and resolved client address, not tenant quotas. Configured
route limits replace the default 600-request budget; they are not a second
aggregate limiter. Health/status exceptions remain unchanged.

The limiter uses its own cache connection with a two-second command timeout,
one retry per request and no offline queue. Cache errors do not admit requests
or switch to local memory. The dedicated connection disconnects on server close.
Queue clients retain their existing retry policy. Direct Dragonfly and Redis
outage behavior is covered by the packaged proof; cluster/Sentinel/ElastiCache
failover and timing need separate deployment acceptance.

MFA budgets retain their per-credential partition but use SHA-256 digests instead
of storing bearer credentials in cache keys. Existing raw-key buckets expire
within their existing one-minute window. This changes the bucket once during
upgrade. No database, token verification, permission or secret-store format is
changed. Native overload responses return a plain error string and `Retry-After`.
Cache failure currently uses the sanitized server-error response; a dedicated
dependency-unavailable UI and service status remains follow-up work.

## Deployment and compatibility

Use one shared cache for replicas of the same Vaultix deployment. Separate
deployments must not share a cache keyspace. Configure controlled reverse-proxy
peers explicitly as described in [0058](0058-trusted-proxy-boundary.md); requests
behind an unconfigured proxy share its socket address and therefore its budget.
Software capabilities remain included. Operator rate-limit configuration and
authorization remain in effect; existing instance configuration sync is retained.

This intentionally begins enforcing limits on production deployments that
previously had none. Clients must honor 429 and `Retry-After`. Static UI files, the runtime UI configuration and application shell do not consume
API budgets; API paths remain metered. Static delivery needs separate edge
capacity and abuse controls.
Development mode is unchanged. No public domain, TLS configuration, owner
account, database or cache volume is provisioned by this packet.

## Evidence and remaining work

`scripts/test-production-admission.mjs <image> <dragonfly|redis>` creates two
replicas against disposable PostgreSQL and cache, with no license keys. It checks
shared authentication and native budgets, forwarding-header rotation, independent
routes, replica restart and bounded denial during cache loss. It removes only its
own containers/network. It emits status-only evidence, never credentials or raw
HTTP payloads. Both cache variants are mandatory in `build-self-hosted.mjs`.

Unit coverage uses the actual Fastify limiter and native router with a simulated
shared cache, including one count per request, 429/error mapping, credential-key
redaction, development fallback, required production cache and connection cleanup.
Build-orchestration fixtures verify both image gates and failure propagation.
The accepted source/image receipts are recorded below.

The first packaged run found a regression: repeated real UI navigation exhausted
the shared fallback budget through static assets, then returned 429 JSON in place
of the application shell. Static delivery is now identified from server route
metadata and excluded from API accounting. The real browser checks were kept
unchanged. The runner now records safe failure phase/status details and observes
pending response-wait rejections so cleanup cannot mask the primary failure.

The complete changed application, limiter configuration, native router and cache
factory files were read, with registration order, route authentication hooks,
instance limit injection/sync, installed Fastify Redis store, error handlers and
cache callers traced. Retained behavior outside this scope is not fully authored.
Source review is recorded by exact blob in `docs/code-audit/reviews.json`.

Still open: account/tenant admission across addresses and endpoint aliases,
distributed fairness, invalid-auth cost before `preValidation`, parser/connection
abuse, edge/static admission, clock/window and provider failover behavior,
cache durability/eviction, measured load/soak, public issuer enrollment and the
rest of CLOUD-01 through CLOUD-08. Two replicas in this proof are not an HA or
scaling topology. No whole-product parity or complete accessibility claim.


## Accepted image evidence

Source: `3be1241e662c5ae9b90c4fc2f7a535adde13b7f3`.
Canonical image: `sha256:18acc6ba1fdf6c1e7c56bd3a10115fa0887b5f56af485b6b10bdfe91c7c74755`.
All paths below are relative to the main checkout. Evidence is local and ignored;
the committed runners reproduce it on owned infrastructure.

- All 15 application build gates passed:
  `.cache/production-admission/.cache/self-hosted-build-xU4kp0/result.json`.
- Shared production admission: four checks per cache, cleanup passed:
  `.cache/production-admission/.cache/production-admission-dCRQlj/result.json`
  (Dragonfly) and
  `.cache/production-admission/.cache/production-admission-FMV5mX/result.json`
  (Redis). Both replicas enforce 60 login / 120 catalog requests, retain the
  budget across application restart and deny requests on cache loss.
- Real browser application and workflow acceptance:
  `.cache/production-admission/.cache/app-image-proof-jSuERH/workflow-result.json`.
  Setup, sign-in, project creation, five product categories, secret/environment
  operations and separately labelled recovery fixtures passed. Existing manual
  accessibility review items remain; this does not establish all-UI WCAG compliance.
- Encrypted recovery: nine checks, cleanup passed:
  `.cache/production-admission/.cache/encrypted-recovery-jz2WM3/result.json`.
- Tenant isolation: eleven checks, cleanup passed:
  `.cache/production-admission/.cache/tenant-isolation-FccsTn/result.json`.
- Proxy authority: four checks, cleanup passed:
  `.cache/production-admission/.cache/proxy-boundary-FJbGfD/result.json`.
- Backend unit: 126 files, 1,953 passed and 22 existing skips:
  `.cache/production-admission/.cache/unit-proof-aM66FS/test-results.json`.
  Type checking and targeted ESLint passed.
- Build orchestration: thirteen fixtures passed:
  `.cache/production-admission/.cache/self-hosted-fixtures-UZvSfE/result.json`.
- Previous image reproduction: login requests 61 and 62 still returned validation
  errors instead of 429, with no rate headers:
  `.cache/production-admission/.cache/production-admission-xHWrxa/result.json`.
- First implementation regression: real browser navigation exhausted static/API
  shared accounting; safe failure receipt:
  `.cache/production-admission/.cache/app-image-proof-Gexgsq/failure.json`.
  The accepted image fixes it without reducing browser assertions or rate budgets.

The 273-route UI baseline and 2,290-operation API baseline remain preserved;
the image exposes 2,291 documented operations with the previously added learning
endpoint. These counts are surface continuity, not blanket behavioral parity.
No paid GitHub runner, registry publication or public deployment was used.
