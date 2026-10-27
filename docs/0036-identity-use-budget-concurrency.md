# Identity token use-budget concurrency

Status: scoped implementation and local real-image acceptance verified, 2026-10-27.
Workstream: AUTH-01. Preceding scoped counter repair: [0035](0035-cache-counter-contract.md), commit `44b7523`.

## Read and traced

The complete Go authenticator, TypeScript identity-token service and its unit
suite, TypeScript keystore, and identity-token database integration suite were
read. Issuance, validation, renewal and revocation share
`identity-token-uses-remaining:<identityId>:<tokenId>` in the existing cache.
The same token ID survives renewal. Go validation uses the existing keystore
interface; TypeScript uses its existing cache factory and service composition.
No new database, encrypted format, model API or identity runtime is needed.

Both validators read a missing counter and unconditionally seed `limit - 1`,
allowing that request. A synchronized 24-request cache miss with a limit of five
therefore allows all 24 in both implementations. Temporary regression evidence:
`.cache/recovery-before.jsonl` and `.cache/usage-ts-before.json`. A second
TypeScript regression confirms renewal overwrites a count consumed after its
initial read. The TypeScript baseline retains 45 passing tests and adds two
failing cases; these failures must remain reproducible before the repair.

## Required behavior and implementation

1. Recover a missing limited-use counter with the existing atomic SET-NX command
   and the full configured budget. Every request then performs its own atomic
   decrement; a competing recovery must never replace the live count. Existing
   zero/negative counts continue to deny. Cache operation errors deny access.
2. Renewal may initialize a still-missing key using the previously observed
   remaining budget (or configured budget when no state existed). It must never
   overwrite a live count. Refresh the existing expiry without changing the
   count; a vanished key at expiry refresh must not return a renewed token.
3. Retain signature, issuer claims, expiry/maxTTL, membership, IP and revocation
   checks and the existing error contract. Unlimited tokens remain unlimited.
   Requests denied later in the workflow can still consume an authorization use,
   as before; this is not a business-action success counter.
4. Test concurrent cache misses, exhausted/invalid state, cache failures, renewal
   racing a decrement, ordinary renewal and TTL preservation, plus retained
   lifecycle and cross-tenant tests. Exercise both real cache providers and the
   canonical standalone image. No blanket authentication parity claim.

SET-NX plus atomic decrement is sufficient for competing initialization without
introducing a second lock or store. Expiry/cache loss between commands may deny
a request; it must not grant one without a successful decrement. Keep errors
free of token/cache contents. Existing cache-loss recovery can restore budget
after state loss: this packet does not make usage accounting durable across
cache flushes, eviction or disaster recovery.

## Separate migration gates

The Go authenticator still has a hard-coded 30-day counter lifetime, while
TypeScript reads the configured maximum age. Its revocation query covers token
and identity IDs but not all TypeScript scoped markers; several authorization
reads use replicas. These require explicit parity and stale-read tests before
native cutover. Forwarding registration is currently disabled; optional shadow
requests reuse credentials and can consume another authorization use. Shadowing
defaults off and is not a safe production parity proof for limited-use tokens.
Do not enable it to claim this migration complete.

Go also identifies full renewal claims by positive TTL/period values, whereas
TypeScript checks field presence. Fully specified zero-TTL tokens need separate
classification and legacy-fallback acceptance; this packet does not change it.
An isolated baseline in `.cache/claims-presence-before.jsonl` reproduces both
zero-budget misclassification and acceptance of a positive TTL without the
creation-time anchor. Those failures remain outside this counter repair.

The TypeScript memory/legacy mock stores also contain incomplete expiry and
numeric behavior; they are not real-cache evidence. Existing database tests use
the configured real cache. Retain provider/hardware skips and Nomen-registration
requirements. The current async WI/TX target/Nomen documentation question does
not block this independent repair.

## Cutover

Use the same existing counter keys and values. The change only prevents an
unconditional overwrite; no migration or new writer is introduced. A rollback
would restore the known concurrency defects, so do not use rollback as evidence
of readiness. Preserve the route/API baseline, build
`core/Dockerfile.standalone-vaultix`, run the acceptance gates, then commit and
roll the verified image into local development.

## Implementation evidence

Both existing validators now initialize with SET-NX and decrement every accepted
use. Renewal refreshes expiry without replacing the live budget and refuses a
key that disappears before expiry refresh. No key format, schema or token format
changes. The Go integration fixture uses an unchanged API-issued token, consumes
uses through the real HTTP API and then validates concurrently through Go with
the same real cache. Its barrier schedules counter reads only; it does not mock
authentication, database results or atomic cache commands.

- TypeScript unit suite: 1,864 passed, 22 existing skips, 119 files;
  `.cache/unit-proof-LpFt8B/test-results.json`.
- Go unit suite with race detection: 479 passed;
  `.cache/usage-go-unit.jsonl`. `make lint` reports zero issues in
  `.cache/usage-go-lint.log`.
- TypeScript typecheck and scoped source/unit/integration ESLint pass;
  `.cache/usage-recovery-types.log` and `.cache/usage-lint-final.log`.
- Focused real Dragonfly identity lifecycle suite: 12 passed;
  `.cache/core-proof-WUreVp/test-results.json`.
- Full selected database capability suites: 170 passed on each real cache;
  `.cache/core-proof-ddGRfz/test-results.json` (Dragonfly) and
  `.cache/core-proof-vD09cZ/test-results.json` (Redis). Retained secret CRUD,
  approvals, reference isolation, environment, OAuth scope, SCIM and session
  lifecycle checks remain in this suite; provider coverage is still separate.
- Canonical standalone build passes: `vaultix:usage-verified`,
  `sha256:8c6227ca6c15906072cda4ee3e2563f4589f183fe9490547d546fee830139dfb`.
  Go test image: `sha256:f81590220ae98069ef957594862a69964eb5330e7ef603deffa02326af9df3bd`.
- Complete native Go integrations with race detection: 219 passed and eight
  external KMS provider skips on each cache, including the new shared-budget
  test. Reports: `.cache/go-proof-FLprLS/result.json` (Dragonfly) and
  `.cache/go-proof-rG7lz6/result.json` (Redis). No failed first-run tests in
  these two complete runs. This does not establish production load capacity or
  eliminate the separately recorded setup failure from the preceding packet.
- Dragonfly image smoke/restart/MCP/queue and packaged browser workflow pass:
  `.cache/usage-image-smoke-dragonfly.log` and
  `.cache/app-image-proof-oG5dqm/workflow-result.json`. Real sign-in, projects,
  environment lifecycle and navigation remain separate from injected outage,
  read-only and chart fixtures. The packaged Vaultix login artwork was visually
  inspected. Preserved surface remains 273 UI routes and 2,290 API operations.

- Redis image smoke/restart/MCP/queue passes in
  `.cache/usage-image-smoke-redis.log`. Request-error reports are
  `.cache/api-error-proof-yEQssU/result.json` (Dragonfly) and
  `.cache/api-error-proof-eW2OvR/result.json` (Redis); the declared-length probe
  does not resolve the separate eager-upload transport finding in 0034.

Whole-product parity, Nomen, manual accessibility and external provider acceptance
are not implied by these scoped results. Commit publication and the hosted rollout
remain separate gates; the existing development database is preserved on rollout.
