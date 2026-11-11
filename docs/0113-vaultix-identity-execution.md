# Vaultix identity: existing capabilities and completion order

Vaultix is one application for people, machine identities and secrets. Built-in
accounts remain independent of any external identity service. The owner's requested
Nomen convergence means a unified account and administration experience; it must
preserve existing account IDs, factors, memberships, provider clients, sessions and
encrypted data. It does not authorize a second user database or automatic linking
of accounts with matching email addresses.

The [complete product requirement register](capabilities/vaultix-capabilities.md)
lists every requirement in the current canonical catalog. The table below breaks
out the identity implementation instead of obscuring it behind a single “SSO” row.
“Present” means an implementation exists, not that every method has passed current
live-provider, browser, deployment and regression acceptance.

## Identity capability register

Paths in this table are relative to the repository. Existing user-facing identity
workflows remain Vaultix capabilities, including those implemented under `ee/`.
The directory does not imply a paid feature entitlement.

| Vaultix capability | Existing owner | Current boundary |
| --- | --- | --- |
| First owner and organization creation | `core/backend/src/server/routes/v1/admin-router.ts` | Present; canonical application setup has scoped image evidence. No shared default password. |
| Account signup and invitations | `core/backend/src/server/routes/v3/signup-router.ts` | Present; enrollment and invitation policies remain authoritative. |
| Password login and organization selection | `core/backend/src/server/routes/v3/login-router.ts` | Present; existing accounts and password compatibility must survive. |
| Google, GitHub and GitLab login | `core/backend/src/server/routes/v1/auth-router.ts` | Present; instance credentials and actual provider callback acceptance remain required. |
| Account profile, security and recovery | `core/backend/src/server/routes/v1/user-router.ts`, `v2/user-router.ts` | Present; complete recovery/factor acceptance remains tracked in 0074. |
| Email MFA, TOTP, passkeys and recovery codes | Existing auth, user and factor services under `core/backend/src/services/` | Present; not all factor lifecycle paths have current complete native acceptance. |
| Application sessions and revocation | `core/backend/src/services/auth-token/`, `core/backend-go/internal/services/auth/apiauth/` | Present; browser, workload and device credential families remain separate. |
| Organization OIDC federation | `core/backend/src/routes/v1/oidc-router.ts` | Present; enabled provider must pass its own issuer, audience, linkage and logout tests. |
| Organization SAML federation | `core/backend/src/routes/v1/saml-router.ts` | Present; signed assertion, organization and method policy must remain enforced. |
| LDAP directory login | `core/backend/src/routes/v1/ldap-router.ts` | Present; live directory configuration and acceptance required. |
| SCIM provisioning | `core/backend/src/routes/v1/scim-router.ts` | Present; provisioning/deprovisioning and tenant controls retain separate acceptance. |
| Users, groups, roles and tenant membership | Existing organization, membership and permission services | Present; free software availability never bypasses authorization. |
| Machine identity lifecycle and memberships | `core/backend/src/server/routes/v1/identity-router.ts`, `v2/identity-router.ts`, organization/project identity routers | Present; creation, assignment, expiry and revocation remain existing source actions. |
| Universal machine authentication | `core/backend/src/server/routes/v1/identity-universal-auth-router.ts` | Present; native CLI accepts client ID/secret through stdin and verifies access before saving. |
| Machine access tokens | `core/backend/src/server/routes/v1/identity-token-auth-router.ts`, `identity-access-token-router.ts` | Present; explicit-token CLI/MCP reference access and real Codex revocation have scoped acceptance in 0112. |
| Machine JWT authentication | `core/backend/src/server/routes/v1/identity-jwt-auth-router.ts` | Present; per-method provider and renewal acceptance remains required. |
| Machine OIDC authentication | `core/backend/src/server/routes/v1/identity-oidc-auth-router.ts` | Present; distinct from human OIDC federation. |
| Kubernetes workload authentication | `core/backend/src/server/routes/v1/identity-kubernetes-auth-router.ts` | Present; Kubernetes authority and service-account policy remain required. |
| AWS IAM workload authentication | `core/backend/src/server/routes/v1/identity-aws-iam-auth-router.ts` | Present; live AWS acceptance remains separate. |
| Azure workload authentication | `core/backend/src/server/routes/v1/identity-azure-auth-router.ts` | Present; live Azure acceptance remains separate. |
| GCP workload authentication | `core/backend/src/server/routes/v1/identity-gcp-auth-router.ts` | Present; live GCP acceptance remains separate. |
| Alibaba Cloud workload authentication | `core/backend/src/server/routes/v1/identity-alicloud-auth-router.ts` | Present; live provider acceptance remains separate. |
| OCI workload authentication | `core/backend/src/server/routes/v1/identity-oci-auth-router.ts` | Present; live provider acceptance remains separate. |
| LDAP workload authentication | `core/backend/src/server/routes/v1/identity-ldap-auth-router.ts` | Present; distinct from human directory login. |
| SPIFFE workload authentication | `core/backend/src/server/routes/v1/identity-spiffe-auth-router.ts` | Present; trust-domain and identity acceptance remain required. |
| TLS certificate workload authentication | `core/backend/src/server/routes/v1/identity-tls-cert-auth-router.ts` | Present; trusted ingress and certificate verification remain required. |
| Machine authentication templates | `core/backend/src/routes/v1/identity-template-router.ts` | Present; templates do not grant extra authority. |
| Delegated OAuth clients | `core/backend/src/server/routes/v1/oauth-router.ts` | Present confidential-client authorization code/refresh flow; delegated scope is not a full user session or public device grant. |
| Nomen verification and explicit account linking | `core/backend-go/internal/services/auth/nomen/` | Native components and scoped fixture evidence exist; live integration and one-application consolidation remain unfinished. |
| Human remote device authorization | `core/backend-go/internal/services/auth/device/` | Existing native grant, policy and dedicated session owner; HTTP integration is the current change. |
| Device renewal, reuse detection and revocation | Same native device owner | Existing atomic lifecycle; HTTP routes connect to it without replacing browser sessions. |
| Default human `vaultix login --domain=...` | `internal/cli/auth_cmds.go` | **Unfinished:** interactive default still selects Nomen. Do not describe explicit machine-token evidence as proof of this flow. |
| Human CLI access through metadata and MCP | Native resource authenticator plus existing Vaultix reference/catalog routes | Native secrets consumers have scoped evidence; TypeScript metadata/MCP admission for the distinct device profile remains unfinished. |

