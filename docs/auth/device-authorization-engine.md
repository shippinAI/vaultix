# Native device authorization engine

This is a component of [0074](../0074-built-in-and-federated-identity.md), not
completion of built-in remote login. Vaultix supports built-in identity and
optional federation. Both will use the existing browser authentication flow
before explicit device approval, subject to current tenant method and MFA policy.

## Ownership and state

`core/backend-go/internal/services/auth/device` owns grant creation, inspection,
approval, denial, cancellation, polling and one-use consumption. It uses the
existing PostgreSQL engine and an additive `vaultix_device_authorizations` table.
There is no alternate user store, provider runtime or delegated OAuth relabeling.

Device codes contain 256 random bits. Human codes contain ten uniformly selected
symbols from a 32-symbol alphabet. HMAC-SHA-256 digests are separated by code type,
instance resource and first-party client. Raw codes are returned once and are not
stored. The constructor copies a configured key of at least 32 bytes; the eventual
composition root must supply a stable, appropriately derived secret across replicas.
Key rotation invalidates outstanding grants and needs a documented rollout policy.

PostgreSQL time determines the ten-minute lifetime and polling schedule. A request
must match the configured resource, `vaultix-cli` client and `vaultix:user` scope.
Metadata inspection returns only the requested connection. Pending, denied,
expired and consumed states cannot issue sessions. Early polling commits a longer
server-side interval before returning `slow_down`. The initial interval is five
seconds, and server enforcement increases by five seconds up to sixty seconds.
An RFC 8628 client must continue increasing its own interval on every `slow_down`.

A grant advisory lock serializes transitions across replicas. Authority checks
lock existing account/session rows before the grant update, respecting deletion
cascades. Approval stores explicit user, session, selected/root organization,
session version, authentication method, MFA and policy provenance. Redemption
revalidates that provenance and creates a dedicated application session in the
same transaction that consumes the grant. Issuance failure rolls back both writes.
An uncertain commit/network delivery can require a new sign-in; a consumed code
is never replayed to recover credentials.

The required `Authority` and `SessionIssuer` interfaces have no permissive defaults.
They must use the supplied primary transaction, perform bounded database work,
and enforce current account, membership, tenant, method and factor policy. The
integration fixtures deliberately implement only a limited authority/session
contract; they are not production implementations or valid credential issuers.

Admission uses one database-wide lock and a configurable maximum of 1–10,000
outstanding rows. Completed/denied rows count until expiry. Cleanup deletes at most
128 expired rows per call, skips locked rows, and also runs before admission.
HTTP rate limits, worker scheduling, overload responses and measured public-cloud
capacity remain required. A storage cap alone does not establish public readiness.

## Verification and migration obligations

`codes_test.go` covers formats, input ambiguity, instance/key separation and
credential redaction. `tests/platform/auth/device_authorization_test.go` exercises
the real database with explicitly limited collaborators: storage, polling,
binding mismatches, cancellation, expiry, policy changes, failed issuance,
rollback after expiry, competing replicas, one-connection operation, admission
and bounded cleanup. This is grant-engine evidence, not live federation evidence.

`scripts/test-device-grant-migration.mjs` runs actual old/new canonical images on
a disposable database: forward migration, empty down/up, refusal of nonempty down,
binary rollback, session-deletion cascade and restart with existing ciphertext.
Nonempty rollback retains the additive schema; it must never delete active
authorization state merely to make an older binary start.

Verification is pending until exact source/image receipts are recorded. Existing
UI/API baselines must remain unchanged. No public routes, discovery metadata, CLI
defaults or identity-provider acceptance are enabled by this component.

## Required continuation

1. Implement the real native tenant/session authority, including root and selected
   organization policy, group membership, lockout, method enforcement and MFA.
2. Implement first-party session issuance, refresh rotation/reuse, revocation,
   audit provenance and recovery against the existing session model.
3. Wire bounded HTTP endpoints and versioned instance discovery, then the existing
   accessible browser approval workflow with explicit connection review.
4. Update `vaultixl login --domain=https://vaultix.cloud` to use advertised supported
   methods. Prove local-only, federated and combined operation, including provider
   outage without policy downgrade, before public activation.

Codex sign-in remains local and separate. Clyffy receives secret references only.
