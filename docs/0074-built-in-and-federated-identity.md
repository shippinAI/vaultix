# Built-in identity and external federation

Owner decision, 2026-10-30 America/New_York (2026-10-31 UTC). Vaultix.cloud and
self-hosted Vaultix support **both their own identity system and external
federation**, including Nomen, OIDC and SAML. This supersedes Nomen-only identity
or session-ownership prerequisites in earlier architecture documents. The same
decision applies to DevSCIF profiles; it does not establish certification.

## Product and authority contract

| Deployment choice | Required behavior |
| --- | --- |
| Built-in identity | Owner creation, accounts, login, MFA, recovery, local sessions, organizations and machine authentication work without a Nomen service or external identity account |
| External federation | Configured providers authenticate users; Vaultix verifies the provider assertion and explicit account linkage, then applies current local account, tenant and authorization policy |
| Both | The instance offers permitted methods and organizations can enforce their method/assurance policy; an external outage never becomes permission to bypass that policy |

One local account/membership/permission model and one encrypted secrets store serve
both paths. Existing user IDs, memberships, factors, sessions, workload identities,
audit provenance and encrypted data must survive migration. Do not infer a link
from matching email addresses or create duplicate users to make login succeed.
Authentication method and verified assurance must remain available to policy checks.

Vaultix owns built-in credentials, factors and application-session lifecycle.
External providers own their credentials and provider sessions. An integration must
define its token exchange, session provenance, refresh, revocation and logout;
logging out of Vaultix is not automatically logout from the external provider.
No Nomen runtime is copied into this checkout, and no parallel user/vault store is
introduced. Continue the native React/Go/Rust migration in the existing engine.

First-instance setup remains organization naming and owner account creation with
a custom password. Federation/client administration is configured later. Public
enrollment, invitations, recovery and administrator recovery policies have their
own controls; neither public federation configuration nor an undocumented bypass
is introduced during first-account setup.

## Existing code and the actual gap

The existing application already has built-in identity. Native migration must
absorb it, not replace it with a mandatory external login:

| Boundary | Observed source and behavior | Required continuation |
| --- | --- | --- |
| Owner, signup and login | `core/backend/src/server/routes/v1/admin-router.ts`, `v3/signup-router.ts`, `v3/login-router.ts`; existing auth/signup/login services and actual login UI | Preserve setup, invitations, email verification, password/SRP compatibility and method policy; migrate complete native use cases |
| Sessions and recovery | `services/auth-token/auth-token-service.ts`, existing session tables, user/account-recovery modules, native `auth/apiauth` | Preserve refresh/reuse handling, session versions, lockout, account restrictions and recovery; test both independent and federated provenance |
| MFA | Existing TOTP, email, passkey and recovery-code modules; native password/TOTP proof work | Keep required-method selection and factor lifecycle; shared durable replay is a scoped improvement, not complete native MFA migration |
| Machine identity | Existing identity, membership-identity and universal/token/JWT/OIDC/cloud/Kubernetes/LDAP/SPIFFE/TLS routes | Preserve each method's credentials, expiry, limits, tenant binding and revocation; a human-login test cannot close workload parity |
| External federation | Existing OIDC/SAML/LDAP organization workflows; native Nomen verification and binding components | Continue explicit verification/linking and per-provider acceptance; Nomen is an optional provider integration |
| Root native CLI | `internal/cli/auth_cmds.go` currently defaults terminal login to Nomen and supports supplied-token/universal login | This is a delivery gap against the owner decision. Replace the default with instance-advertised supported human login once the complete built-in flow is implemented and verified |
| Existing browser-to-CLI handoff | `CliRedirectPage/route.tsx`, `CliRedirectPage.tsx`, `SelectOrgPage` callback path | Existing compatibility remains. Its bare bearer-token loopback/copy fallback is not the new secure remote/headless flow |
| Existing OAuth service | `server/routes/v1/oauth-router.ts` exposes authorization-code/refresh exchanges, not a device grant; `services/oauth-client/oauth-client-service.ts` authenticates a confidential client and issues explicitly delegated tokens | Preserve the client/scoped-token contract; native public-client login cannot embed a client secret or relabel delegated tokens as full user sessions |

