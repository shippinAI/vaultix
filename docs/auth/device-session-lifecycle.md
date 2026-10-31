# Native device session lifecycle

This is the next implementation stage of [0074](../0074-built-in-and-federated-identity.md).
The [grant engine](device-authorization-engine.md) and
[approval authority](device-approval-authority.md) have scoped evidence. Dedicated
session issuance, renewal, audit delivery and real API consumers remain in progress.
No new public login endpoint or CLI default is enabled by this document.

## Credential profile

`core/backend-go/internal/services/auth/device/credentials.go` owns version 1
credential encoding and cryptographic verification. It does not establish current
database authorization. Browser and confidential OAuth credentials remain separate.

Access tokens use HS256, `typ: vaultix-device-at+jwt`, and
`authTokenType: vaultix-device-access-v1`. Issuer and the single audience are the
configured instance resource. The public client is `vaultix-cli`, with the explicit
first-party scope `vaultix:user`. Subject, user, dedicated session, access version,
root/selected organization and authentication method are required and checked.
MFA claims are structurally checked: false or omitted verification means
unverified; true requires a recognized factor method. The profile rejects delegated OAuth/MCP markers. No policy snapshot or
secret value is encoded. Access lifetime is a whole-second duration from one second
through one day; the session owner must also cap it against organization/session
expiry. Existing browser lifetime configuration is unchanged.

Access and refresh signing keys are independently derived with HMAC-SHA256 from
the configured secret and a versioned domain containing kind, resource, client and
scope. Existing browser validators using the base secret cannot accept these
credentials. Changing the instance resource or secret invalidates this profile;
there is no fallback to another credential family after verification fails.

Refresh credentials use the `vxd1.` prefix and strict unpadded base64url over
104 bytes: user UUID, session UUID, unsigned big-endian generation, 32 random nonce
bytes and a 32-byte HMAC. Generations are positive canonical session integers.
Verification authenticates every field before returning the locator. Expiration,
current generation, current-token digest and revocation belong to the primary
database. A valid HMAC alone never authorizes renewal. A forged generation must
never become a session-revocation signal.

Public fixtures in `testdata/credentials-v1.json` are produced independently by
Node's crypto implementation. They include both authentication families, MFA,
profile/key confusion and malformed lifetime/identity claims. Their test secret
and keys are deliberately public and are not product configuration.

## Remaining transaction and consumer contract

1. Create a dedicated `auth_token_sessions` row inside the transaction that
   consumes the device grant. Do not reuse the approving browser session. Additive
   device metadata must reference its own canonical session; grant cleanup and
   browser logout must not cascade into the newly issued session.
2. Bind the approved client/resource/scope and method/MFA/bypass provenance to
   session state. Resolve organization lifetime from existing policy. Use database
   time, bounded expiration and canonical session versions. Retain user-before-
   session lock order and avoid opening a second connection inside a transaction.
3. Rotate refresh credentials atomically. Authenticate an old credential before
   treating its generation as reuse; revoke the active family on confirmed reuse.
   Recheck current account/session/tenant/factor policy. Preserve the CLI's explicit
   recovery from uncertain refresh rather than automatically replaying it.
4. Record security events durably with issuance/revocation and integrate their
   delivery into existing audit and notification owners. Current asynchronous
   enqueue methods are not an atomic issuance record. Preserve configured audit
   routing, retention, operational switches and SSO-bypass notifications.
5. Integrate access verification in actual Go and TypeScript resource consumers.
   A cryptographically verified locator is not an actor until current canonical
   account/session/organization checks pass. Preserve each existing credential
   profile and the delegated scope boundary. Test logout, lock, deletion and
   organization/factor changes through protected project/reference actions.
6. Prove concurrent redemption/renewal, replay, one-connection operation, event
   failure rollback, restart and migration/binary rollback on the canonical image.
   Then wire discovery, HTTP, accessible browser approval and CLI login. Prove
   built-in operation without Nomen and permitted federated/combined configurations.