## Current HTTP implementation

The native HTTP boundary under `/api/v1/vaultix/auth/device` provides POST
`authorize`, `inspect`, `decision`, `token`, `cancel` and `revoke` operations.
Requests use `application/x-www-form-urlencoded`. Duplicate, unknown, empty,
oversized and query-string parameters are rejected. Codes and credentials are
never returned by GET. Responses are non-cacheable and failures contain a plain
`error` code.

`inspect` and `decision` require the existing browser JWT authenticator, a human
actor, the configured application origin and no assumed privilege. Approval
revalidates the existing account, session, organization and factor policy in the
grant transaction. Device and machine credentials cannot approve another login.
The confidential device code is distinct from the user code; only successful
redemption returns dedicated access and refresh credentials.

Request limits use the shared Redis protocol cache, including the default
Dragonfly deployment. Cache failure denies the operation. Existing per-grant
polling/backoff and global outstanding-grant admission still apply. These limits
are operational controls, not paid tiers or measured cloud-capacity evidence.

`VAULTIX_DEVICE_AUTHORIZATION_ENABLED` is false by default and requires
`VAULTIX_DEVICE_ACCESS_ENABLED`. This intermediate gate is not advertised as a
working public login choice. The native listener remains private behind trusted
ingress. Browser approval, packaged ingress, CLI storage/renewal/logout, public
discovery and all required resource consumers must pass together before default
activation. Turning on a flag is not a substitute for completing those paths.

## Completion sequence and retained obligations

1. Verify the HTTP protocol against the canonical store and actual browser
   authenticator, including denial, replay, refresh reuse and revocation.
2. Connect the actual application's accessible approval screen and trusted ingress.
   Show the instance, organization, requested access and matching user code; require
   a deliberate approval or denial. Do not automatically approve a URL visit.
3. Connect the same device actor to metadata/reference source actions and MCP.
   Current permissions and revocation apply on every action. Values stay outside
   the AI process; existing workload clients continue working.
4. Publish the versioned instance login contract and switch the root CLI to the
   supported built-in flow. Support headless remote use, protected local storage,
   renewal and server-side logout without copying a browser bearer token.
5. Prove the complete flow in `Dockerfile.standalone-vaultix`, then commit/push and
   update the visible preview. Production upgrade needs the actual server target.
6. Consolidate Nomen capabilities into the same account/session administration
   model through reviewed domain work and explicit migration. Preserve existing
   clients and issuer bindings; do not import a second identity runtime or store.

The enhanced card design, contextual help/dialogs, graphical AI interaction,
recorded current UI, provider-specific live tests, full manual accessibility,
whole-tree authorship and public-cloud readiness remain obligations. This document
does not close them.

Protocol reference: [RFC 8628](https://www.rfc-editor.org/rfc/rfc8628.html), reviewed
2026-11-03. Native HTTP handling is handwritten to reject ambiguous form input;
the existing grant/session domain remains the sole authority for its state.
