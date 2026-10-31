# Native Nomen login and capability execution plan

Research/review date: 2026-10-30. Parent queue: [0069](../0069-execution-goal.md),
AUTH-03 through AUTH-06. Authority contract: [0070](../0070-nomen-authority-contract.md).
Product scope remains [the capability catalog](../capabilities/README.md) and
[native migration](../0027-native-stack-and-ai-migration.md). This document decomposes
those accepted packets; it does not introduce a replacement roadmap.

## Scope correction: optional external identity

The owner's [dual identity decision](../0074-built-in-and-federated-identity.md)
requires first-class built-in Vaultix identity and optional external federation.
This plan specifies the Nomen integration only. Its prerequisites do not gate
built-in login or self-hosted operation. Preserve its protocol, binding, policy
and live-provider obligations while executing the shared IDENTITY-01..06 queue.

## Required user journey for the Nomen profile

The target command is `vaultixl login --domain=https://vaultix.cloud` (the same
native binary is also named `vaultix`). A new user should not need an issuer,
OAuth client registration or federation configuration to get started. The instance
supplies validated public connection metadata. When the Nomen profile is enabled
and selected, the CLI shows Nomen's approval URL and short user code, supports
another-device approval, and explains pending,
denied, expired and canceled states. Nomen owns credentials, MFA and its session.
Tokens never go in browser URLs, clipboard instructions, chat or A2UI events.

After provider approval, Vaultix verifies the identity binding and accepted tenant
membership through a protected action before saving the session. One authorized
organization can be selected automatically; multiple authorized organizations need
an explicit choice. GET requests must not create organizations, accept invitations
or link accounts. New owner/organization setup remains its own established flow,
with a suggested editable organization name. Public OAuth client administration is
an advanced later workflow, not a first-account step.

Clyffy uses the same source actions and reference-only MCP catalog. Local Codex
sign-in and an organization's own model setup remain separate from Vaultix login.
This packet does not implement Codex subscription integration or value delivery.

## What the existing code establishes

| Source boundary | Observed behavior | Consequence |
| --- | --- | --- |
| `internal/oidc/device.go`, `internal/cli/auth_cmds.go`, `internal/cli/session.go` | Device polling and stored renewal exist; protected server verification gates saving. | Preserve rotation, locking, denial and no-output behavior; provider approval alone is not application access. |
| `internal/api/client.go` | Protected verification uses `/api/v1/vaultix/projects`; project resolution also uses `/api/v2/workspace/:slug`. | Project lookup and bootstrap must join the identity cutover. |
| `internal/api/secrets.go` | Existing pull/push calls use `/api/v3/secrets/raw` and key-specific mutation routes. | Projects/MCP login acceptance does not prove these secret commands work with Nomen. Migrate their complete use cases or preserve explicit existing-token compatibility until replacement. |
| `internal/cli/run_cmds.go`, `internal/cli/sync_cmds.go` | Run can inject into an arbitrary child and falls back to saved local data after sync failure. | This is not accepted workload-bound AI delivery. INJECT-01 must distinguish offline policy from authorization/revocation failure before Clyffy can invoke it. |
| `core/backend-go/internal/services/auth/apiauth/classify.go`, `require_auth.go` | Local service/JWT modes are classified before local validation; middleware currently serializes authentication errors as 401. | External-token dispatch and provider-outage 503 need deliberate integration, not fallback after local validation fails. |
| `core/backend-go/internal/services/auth/apiauth/authenticator.go` (scoped read) | Existing users pass account lock, accepted-user, session-version and live membership checks. | External claims must not bypass account or tenant restrictions. Re-read full affected methods and consumers before edits. |
| `core/backend-go/internal/services/secretmanager/reference/projects.go`, `core/backend-go/internal/server/api/platform_routes.go` | Native project listing exists; reviewed platform registration does not expose Vaultix metadata actions. | Service existence is not route ownership or successful native login. |
| `core/backend/src/server/routes/vaultix-router.ts`, `core/backend/src/services/vaultix/reference-service.ts` | Current public project/reference/MCP actions execute TS services with tenant/permission checks and metadata filtering. | Preserve the public contract while moving domain execution to Go. A Go proxy back to this logic is not completion. |
| `core/backend/src/server/plugins/go-sidecar-forwarding.ts`, `core/backend/src/server/routes/index.ts` (registration range) | Proposed forwarding covers two v4 secret reads; reviewed registration is commented out. | It is not an active Vaultix metadata cutover switch. |
| `core/backend/src/db/schemas/user-aliases.ts`, `memberships.ts` | Alias records lack issuer provenance; memberships represent user/group/identity, scope, status and activity. | Never convert email or issuerless aliases into trusted Nomen bindings automatically. |

