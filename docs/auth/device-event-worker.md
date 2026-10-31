# Device security-event worker lifecycle

This continues [recorded audit acceptance](recorded-audit-acceptance.md) and
[source-bound dispatch](device-event-dispatch.md). Worker registration and its
resource lifecycle are implemented and verified in the canonical image. The public device
authorization, API credential consumers, approval UI and CLI journey remain
separate unfinished requirements. Both built-in Vaultix identity and optional
federation retain the contract in [0074](../0074-built-in-and-federated-identity.md).

## Existing owners and bounded work

The existing source/delivery DAL accepts an explicit recorded-operation context
for claims, preparation pages, lease inspection, acknowledgments, failure
dispositions, notification transactions and retention. Recipient queries accept
the same context and reuse a supplied transaction. These paths acquire from the
existing primary pool, cancel a pending acquisition and close an owned connection
when interrupted. Nested notification reads and writes never acquire a second
connection. Callers without an operation retain their prior contract.

Preparation and dispatch each own a thirty-second attempt. Preparation checks
cancellation before work, after retention lookup, between notice renders and
before committing a page. The production retention provider is the existing
Vaultix feature service's in-memory result. The two security-mail templates are
finite in-memory renders with bounded source inputs. An active render is awaited;
the worker does not pretend it can preempt JavaScript CPU work. A future template
that performs asynchronous external work needs its own cancellation owner before
being used here.

Dispatch passes the operation through recipient eligibility, notification writes
and source settlement. Audit and SMTP budgets remain below the database lease
and delivery expiry, with a reserve for acknowledgment. Interrupted notification
transactions roll back. SMTP acceptance uncertainty remains `unknown`; cancellation
before possible delivery can remain retryable. Disposition cleanup gets a separate
five-second operation so an already-aborted attempt can still record safe state.
If cleanup fails, existing leases and retained records govern recovery.

## Scheduling, profiles and shutdown

The driver has one preparation slot and one delivery slot per process. Each slot
claims one record only when it can start it. A new cycle is scheduled one second
after the previous cycle completes, so timer ticks cannot overlap. Independent
replicas use existing primary-database `SKIP LOCKED` claims and lease fences; there
is no second queue payload or cache lease for this source.

`QUEUE_WORKERS_ENABLED=false` disables the driver. The `all` and `standard`
profiles run it; `secret-scanning` does not. The application starts it from
`onReady`, after service construction and existing stream-sweeper registration.
`preClose` signals cancellation and awaits actual completion, including disposition
cleanup. `onClose` repeats that idempotent stop before the existing shutdown
sequence. The main process closes the server before queue/database teardown.
Stopping a timer or winning a timeout race is not treated as a drained worker.

Once per minute, after its active slots finish, the driver offers the existing
retention owner one page of at most one hundred records. It retains a full year
of settled source/delivery records and preserves active sessions and unresolved,
exhausted or uncertain work. This does not repair the separate external-stream
outbox's shorter deduplication or exhausted-delivery behavior.

Internal counters distinguish prepared pages and handled delivery dispositions.
A handled disposition is not proof that a message arrived or an audit reached an
external provider. Logs contain a bounded generic failure message, never captured
source context, SQL, recipient addresses or SMTP diagnostics. An authorized
operator status/repair workflow remains required; these internal counters are not
that workflow.

Two slots per process are an execution bound, not a public-cloud capacity claim.
Fleet-wide quotas, measured throughput, tenant fairness and recovery objectives
remain subject to the public-service release gates.

## Verification obligations

`scripts/verify-device-event-dispatch.mjs IMAGE BACKEND_TEST_IMAGE --worker-lifecycle`
retains the original 88 recorded-audit/store/preparation/dispatch scenarios and adds
actual worker tests against one-connection PostgreSQL pools. They cover every
source/recipient acquisition boundary, blocked preparation rollback, both active
profiles, inactive profiles, shutdown during rendering and notifications,
independent workers, restart and real SMTP shutdown before and after message data.

`scripts/test-device-worker-image.mjs IMAGE` exercises the assembled application's
profile gates and registration, durable audit/notification effects, two replicas,
shutdown while a database claim is blocked, and restart with the initialized
owner preserved. It uses only disposable infrastructure and test identities.

Required acceptance also includes backend types/lint, deliberate disposable
negative controls, all sixteen canonical image gates and retained destination
compatibility evidence. None of these closes public device authorization,
complete identity-provider acceptance, operator repair or whole-product parity.

Research reviewed 2026-10-31: [Node timer cancellation](https://nodejs.org/api/timers.html#cancelling-timers)
distinguishes removing scheduled callbacks from work already executing. Actual
resource cancellation is tested through the pinned clients and application image.

## Local acceptance checkpoint

All 111 integration scenarios passed, including the unchanged 88 prior cases.
Full backend type checking and changed-file lint passed. Three disposable copies
failed only their targeted scenario after removing the worker drain wait, immutable
source binding, or pending-acquisition cancellation. Working source was unchanged.

The first run passed 110 cases; the new greeting-cancellation test incorrectly
expected retry. The existing transport and its prior tests intentionally classify
all active-send cancellation as uncertain. The new assertion was corrected to
retain `unknown`, with no production policy change or removed scenario.

Receipts: `.cache/device-dispatch-store-x0BUMW/result.json`,
`.cache/device-worker-mutation-maVNDl/result.json`, `.cache/recorded-audit-mutation-hb2p1l/result.json`, `.cache/device-dispatch-mutation-lIQQ22/result.json`,
`.cache/device-worker-lifecycle-lint.json` and
`.cache/device-worker-lifecycle-typecheck.json`. The initial run remains at
`.cache/device-dispatch-store-00qiG3/result.json`. Canonical evidence follows.

## Canonical artifact evidence

Runtime source `7242f8e2e319caf6cb27498f33b2be628cdefa6d` produced
`sha256:624ccded60fddcab353c018d82dc63cbcea7ae8a8e62896e0fe4c9f475c8a247`. All sixteen canonical image gates passed.
The image passed six actual worker/profile/replica/shutdown/restart checks and four
native-audit checks. Its migrated disposable stores passed all 111 integration
scenarios and all 16 destination compatibility scenarios. Tested core bytes match
the committed image archive; the worker image harness is independently hashed.
The three local negative controls retain exact-source provenance. Unchanged
audit/SMTP units, Go/session and historical schema rollback receipts remain bound
to their original source and artifacts.

Receipts: `.cache/self-hosted-build-k8uY9r/result.json`, `.cache/device-worker-image-EMh29R/result.json`,
`.cache/device-dispatch-store-ditoGT/result.json`, `.cache/delivery-destination-store-PgXETI/result.json`,
`.cache/native-audit-image-CkcL1c/result.json` and `.cache/app-image-proof-FdgDKB/result.json`.
The real browser gate exercised built-in sign-in, projects, secrets and denials.
These are scoped regression checks, not complete accessibility or enterprise parity.
Public device authorization, API consumers, approval UI, CLI, full provenance and
authorized operational repair remain unfinished.
