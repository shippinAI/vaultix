# Bounded acceptance of recorded audit events

Current continuation: [worker lifecycle](device-event-worker.md) is implemented
and under canonical verification. Earlier unregistered-worker statements below
describe their original checkpoints. Public device login remains unfinished.

This continues [device dispatch](device-event-dispatch.md). It changes the
existing audit storage and stream-outbox owners in place. It does not register
the device worker or enable public headless login. Canonical acceptance for this increment passed.

## Operation and database ownership

The device dispatcher derives an audit budget from its primary-database lease
and expiry, subtracting elapsed inspection time and a one-second reserve. An
attempt is limited to thirty seconds. The operation uses monotonic elapsed time
and an AbortSignal shared by its actual resource owners. It awaits those owners;
a rejected timeout race is not treated as a stopped operation.

The recorded transaction adapter uses the existing primary or audit database
pool. A pending acquisition can be aborted. Once acquired, one connection serves
the entire transaction; nested reads and writes receive that transaction. An
abort closes that connection and marks it disposed before returning it to the
pool. A normal transaction sets local statement and idle-in-transaction deadlines
of at most five seconds, bounded further by its remaining operation budget.
Those settings do not leak to another borrower. No cache, mail, provider request
or expensive rendering occurs inside these transactions.

The adapter narrows Knex's untyped client interface to the methods it uses. This
is a pinned infrastructure dependency, not an interchangeable database protocol:
Knex 3.0.1, Tarn 3.0.2 and node-postgres 8.13.1 require the real-pool compatibility
tests before upgrades. The shared pool can finish creating a resource after its
pending acquisition is aborted; this does not authorize starting the abandoned
application transaction. Whole-process pool teardown remains a separate owner.

Recorded PostgreSQL storage keeps the source audit identity and existing conflict
behavior. ClickHouse receives the operation's abort signal. A lost response can
mean that an insert happened; cancellation is never proof of non-insertion.
Retry preserves the original identity, timestamp and retention rather than
inventing a new audit event.

## Durable stream acceptance and progress

Recorded fanout reads stream metadata on the primary in pages of at most one
hundred. It reads no provider credentials. Product resolution and the existing
product-filter functions run against the same transaction connection as the
outbox insert. A page commits its accepted pairs atomically, including the case
where every stream in that page is filtered out.

Existing `(streamId, auditLogId)` outbox pairs are excluded from the page query.
Consequently, an interruption after a successful page retains progress: a retry
processes missing pairs, and a failed page cannot leave half its inserts behind.
The in-attempt cursor advances past filtered destinations as well. Current stream
configuration is evaluated at each page; this does not freeze a provider's future
configuration or promise delivery to streams created after acceptance finishes.

Source acknowledgment means that the configured audit storage and eligible stream
outbox rows were accepted. It does not depend on a cache debounce or queue wake-up
returning. The existing overdue-row sweeper subsequently schedules pending rows,
so initial delivery can wait for that sweep. Worker/profile registration must
prove that the sweep is available before device-event activation.

Existing request/ingest callers without a recorded-operation argument keep their
existing behavior. The bounded path accepts one recorded source event at a time;
it does not truncate the eligible stream set. A deadline failure remains a source
failure, with committed outbox pages available to the next attempt.

External delivery retains existing limitations: successful outbox deduplication
rows are pruned after fifteen minutes and exhausted external deliveries are
deleted. Those facts preclude a claim of indefinite deduplication, exactly-once
provider delivery or retained operator repair. The full delivery and operational
requirements remain open.

## Verification obligations

`scripts/verify-device-event-dispatch.mjs IMAGE BACKEND_TEST_IMAGE --recorded-audit`
adds actual recorded-audit scenarios and the unchanged legacy outbox tests to the
existing dispatcher/store/preparation suite. Required evidence covers acquisition
cancellation, query interruption, rollback, pool reuse, local setting restoration,
tenant isolation, product filters, multiple pages, partial progress, retry,
cache loss and overdue-row scheduling. ClickHouse client and HTTP transport
fixtures establish client behavior, not acceptance by a live ClickHouse server.

Static checks, destination compatibility, a deliberately broken disposable
negative control and the canonical image gates remain required. Scheduler
concurrency, real shutdown drain, operational repair, request provenance, approval
UI and CLI consumers are separate unfinished obligations.

Research reviewed 2026-10-31: [Tarn acquisition cancellation](https://github.com/vincit/tarn.js/),
[PostgreSQL 16 statement and session deadlines](https://www.postgresql.org/docs/16/runtime-config-client.html),
and [ClickHouse JavaScript cancellation](https://clickhouse.com/docs/integrations/language-clients/js/index).
Documentation informs the implementation; pinned client behavior is checked
against actual resources and retained regression scenarios.

## Local acceptance checkpoint

All 88 integration scenarios and 122 audit/SMTP unit scenarios passed. Full backend
type checking and changed-file lint passed. Two disposable negative controls
failed only their expected cases: disabling pending-acquisition cancellation, and
removing immutable source binding. Production source remained unchanged. The
original 56 dispatch/store/preparation scenarios and 18 legacy outbox scenarios
remain unchanged; the 14 new cases test actual resource ownership and fanout.

Receipts: `.cache/device-dispatch-store-7EUIaQ/result.json`, `.cache/mail-cancellation-unit-vJdbo4/result.json`,
`.cache/recorded-audit-mutation-fDGEiZ/result.json`, `.cache/device-dispatch-mutation-bx8wGJ/result.json`,
`.cache/recorded-audit-lint.json` and `.cache/recorded-audit-typecheck.json`.
Canonical evidence follows.

## Canonical artifact evidence

Runtime source `0bf0405b4499ad41302d33ea9d588df71a957574` produced
`sha256:b59d87453871e9eaf52a93702efbf2a8c36d7011f7a403dc0877ec60afecdc15`. All sixteen canonical image gates passed.
Fresh disposable stores passed all 88 recorded-audit/dispatch/preparation scenarios,
all 16 destination compatibility scenarios and four actual native-audit checks.
Tested source bytes match the committed image archive. The two negative controls
and 122 unit cases above are exact-source local evidence, not described as rerun
inside the final image. Unchanged schema rollback and Go/session evidence retains
its original artifact and source provenance.

Receipts: `.cache/self-hosted-build-hUCBH0/result.json`,
`.cache/device-dispatch-store-UKrheB/result.json`, `.cache/delivery-destination-store-olQhl4/result.json`,
`.cache/native-audit-image-Yzp2oN/result.json` and `.cache/app-image-proof-y1sbvj/result.json`.
The real application gate exercised email sign-in, projects, secrets and denial
behavior. This establishes scoped regression acceptance, not complete federation,
accessibility or enterprise parity. The device worker remains unregistered.

The actual `onboarding-organization.png`, `login.png` and
`authenticated-projects.png` captures in that application receipt directory were
visually inspected for Vaultix identity, organization-first setup and authenticated
application loading. This visual inspection does not certify all workflows.
