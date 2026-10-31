# Device session security-event delivery

The native session owner writes security records in its source transaction. This
work continues the delivery obligation in [the session lifecycle](device-session-lifecycle.md).
Source persistence alone does not establish delivery or enable headless login.

## Destination ownership

Keep session decisions in Go and deliver through the existing audit, notification
and SMTP owners. No second identity model, vault store or model-only API is added.
The existing Node infrastructure remains the destination owner until that complete
infrastructure use case is migrated; delegating a session decision to it would not
be native domain ownership.

| Destination | Recorded-delivery contract |
| --- | --- |
| Audit | `auditLogQueue.persistRecorded` preserves source ID, creation time, organization and retention. It acknowledges configured storage and external-stream outbox fanout separately, propagates failures and explicitly reports disabled destinations. It does not rely on the lossy request-path ingest enqueue. |
| In-app notification | `notificationService.persistRecordedNotifications` writes through the existing notification DAL. Identity is the existing partition key `(id, createdAt)`. A replay preserves read state and rejects conflicting immutable content. The caller may supply the source-acknowledgment transaction; no second connection is opened. Batches are bounded at 100 and ordered consistently across workers. |
| Email | `smtpService.sendRecordedMail` uses one bare mailbox per delivery, a stable Message-ID and bounded SMTP connection/greeting/socket waits. Unconfigured SMTP is explicitly disabled without rendering/logging the message. Acceptance is not inbox delivery or exactly-once delivery; an uncertain acknowledgment can duplicate email. |

Existing browser/request notification and mail interfaces remain available.
Persisting a source acknowledgment after a separate notification transaction would
leave a replay window if the user deletes the notification; the source worker must
join notification persistence and acknowledgment in the supplied transaction.

## Required source worker

1. Preserve actor/request provenance before canonical session or account deletion.
   Cover native revocation and existing session/account deletion paths. Never retain
   access/refresh tokens, refresh digests, policy digests or secret values in delivery
   payloads.
2. Snapshot bounded, versioned destination payloads with stable identities and
   retention. Resolve SSO-bypass administrators with bounded pagination. Do not use
   mutable profile data to reinterpret an already-prepared event on retry.
3. Claim bounded batches on the primary database with a fenced lease and database
   time. Release transactions before network delivery. Reclaim abandoned work and
   back off failures; preserve pending/exhausted records with observable status.
4. Acknowledge each configured destination only after its owner succeeds. Distinguish
   disabled, not-applicable and expired policy from actual delivery. Audit fanout
   acknowledgment means durable acceptance by the existing external-stream outbox,
   not successful delivery to every external provider.
5. Retain unresolved records. Prune only settled records under the explicit retention
   policy. Verify worker registration, disabled-worker configuration, restart, cache
   loss, concurrency, tenant binding and one-connection behavior on the canonical
   image before activation.

## Source context and canonical deletion

The additive `20261031190000_vaultix-device-event-context` migration captures a
versioned `sourceContext` on new device-session metadata. It contains only the
affected account's public profile, organization identity/name, and session-origin
IP, user agent and creation time. It does not contain the approval policy digest,
refresh digest, password hash, tokens or secret values. The database bounds the
snapshot at 16 KiB. The context is immutable after capture and copied to security
events; event identity, provenance and context are immutable while destination
acknowledgments remain writable.

This is **session-creation context**, not a claim about the current request or the
person initiating a later deletion. Canonical deletion records explicitly mark
their initiator as unattributed. Delivery must preserve that distinction rather
than presenting the affected account as an administrator who deleted it.

A `BEFORE DELETE` trigger on existing device metadata records a revocation fact
when the canonical session DAL or an account cascade removes it. Native terminal
events (`revoked`, `reuse`, `policy-denied`) retain their precise reason without a
second event. Source-write failure rolls back deletion. Browser sessions remain
outside this device event stream. These hooks preserve existing session decisions;
they do not implement authentication or introduce a second identity store.

Existing rows are not rewritten by the migration. Their absent context remains
explicit. A later metadata update can capture still-available context with basis
`legacy-capture`; it never rewrites historical events or claims a creation-time
snapshot. If a legacy account disappears first, its deletion record retains its
IDs and null context. The preparation worker must retain unresolved records and
report them; public activation requires resolved preparation and full delivery
acceptance. A rollback refuses retained session/event state; binary rollback keeps
the additive schema. Empty-state down/up remains supported.