Complete reads include the small CLI/callback modules and the OAuth client service,
types, DAL, helper and scope modules. OAuth consent checks membership, federation
and required MFA before issuance; refresh carries the granted scopes forward.
Only `secrets:read` is currently defined for delegated OAuth. The existing code
exchange reads and deletes its cache entry in separate calls; characterize
concurrent redemption before reusing or migrating that path. New device code
consumption must be atomic and tested across replicas.

Route tracing remains scoped. Complete session, recovery, permission and provider
consumer tracing is still required. These reads do not stamp the authentication
domain authored or accepted. The authorship ledger and capability catalog remain
canonical.

## Ordered execution and acceptance

1. **IDENTITY-01 — Preserve and characterize both systems.** Trace each existing
   login, signup, factor, recovery, session, provider and workload consumer to its
   data and policy owner. Establish real-image scenarios for built-in-only,
   federation-only and combined configurations. Keep old APIs and encrypted data.
2. **IDENTITY-02 — Instance connection contract.** Add versioned, validated public
   login metadata to the existing core contract. Advertise only implemented and
   enabled profiles, endpoints and public client settings. The CLI must not silently
   choose Nomen, leak local credentials to a provider, or downgrade after denial.
3. **IDENTITY-03 — Native built-in remote authorization.** Implement the complete
   server-side device/approval/session use case against existing Vaultix accounts,
   memberships and factors. Human approval uses the real application login and
   can therefore honor permitted local or federated methods. Bind the request,
   client, resource, selected organization and approved scope. Test one-use codes,
   polling/backoff, expiration, cancellation, refresh rotation/reuse and durable
   recovery across replicas. No password grant or bearer-token copy instructions.
4. **IDENTITY-04 — Shared native actor/source actions.** Local sessions, workload
   identities and validated external identities reach the same existing permission
   and source-action boundaries. Preserve distinct credential profiles and delegated
   scopes. Test account lock/deletion, membership/group/suborganization changes,
   method enforcement, tenant isolation and revocation through CLI and long-lived MCP.
5. **IDENTITY-05 — Accessible account and connection workflows.** Author the existing
   login, account security, provider linking and approval screens with contextual
   help, notifications, confirmation/recovery dialogs and catalog-backed events.
   Test keyboard/focus, screen reader, reflow, reduced motion and actual service
   results. First-time users do not administer OAuth clients to log in.
6. **IDENTITY-06 — Independent live acceptance.** Prove the exact
   `vaultixl login --domain=https://vaultix.cloud` command against a built-in
   configuration, then against enabled federation, and test combined policy.
   Prove self-hosted built-in login with Nomen unavailable. External provider outage,
   issuer revocation and live audience/client assurance remain provider-specific
   gates; they cannot block already verified independent built-in operation.

The existing AUTH-03/04/05 obligations remain for the external Nomen integration.
Their evidence is retained, and their unavailable live prerequisites no longer
gate the built-in identity path. Native projects/references and the broader secrets,
AI, public-cloud and DevSCIF roadmap continue with the same no-regression rules.

## Research and current status

[RFC 8628](https://www.rfc-editor.org/rfc/rfc8628.html) defines device authorization
without requiring a particular identity provider. [RFC 9700 / BCP 240](https://www.rfc-editor.org/rfc/rfc9700.html)
informs audience/issuer separation, redirect protection and refresh-token security.
Reviewed 2026-10-31 UTC. These standards guide implementation; they do not prove the
current Vaultix CLI or server already implements the required built-in device flow.

Built-in web identity remains present and covered by existing scoped application
checks. Native built-in device authorization and the revised CLI default are not
implemented by this planning correction. No public login or whole-identity parity
claim is made. Codex subscription sign-in stays local to the user's AI client and
separate from both Vaultix identity modes; Clyffy receives secret references only.
