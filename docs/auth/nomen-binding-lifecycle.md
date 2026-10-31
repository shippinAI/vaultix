# Native Nomen binding lifecycle

AUTH-03 B persistence checkpoint, 2026-10-30. Parent: [execution plan](nomen-execution-plan.md).
The full migration and public-login goal remain active. This checkpoint implements
binding persistence and lifecycle; it does not enable an account-link endpoint or
external bearer authentication.

## Native use cases and authority

The native Go BindingService uses the existing primary PostgreSQL pool. BeginLink
requires a first-party human identity, an actual user session and a mandatory
FreshAuthentication dependency. That dependency must validate a recent, intent-bound
reauthentication proof including required MFA, and return the session access version
and authenticated time. There is no production adapter or allow-by-default verifier.
Tests label its implementation as a fixture; existing JWT account/session validation
and the provider TLS/introspection client remain real within the fixture environment.

One outstanding, random 256-bit challenge per user is stored only as SHA-256, bound
to issuer, user, session and access version. Its deadline is at most five minutes
from reauthentication. A new challenge supersedes the old attempt. CompleteLink
checks the challenge before provider I/O, verifies the access credential, then opens
a short transaction. The transaction locks user then session, checks current account
restrictions/version, consumes the current unexpired challenge, writes the exact
issuer/subject binding and records provenance atomically. No network call occurs
inside that transaction. Database mutation contexts have a five-second deadline.

An issuer/subject pair can never move to another user. The same owner may relink a
revoked binding only with a new authorized challenge. Revoke requires fresh proof,
is idempotent for that owner and immediately excludes the binding from primary
resolution. Resolve returns only a user UUID; it cannot grant tenant membership,
MFA assurance, roles or API access. Public actor construction remains AUTH-03 C.
No local session is minted, and no email/username match creates a binding.

## Schema and deletion behavior

The additive migration is
`core/backend/src/db/migrations/20261030220000_vaultix-identity-bindings.ts`.
It owns three tables in the existing store:

- `vaultix_identity_bindings`: exact C-collated issuer/subject unique key, nullable user linkage, immutable ownership, revocation and proof/session identifiers.
- `vaultix_identity_link_challenges`: one expiring intent per user; no raw challenge, bearer or reauthentication proof. User/session deletion cascades pending intents.
- `vaultix_identity_binding_events`: append-only linked/revoked/relinked/user-deleted history, recorded by database trigger in the binding transaction. This is domain provenance, not a replacement general audit service or an implemented notification pipeline.

Deleting a user sets the binding user reference to NULL and records a revoked
tombstone and deletion event. A tombstone cannot be claimed by another account.
History retains UUID provenance without a cascading user foreign key. Existing
single/bulk/self deletion paths therefore do not need to know the new schema.
Retention/pseudonymization and controlled export policies still need the broader
account/governance review; this checkpoint does not establish those policies.

Binary rollback keeps the additive tables. Schema down takes exclusive table locks
and refuses to run if bindings, history or intents exist. It cannot silently erase
identity ownership history. Only an empty schema may be rolled down and reapplied.
No encrypted secret column or existing user/session schema is replaced.

## Code grounding

New migration, Go lifecycle, new integration test and migration harness are fully
authored/read. Existing consumer review is scoped, not a whole-file authorship claim:

| Existing source | Reviewed scope | Finding |
| --- | --- | --- |
| `core/backend-go/internal/database/pg/pg.go` | Full module | Primary and replicas are explicit; authority reads use primary. |
| `core/backend-go/internal/services/auditlog/auditlog.go` | Full module | Async queue requires org/project and cannot atomically persist this global account binding. |
| `core/backend-go/internal/services/auth/auth.go` | Identity/context/session and assumed-privilege types/helpers | Linking accepts only first-party human sessions and rejects assumed privilege. |
| `core/backend-go/internal/services/auth/apiauth/authenticator.go` | 1-260 and 550-620 | Existing JWT checks reject delegated markers and validate current user/session/membership restrictions. |
| `core/backend/src/services/user/user-service.ts` | 554-622 | Self-delete deletes the user transactionally and preserves the last-admin guard; FK behavior must not obstruct it. |
| `core/backend/src/services/super-admin/super-admin-service.ts` | 750-837 | Admin single/bulk delete uses existing transactions and cleanup. |
| `core/backend/src/server/routes/v1/admin-router.ts` | 497-554 | Existing authenticated admin deletion route used by cross-version acceptance. |
| `core/backend/src/auto-start-migrations.ts` | 399-439, 546-600 | Startup handles an ahead database without applying missing older migrations; must prove previous binary startup. |
| `core/backend/src/db/knexfile.ts`, `core/backend/src/db/schemas/users.ts` | Full modules | Existing migration registry and accepted/locked/ghost user constraints. |
| `scripts/lib/disposable-image.mjs` | Full module | Tests own isolated containers/networks; operator targets are excluded and raw diagnostics withheld. |

This record and the journal source fingerprints bind the review; unchanged modules
are not promoted to rewritten or verified wholesale.

## Research and acceptance