Exact Git blobs and read scopes are in [the source review](nomen-execution-sources.json).
A scoped read is not a whole-file authorship claim. The earlier complete AUTH-02
trace remains in 0070. No existing domain file is stamped rewritten by this plan.

## Ordered implementation packets

| Packet | Implement in place | Exit gate and dependency |
| --- | --- | --- |
| AUTH-03 A: provider protocol | Native `core/backend-go/internal/services/auth/nomen/` component; pinned HTTPS issuer/endpoint; authenticated introspection; strict bounded claims; no positive cache. | TLS fixture success, invalid/expired/wrong-audience/client denial, redirect/timeout/malformed-provider failure and recovery, independent assertion signature verification, concurrency/race and pinned lint. This component returns metadata only and remains unmounted. |
| AUTH-03 B: durable binding | Add a reviewed additive migration and native primary-pool service for exact issuer + case-sensitive subject bound to an existing user; explicit link/unlink flow with provenance and audit. | Real DB unique/concurrent binding, unknown/rebound subject denial, deletion/revocation, old binary compatibility and rollback. Requires full review of user deletion, migrations, database and audit consumers first. |
| AUTH-03 C: actor and tenant | Disjoint local/machine/service/external authentication profiles; resolve binding and current account/membership policy on primary DB; select an authorized tenant. | Locked/unaccepted/deleted user, inactive/invited membership, direct/group precedence, suborganization isolation, live revoke, SSO/MFA restrictions, existing session/token regression and provider outage recovery. Depends on A+B. |
| AUTH-04: native source actions | Register native projects/references and the same MCP catalog using complete Go domain permissions, data and audit ownership; version bootstrap metadata in the existing core contract. | Actual DB permission changes visible to CLI and long-lived MCP; pagination, empty/denied states, plain errors, 404 concealment, value-canary exclusion, routing rollback and ownership evidence. Depends on C. |
| AUTH-06: guided client/UI | Read validated instance connection metadata; org selection; device approval/progress/recovery; accessible account-link and connection dialogs; preserve session storage/rotation and API/issuer/account/org binding. | Exact command with no extra provider flags; keyboard/screen-reader/reflow/reduced-motion review; cancel, expired, denied and recovery states; protected verification before storage; actual Windows keyring acceptance. Fixture UX work can proceed before live registration. |
| AUTH-05: live acceptance | Registered public device/refresh client plus separate API resource-server credentials and approved API audience; real human approval; deployed canonical image. | Actual access-token success and ID/refresh-token rejection, rotation, issuer revoke, expiry, logout, cross-tenant denial and outage/recovery. Fixtures cannot close this packet. |
| READ-01 / SECRET-01 / INJECT-01 | Move the remaining CLI/project lookup and secret use cases onto accepted native actions and workload-bound delivery, retaining the encrypted store. | Full CLI operation/permission/provider matrix including imports, conflicts, offline policy, revoke, rollback and no model-process secret values. Login success cannot close these packets. |

No production route is enabled by AUTH-03 A. Its live access-token purpose profile
must be accepted before the new authority can be used. The introspection request's
`token_type_hint` and response's Bearer label alone are not proof that ID or refresh
tokens cannot be substituted.

### Binding and authorization decisions to resolve before cutover

The additive `vaultix_identity_bindings` owner now preserves a unique exact
issuer/subject pair, user linkage, proof provenance and revocation state.
See [the lifecycle checkpoint](nomen-binding-lifecycle.md) for accepted migration
and native-service evidence. Public linking remains unmounted. Never create
`nomen_vault_*` tables.
Account linking must prove both the existing Vaultix account and current Nomen
subject with a short-lived, single-use, origin/intent-bound challenge and reviewed
PKCE/state protection. An email match is never sufficient. Revocation/deletion must
retain enough tombstone history to prevent silent reattachment. Review nullable
user linkage with ON DELETE SET NULL against actual user deletion rather than
accidentally blocking existing deletion with a new restrictive foreign key.

Choose and test unambiguous authentication dispatch before integration. Local JWT
shape is not a reliable distinction from provider JWTs. Unsigned claims may only
route a candidate to one fixed validator, never confer authority; ambiguous forms
must fail. Do not try external introspection after a local validation failure or
send existing credentials to an unrelated issuer. An explicit profile hint, if
needed, is not authorization and must preserve standard Bearer client behavior.
The final classifier/contract is still an implementation decision requiring tests.

Audience identifies the intended resource, not organization entitlement. Read
accepted active membership and restrictions from the primary store on every
request, including direct/group precedence and suborganization rules. Do not
blindly label Nomen authentication as satisfying existing OIDC/MFA/SSO policy.
Where required assurance cannot be established, deny it. Existing temporary
privileges need a reviewed external-session binding; they are not inherited from
an unrelated browser cookie.

