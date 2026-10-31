# Vaultix execution goal and ordered delivery plan

Owner: AngryVibes LLC. Product: Vaultix.cloud. Suite: DevSCIF.com.
Planning checkpoint: 2026-10-29, following merged source `e42b6367`.
This is the current execution queue for the existing migration goal, not a new
product architecture or a declaration of completed migration.

## Goal

Complete the in-place Vaultix product migration: native React workflows, Go
domain ownership and scoped Rust delivery/protocol components; approachable
remote sign-in; reference-safe AI assistance; preserved existing capabilities;
and a verified public service operated on owned infrastructure with the same
engine available for self-hosting. Author complete use cases in the existing
tree and encrypted store. Commit, merge and push accepted increments with exact
source, artifact, workflow and recovery evidence.

Architecture and dependency authority remain [0027](0027-native-stack-and-ai-migration.md)
and [workstreams.json](migration/workstreams.json). The UI execution method is
[0029](0029-ui-workflow-execution.md); product grouping and capability scope are
[0049](0049-capability-product-plan.md) and [the capability catalog](capabilities/README.md).
Public-service acceptance remains [0054](0054-public-cloud-service.md).
Auth (built-in and federated) precedes Secrets. Mesh is outside this checkout's authorized work.
The owner's 2026-10-30 [dual identity correction](0074-built-in-and-federated-identity.md)
supersedes Nomen-only prerequisites in this queue and earlier architecture.

## Starting checkpoint

| Area | Established evidence | Still open |
| --- | --- | --- |
| Local engine | Canonical image built and healthy at port 8200; existing owner/data preserved; 16 scoped application/build gates passed | Public exposure, production topology, capacity and availability acceptance |
| CLI and MCP | Protected login, local reference-only MCP, saved device renewal, rotation locking and failure recovery; 101 Linux unit/race checks and 12 CLI/image checks | Real Nomen identity mapping/approval, live issuer revocation and actual Windows keyring acceptance |
| UI | Real application entry and selected authored workflows have browser evidence | All-workflow authorship, manual accessibility, full mobile/reflow and loading acceptance |
| Capabilities | Existing engine surface and capability catalog retained | Complete behavior/provider matrices, independent gap implementations and end-to-end family acceptance |
| Native migration | Domain map, dependency graph and selected native services exist | Complete Go ownership per use case, Rust delivery and retirement of replaced implementations |

Exact checkpoint receipts and image/CLI identities are in
[0068](0068-device-session-renewal.md). Its issuer is a test fixture; it does not
prove public Nomen sign-in. Existing scoped proofs stay valid for their recorded
claims. Nothing in this plan expands them into blanket parity or cloud readiness.

## Immediate queue: preserve built-in identity and support federation

Execute IDENTITY-01 through IDENTITY-06 in [0074](0074-built-in-and-federated-identity.md):
characterize existing built-in and federated workflows, version instance login
metadata, implement native built-in remote authorization, preserve shared actor
and tenant policy, author accessible connection workflows, and prove both modes.
Self-hosted built-in operation must not require Nomen. The current native CLI
default to Nomen is an implementation gap, not the intended product contract.

The external Nomen integration retains the obligations below. Its live provider
gates apply to that integration; they do not block independent built-in identity.

AUTH-02 has scoped authority-contract evidence; AUTH-03 is now in progress.
The [researched execution breakdown](auth/nomen-execution-plan.md) maps the native
verifier, durable bindings, actor policy, source actions, guided login and remaining
CLI capabilities to concrete gates. AUTH-03 through AUTH-04 can proceed
using local deterministic fixtures while external registration is being resolved.
AUTH-05 remains a live acceptance gate, not a reason to stop independent work.

AUTH-02's current source trace, introspection decision and delegated-token
correction are recorded in [0070](0070-nomen-authority-contract.md). External
bearer acceptance remains disabled/unimplemented; AUTH-03 still requires the
complete verifier integration and durable issuer/subject binding, followed by actual
route integration in AUTH-04. The [native protocol component](auth/nomen-protocol-evidence.md)
has scoped fixture/race evidence and remains unmounted.

The owner's 2026-10-30 UI/DevSCIF steering is captured in
[0071](0071-devscif-governance-experience.md): evolve existing controls with
contextual help, reviewed changes, notifications and recovery, alongside an
explicit shared-engine service roadmap. GOV-UI-01 authors the existing MFA
settings workflow; it does not replace AUTH-03/04 or imply DevSCIF acceptance.