[PostgreSQL 16 locking](https://www.postgresql.org/docs/16/explicit-locking.html)
supports the consistent row-lock order and exclusive empty-schema rollback design.
[PostgreSQL constraints](https://www.postgresql.org/docs/16/ddl-constraints.html)
define unique/FK behavior used to retain deletion tombstones.
[OWASP account linking guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html#secure-federated-account-linking)
requires authenticated linking, reauthentication, session-bound provider proof and
notification; email matching is insufficient. Sources retrieved 2026-10-30.

Predeclared verification covers real PostgreSQL uniqueness, competing accounts,
replay, expiry, supersession, session revoke, locked/unaccepted/ghost account denial,
audit-write rollback and recovery, deletion, immutable history and a one-connection
provider-I/O check. The migration harness starts the previous canonical image,
creates encrypted data, upgrades through startup, checks actual empty down/up and
nonempty refusal, then runs the old binary against the upgraded store and exercises
its user-deletion API. It checks exact ciphertext and decrypted fixture canary only
inside the test process. The scoped acceptance results below passed.

## Accepted evidence and exact limits

Implementation source: `3c7f8865893611e2478d642134df57b6b2d1b149`.
Corrected acceptance source: `52a03006895361a9540e2de13cc823859b529774`.
Canonical final image:
`sha256:65e2f4f99d053971b0ca7da58538a87725330b509ede7b79ce990c8073266367`.
The final image's runtime filesystem layers exactly equal the implementation image
`sha256:1856177c2b2908f91fe763ef1898d4d9a50a862e7649f9d97af7e45397e732bd`.
Only the test switch style and bodyless DELETE harness changed between these
source revisions. Final image revision identity passed. Receipt-only documentation
commits do not change the accepted runtime source.

| Verification | Observed result | Local receipt (task worktree) |
| --- | --- | --- |
| Canonical build/application gates on implementation source | All 16 passed, including Dragonfly/Redis application, encrypted recovery, tenant isolation, proxy boundary and both admission providers | `.cache/self-hosted-build-l4BOeZ/result.json` |
| Native internal race suite on unchanged implementation source | 787 test/subtest outcomes passed | `.cache/nomen-binding-native.json`, native-race step |
| Full native integration/race suite on implementation source | 703 outcomes passed, zero failed, 8 external-provider tests skipped | `.cache/go-proof-5FktOC/result.json` |
| Final committed authentication integration/race suite | 323 outcomes passed, including all 14 binding lifecycle outcomes | `.cache/binding-final-native.json` |
| Final committed pinned Go lint | golangci-lint 2.15.0, integration tags, zero issues | `.cache/binding-final-native.json`, lint step |
| Final canonical image and layer comparison | Revision identity and exact runtime-layer equality passed | `.cache/binding-final-image.json` |
| Final committed migration harness | All five checks passed; owned fixtures cleaned up | `.cache/nomen-binding-migration-mIOIYE/result.json` |

The initial lint receipt remains failed for one test-only if/else style finding;
the corrected concurrency test retains every assertion. Initial migration receipts
remain failed because the harness advertised application/json on a bodyless DELETE.
Correcting request framing made the previous binary's actual deletion route pass;
no production parser, deletion rule, schema guard or assertion was weakened.
The earlier diagnostic-only pass is not substituted for the final committed harness.

History-write failure is injected with an independent database constraint; the test
proves no partial binding becomes resolvable and the same intent succeeds after
recovery. Competing accounts share one provider subject and must produce exactly
one successful claim. A one-connection pool and provider callback independently
prove that provider I/O does not hold the transaction. These exercise failure
boundaries rather than checking implementation-generated expected values.
Counts include subtests and do not establish complete capability parity. The
fresh-authentication adapter and provider remain fixtures. Journal receipt matching
and local hashes establish consistency, not independent attestation. No live
provider, browser linking, notification delivery or public-cloud gate is closed.

## Next integration gates

Continuation: [native reauthentication](nomen-reauthentication.md) adds the
local-password producer and action/target-specific transactional consumption.
The results above describe the earlier persistence checkpoint, not that new
component's acceptance or the complete authentication-method matrix.

Existing MFA session service/router and step-up helpers were read for the next
consumer integration. Their generic ACTIVE cache entries lack the required
intent-specific authenticated time and access version; legacy entries can omit
the initiating session. Do not reuse generic MFA grace as identity-link authority.
The native password proof now supplies mandatory user/session/version/time and
explicit link/revoke purpose with transactional consumption. Its separate checkpoint
includes replay, expiry, policy changes and session revocation. Required native
factor and SSO methods remain to be implemented; no permissive adapter is supplied.

Before public linking: finish and verify native factor/SSO reauthentication,
intent-specific link/revoke confirmations, origin/CSRF and browser state/PKCE checks,
rate limits, notifications, metadata response schema and accessible native UI.
No automatic external acceptance is enabled by constructing a binding row.
Next dependency: finish that proof/notification integration and AUTH-03 C live actor
and tenant policy, then AUTH-04 native projects/references/MCP. Public provider
registration/human approval remains a distinct AUTH-05 gate.
