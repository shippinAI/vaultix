# Native audit delivery

This repair supports the session lifecycle in
[0074](../0074-built-in-and-federated-identity.md). It does not activate device login
or establish a transactionally durable session audit record.

## Delivery contract

The native producer assigns a UUID and creation time before enqueueing an audit
job. Workers preserve both through deserialization and retry. The worker resolves
the organization and retention policy, then appends the nested `actor` / `event`
envelope to the existing `audit-log-stream`. PostgreSQL and ClickHouse modes share
this ingest path and its configured external-stream fanout. Native PostgreSQL
events previously bypassed that fanout by inserting directly.

The existing consumer persists the batch, enqueues configured stream deliveries,
then trims the consumed stream entries. Storage or fanout failure leaves the batch
available for retry. Storage switches remain with the existing persistence owner;
disabling PostgreSQL storage does not implicitly disable external-stream fanout.
Workers must be enabled to drain this stream. Native PostgreSQL persistence now
uses the same scheduled batching as TypeScript events.

## Compatibility and limits

- New workers accept the older queued DTO shape. Such jobs have no original event
  ID or creation time, so their worker retries retain the prior duplicate risk.
  New jobs carry those fields; old binaries ignore the additional fields.
- The consumer accepts both nested envelopes and old flat native stream records.
  A malformed nested event cannot silently fall back to a different flat event.
- IDs and timestamps are not regenerated when an existing stream entry is retried.
  PostgreSQL uses its existing conflict handling. ClickHouse behavior depends on
  the configured engine: ReplacingMergeTree compares the complete sorting key and
  merges duplicates eventually. This is not immediate exactly-once delivery.
- Already trimmed records cannot be reconstructed by this repair. Original event
  capture is still asynchronous. Queue acknowledgement does not prove persistence,
  and neither queue nor stream acknowledgement is atomic with session issuance.
- A transactional security-event outbox, notification delivery, project-retention
  convergence, and live external-storage/sink acceptance remain open obligations.

The ClickHouse retry distinction follows its
[official explanation of merge and query-time deduplication](https://clickhouse.com/resources/engineering/clickhouse-optimize-table-final),
reviewed during this repair. The existing schema sorts by organization, project,
creation time and ID; retaining only the ID would be insufficient.

## Verification

`scripts/verify-native-audit-boundary.mjs` requires pinned local Go, backend and
cache image IDs. It creates its own disposable cache, exercises the real producer's
queue payload, and passes actual Go worker output to the real TypeScript consumer.
The consumer's storage and fanout dependencies are mocked. Independent assertions
cover identity, provenance, retention, both storage modes, legacy records,
malformed input, and storage/fanout failure followed by retry. The script owns and
cleans up its containers and network; it does not use the operator's cache.

The original failing acceptance probe is retained privately. It demonstrated that
the prior flat Go record was skipped and trimmed without persistence or fanout.
Current verification receipts and the exact canonical-image result must be recorded
before this repair is accepted. No live ClickHouse or external sink result is
implied by a mocked consumer dependency.

## Native callers and shadow operation

The first real-image probe authorized a native read but found no audit event.
Both native list/get handlers still had audit calls disabled for historical
shadow comparisons. The calls are restored after authorization and before the
response, including individual-secret metadata redaction. Failure to enqueue
an enabled audit fails the native read; asynchronous acceptance still does not
prove durable persistence.

Managed shadow processes receive `DISABLE_AUDIT_LOG_GENERATION=true` from the
resolved shadow configuration. Primary native processes retain the explicit
operator audit-generation setting. Request headers cannot turn audit off.
Separately operated remote shadow workers must set this same operational switch
themselves; the application cannot configure a remote process.

`scripts/test-native-audit-image.mjs` exercises actual packaged native list/get
reads, PostgreSQL persistence, encrypted-metadata redaction and anonymous denial
on disposable infrastructure. The original failing probe is retained; this
expanded proof must pass before the repair is accepted.