Bootstrap belongs to [the existing core API schema](../../contracts/vaultix.core.v1.json)
with a versioned response, runtime validation and generated consumers. It may
publish issuer, public CLI client ID, requested scopes and readiness. It must never
publish API secrets/private keys or silently fall back to a previous default
issuer when unavailable. No second API for AI and no new product Zod schema.

### Scaling and failure behavior

Introspection is an outbound dependency on each external request. Start without a
positive cache so revocation is not hidden by a local TTL. Add bounded concurrency,
queue/admission limits, per-tenant fairness and measured provider/API P95 capacity
before public release; do not interpret more replicas as provider capacity.
Require deadlines, capped response sizes and metrics without token/subject labels.
If caching later becomes necessary, document and test its revocation window first.

Invalid credentials produce 401; unavailable provider verification produces 503
with a plain safe error. External authority fails closed while existing independent
authentication remains available. Nomen's own propagation delay still needs live
measurement. Only trusted ingress may supply forwarded IP headers: strip/replace
untrusted headers and isolate the Go port before relying on network policies.

Native React delivers visible instructions, contextual tooltips and focus-managed
confirmation/recovery dialogs with actual request status. Catalog events must
separate teaching completion, pending execution and confirmed action success.
Lightweight vector art and optional lazy-loaded motion must fit loading and
reduced-motion budgets. UI/art choices can be reviewed in the real local preview
without blocking independent protocol and data work.

## Capability work after the login boundary

The current catalog contains 86 requirements in 13 groups and five dependency
phases. The families below route the full scope; they are not parity checkmarks.
Expand each family into operations, roles, providers/protocols, failure/recovery,
data ownership, UI/CLI/API consumers and retained compatibility before accepting it.

| Family | Canonical requirement IDs | Required expansion |
| --- | --- | --- |
| Workspace | W01, W02, W03, W04, W05 | Setup, organization/project/environment/folder lifecycle, templates and migration |
| Secrets | S01, S02, S03, S04, S05, S06, S07, S08, S09, S10, S11 | Encrypted CRUD/batches, references/import precedence, personal and branch behavior, history/restore, validation, sharing, every CLI/SDK/IaC operation and delivery/offline policy |
| Identity | I01, I02, I03, I04, I05, I06, I07, I08, I09, I10 | User and machine auth, federation, directory lifecycle, permissions, requests/approvals and conditions |
| Automation/connections | A01, A02, A03, A04, A05, A06, C01, C02, C03, C04, C05 | Each rotation/lease/sync provider, retries, durable jobs/events, existing relay/gateway/proxy compatibility; new Mesh remains excluded |
| Trust protocols | P01, P02, P03, P04, P05, P06, K01, K02, K03, K04, K05 | Certificate/signing lifecycle, ACME/EST/SCEP, KMS/HSM/KMIP, key recovery and hardware/provider tests |
| Privileged access/detection | R01, R02, R03, R04, R05, D01, D02, D03, D04 | Resource/protocol sessions, approval, recording/rotation, scanning, honeytokens and remediation |
| AI | AI01, AI02, AI03, AI04, AI05, AI06, AI07, AI08, AI09, AI10 | Local subscription and own-provider setup, references, approved actions, scoped delivery, revocation, adversarial data-flow tests and evidence |
| Governance/operations | G01, G02, G03, G04, G05, O01, O02, O03, O04, O05, O06, O07, O08 | Audit/outbox/export, explicit DevSCIF profiles, owned builds, Dragonfly default plus Redis/ElastiCache acceptance, recovery, capacity, service allowances and legacy reconciliation |
| Experience | U01, U02, U03, U04, U05, U06 | Navigation, contextual help/dialogs, guided learning, WCAG 2.2 AA workflows, vector/loading budgets and truthful previews |

The current first-party CLI index includes command families beyond today's native
CLI: agent, agent-vault, bootstrap, certificate management, gateway, initialization,
KMIP, org/profile/user, PAM/proxy/relay, scanning, service tokens, secrets management,
SSH, token and vault commands. Inventory every operation/flag/protocol against S09
and the responsible domain; renaming the binary does not implement these families.
Doppler branch configurations require inheritance, personal branches, promotion and
audited history; existing personal overrides alone are not branch parity.
Independent implementation and capability acceptance remain required. Included
software features do not remove permission, approval or operational controls.

## Primary research and uncertainty

All sources below were consulted on 2026-10-30; unversioned provider pages reflect
that retrieval date. Public discovery was read without credentials. Provider
registration, grant policy, intended audience and live token behavior remain
unverified. No frozen source/snapshot host was contacted.

