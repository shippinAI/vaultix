# Nomen authority contract and delegated-token boundary

AUTH-02 checkpoint, 2026-10-30. This records the current implementation and the
contract for AUTH-03/04 in [0069](0069-execution-goal.md). External Nomen API
bearer acceptance is **not implemented or enabled** by this packet. Existing
browser and machine authentication remain in place.

## Current route and authority trace

The reviewed paths, exact Git blobs and read ranges are recorded in
[authority-review.json](auth/authority-review.json). Ranges distinguish a caller
trace from whole-file review. The checker validates that record against source;
it cannot establish behavior, authorship quality or live provider acceptance.

| Entry | Actual consumer and authority | Data / remaining boundary |
| --- | --- | --- |
| `/api/v1/vaultix/projects`, `/secret-references`, `/mcp` | TS `vaultix-router.ts`, `inject-identity.ts`, `verify-auth.ts`, `inject-permission.ts`, then `reference-service.ts` | Current project service, folder/secret DAL and permission service. Metadata only; reference page filtering does not imply imported-secret expansion. Go reference services are not mounted here. |
| Browser OIDC login/callback | TS `oidc-router.ts` and `oidc-config-service.ts`; organization-specific Passport strategy | A transient Redis-backed OIDC session is destroyed at callback. Current code then creates Vaultix tokens and a refresh cookie. This is existing compatibility behavior, not completed Nomen session ownership. |
| Organization selection | `auth-login-service.ts:selectOrganization` | Loads user, effective membership, root/suborganization, SSO and MFA requirements before issuing scoped tokens. This browser flow can promote invited membership after authentication; an API bearer must not silently perform that enrollment. |
| Native Go authenticated handlers | `RequireAuth` → token classification/signature validation → `validateUserTokenClaims` or machine-token validation → `auth.Identity` → permission service | Primary-database session version, account and membership checks; project/org roles and constraints remain authoritative. Separate reads are not a serializable authorization snapshot. |
| Go project/reference domain code | Go `reference/projects.go` and `reference/reference.go`, permission evaluator | Native implementations and differential tests exist. A service implementation alone does not establish public route cutover. |
| Sidecar ingress | `routes/index.ts` registers spawning/shadowing conditionally; forwarding registration is commented out | `go-sidecar-forwarding.ts` describes two v4 secret GET patterns, but is **not registered**. Do not describe production requests as forwarded. Spawned Go binds loopback port 4040. |
| CLI device/refresh flow | `internal/oidc/device.go`, `refresh.go`; protected local session integration in 0068 | Obtains an access token from configured issuer; no server-side Nomen identity mapping follows from obtaining it. Default issuer is currently `https://auth.shippin.ai`; observed discovery is `https://id.shippin.cloud`. Explicit configuration and acceptance are needed before changing the default. |

## Correction delivered here

TS distinguishes locally issued delegated OAuth access tokens by `oauthClientId`
and keeps their scopes. Routes must opt into OAuth and the TS permission path
applies its delegated constraints. Go previously discarded that marker while
decoding claims, allowing a valid signed delegated token with a live session to
reach ordinary user-session authority. Go does not implement the corresponding
scope intersection.

Go now retains the marker through both claim representations and rejects its
presence before reading session or membership authority. Empty, null and malformed
marker values also fail closed. This applies to both the middleware classifier
and direct `ValidateJWT` entry. No scopes, including `*`, grant an exception.
First-party and machine-token branches retain their existing policies. Supporting
delegated OAuth on Go routes later requires an explicit auth mode and scope
intersection at every consuming permission boundary. Restoring the old permissive
path is not a compatibility strategy.

## External authority decision

