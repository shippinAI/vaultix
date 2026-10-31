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

[PostgreSQL's locking documentation](https://www.postgresql.org/docs/current/sql-select.html)
describes `SKIP LOCKED` for queue-like consumers. [BullMQ's retry guidance](https://docs.bullmq.io/patterns/idempotent-jobs)
requires idempotent effects. Reviewed 2026-10-31; these inform the design and do not
prove the pending worker is implemented. Runtime PostgreSQL remains pinned to 16.

## Current verification boundary

Destination methods are under verification. Real PostgreSQL checks exercise audit
storage followed by fanout failure/retry, and notification replay, read-state
preservation, conflicting recipients, caller rollback and independent workers with one connection each.
Unit checks exercise both audit storage modes and SMTP acknowledgment semantics.
Mocked ClickHouse, external sinks and SMTP are not live-provider evidence.

The source worker, canonical deletion event coverage, full delivery/retention,
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
remain local; canonical-image verification is still pending.

Receipts: `.cache/delivery-destination-unit-OEsdfV/result.json`, `.cache/delivery-destination-store-S3VA0v/result.json`,
`.cache/delivery-destinations-typecheck.json`,
`.cache/delivery-destinations-lint-fix.json`, and
`.cache/native-audit-boundary-PDc288/result.json`. These are scoped local evidence,
not independent attestation, full device-event delivery or provider acceptance.