PostgreSQL documents that triggers run in the initiating transaction and errors
roll back both effects; real-store verification must still prove cascade behavior
and recovery on the pinned PostgreSQL 16 runtime.
[Trigger behavior](https://www.postgresql.org/docs/16/trigger-definition.html).
Source-capture verification is recorded below; worker delivery remains unimplemented.

[PostgreSQL's locking documentation](https://www.postgresql.org/docs/current/sql-select.html)
describes `SKIP LOCKED` for queue-like consumers. [BullMQ's retry guidance](https://docs.bullmq.io/patterns/idempotent-jobs)
requires idempotent effects. Reviewed 2026-10-31; these inform the design and do not
prove the pending worker is implemented. Runtime PostgreSQL remains pinned to 16.

## Current verification boundary

Destination methods have scoped verification below. Real PostgreSQL checks exercise audit
storage followed by fanout failure/retry, and notification replay, read-state
preservation, conflicting recipients, caller rollback and independent workers with one connection each.
Unit checks exercise both audit storage modes and SMTP acknowledgment semantics.
Mocked ClickHouse, external sinks and SMTP are not live-provider evidence.

The source worker, full delivery/retention,
resource-token consumers and public HTTP/browser/CLI flow remain open. The original
lifecycle plan retains these requirements; destination tests cannot satisfy them.

### Destination verification checkpoint

Exact destination source passed 62 unit outcomes and three actual
PostgreSQL/local SMTP scenarios. The database checks use one connection per worker, including opposite-order concurrent batches;
SMTP uses the real renderer and Nodemailer against a local server that accepts and
rejects recipients. Ambiguous multi-mailbox strings are rejected before delivery.
Full backend TypeScript checking and changed-file lint passed. Native producer
compatibility passed fourteen producer/real-cache outcomes and 59 consumer/launcher
outcomes; ClickHouse and external fanout remain mocked in that protocol check.

The first real-store attempt found a wrong notification conflict target: the table
is partitioned with primary key `(id, createdAt)`. This was corrected and verified,
without changing the schema or lowering assertions. Logger test initialization,
optional-row type errors and lint findings were also corrected. Initial failures
remain local; canonical-image verification is recorded below.

Receipts: `.cache/delivery-destination-unit-OEsdfV/result.json`, `.cache/delivery-destination-store-S3VA0v/result.json`,
`.cache/delivery-destinations-typecheck.json`,
`.cache/delivery-destinations-lint-fix.json`, and
`.cache/native-audit-boundary-PDc288/result.json`. These are scoped local evidence,
not independent attestation, full device-event delivery or provider acceptance.

### Canonical artifact

Runtime source `4cb430d42b33b383a00bb86296b2500c572b14ae` produced
`sha256:d6898f72a8c23a46025bfb30194606f1f6868e54d3d1e7cb322829ed495555f8`. All sixteen standard image gates passed,
including browser/project workflows, Dragonfly/Redis, encrypted recovery, tenant
isolation, proxy boundaries and admission. Four additional checks proved actual
native secrets audit persistence, redaction and anonymous denial on that image.

Exact receipt source was compared with the committed archive. The unchanged native
session/credential sources retain their prior scoped evidence; this does not repeat
or broaden it into full source-worker or public device-flow acceptance.

Image receipts: `.cache/self-hosted-build-Q7KW1R/result.json` and `.cache/native-audit-image-uh5YBt/result.json`.
The source-worker requirements above remain open; no device endpoint or CLI default
is activated by this checkpoint.

### Source capture local checkpoint

Eleven real PostgreSQL scenarios cover immutable subject/session-origin snapshots,
legacy uncertainty, canonical and account-cascade deletion, terminal reason dedup,
one-connection concurrent revocation, tenant binding, injected event failure and
transaction rollback. The existing session-store scenario now exercises both
additive migrations and the actual captured deletion record, including browser
reuse and empty-state down/up. Both disposable stores restarted the existing image.

The native source snapshot passed 901 unit/race outcomes and zero lint issues;
TypeScript checking and changed-file lint passed. Initial fixture DDL binding,
test typing, formatting, and disposable signup setup failures are retained locally.
The source fixture password now uses separated random bytes to avoid the existing
repeated-character policy. These are local scoped checks; canonical-image and
native integration verification are recorded below.

Receipts: `.cache/device-source-store-DNFVMq/result.json`, `.cache/device-session-store-gA3Dm9/result.json`,
`.cache/device-source-final-unit.json`, `.cache/device-source-final-lint.json`,
`.cache/source-capture-lint-fix.json`, and `.cache/source-capture-typecheck.json`.

### Canonical source-capture artifact

Runtime source `33be24f5c7349fa2366f562d0e7212d4ac1a92aa` produced
`sha256:39f67677e32a41744821233c7f792589758e7a04eea803977b27744a36c7021e`. All sixteen standard image gates passed.
The image's migrated PostgreSQL store passed 25 native session integration/race
outcomes and all eleven source-capture scenarios; 132 native secret-service
outcomes and four real native audit checks also passed. Existing audit, notification
and local SMTP destination scenarios passed again on this exact schema/image.

These checks preserve existing browser/secret behavior and prove the scoped capture
boundary. They do not prove a delivery worker, recipient preparation, current-request
provenance for every lifecycle action, public device login or live federation.

Receipts: `.cache/self-hosted-build-nzo2vT/result.json`, `.cache/native-audit-image-HcLi8J/result.json`,
`.cache/device-source-store-GgIaY6/result.json`, `.cache/delivery-destination-store-igoIZQ/result.json`,
`.cache/device-source-final-integration.json`, and
`.cache/device-source-final-secrets.json`. Existing-image migration and binary
compatibility evidence remains in `.cache/device-source-store-DNFVMq/result.json` and
`.cache/device-session-store-gA3Dm9/result.json`. No original full lifecycle gate is closed by a scoped check.

A separate real-image rollback check advanced migration history through the new
image, restarted the previous `d6898f72` image on that database, invoked its real
HTTP session-revocation API, then reupgraded. The owner and source events survived,
and the previous API recorded the new deletion fact through the database hooks.
This closes the gap left by direct migration-function tests that do not advance
the migration-history table. Receipt: `.cache/device-source-rollback-GY7cQH/result.json`.

## Durable preparation and delivery state

The additive `20261031200000_vaultix-device-event-delivery` migration and
`device-event-delivery-dal.ts` implement the database operations required by the
source worker. They are not registered as a running worker yet. Existing native
session decisions and the immutable event/context records remain unchanged.

Preparation claims use the primary database, database time, a random lease token
and a sixty-second lease. Each successful page saves at most 100 delivery records
and advances its recipient cursor in the same transaction. The first versioned
preparation snapshot is immutable. Prepared payloads, recipients, organization,
expiry and identities are also immutable; conflicting replay rolls back the page.
An event cannot finish preparation without its organization's audit record.
Delivery claims wait until all preparation pages are complete.

Each destination and recipient has a stable database identity and independent
status. Claims use `FOR UPDATE SKIP LOCKED`, bounded batches and a fresh lease
token. Completion and failure updates reject expired or replaced leases. Retryable
failures back off from five seconds to one hour, up to twelve attempts; exhausted
and unresolved records remain stored. An abandoned email claim becomes `unknown`
because the sender may have accepted it before the worker disappeared. It is not
automatically resent or pruned. Explicit uncertain outcomes use the same state.

Notification persistence runs through the existing notification DAL inside the
source acknowledgment transaction, using one connection. A failure or expired
lease rolls back both effects. Once acknowledged, a user's subsequent deletion
does not reopen the delivery. Network destinations must be called outside these
transactions when the dispatcher is implemented. Disabled, not-applicable and
expired dispositions remain distinct from successful delivery.

Cleanup accepts an explicit retention period between 30 and 3,650 days. It only
removes fully settled records after both preparation and settlement are older
than that period, and after the session's device metadata is gone. Recipient
deletion and source deletion are separately bounded; a large organization cannot
turn a one-event limit into an unbounded cascade. Unresolved, pending, processing,
exhausted and unknown work is retained. Schema rollback refuses retained delivery
or preparation state; binary rollback retains the additive schema.

These operations do not resolve recipient policy, construct approved audit events,
validate destination-specific payload semantics or dispatch mail. The versioned
JSON storage boundary is bounded and immutable, not a credential-redaction filter.
The actual preparer must select permitted fields and preserve session-origin versus
current-request provenance. Recipient pagination, worker registration, operational
status/repair, destination wiring, full image acceptance and public login remain
required. The previous scoped checks do not close those obligations.

### Delivery state local verification

Fourteen actual PostgreSQL scenarios passed with separate one-connection workers,
including locked-row skipping, stale fences, transaction rollback, independent
outcomes, immutable page replay, tenant mismatch, unknown email preservation,
actual notification persistence and bounded recipient cleanup. The existing
session compatibility test now rolls back the additive migrations in dependency
order and preserves browser behavior. Full backend TypeScript checking and
changed-file lint passed. Canonical image and migration-history rollback checks
are recorded below; no dispatcher has been registered.

Receipts: `.cache/device-delivery-store-0hWQ6O/result.json`, `.cache/device-session-store-6FH1DU/result.json`,
`.cache/device-delivery-store-typecheck.json` and
`.cache/device-delivery-store-lint-fix.json`. The first eleven-case receipt
preceded the added retention/locking assertions; it is not reused as evidence
for the final fourteen-case implementation. Initial formatting output is retained locally; the test typing correction
is recorded in the journal.

### Canonical delivery-state artifact

Runtime source `34dd50262ac33ce759df91f91384861ed36d2893` produced
`sha256:49a0d4be726f3916b73be0417f2665a6466d96efc53040c116457adc68f6c3ac`. All sixteen standard image gates passed.
The exact image also passed all fourteen delivery-state scenarios, eleven existing
source-capture scenarios, 25 native session integration/race outcomes, four native
audit checks and three recorded-destination PostgreSQL/local SMTP scenarios.
The existing session-store compatibility test covers the three additive migrations
in dependency order.

The real upgrade/rollback/reupgrade check advanced migration history, restarted
the previous `39f67677` binary, invoked its authenticated session-revocation API,
and preserved an unknown delivery alongside its immutable source. Reupgrade
preserved that state and the newly pending revocation event. This is binary and
store compatibility evidence, not a running source worker or public device flow.

Receipts: `.cache/self-hosted-build-nOS7P1/result.json`, `.cache/device-delivery-store-Ye6tlN/result.json`,
`.cache/device-source-store-2UehNG/result.json`, `.cache/device-delivery-rollback-pNAIje/result.json`,
`.cache/native-audit-image-VALJJg/result.json`, `.cache/delivery-destination-store-oU6krt/result.json`,
and `.cache/device-delivery-native-integration.json`.