| Packet | Implementation and review scope | Required exit evidence |
| --- | --- | --- |
| AUTH-02 authority contract | Fully read TS identity middleware, Go `auth/apiauth` and permission callers, browser OIDC, user aliases, memberships and native project/reference routes. Record exact blobs, actor derivation and existing login/session behavior. Specify issuer, access-token format, intended audience, subject binding, organization selection, revocation and rollout contract. | Route-to-handler-to-authority/data trace; explicit decision for JWT validation versus authenticated introspection based on the actual issuer contract; no inferred account link from email or unsigned claims. |
| AUTH-03 native verifier and mapping | Author Go issuer verification and issuer-plus-subject mapping against the existing user/membership model. Review alias provenance before reuse; any additive migration must preserve old binaries and encrypted data. Require accepted, active membership and existing account restrictions. Keep new authority acceptance disabled until configured and verified. | Wrong issuer/audience/signature/type/expiry, unknown/rebound subject, locked user, inactive membership and cross-tenant denial; key rotation or introspection failure; existing-token regression and rollback tests. No ID tokens accepted as API bearer tokens. |
| AUTH-04 complete source-action integration | Use that authority on the existing native projects/references path and its MCP actions. Preserve permission evaluation, tenant hierarchy, audit identity and existing API compatibility. Integrate CLI device sessions with the verified server contract. | Real database permission changes/revocation observed by CLI and long-lived MCP; empty authorized projects; consistent plain error strings; canary exclusion from metadata, logs, UI events and MCP. A Go proxy over old business logic is not completed domain ownership. |
| AUTH-05 live remote acceptance | Use the registered public Nomen device/refresh client and approved API audience. A human approves the initiated login on another device. Verify refresh/rotation, expiry, issuer revocation, local logout and server denial. | Exact issuer/client configuration without credentials in evidence; real human approval; real tenant authorization; canonical-image receipt; tested issuer outage/recovery. Fixture approval cannot close this packet. |
| AUTH-06 guided connection UX | Author native connection/setup states with clear scope, remote approval instructions, progress, cancel, expired/denied recovery and accessible contextual help. Keep instance-owner creation separate from public enrollment and organization federation. | Keyboard, screen-reader review, reflow, reduced motion, no-value output and real successful/denied sign-in. Verify Codex subscription and own-provider setups independently; never collect model subscription credentials. |

AUTH-02 starting paths: `core/backend/src/server/plugins/auth/inject-identity.ts`,
`core/backend-go/internal/services/auth/apiauth/`,
`core/backend-go/internal/services/permission/`,
`core/backend/src/ee/services/oidc/`, `core/backend/src/db/schemas/user-aliases.ts`,
`core/backend/src/server/routes/vaultix-router.ts`, `internal/oidc/` and
`internal/cli/`. Trace their DALs, migrations, callers and tests before edits;
this path list is discovery, not a completed review.

## Subsequent implementation queue

These packets follow the workstream dependencies; UI, characterization and local
failure tests can advance independently when a live provider gate is unavailable.
Audit/outbox foundations land before dependent automation or irreversible actions.

| Order | Deliverable | Completion gate |
| --- | --- | --- |
| 1. READ-01 | Complete Go project/environment/reference reads against the current store, consumed by native React and the same MCP catalog | Old/new behavior comparison: pagination, empty/denied states, imports/precedence, roles, tenant hierarchy and latency; no secret values in metadata |
| 2. SECRET-01 and ACTION-01 | Encrypted create/edit/import/version/restore/delete workflows; shared source actions, approvals, idempotency, transactional audit/outbox and visible execution history | Success/denial/conflict/concurrency/cancel/recovery; exact approval parameter binding; same human/AI authority; one writer; restored ciphertext remains usable |
| 3. INJECT-01 | Scoped Rust broker and CLI integration for delivery to an authorized application process | Actual canary consumption by the intended workload; agent-process, wrong-target, cross-tenant, replay, expiry and revocation denial; supported OS and offline-policy acceptance |
| 4. AUTO-01 and PROVIDER-01 | Rotation, leases, connections, sync and events; explicit queue/worker ownership and reconciliation | Per-provider lifecycle matrix, paging/rate-limit/outage recovery, duplicate-delivery safety, durable audit and cutover/rollback; no duplicate consumers |
| 5. SECURITY-01 | Identity administration, SSO/SCIM, policy/approvals, audit/export, KMS/HSM/KMIP, PKI/signing, PAM, scanning and honeytokens | Each capability expanded into operations and provider/protocol prerequisites; real authorization, recovery, UI and provider evidence; independent implementations for remaining convergence gaps |
| 6. CLOUD-01..08 | Public enrollment, service isolation/fairness, recovery, execution durability, measured admission/capacity, availability/upgrades, operations and user lifecycle | All public-release gates in 0054, with actual hardware/workload matrix, recovery objectives and rehearsals; a Compose smoke test or more replicas cannot close them |
| 7. DEVSCIF-01 | Enterprise/government-tailored deployment profiles using the same included software capabilities | Explicit control profile, custody/egress/operator boundaries and evidence agreed for the intended environment; no inferred certification or classified-system suitability |
| 8. RETIRE-01 | Retire replaced code and optional duplicate panel paths after migration windows | Equivalent accepted workflows, no remaining callers/jobs, reconciled data, operator migration and documented rollback boundary; provenance retained |