| Primary source | Finding used in the plan | Limit |
| --- | --- | --- |
| [RFC 7662](https://www.rfc-editor.org/rfc/rfc7662) (October 2015) | Authenticated introspection and freshness/cache tradeoffs | Introspection is not local tenant authorization |
| [RFC 8628](https://www.rfc-editor.org/rfc/rfc8628) (August 2019) | Device approval, pending/slow-down, denial and expiry behavior | Published grant support does not prove this CLI client is registered |
| [RFC 9700 / BCP 240](https://datatracker.ietf.org/doc/html/rfc9700) (January 2025) | Audience restrictions; public refresh tokens require rotation or sender constraint; asymmetric client authentication | Provider policy and actual replay behavior need live acceptance |
| [RFC 8725](https://datatracker.ietf.org/doc/html/rfc8725) (February 2020) | Mutually exclusive validation rules prevent cross-token confusion | JWT shape and unsigned claims cannot establish authority |
| [OIDC Core errata set 2](https://openid.net/specs/openid-connect-core-1_0.html) (December 2023) | Issuer constraints and case-sensitive ASCII subject identifiers | ID tokens are not API access credentials |
| [ZITADEL introspection](https://zitadel.com/docs/guides/integrate/token-introspection), [private-key JWT](https://zitadel.com/docs/guides/integrate/token-introspection/private-key-jwt), [Basic](https://zitadel.com/docs/guides/integrate/token-introspection/basic-auth) | Separate API resource registration; private-key JWT preferred, Basic explicit alternative; assertion audience is issuer URL | Requires real resource client/key registration; fixture keys prove protocol only |
| [ZITADEL endpoints](https://zitadel.com/docs/apis/openidoauth/endpoints) | Introspection claim profile and supported endpoints | A Bearer response label cannot replace live ID/refresh-token rejection |
| [ZITADEL audience guidance](https://help.zitadel.com/security-best-practices-validating-audience-aud-claims-in-zitadel-access-tokens) (July 2025) | A client can request project audience independently of user grants | Always resolve local membership/permissions |
| [Nomen public discovery](https://id.shippin.cloud/.well-known/openid-configuration) | Issuer id.shippin.cloud advertises device grant and introspection with private_key_jwt/client_secret_basic | No human approval, public client registration, refresh policy or tenant access established |
| [Infisical CLI reference](https://infisical.com/docs/cli/reference) | Broader public command families require a native operation matrix | An index is not full flag/provider behavior or implementation evidence |
| [Doppler branch configurations](https://docs.doppler.com/docs/branch-configs) | Branch inheritance, overrides, promotion and history are distinct behaviors | Does not establish implementation or complete convergence |

## Verification, rollout and next action

The scoped result is recorded in [AUTH-03 A protocol evidence](nomen-protocol-evidence.md).

AUTH-03 A is newly authored native Go, exercised directly over a TLS fixture using
its real HTTP client and an independent JWT verifier for API client assertions.
Failure tests include malformed/duplicate claims, redirects, bounded bodies,
deadlines, invalid scope/audience/client/expiry, cancellation, parallel calls and
recovery without caching. It does not touch the DB, tenant permissions or production
routes, so those dimensions remain the explicit B/C/04 gates, not simulated claims.
The model-facing source actions continue to return metadata only.

Build the committed candidate using `core/Dockerfile.standalone-vaultix`. Run the
native internal race suite and pinned integration-tag linter from LF committed
source. Compare runtime layers with the accepted image; if changed, exercise the
canonical application/regression gates. Save exact source/image/check receipts in
local journals and publish only reviewed summaries. Never reduce a baseline.

AUTH-03 A protocol rollback remains code-only. AUTH-03 B now adds binding tables:
binary rollback retains them, and schema down refuses nonempty identity history.
Old-binary compatibility is proven in the linked lifecycle checkpoint;
route cutover must have an explicit owner switch and reconciliation. Disabling
external acceptance must not delete bindings or mint fallback local sessions.

The [native reauthentication continuation](nomen-reauthentication.md) implements
the local-password proof method and action-specific consumption; its verification
and remaining method matrix are tracked separately. MFA/federation never fall back
to password-only proof.

For this optional integration, remaining implementation includes AUTH-03 B native
factor/SSO fresh-authentication proof, link/revoke confirmations and notifications,
followed by C actor policy and
AUTH-04 source-action ownership. Persistence acceptance does not close the
remaining B consumers. Public registration can proceed alongside this work; only the live
gate waits for operator-controlled settings and human approval. No public login,
whole CLI parity, all-UI acceptance, public-cloud readiness or DevSCIF certification
is claimed by the protocol component or this plan.
