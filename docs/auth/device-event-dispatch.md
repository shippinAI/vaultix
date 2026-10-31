# Device security-event dispatch

Current continuation: [bounded recorded-audit acceptance](recorded-audit-acceptance.md)
is implemented and verified in the canonical image. Worker activation and the public
login journey remain open. Historical evidence below retains its original scope.

This continues [event preparation](device-event-preparation.md) and the
[full delivery obligation](device-event-delivery.md). The domain dispatcher is
implemented against existing destination owners. It is not yet registered as a
background worker and does not enable public device login.

## Source and recipient checks

The dispatcher re-reads the claimed delivery on the primary database, checks its
fenced lease and obtains its immutable source event. Version-one payloads must
match the event's organization, account, session, action, captured context and
provenance. Internal consistency within a payload is insufficient. Unknown fields,
versions, altered attribution and inconsistent routes fail before side effects.
Invalid work becomes exhausted and remains retained for operator investigation.
Payloads and raw database or mail errors are not copied into delivery status.

Version one fixes the audit and notification semantics established by the
preparer. Future changes must preserve its decoder or introduce a new version.
Email uses the existing prepared-mail decoder and the previously rendered content;
dispatch never renders a new message from a changed profile or configuration.

Recipient checks use the primary membership/account owner. A new current address
does not redirect historical mail. A different currently eligible organization
does not reroute a previously prepared administrator notice. Locked subjects can
still receive security notices, but deleted or unaccepted accounts cannot. These
checks do not grant a session or any organization/resource permission.

## Destination acknowledgment

| Destination | Behavior |
| --- | --- |
| Notification | Recheck eligibility, persist the stable notification identity and acknowledge the delivery in the same fenced transaction and connection. Cancellation or lease failure rolls back the insert. Replay does not reset read state or recreate an acknowledged notice after deletion. |
| Audit | Pass the exact prepared entry to the existing audit owner. Acknowledge configured storage and external-stream outbox fanout distinctly. Failure remains retryable; stable source identity preserves idempotent PostgreSQL persistence. External fanout acknowledgment is not provider delivery. |
| Email | Recheck the current mailbox and lease, then send outside the database transaction with a stable Message-ID. SMTP acceptance is not inbox delivery or exactly-once delivery. Known rejection can retry; uncertain acceptance remains unknown and is not automatically resent. |

Disabled, not-applicable and expired deliveries are distinct from delivered ones.
The dispatcher uses database time for remaining lease/expiry budgets. It reserves
one second before that boundary and caps the SMTP attempt below 30 seconds. Its
AbortSignal closes the underlying SMTP connection through the existing transport;
an acknowledgment lost after DATA remains uncertain. A short remaining lease never
starts SMTP. Network delivery does not hold the notification transaction open.

## Verification and activation gates

`scripts/verify-device-event-dispatch.mjs IMAGE BACKEND_TEST_IMAGE` creates a
disposable migrated PostgreSQL/cache/application stack. It exercises the actual
preparer, primary recipient resolver, dispatcher, notification DAL, audit DAL and
SMTP renderer/transport. Each database client has one connection. Global queue
fixtures run sequentially across files; explicit multi-worker contention remains
inside the store suite. External audit fanout is injected, not live-provider proof.
The application restarts after the suite and owned resources are cleaned up.

The suite retains all fourteen store scenarios and all twenty-one recipient and
preparation scenarios. Dispatch scenarios cover actual effects, rollback, replay,
revoked membership, changed mailboxes, malformed source/payloads, stale and short
leases, expiration, SMTP rejection, post-DATA cancellation and unknown retention.
Copied test-source receipts require comparison with the committed image archive;
they are not automatically evidence of packaged code.

Worker concurrency, scheduling/profile registration, genuine shutdown drain,
operational visibility/authorized repair and complete retention/recovery remain
required before activation. In particular, the existing audit owner can still wait
on database and outbox wake-up operations without a dispatch-specific cancellation
bound. A timeout race would not prove those operations stopped. Public HTTP,
token consumers, accessible approval and CLI default integration remain open.

Research for that continuation: [Knex query timeout](https://knexjs.org/guide/query-builder#timeout)
distinguishes a timeout from database cancellation. The
[ClickHouse JavaScript client](https://clickhouse.com/docs/integrations/language-clients/js/index)
supports abort signals but does not guarantee an aborted insert had no effect.
Reviewed 2026-10-31; pinned client behavior and actual cancellation still need
verification before changing the existing audit owner.

### Local evidence

All 56 scenarios passed, including the unchanged fourteen store and twenty-one
recipient/preparation cases. Full backend type checking and changed-file lint passed.
A disposable test copy with its immutable-source comparison removed failed the
forged-account scenario as expected; production source remained unchanged. This
negative control checks that payload internal consistency cannot replace source
binding. These local receipts precede canonical image acceptance.

Receipts: `.cache/device-dispatch-store-3CI36f/result.json`, `.cache/device-dispatch-mutation-iskjjv/result.json`,
`.cache/device-dispatch-typecheck.json` and `.cache/device-dispatch-lint-fix.json`.

### Canonical artifact evidence

Runtime source `1cfaab7174d37bb184f490cddbe5c97ef8482ab0` produced
`sha256:b805afc7bc6f9779f4d97aa6e656cbf5a29434fada2ff61d07b9003f9addcbab`. All sixteen canonical image gates passed.
The image passed four native audit checks; its migrated disposable stores passed
all 56 dispatch/store/preparation scenarios and all 16 destination compatibility
scenarios. Tested source bytes match the committed image archive. The source-binding
negative control above is retained against identical source, not described as rerun.

Receipts: `.cache/self-hosted-build-WBudYP/result.json`,
`.cache/device-dispatch-store-k4mZ5m/result.json`, `.cache/delivery-destination-store-NZ5IyF/result.json` and
`.cache/native-audit-image-ZesGub/result.json`. Previous unchanged Go/session, schema rollback and SMTP
unit/mutation evidence retains its original source and artifact provenance.
Registration, bounded audit shutdown, operational recovery and public login remain
open; the image does not activate the device dispatcher.

Actual application evidence: `.cache/app-image-proof-9jb3nO/result.json`. The canonical application gate
exercised real email sign-in, authenticated product navigation, projects, secret
workflows and denial behavior. The login and organization-first onboarding images
were inspected. This is scoped application regression evidence, not complete
federation, accessibility or enterprise parity.