UI is delivered with each domain: project/environment/secret workflows first,
then access/approvals, automation, security domains and administration. Use native
React, lightweight vector artwork and deliberate elevation; lazy-load optional
charts/protocol/media modules. Tooltips supplement visible instructions. Dialogs
need focus/cancel/recovery behavior. Catalog-backed A2UI events distinguish
teaching from successful service execution. Remotion/teaching media remains
optional and reduced-motion compatible. Ask for UI/art direction on a concrete
visible choice, while continuing work that does not depend on that choice.

## Capability accounting and no-regression rule

For every capability catalog requirement, expand child operations, permission
variants and provider/protocol combinations before acceptance. Bind each child
to exact source paths, API/UI actions, data/job ownership, tests and receipts.
Use `docs/code-audit/reviews.json` for read/authorship decisions and the capability
catalog for product grouping. Generated file counts are not work completion.
Keep unknown, authored, fixture-tested and live-accepted states distinguishable.

Preserve legacy compatibility while replacing complete use cases in place. Do
not recapture a smaller UI/API baseline, remove tests to conceal regressions,
replace the encrypted store, or claim entitlement flags prove enterprise parity.
All software features remain included; RBAC, approvals and operational limits
remain enforced. Dragonfly stays the default; Redis and ElastiCache retain their
explicit alternatives and their distinct acceptance requirements.

## Inputs that gate live acceptance

| Input | Known now | Work that continues without it |
| --- | --- | --- |
| Nomen public client | Issuer discovery at `https://id.shippin.cloud` advertises device authorization. Public CLI registration, API audience, access-token contract and refresh policy are unverified. The existing confidential app is not assumed to be that public client. | AUTH-02 trace/design, Go validation/mapping fixtures, authorization regression and UI state design. Request only public settings; credentials stay in operator tooling. |
| Owned servers and first region | Three owner-operated bare-metal servers are stated; actual placement, hardware/failure domains, operator access and recovery targets are not accepted in this plan. | Local restore, isolation, durable job tests, repeatable builds and capacity harness. No invented WI/TX target or automatic public exposure. |
| External providers/hardware | Per-family credentials, tenants, test resources and HSM/ElastiCache/protocol environments are not presumed available. | Native implementation, provider contract/failure fixtures and explicit outstanding live gates. |
| DevSCIF profile | Suite direction established; deployment/control profile remains unspecified. | Shared engine security, operator separation, audit and recovery foundations. |

## Delivery loop and definition of done

For each packet: read/trace and record the behavior matrix; author in place;
verify targeted success/denial/failure paths; build the canonical standalone
image when runtime/source artifacts change; exercise the actual workflow;
reconcile audit/maps and receipts; commit, merge and push accepted changes;
update the visible local preview where runtime behavior changed; record the next
packet and remaining prerequisites. Builds run locally on owned infrastructure;
GitHub is source hosting and Actions are optional manual workflows.

Documentation-only changes require link/map/audit checks and canonical artifact
identity verification; they do not justify repeating unchanged behavioral suites.
Preserve uncommitted operator files and running data. Migration and deployment
changes need a concrete rollback path before cutover. Secrets must stay out of
chat, A2UI, model processes, generated model configuration and public receipts.

The overall goal is complete only when the capability and authorship queues are
accepted at their stated scope, native domain cutovers are proven, guided UI and
AI workflows work end to end, production gates pass on the selected owned
infrastructure, and the selected DevSCIF profiles have their required evidence.
Commit counts, a healthy preview, fixture success or missing external inputs
cannot substitute for those outcomes. Continue independent ready packets when
one gate lacks an external prerequisite; report the specific remaining gate.

## Planning verification

Local document links and audit/migration map checks passed. The canonical image
was built from planning source `06fef70bb6d24dca55dc20eefb58cfbae5dcee5f`:
`sha256:a282f897d63d48c3d90e27d46a342ee02cc8a360ac22cb6c8dc28b83ffaef261`.
Its revision identity matches and its runtime filesystem layers equal the
accepted 0068 image. Receipt:
`.cache/headless-ai-login/.cache/execution-plan-build-0oC4Ab/result.json`.
This documentation packet changes no application/CLI source or runtime behavior;
the existing preview and behavioral evidence remain in place. The planning
checks do not close any of the implementation or live acceptance gates above.