[RFC 9700 section 4.14](https://www.rfc-editor.org/rfc/rfc9700.html#section-4.14)
requires replay detection for public-client refresh and binding to approved scope
and resources. Reviewed 2026-10-31. The standard informs these obligations; it is
not evidence that Vaultix's new session lifecycle is already complete.

The execution journal retains the entire session/consumer/image plan. Passing
credential vectors alone does not satisfy its integration or image obligations.

## Credential checkpoint evidence

Runtime source `c8ff701237d0423fbef641b29e94d96d63bec25d` produced canonical image
`sha256:43cba3e3e2fb2f129b6dcc41a4b79babf269fedbe4535ffcc3765c3a4e7cbbbf`. All sixteen standalone-image gates passed, including
real browser login/project workflows, both cache providers, encrypted recovery,
tenant isolation, proxy boundaries and admission. Existing capability baselines
were retained.

The exact native source content passed 875 unit/race outcomes, including
61 credential outcomes, and pinned lint with zero issues. Independent Node
fixtures verify the profile; disabling refresh HMAC verification in a disposable
copy makes the integrity test fail. Initial lint failures and their corrections
remain in the private evidence directory. Source snapshots captured before the
commit match its canonical archive by content; the older base revision recorded
in those working-copy receipts is not substituted for that content comparison.

Receipts are local: `.cache/session-credentials-final-unit.json`,
`.cache/session-credentials-final-lint.json`,
`.cache/session-credentials-mutation.json`, and
`.cache/self-hosted-build-G1az8e/result.json`. They are not independent attestation.
The lifecycle plan remains open. No production session issuer, refresh/revocation
owner, actual API-profile consumer or public CLI flow is established by these
credential checks. The authorship ledger therefore retains an authored,
integration-pending scope.

### Integration findings that must be resolved

- Browser and confidential OAuth issuance both use `getUserTokenSession`, which
  reuses rows by user/IP/user-agent. Exclude dedicated device sessions from that
  specific lookup while preserving canonical session listing/version/revocation.
- A local cross-language probe captured the actual Go audit producer's
  ClickHouse-mode stream JSON and supplied it to the actual TypeScript consumer.
  The record was skipped and trimmed without persistence or external-stream
  fanout: the producer uses flat actor/event fields; the consumer expects nested
  envelopes. The acceptance assertion failed and the drop characterization
  passed. Local storage/stream dependencies were mocked, so this is protocol
  evidence, not live ClickHouse acceptance. Repair and retain an enduring
  producer/consumer test before device sessions depend on this path.

The audit probe receipt is `.cache/native-audit-probe.json`. Durable issuance
events, retry identity and notification delivery remain part of the same session
plan; an asynchronous enqueue call is insufficient evidence of atomic delivery.

The in-place repair and its compatibility boundary are documented in
[native audit delivery](native-audit-delivery.md). This prerequisite does not close
the dedicated-session, transaction, notification or API-consumer obligations above.

## Session owner implementation under verification

`device.Sessions` now implements the grant issuer, rotation, revocation and
database-backed access-profile validation. It creates a new canonical
`auth_token_sessions` row with `sessionType=device-v1`, plus versioned device
metadata. Browser and confidential OAuth reuse select only `browser` sessions;
canonical session lookup, listing, version invalidation and deletion still include
both kinds. The approving browser session is never the device session's parent.

Issuance copies verified authentication, MFA and SSO-bypass provenance and the
approval policy digest. Every renewal and access validation rechecks current
account/session and organization/factor policy on the primary database. Policy
changes require fresh approval. User-before-session locks serialize refresh and
account deletion; all database work stays on the supplied transaction/connection.
This conservative policy does not replace action-level authorization or establish
measured public-service capacity.

Refresh has a fixed absolute expiry, capped by the configured session lifetime
and both selected/root organization limits. The constructor accepts one second
through 365 days; access tokens remain capped by their shorter configured lifetime.
Renewal does not extend the absolute expiry. Only the current refresh digest is
stored. Authenticated older generations revoke their family; forged tokens,
future generations and wrong current-token digests cannot trigger that revocation.
Concurrent reuse can invalidate the winner's newly issued credentials, so clients
must serialize renewal and recover explicitly from an uncertain response.

Issuance, rotation and native revocation write credential-free security records
in `vaultix_device_session_events` in the same transaction. These records survive
canonical session/account deletion. Delivery timestamps remain unset: integrating
bounded retries, retention and delivery through the existing audit and notification
owners is still required. Existing generic session deletion continues to revoke
device access, but this implementation does not add a security event to every
legacy deletion path. That coverage remains part of delivery integration.

The additive migration preserves existing sessions as `browser`. Schema rollback
refuses retained device sessions or security records. Keep the additive schema
during binary rollback. Older binaries do not understand the reuse discriminator;
do not activate new issuance in mixed-version or rollback operation. The disposable
store runner exercises real DAL/service reuse, revocation, migration guards and
old-binary startup, separate from the native lifecycle tests.

The public device endpoints, discovery, actual Go/TypeScript API consumers and
browser/CLI activation remain unmounted. Current verification is pending; these
implemented methods alone do not establish working public headless login or
complete security-event/notification delivery.
