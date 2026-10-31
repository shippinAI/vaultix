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

## Accepted repair checkpoint

Runtime source `4aa3d6c888644f9d0c0e9a90f9e59ace0f70433b` produced canonical image
`sha256:288a19ed5eef7455f5d173c9038c0f276a269d518c29288ddbe745b288b3f4dd`. All sixteen standalone-image gates passed.
Exact native source passed 888 unit/race outcomes and 132 secrets integration/race
outcomes, with zero Go lint issues. The changed TypeScript passed lint. The
cross-language check passed 14 producer/real-cache outcomes and 39 consumer/launcher
outcomes. The secrets integration suite used the existing real schema from the
prior image while compiling the current native source; the final image check below
exercised the packaged implementation itself.

The additional disposable real-image check used built-in identity, read an empty
project and an individual secret directly through the packaged native Go API,
and observed both audit events in PostgreSQL through the real queue and application
consumer. Encrypted metadata was redacted, the generated secret-value canary was
absent from the audit, and an anonymous read was denied. No live ClickHouse or
external sink was exercised. Launcher tests separately verified managed shadow
and explicit operator audit settings.

The earlier image passed the standard gates but failed this additional native
audit check because the native callers were still disabled. That failure led to
restoring the callers and adding explicit shadow policy; it was not waived.
Initial fixture-order and explicit test-dependency lint failures were also retained
with their corrections.

Local receipts: `.cache/self-hosted-build-xmLOBt/result.json`, `.cache/native-audit-image-UZAaGa/result.json`,
`.cache/native-audit-boundary-twLLei/result.json`,
`.cache/audit-callers-final-unit.json`, `.cache/audit-callers-final-secrets.json`,
`.cache/audit-callers-final-lint.json`, and
`.cache/audit-callers-typescript-lint-fix.json`. Working-copy source receipts were
compared with the canonical archive; their pre-commit revision fields were not
relabeled. These are local receipts, not independent attestation. Dedicated device
sessions, transactionally durable issuance events, notifications, real API-profile
consumers and public CLI activation remain open.
