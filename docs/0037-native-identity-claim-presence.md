# Native identity claim presence

Status: scoped implementation and local real-image acceptance verified, 2026-10-27.
Workstream: AUTH-01, following [0036](0036-identity-use-budget-concurrency.md).

## Source and behavior

The complete Go claim definitions, authenticator and its unit/integration suites
were read, together with the TypeScript identity-token helpers. The relevant
wire contract distinguishes an absent lifetime claim from a numeric zero.
Zero TTL/maxTTL/period is supported by the existing universal-auth API; issuance
still bounds the actual JWT expiry using the configured maximum age.

At source commit `161ec62362c8ab6eb581b124c07833cec47bb903`, Go `claims.go`
has blob `11137984df5735a4f3654998cf3e8b95e1603d8b` and its unit suite
`authenticator_test.go` has blob `4e7d88f0a66161396b2a77b74882afa52ec151d5`.
Go currently uses a positive TTL/period to identify full claims. This sends
fully specified zero-budget tokens through legacy database lookup, while accepting
positive-TTL payloads without all lifetime anchors as complete. The isolated
JSON-decoding regression in `.cache/claims-presence-before.jsonl` fails in both
directions. No production or fixture token is printed by these checks.

Real-image baseline `.cache/claims-real-before.jsonl` confirms an unchanged
API-issued zero-budget credential succeeds over HTTP, has no eager token row,
then fails Go validation as an unknown legacy token. A separate signed-fixture
baseline in `.cache/claims-legacy-before.jsonl` shows that missing maxTTL, period
or creationEpoch incorrectly bypasses a legacy row's revoked flag. Its missing
TTL control already denies. These fixtures use the canonical preceding image
and isolated database/cache; no operator data is changed.

## In-place implementation

Represent the four optional lifetime fields with `*int64` in both existing Go
claim structs: TTL, maxTTL, period and creationEpoch. Nil represents absent/null;
a non-nil zero remains numeric data. Carry them through the existing unified
conversion and require every field alongside the existing jti, tenant and auth
method fields. Retain the existing JWT parser and signature validation. No custom
parser, second store, schema migration or token wire-format change is needed.

Retain all inherited tests. Update fixture literals to deliberately represent
complete versus legacy claims; they must not accidentally omit required anchors.
Add decoded-field, conversion and serialization tests and a real API-issued
zero-budget credential check. Demonstrate the real-token baseline failure before
repair, then exercise unchanged credentials through both Go validation entry points.

## Acceptance and limits

- Complete explicit-zero and positive budgets classify correctly. Each omitted
  or null lifetime field falls back to legacy lookup; invalid JSON field types
  fail decoding. Tenant, method and token-ID requirements remain intact.
- A real universal-auth credential with zero configured TTL/maxTTL is accepted
  by the existing API and Go without requiring an eagerly written token row.
  Missing token-row behavior is observed, not manufactured by deleting rows.
- Preserve inherited signature/expiry, user/identity, tenant, revoked-token,
  IP, limited-use and legacy database constraints. Run Go unit/race/lint, both
  real-cache integration suites and the canonical image/browser gates.
- No claims of full native authentication cutover: scoped revocation, primary
  read freshness, configurable counter lifetime, expiry-free legacy grace and
  Nomen ownership remain separate gates.

The implementation now passes 516 Go unit tests with race detection
(`.cache/claims-go-unit.jsonl`). The original classification cases remain, with
complete fixture anchors and additional missing-field cases. New wire tests
cover each absent/null/zero/positive field, invalid integer representations,
both claim structs, unified conversion and zero-preserving JSON serialization.
The signed unit token exercises the existing parser. Final lint passes with
zero issues (`.cache/claims-go-lint-final.log`). The complete Dragonfly
real-image integration suite passes 225 tests with eight external KMS skips
(`.cache/go-proof-TNtYOZ/result.json`), including the real zero-budget credential
and four incomplete-claim/legacy-revocation cases.

Canonical image: `sha256:ffe4bbd23b856ba3800395691a9f14f0014dd274e3bc94f8740ea2911e6fde05`
(`vaultix:claims-verified`). Final Go integration runner:
`sha256:2ea8dbb3d3399accb93ddf700b2929eb50f485fd90d07c8e5504ee33b815d882`.
The unit run preceded addition of the legacy integration fixture; its production
and unit-test sources are unchanged in the final runner. Redis also passes the
complete 225-test integration/race suite with eight external KMS skips
(`.cache/go-proof-teQVEL/result.json`).

Both image smoke/restart/MCP/queue gates pass in
`.cache/claims-image-smoke-dragonfly.log` and `.cache/claims-image-smoke-redis.log`.
The packaged application workflow passes in
`.cache/app-image-proof-iVxZeL/workflow-result.json`, with real operations and
injected recovery/chart fixtures separately labelled. Request-error reports are
`.cache/api-error-proof-ivHrrI/result.json` and
`.cache/api-error-proof-1TMQwg/result.json`; eager-upload transport remains a
separate limitation. The preserved surface is still 273 UI routes and 2,290 API
operations. No TypeScript or frontend production source changes in this packet.
Publication and hosted topology require their own acceptance.

This is a reader correction using the existing issuer and encrypted store.
Rollback would restore the classification regression. The canonical image must
pass before replacing the verified development image. The preceding `161ec62`
checkpoint is pushed, and image `8c6227ca6c15906072cda4ee3e2563f4589f183fe9490547d546fee830139dfb`
is healthy locally with API port 8200 and source UI port 3000 both returning 200.