Use authenticated token introspection for the initial Nomen integration. On
2026-10-30, [public discovery](https://id.shippin.cloud/.well-known/openid-configuration)
advertised issuer `https://id.shippin.cloud`, device authorization, refresh,
introspection, revocation and both `private_key_jwt` / `client_secret_basic`
introspection authentication. It does not identify the registered Vaultix public
client, accepted resource audience, emitted token format or revocation latency.

The provider documents introspection for both opaque and JWT access tokens and a
separate API registration, with private-key authentication preferred. Treat this
as the proposed provider profile to verify against the deployed issuer, not proof
of the operator's registration. [Provider introspection guide](https://zitadel.com/docs/guides/integrate/token-introspection).

[RFC 7662](https://www.rfc-editor.org/rfc/rfc7662) defines authenticated
introspection and the freshness tradeoff of caching. Offline JWT verification
would require an accepted access-token profile, algorithm/key-rotation policy
and a separate revocation strategy; discovery JWKS alone establishes none of
those. [RFC 9068](https://www.rfc-editor.org/rfc/rfc9068) is a possible future
profile, not an assumption about tokens currently issued here.

AUTH-03 must implement the following contract behind explicit, disabled-by-default
configuration. This document and its review schema are not runtime configuration.

1. Bind exact HTTPS issuer, introspection endpoint, resource audience and allowed
   public client IDs in operator configuration. Check discovery issuer equality.
   Do not select a host from bearer claims or follow redirects carrying credentials.
   Endpoint trust is explicit; no arbitrary discovery URL per request.
2. Authenticate the resource server to introspection, preferably with a separately
   registered private key; Basic is a deliberate supported alternative. Keys stay
   server-side. The public device client has no embedded client secret.
3. Require a successful bounded response with `active: true`, exact issuer,
   intended audience, nonempty subject, permitted client and unexpired lifetime.
   Define and test strict types, clock skew, optional `nbf`, response/body limits,
   timeout and cancellation. Missing required fields are denial, not defaults.
   Provider-specific claims and ID-token rejection must be proven with fixtures
   and actual issued tokens before activation. The issuer must attest that the
   credential is an access token for this API; an ID token is never API authority.
4. Keep local first-party, machine and external verification modes disjoint.
   Unverified token contents may select a rejection path, never grant authority.
   An invalid local token must not be retried as external authority; an external
   verification failure must not fall back to a local session or stale success.
   Resolve the dispatch contract explicitly in AUTH-03, including opaque tokens.
5. Initially introspect every external request without a positive-result cache.
   Issuer outage denies external requests with a plain, non-sensitive `error`
   string and a retryable service status. Invalid credentials get 401; authenticated
   authorization denial gets 403. Existing local authentication remains available
   under its existing policy. Measure dependency latency and capacity before any
   cache optimization; define an accepted revocation bound before adding one.

## Existing users, organizations and authorization

Current OIDC aliases identify `(externalId, orgId, aliasType)` and have no issuer
column. The browser flow can resolve username/email and create an alias under its
own guarded enrollment flow. An alias alone cannot establish a globally trusted
Nomen `(issuer, subject)` binding, particularly after issuer configuration changes.
No automatic email-only or unsigned-claim linkage is allowed.

AUTH-03 should introduce a separate, additive Vaultix-owned identity binding with
an immutable unique `(issuer, subject)` key, existing-user foreign key and recorded
link provenance/revocation. Final table name and migration require schema review;
no table or migration is introduced here. Never create `nomen_vault_*` tables.
Separate storage avoids old browser writers populating issuerless records in the
new trust domain. Existing aliases are evidence to investigate, not an automatic
backfill source. Linking requires authenticated proof of the existing account
and external subject, with explicit authorization and audit. Rebinding cannot be
an upsert. Test uniqueness, concurrent linking, revocation and old-binary rollback.

The resulting actor is the existing Vaultix user, not a new parallel secrets
identity. Reject missing, unaccepted, locked or deleted accounts according to the
reviewed account policy. Load accepted, active organization membership from the
primary database on each request. Selection of an organization is a request hint,
never membership authority. Preserve root/suborganization relationships and direct
membership precedence: an inactive direct membership must not be rescued by a
group grant. Do not auto-create an organization or accept an invitation from an API
read. Public enrollment and initial owner setup remain separate workflows.

Preserve project permissions, group/custom roles, temporary privilege expiry,
machine identity constraints and cross-tenant denial. External scopes can only
narrow these permissions. Membership/role revocation must affect the next request
from CLI and long-lived MCP. Successful login is not permission to list all users'
projects. Nomen SSO must not be translated blindly into the existing `oidc` auth
method: organization-specific SSO/MFA policy needs verified issuer and assurance
mapping. Until that mapping is implemented, deny policies whose requirements
cannot be established. Do not infer MFA from a generic authenticated subject.

Nomen owns the target SSO cookie/session. Vaultix does not mint a replacement Nomen
session. Keep existing browser compatibility until its complete cutover is proven.
Audit the mapped Vaultix actor and selected tenant, never token contents. AI/MCP
continues using the same source actions and metadata-only references; no secret
values in chat, A2UI, prompts, configuration or test reports.

## Acceptance, rollout and rollback

The local review record deliberately says `not-implemented`. It cannot be edited
to advertise activation while passing the current schema. A future contract
revision must accompany the actual verifier, mapping, route consumers and evidence.

| Gate | Required evidence |
| --- | --- |
| Current guard | Red test on old code; signed-marker variants denied before DB lookup; real fixture session succeeds before/after delegated denial; normal error serializer emits a plain error. |
| AUTH-03 | Issuer/audience/client/type/expiry denial, unknown/rebound subject, account lock, inactive membership, mapping concurrency, introspection outage/recovery and existing-token regression; no hidden fallback. |
| AUTH-04 | Native project/reference routes and shared MCP catalog consume the new authority; real DB permission/revocation changes, pagination/empty states, canary exclusion and rollback of route ownership. |
| AUTH-05 | Registered public device client, API audience and resource-server authentication; real human remote approval, refresh rotation, access-token/ID-token distinction, issuer revocation, outage/recovery and canonical-image receipt. |

Deploy the guard only after canonical build and regression checks. It has no data
migration. Preserve the previous artifact and operator data; investigate failures
before cutover. For the later external verifier, disabling external acceptance
must leave existing local authority intact. Additive bindings must survive rollback
without being interpreted as trusted aliases by old binaries. No public-cloud
readiness, full auth parity or complete migration claim follows from this packet.

Verification receipts will identify the exact candidate, image, fixture tests and
remaining gates below after execution.
