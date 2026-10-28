# Native identity scoped revocation

Status: scoped implementation and local image acceptance verified, 2026-10-27.
Workstream: AUTH-01, following [0037](0037-native-identity-claim-presence.md).

## Source contract and plan

The existing TypeScript revocation reader checks active markers on the primary
database, matching both token/identity IDs and client-secret, authentication-method
or organization scopes. Its evaluator distinguishes a null scope from an explicit
empty scope. Only an unscoped exact-token marker denies regardless of issuance
time; identity-wide and scoped markers deny tokens issued strictly before the
revocation timestamp, falling back to marker creation time when needed.

At `aa914b05c1fb63a5e60a3e8a4f7eb028a6b71539`, the Go authenticator reads only
token/identity IDs through `Replica()`. It never loads scope markers. First
reproduce the difference using two real universal-auth client secrets for one
identity: both tokens work, revoke one secret through the authorized API, then
check denial and the unaffected secret through HTTP and both Go entry points.
Keep all credentials within the isolated fixture.

Repair the existing validator and revocation reader in place. Carry the decoded
client-secret ID and resolved method/organization through both current and legacy
token paths. Read the existing table on the primary with indexed equality arms;
do not introduce a new store, schema, authorization bypass or forwarding layer.
Preserve error messages, strict timestamp boundaries and fail-closed DB errors.

## Acceptance

- Capture the real API baseline before changing production Go code.
- Verify actual client-secret revocation and an unaffected-secret control.
- Separately label signed-token/database fixtures covering each scope, identity
  isolation, expired markers, legacy fallback, timestamp boundaries, null versus
  empty scopes and scope markers whose IDs collide with a token ID.
- Exercise primary routing and unavailable-primary failure without claiming
  that a single-database fixture proves replication or failover behavior.
- Run Go unit/race/lint and integrations against Dragonfly and Redis. Build
  `core/Dockerfile.standalone-vaultix`, then run canonical image/browser gates.
- Record exact reviewed blobs, evidence and limitations; commit and push.

Other authoritative reads, token-budget cache lifetime, expiry-free legacy grace,
legacy tenant binding, Nomen registration and full native cutover remain separate
acceptance gates. No enterprise-wide or whole-tree parity claim follows from this
packet. Existing operator data and local credentials are not test fixtures.

## Baseline and implementation record

The real-image baseline is `.cache/go-proof-OXwvzO/result.json`. It uses the
preceding canonical image `sha256:2a9ddfb139a81ffc9397f02eb8c1e2e47b6ef7daa5f85ddc330b6f6518014b70`
and immutable old-production Go runner
`sha256:890db6872e82392138ae2a65904cb7367134c3b89e5c299dae6a213a417f7a18`.
HTTP denies the revoked secret and the unaffected secret remains valid through
HTTP and Go. Both Go denial assertions fail because validation returns no error.
The fixture issues and revokes actual credentials; it never prints them.

Two earlier fixture attempts stopped at the revoke POST with HTTP 415 because
the request lacked a JSON body (`go-proof-qyqKdC` and `go-proof-qDaN1Z`). Adding
an empty JSON object fixes that fixture request. Those setup failures are not
counted as reproduction of the authentication defect.

The existing authenticator now supplies signed client-secret metadata plus its
resolved method and organization to `apiauth/revocation.go`. This is the native
revocation implementation in the same service and existing encrypted-store
architecture; it makes no call to the TypeScript business logic. The reader uses
the primary, preserves token/identity lookup, adds a scope lookup with `UNION ALL`,
and binds identity and expiry in both arms. It distinguishes SQL null from an
empty scope, tolerates duplicate rows and preserves exact error messages and
strict timestamp comparison. No schema or token wire-format change is required.

Initial lint rejected a heavy value parameter and a dynamic format string;
the context now passes by pointer and the error constructor uses a literal
format. The intermediate image was not installed. Final verification follows
against the corrected source, with signed/DB fixtures labelled separately from
the actual client-secret lifecycle.

