# Cache counter contract

Status: scoped counter repair locally accepted, 2026-10-27. Workstream: AUTH-01 fixture foundations.

The complete Go `internal/keystore/memory.go` and `keystore.go` were read.
The memory implementation serializes increments as Unicode code points but
parses decimal strings. It also silently ignores non-digit characters and
integer overflow. Consequently, a repeated-use authentication test can behave
differently from the production Dragonfly/Redis counter. The only existing
integration usage-limit test seeds zero and never exercises a decrement.

Trace the actual `checkAndDecrementUsesRemaining` consumer. Characterize decimal
increment/decrement, signed 64-bit boundaries, rejected input with unchanged
state, expiry preservation, expired-key initialization and concurrent increments.
Exercise the memory implementation and real supported cache providers. Add a
consumer regression proving exactly the seeded allowed uses followed by denial.
Retain all inherited auth tests; do not claim a test double proves provider or
Nomen behavior.

Use standard integer formatting/parsing and explicit overflow checks under the
existing lock. No encrypted-store, token format, permission or live cache change
is required for this repair. Do not log counter contents. The memory store's
placeholder stream operation and other methods need separate contract review;
this packet does not turn it into a production cache.

Review also found the consumer's missing-counter read/reseed sequence is not
atomic. Concurrent recovery can exceed the intended use bound. Characterize that
separately against the real cache before changing recovery semantics shared with
the TypeScript issuer/validator. Fixing numeric serialization does not resolve
that production recovery risk.

The complete TypeScript identity-token service and keystore were then read for
the next packet. Renewal also reads a remaining count and later writes that
snapshot back, which can restore uses consumed concurrently. Preserve remaining
budget and expiry without overwriting a live counter when repairing recovery.
These findings are not resolved by the memory-store change.
Characterization confirms both: a forced shared cache-miss read allows all 24
concurrent requests with a five-use limit in Go (`.cache/recovery-before.jsonl`)
and TypeScript; renewal restores a consumed use in the TypeScript service
(`.cache/usage-ts-before.json`, 45 existing passes and two new failures).
These temporary failing experiments are preparation for the next repair, not
passing acceptance evidence for this packet.

References: [Redis INCRBY](https://redis.io/docs/latest/commands/incrby/) and
[expiry behavior](https://redis.io/docs/latest/commands/expire/). Compare actual
Dragonfly and Redis results for canonical integer text and expiry rather than
assuming every edge case is identical from documentation.

Preceding commit `0da8031` is pushed. Its canonical request-error image is
`sha256:0726fe6b9fa18bab22cd3c02cee6d275d15f7e0af1721905eac61a5571675418`.
The scoped acceptance and eager-upload transport gap are recorded in [0034](0034-api-request-errors.md).

## Repair and evidence

`IncrementBy` now uses canonical signed decimal text, checks signed 64-bit
overflow before mutation, preserves live expiry and initializes expired keys
without their old expiry. Invalid counter text returns a static error without
changing the stored value or expiration. Operations remain under the same mutex.
No live Dragonfly/Redis implementation or authentication policy changes here.

The preceding source fails the new decimal/boundary/concurrency/consumer tests
(`.cache/counter-before.jsonl`: 16 failing test/subtest events). The repaired
backend Go unit suite passes 473 tests with race detection
(`.cache/counter-go-unit.jsonl`). The real cache contract tests pass against
Dragonfly and Redis (`.cache/counter-dragonfly-final.jsonl`,
`.cache/counter-redis-final.jsonl`), covering matching integer acceptance,
unchanged invalid/overflow state, repeated decrement, live expiry, expired-key
initialization and 64 concurrent increments. The first isolated integration
attempt omitted the database required by the shared fixture configuration and
failed before tests; the final fixture supplies that dependency rather than
disabling validation. `make lint` passes (`.cache/counter-go-lint-final.log`).

Canonical image `sha256:6a728c527fc2746d53e0e27c365872631de73a4802198d086e0c3d71ad7567b9`
builds from `core/Dockerfile.standalone-vaultix`. Dragonfly smoke/restart/API
checks and the packaged browser workflow pass (`.cache/counter-image-smoke.log`,
`.cache/app-image-proof-opnKQi/workflow-result.json`). This packet changes a test
store, not the authored UI; its retained workflow proof does not establish a
new UI capability, Nomen acceptance or whole-product migration completion.

The first complete Dragonfly run failed in authentication-package setup before
any of its 53 tests ran (`.cache/go-proof-yrjGhv/result.json`: 165 passes elsewhere,
8 provider skips, one package failure). The bounded report does not retain the
underlying setup diagnostic, so its exact cause is not asserted. The isolated
same-image authentication rerun passes all 53 tests in 38.188 seconds
(`.cache/counter-auth-dragonfly-retry.jsonl`). Redis's complete run passes all
218 tests with 8 provider skips (`.cache/go-proof-iKp3eQ/result.json`). The final complete Dragonfly rerun also passes 218 tests with 8 provider skips
(`.cache/go-proof-AA0IUB/result.json`). Setup reliability is not proven by a
passing retry. Committed CI/publication remains a separate gate.
