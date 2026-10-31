# Native authenticator proof

This architecture and acceptance record covers the TOTP method of native identity
reauthentication. It extends the [password proof](nomen-reauthentication.md) using
the same user, session, encrypted factor and PostgreSQL store. Implementation is
locally verified at the scoped checkpoint below. No public endpoint is enabled
by this work. [Built-in identity and optional federation](../0074-built-in-and-federated-identity.md)
remain first-class; this native proof supports sensitive account linking without
making Nomen a prerequisite for existing built-in authentication.

## Authority and data ownership

The Go producer requires the current local password and an enrolled, verified
authenticator. The native KMS service decrypts the existing root-protected factor
without exporting the root key. Password hashing, factor decryption and cache I/O
occur outside database transactions. The producer then rechecks account, session,
password, factor and organization policy before atomically recording the code's
consumption and the action-bound proof.

The supported authenticator profile matches the installed Node implementation:
SHA-1, six decimal digits, 30-second steps and a previous/current/next-step window.
Existing generated factors contain ten decoded bytes. Native verification accepts
10–64 decoded bytes and selects the highest matching step, including the rare case
where adjacent steps produce the same code. This compatibility does not establish
a FIPS cryptographic profile or a complete native factor enrollment lifecycle.

Root and selected-organization MFA requirements must both be satisfied. Enforced
organization methods take precedence over user preference. Conflicting required
methods, email/passkey requirements, enforced federation, non-password sessions,
disabled instance password login and FIPS mode remain denied by this method.
Password-only proofs cannot substitute for required MFA.

Two additive tables preserve the original proof schema:

| Table | Authority and lifetime |
| --- | --- |
| `vaultix_totp_replays` | One monotonically increasing accepted time step per enrolled factor; shared by current TypeScript login/step-up verification and native proof issuance |
| `vaultix_identity_reauth_totp` | One current factor provenance row per user, joined to the exact current proof UUID; records factor ID, ciphertext digest and accepted step |

The factor, password and method domain contribute to the proof policy digest.
Changing, deleting or unverifying the factor invalidates the proof. Removing its
provenance cannot convert it into a password-only proof, even if MFA is later
disabled. An older password producer can replace a proof UUID without inheriting
stale factor provenance. Link completion rechecks current factor and policy after
provider I/O. Audit export and notification delivery remain separate obligations.

## Replay, failure and compatibility

The existing atomic cache claim remains for interoperability with older consumers.
Current consumers also write durable replay state, so cache loss cannot revive a
successfully consumed authentication code. A later SQL failure retains the cache
claim; the user waits for a new code. Native proof insertion and durable step
consumption commit or roll back together. Admission remains five proof attempts
per user per five-minute window, including successful attempts.

All affected transactions lock user before factor. Existing TOTP registration now
passes its transaction to both the unverified-factor lookup and creation, preventing
those calls from waiting for a second connection. The one-connection application
check exercises concurrent registration against the real API. Enrollment confirmation
remains a separate existing ceremony; its code is not newly classified as an
authentication replay event by this change.

The actual one-connection application gate also exposed an existing KMS startup
deadlock: its root lookup and creation omitted the open transaction. Startup now
reads through a short primary transaction, generates/encrypts a candidate root
outside the transaction, then locks and rechecks before creating it. Concurrent
instances use the committed winner. Temporary generated plaintext is cleared;
stored root ciphertext and the existing format remain unchanged. Fresh-root
concurrency, wrong-key denial and correct-key restart are additional acceptance
checks. Software fixtures do not establish hardware/HSM acceptance.

Empty migration down/up is supported. Nonempty down refuses to erase replay or
proof provenance. Binary rollback retains the additive tables, factors and encrypted
secrets. Older binaries do not write the new durable TOTP counter: their cache-loss
behavior is not upgraded by retaining a table. Public native method activation must
wait until all authentication consumers use the durable owner. Rollback compatibility
does not establish safe mixed-version public activation.

## Verification plan and evidence limits

The private immutable plan is journal session
`2026/10/0c680dd0-bcee-4cd8-839a-2bdbb313dcc3`. Its acceptance obligations include:

- Independent RFC and pinned Node vectors; real Node enrollment and native KMS
  decryption; link/revoke proof consumption and original password regression.