Corrected Go runner:
`sha256:d802c0eda17f3e6f14e6fbd623e8665e2b6c1a0860719df2f8ff663c6d021d13`.
All 564 unit tests pass with race detection in
`.cache/revocation-go-unit-final.jsonl`; lint reports zero issues in
`.cache/revocation-go-lint-final.log`. The canonical standalone build is
`sha256:b2e141a70cec2e8c03f1c6631301cefba1c29a6ebf02d9355502cfd3f59c77ee`
(`vaultix:revocation-verified`). Dragonfly integration/race verification passes
263 tests with eight unavailable external-KMS skips in
`.cache/go-proof-rviVwm/result.json`. This includes the real revoke endpoint and
both Go validation entry points, plus separate complete/legacy signed fixtures.
The first Redis run, `.cache/go-proof-6grnEE/result.json`, passes 166 tests with
eight provider skips, then fails before any test in `secretmanager/secrets`
completes. The package fails during setup after 144.399 seconds. The original
runner retained outcomes but no safe setup classification, so its root cause is
not established; elapsed time alone is not evidence of a timeout. An isolated
secrets-package rerun passes all 97 tests in `.cache/go-proof-Z5XNy0/result.json`.
The complete Redis rerun then passes all 263 tests with eight provider skips and
no setup diagnostics in `.cache/go-proof-10RYK1/result.json`. Neither rerun
establishes the original failure's cause or proves it fixed. Retain this as an
operational-repeatability finding.

`scripts/go-test-evidence.mjs` now preserves enumerated setup phases and causes
alongside outcomes. It discards raw subprocess messages and response bodies.
`scripts/test-go-test-evidence.mjs` verifies that credentials embedded in malformed
lines, HTTP failure bodies, successful events and arbitrary output never enter
the result; ordinary test names containing “timeout” do not become setup failures.
The existing runner uses this collector, and GHCR checks invoke its test. Local
verification passes; the GitHub step remains unexecuted while Actions is blocked.

Both canonical-image smoke suites pass in `.cache/revocation-image-dragonfly.log`
and `.cache/revocation-image-redis.log`, including migrations/startup, MCP, queue
delivery and engine restart. The real packaged application run passes in
`.cache/app-image-proof-5PJBz6/workflow-result.json`; real sign-in and project/
environment operations remain distinguished from injected recovery/chart fixtures.
API error evidence is `.cache/api-error-proof-05cASv/result.json` and
`.cache/api-error-proof-wv4qtp/result.json`. The baseline remains 273 UI routes and
2,290 API operations. The separate eager-upload transport limitation is unchanged.
No TypeScript business logic, frontend production source or schema changes in
this packet; their prior scoped evidence is retained, not represented as a new
whole-product verification.

## Publication constraint

GitHub runs `40606134437` and `40606134791` for preceding commit `aa914b0`
failed before executing any steps. Their check annotations report account payment
failure or a spending limit requiring adjustment. This is an external Actions
account constraint, not a passing CI result or a published image. Local proof and
git pushes can continue; GHCR publication requires separate confirmation.

## Follow-up source review

The following complete files were read while verification ran. Their records are
`reviewed` with an investigation decision, not authored or migrated. No code in
these files changes in this packet.

- `backend-go/internal/config/config.go`, `config/loader.go` and
  `server/api/platform_services.go`: native configuration currently omits the
  issuer's identity lifetime policy. Go's recovered counter has a fixed 30-day
  lifetime; TypeScript defaults to a configurable 90 days. The native constructor
  receives only the signing key for this policy. Optional numeric/bool parsing
  silently defaults on malformed inputs. Cloud derivation still depends on a
  license-server key; mixed-case primary-instance/gateway names and inherited
  integration identifiers need a separate consumer/compatibility review.
- `backend/src/lib/config/env.ts`, `lib/ms/index.ts` and `lib/zod/index.ts`:
  environment strings are trimmed before defaults. The duration helper delegates
  to the installed `ms` package; a nonmatching string can yield `undefined` and
  then `NaN` in the maximum-age transform. Existing no-expiry legacy grace is
  deployment-date anchored. These identity policy fields are not runtime
  override fields. Configuration authorship must also address the existing
  cloud derivation, cookie-signing default and integration override metadata;
  none is fixed by reading or renaming the file.
- `backend/src/server/plugins/go-sidecar.ts` and `backend-go/cmd/vaultix/main.go`:
  the launcher passes resolved cache aliases and an inherited environment; native
  startup loads config and constructs services. A future policy change must work
  in the Go process independently of that launcher. Supervision's elapsed-time
  reset is not an application-health probe. This review does not establish live
  native cutover, failover or Nomen ownership.
- `scripts/publish-github.sh`: the legacy script stages a fresh repository,
  excludes canonical standalone Dockerfiles and offers force-pushing existing
  main. It was not executed. Replace it in a separate publication packet with
  checked-history, non-force publication and executable failure-path tests.
  Current delivery uses ordinary commits and non-force pushes.

Paths in this list are relative to `core/` except `scripts/publish-github.sh`.
These findings are source evidence and pending work, not demonstrated production
incidents. The next authentication packet should reproduce the expiry-free
legacy and counter-retention differences before changing lifetime policy.
