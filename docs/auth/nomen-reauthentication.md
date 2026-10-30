# Native identity reauthentication

AUTH-03 B continuation. The [Nomen execution plan](nomen-execution-plan.md) and
[full migration goal](../0069-execution-goal.md) remain active. This component is
not mounted as a public endpoint and does not establish public login acceptance.

## Implementation and authority

The Go password producer verifies existing local-password accounts directly against
the existing PostgreSQL store. There is no call through to TypeScript authentication.
Existing bcrypt byte truncation and PBKDF2-SHA256 storage formats are checked against
independently generated Node vectors. No password hash or encrypted secret is changed.
Two in-flight hash workers bound CPU concurrency per service instance. Cancellation
releases the caller, but an already-running hash retains its worker slot until it
ends. Passwords are bounded to 1024 bytes and bcrypt costs to 20; the existing
PBKDF2 format supports costs 10 through 20. Extreme-cost workload capacity remains
an operational gate, not a measured production capacity claim.

Five attempts per user per fixed five-minute window are admitted durably before
hashing. Concurrent guesses cannot reset or exceed the budget, and cache loss
cannot reset it. Successful attempts also consume a slot. Only one proof row is
retained per user, so issuing another proof supersedes the previous attempt even
across sessions or organizations. A public caller also needs bounded ingress and
fair scheduling; this internal component does not establish those release gates.

Proof schema version 1 binds an opaque 256-bit code (stored only as SHA-256) to its
issuer, local user, validated session/access version, organization, exact action,
optional revoke target, credential digest, authenticated time and five-minute expiry.
Link proofs cannot revoke a binding; revoke proofs cannot begin a link or revoke a
different binding. The verified JWT access version is now retained on the native
identity. A missing version is distinct from version zero and is never inferred.

Issuance locks current account/session and policy only for short database work,
releases the connection for hashing, then checks the current credential and policy
again before writing. User and root/selected organization MFA or federation policy,
account restrictions, verified email, session deletion/version and password changes
are checked against the primary store. Both root and selected organizations must
still exist and match the validated hierarchy. The account must have password auth
enabled and the incoming validated session must itself use email authentication.
Disabled instance email login and FIPS-enabled instances are denied by this method;
there is no administrator or policy-bypass exception in the new component.

Starting a link or revoking a binding consumes the proof inside the binding
transaction. Failed mutations roll consumption back atomically, so retry does not
require weakening replay protection. Link completion rechecks the retained consumed
proof, current credential and policy after provider I/O, in the binding transaction.
The proof UUID becomes the binding history provenance identifier. No provider call,
password comparison, nested transaction or second-pool query occurs inside proof
verification. Rows lock user, session, sorted organization IDs, instance policy, then
proof/intent state. Existing deletion cascades bounded proof/attempt state and retains
the separate binding tombstone/history. This is not a new tenant permission grant.

The migration adds `vaultix_identity_reauth_attempts` and
`vaultix_identity_reauth_proofs` to the same store. Empty down/up is supported;
nonempty down refuses to reset proof or admission state. Binary rollback keeps the
additive tables. Proof consumption metadata is bounded state, not a permanent audit
export: the binding event keeps the proof UUID after a later proof supersedes it.
Notification/audit export retention remains a separate required consumer.

## Authentication method matrix and remaining work

| Existing account/policy | New proof path | Remaining acceptance |
| --- | --- | --- |
| Verified local email/password, no required MFA/federation, selected organization | Native password producer and transaction-bound consumer implemented | Actual canonical DB, concurrency, lifecycle, hash compatibility and regression checks below |
| User or organization requires MFA | Explicitly unavailable; cannot fall back to password only | Native TOTP, email challenge and passkey ceremonies with current method policy, replay/attempt controls and cancellation |
| Federated/SSO account or enforced federation | Explicitly unavailable | Purpose-bound fresh provider assertion and assurance policy; no generic local session or email match substitutes |
| FIPS-enabled instance | Explicitly unavailable | Separately accepted native cryptographic deployment profile; format compatibility is not certification |
| Browser/CLI/Clyffy | No new public route or tool | Human confirmation, origin/CSRF/state/PKCE, guided accessible UI, notifications, actor/tenant policy and live Nomen acceptance |

Existing login, MFA, recovery and PAM workflows remain available through their
current implementation. This table does not close their native migration. Do not
publish the partial method matrix as a complete linking feature. The full next
work remains native factor/SSO proof issuance, native linking/revocation UI and
notifications, AUTH-03 C actor/tenant policy and AUTH-04 source actions.

## Grounding and verification

Existing source review covered `auth.go` and the complete native authenticator;
password format functions in `crypto.ts` and full `hash-fips.ts`; login/password
comparison, account reset and session invalidation paths; complete MFA session
service/types/router and step-up helpers; MFA requirement selection and attempt
admission; current user, organization and instance schemas. Review scopes are
recorded in the local journal. These reads do not stamp all inherited modules as
rewritten or establish whole-product authorship.

[OWASP authentication guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
requires deliberate reauthentication for sensitive account linking.
[OWASP transaction authorization guidance](https://cheatsheetseries.owasp.org/cheatsheets/Transaction_Authorization_Cheat_Sheet.html)
supports binding authorization to the intended action and rejecting changed targets.
[Redis GETDEL](https://redis.io/docs/latest/commands/getdel/) provides atomic cache
consumption, but this design uses PostgreSQL for durable proof and attempt authority.
Sources retrieved 2026-10-30; these design choices are not an external security audit.

Predeclared tests cover real native JWT account validation, independent Node password
vectors, successful proof/link/revoke, wrong action/target/issuer/user/session/org,
expiry, supersession, policy/credential changes, concurrent replay and attempts,
injected database failure with rollback/recovery, and a one-connection pool. The
canonical migration harness checks the actual chain against the previous binary,
including encrypted-data continuity, nonempty down refusal and account deletion.
Verification is pending; failed receipts must remain visible until corrected.