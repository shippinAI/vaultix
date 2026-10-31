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
root/selected organization and authentication/MFA provenance are required and
checked. The profile rejects delegated OAuth/MCP markers. No policy snapshot or
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