- Cross-runtime replay after cache loss, concurrent attempts, changed factors and
  current method policy, database/cache failure and fresh-code recovery.
- One-connection execution with explicit probes for connections held during crypto
  and cache calls; actual API enrollment with a one-connection application pool.
- Actual startup migration, empty down/up, nonempty down refusal, previous-binary
  startup/decryption/deletion, canonical application checks and preserved baselines.

Accepted scoped source: `2fa47afcc475f482713840ba95ac53592217ffb5`. Canonical image:
`sha256:a28781a0c3d65d188019a7ce2a651e65e778255cb10ffd0dae15604dc9c8bad4`. Private receipts are relative to the task worktree.

| Check | Observed result | Receipt |
| --- | --- | --- |
| Canonical standalone application | All 16 gates passed, including actual application, Dragonfly/Redis, encrypted recovery, tenant/proxy isolation and admission | `.cache/self-hosted-build-wjMBEc/result.json` |
| Native internal race and lint | 810 outcomes passed; pinned golangci-lint 2.15.0 reports zero issues | `.cache/totp-native.json` |
| Complete native integration/race | 777 outcomes passed, 8 external-provider skips; 32 TOTP, 42 password-proof and 14 binding outcomes | `.cache/go-proof-5yQDVC/result.json` |
| Exact-source TypeScript checks | Scoped ESLint and full backend type-check passed | `.cache/totp-typescript-final.json` |
| Actual old/new migration | 9 checks passed: concurrent fresh/resumed registration at pool size one, ciphertext continuity, down/up, retained security state, previous-binary deletion, concurrent fresh-root initialization, wrong-key denial and correct-key restart recovery | `.cache/nomen-binding-migration-E2dhv9/result.json` |
| Deliberately broken disposable source | Removing durable replay and proof-UUID joins triggered the named replay and stale-provenance assertions | `.cache/totp-mutation.json` |

Counts include subtests. Initial development receipts retain enrollment-fixture
failures caused by an all-zero optional organization UUID, then assertion mismatches
against the existing MFA error wrapper and deletion policy. The fixtures were
corrected against actual consumers; production checks were not weakened. Final
acceptance uses the exact canonical source and image, not the development image.
Native built-in device login, complete factor/SSO ceremonies and public linking
remain separate implementation and acceptance work.

Candidate `8abfd322` passed its 16 application gates and 777 native integration
outcomes, but failed the subsequent one-connection startup gate. Both the original
failure and diagnostic reproduction are retained; they cannot count as migration
acceptance. The repaired artifact recorded above completed the unchanged obligations and
additional root-startup checks before publication.

The verification harness was independently corrected after review found that
its blocking Docker helper serialized enrollment requests. Final evidence uses
concurrent fetches inside one disposable process. Cold-root preparation also
accounts for historical migrations that initialize KMS: only the newly created
empty fixture database has its synthetic root removed, after verifying no accounts,
tenants, projects or encrypted data exist. Earlier fixture failures are retained.

The runtime source above is unchanged by these test corrections. The final
migration receipt binds SHA-256 fingerprints of the executed harness and shared
helper; publication verifies those fingerprints and runtime source equality.
The provider uses a TLS fixture. These checks cannot establish live Nomen, public
login, remaining authentication methods, accessibility, capacity or enterprise parity.

## Research and source grounding

[RFC 6238](https://www.rfc-editor.org/rfc/rfc6238) supplies the time-step model,
bounded validation window, single-use requirement and independent test vectors.
[OWASP MFA guidance](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html)
informs fresh-factor authority and lifecycle/notification obligations. Both were
reviewed on 2026-10-31 UTC.

The [otplib v12 migration documentation](https://otplib.yeojz.dev/guide/v12-adapter.html)
describes changes in newer APIs. Compatibility here is grounded in version **12.0.1**
inspected inside the previously accepted Vaultix image, not inferred from v13 docs.
Independent vectors include its ten-byte default and twenty-byte RFC profile.
No dependency upgrade is included.

Complete source reads covered the TOTP service, DAL/types/schema, native KMS and
cipher modules, native proof producer/consumer, cache interface, MFA-session service
and router. Required-method selection, login verification and user factor routes
were traced at their relevant call sites. These scopes do not mark the entire
authentication domain or inherited product as authored or accepted.
