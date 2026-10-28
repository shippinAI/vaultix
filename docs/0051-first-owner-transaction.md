# First-owner transaction

Vaultix first-run setup must establish one owner and organization before opening
the existing application. Browser signup and machine bootstrap share that boundary;
neither a cached flag nor a separate user write can reserve ownership safely.

## Implementation packet

The existing TypeScript authentication service remains the active writer until
the native identity migration meets its acceptance gates. This packet changes
`core/backend/src/services/super-admin/{super-admin-service,super-admin-dal}.ts`
and the organization creation section of `services/org/org-service.ts` in place.
No route, response contract, schema, ciphertext format, identity runtime or
second store is introduced. This is not the Go identity cutover.

Both first-owner paths take the existing PostgreSQL `SuperAdminInit` advisory
transaction lock, then check the configuration on that same primary transaction.
Owner, organization, admin memberships, certificate/PAM defaults, session or
machine-token records and initialized configuration commit together. Every query
within that transaction uses its handle. Configuration updates join the supplied
transaction instead of silently opening another connection; startup initialization
also threads its transaction through reads and writes.

Password hashing precedes the transaction. Browser session signing uses the
existing session service with no organization lookup; machine issuance retains
the bounded issuer and its managed PostgreSQL record. Bootstrap tokens have no
usage counter, so this issuance path performs no cache write inside the transaction.
Failure before commit rolls back the whole database operation. A lost successful
browser response is recovered by signing in with the chosen password, not by
reopening account creation. Machine-token loss requires authenticated token
management; unauthenticated bootstrap cannot retrieve a previous credential.

Fresh self-hosted setup commits invite-only access and email/password login for
both paths. Existing initialized instances are rejected without changing their
access policy. Ordinary organization creation continues using the same database
creation function, with its existing external provisioning/reporting contract.
That ordinary creation path's broader transaction lifecycle remains separate work.

External legacy-cloud customer preparation runs before the transaction and is
compensated when creation fails or loses the race. Failed compensation is logged
with the customer identifier for reconciliation. Cache invalidation, membership
reporting and PAM usage signals run after commit. Reporting failure cannot turn
a committed account into a failed signup. Cached pre-setup configuration is
rechecked against the primary so a late cache fill cannot reopen setup or public
signup. This does not change the broader configuration-cache consistency model.

## Acceptance and limitations

`core/backend/e2e-test/routes/v1/first-owner-atomic.spec.ts` uses disposable
PostgreSQL and cache services. It tests a one-connection configuration transaction,
mixed and same-path races, database-trigger failures at multiple write boundaries,
same-email retry after rollback, password sign-in after a lost creation response,
stale pre-setup cache, machine-token persistence/expiry, and repeat rejection.
The service is exercised through its HTTP endpoints, with database triggers used
only for fault injection. Seeded rows are retained as the count baseline. The
standalone-image browser test separately covers a fresh instance.

Passing evidence must identify the tested source/image and cache providers.
An existing test file is not a passing result. External cloud provisioning and
reporting outage acceptance, durable retry/outbox reconciliation, multi-host
failover and manual accessibility
acceptance are not established by these tests. The owner database is never a test
fixture. Whole-product authorship and enterprise parity remain open under 0021,
0023 and 0027.

## Reproducible discovery

A clean source worktree exposed two empty, untracked historical provider
directories that had inflated the earlier generated inventory. Provider discovery
now requires a corresponding mapped source file, and its test creates an empty
directory to check that the output stays stable. The generated count is 187
adapters; no provider source was removed. The preservation baseline remains
273 UI routes and 2,290 API operations, unchanged.
