# Native device approval authority

The native device grant now has a real account and tenant policy implementation
in `core/backend-go/internal/services/auth/device/authority.go`. This advances
[the dual-identity plan](../0074-built-in-and-federated-identity.md). Public device
login still requires native session issuance, refresh/revocation, audit and
notifications, HTTP/discovery, browser approval and CLI integration.

## Existing authority, shared by both login paths

The authority accepts an already verified first-party Vaultix user session.
It does not authenticate a password, verify an external provider assertion,
link accounts by email, or convert a delegated OAuth token into a user session.
The existing authenticator must reject delegated/scoped credentials before this
boundary. Built-in and federated authentication methods use the same local
account, session, organization, membership and factor records.

Approval requires an accepted, non-ghost account without a current permanent or
temporary lock, a live browser session with the exact access version, and an
explicit selected/root organization. Unscoped pre-MFA password responses cannot
approve a device. Assumed privileges cannot authorize a new first-party session.

The root organization must be a real root, and the selected organization must
belong to it. A direct selected membership takes precedence over groups. Disabled
or pending direct membership cannot borrow group access. Otherwise an active,
accepted or status-null group membership grants standing. A child organization
also requires an active accepted/status-null direct root membership. This new
approval boundary does not promote invitations; the existing organization
selection flow must complete them first.

Root organization MFA overrides user preference, matching existing organization
selection and OAuth consent. An unspecified required method means email. Verified
MFA must match the required method; TOTP needs a current verified factor,
WebAuthn needs a current credential, and email needs a verified address. The
snapshot binds current factor material without returning credentials: it hashes
TOTP ciphertext and the email address, and includes WebAuthn public keys. It does
not claim that existing browser tokens identify the individual WebAuthn credential
or prove a provider's original assurance. Those claims are absent today.

Root and selected organization SSO policies both apply. Each organization's bypass
requires its explicit flag and the user's current capability in that organization.
The canonical native permission module evaluates the same packed CASL rules,
including unconditional denies, custom roles and additional privileges. Expired
temporary roles cannot grant bypass. Only actual use of that permission to bypass
a method policy is recorded; compliant SSO does not become a bypass just because
the user is an administrator. The resulting bypass provenance is retained
for the required session/audit consumer; audit notifications are not implemented
by this component.

The effective existing organization permission check permits OIDC and the five
SAML methods under enforced SSO. LDAP remains a recognized authentication method
when that policy is not enforced. Although `selectOrganization` also mentions
LDAP in one later condition, its earlier organization permission check rejects
LDAP under enforcement. The new authority follows that effective check. Google
enforcement separately requires Google or an authorized explicit bypass.

## Snapshot, revocation and transaction limits

The authority uses only the grant owner's primary transaction. It locks the user
before the session, matching deletion cascades, then reads policy inputs in one
SQL statement with database time. It opens no second connection and has a
five-second operation deadline. Driver errors are reduced to a fixed operation
label; no raw SQL error, factor, policy, code or token is logged.

A versioned digest binds ordered organization, membership, active role,
additional-privilege and factor inputs. Root/selected token lifetime changes are
included for the future issuer. Profile names and usage timestamps are excluded.
Redemption checks the account/session again and requires the current policy
digest and bypass result to match approval. A changed policy requires a fresh
approval, including changes that would increase permission. The grant owner
commits a denial without issuing a session; issuance failure rolls back.

[PostgreSQL Read Committed](https://www.postgresql.org/docs/current/transaction-iso.html)
provides a statement snapshot, not a transaction-wide policy snapshot. Reviewed
2026-10-31. The account/session locks serialize their revocation, but this design
does not lock every legacy membership/role writer. Policy changes committed after
the observation are later changes; every resource action must still enforce
current authorization. No global revocation linearizability or public-cloud
capacity claim follows from these checks.

## Verification scope

`tests/platform/auth/device_authority_test.go` uses the production native
authority through actual PostgreSQL grant approval and redemption. Its session
issuer remains an explicitly limited transactional fixture. Scenarios cover
both method families, current account/session/tenant denial, direct/group and
child membership, root MFA, factor changes, SSO and explicit bypass, custom
denies, expiry, stale policy, one-connection operation and rollback/retry.
The permission projection also runs the existing independently generated CASL
vectors. These tests do not prove real external provider login or usable native
device tokens.

Verified component checkpoint, 2026-10-31 UTC:

- Runtime source: `076ba27b843c7a4ba76dd2ec87704e0a28ef13f8`.
- Canonical image: `sha256:6938721edbb83b34897041da1197c6dabf6de740759edb4ba4d26bab830bbcea`.
- All 16 canonical build/application gates passed, including existing real browser login/project workflows, Dragonfly/Redis, encrypted recovery, tenant isolation, proxy boundaries and admission.
- 814 native unit/race and 868 native integration/race outcomes passed, including 63 authority outcomes. 8 external-provider KMS outcomes remain skipped. Pinned Go lint reports zero issues.
- Disabling the policy-digest comparison in a disposable source copy caused the role-change redemption test to fail. The production baseline passed.
- All 273 baseline UI routes and 2,290 baseline API operations are retained; the image reports 2,291 operations. The preservation baseline was not recaptured.

The initial new role/group fixtures omitted required fields from the actual
database schema. Required names, organization and slug fields were supplied;
constraints and policy assertions were retained. An initial image attempt also
exceeded the existing twenty-second limit for two issuer startup probes despite
emitting the expected validation diagnostics. The accepted image passed all
eighteen startup probes without changing that limit. Failed attempts remain in
the private journal/evidence directory.

Local receipts: `.cache/self-hosted-build-3QH0ej/result.json`,
`.cache/authority-final-unit.json`, `.cache/authority-final-all.json`,
`.cache/authority-final-lint.json`, and `.cache/authority-final-mutation.json`.
Native source fingerprints match the canonical archive. These are local receipts,
not independently attested certification.

No public route, CLI default, database migration or existing login behavior is
changed by this unmounted authority component. Its PostgreSQL tests use the real
authority and a fixture session issuer; the image checks preserve existing
application workflows. Complete remote login and live provider acceptance remain
open in [0074](../0074-built-in-and-federated-identity.md).
