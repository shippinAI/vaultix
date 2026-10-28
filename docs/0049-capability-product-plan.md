# Vaultix capability, experience and AI workspace plan

Owner: AngryVibes LLC. Product: Vaultix.cloud. Tailored suite: DevSCIF.com.
Planning checkpoint: 2026-10-28. Status: proposed product organization and delivery
scope; existing software-included policy remains in force.

## Problem and outcome

Vaultix has a large existing codebase and capability surface, but neither a file
inventory nor renamed screens explains what a builder can accomplish, what has
been proven, or what must be implemented next. We need one navigable product
scope, complete workflows authored in place, and evidence that follows each
workflow through React, Go, storage, policy, delivery and operation.

This plan makes that work inspectable. The [capability workspace](capabilities/README.md)
contains 86 initial requirements in 13 groups, every preserved UI/API surface and
every file in the migration map. These are family-level requirements and primary
ownership assignments, not a claim that every behavior has been reviewed. Expand
provider/protocol/lifecycle matrices before declaring any family complete.

Self-hosted development on owned servers comes first. Source is public; builds
remain local/manual. Hosted services follow the same engine and acceptance gates.
Keep the encrypted store, compatibility, existing workflows and third-party
notices. Migrate complete use cases to native React/Go and scoped Rust components
under [0027](0027-native-stack-and-ai-migration.md). A proxy over old business logic
does not complete a migration. This plan authorizes no Mesh work.

## People and jobs

| Person | Job | Successful experience |
| --- | --- | --- |
| Builder / vibe coder | Give an application the configuration it needs | Guided setup, import preview, reference insertion, testable delivery and clear recovery |
| Team maintainer | Change production safely | Exact diff, policy explanation, approvals, rollout state and rollback |
| Platform operator | Run it on owned infrastructure | Reproducible image, capacity view, backup/restore, upgrades and outage diagnosis |
| Security administrator | Bound access and investigate events | Scoped identity, expiry/revocation, searchable audit and trustworthy evidence |
| AI-assisted developer | Delegate a task without exposing secrets | Reference-only plan, visible authority, explicit execution and redacted receipts |
| DevSCIF operator | Enforce a specified controlled deployment profile | Measurable isolation, egress, custody, recovery and evidence for that profile |

## Product organization

| Navigation section | Capability groups | First useful entry |
| --- | --- | --- |
| Build | Workspace; Secrets | Create/import a project, understand environments and dependencies |
| Access | Identity & access; Privileged access | Invite or authorize a workload; request temporary access |
| Automate | Lifecycle automation; Connections & sync | Connect one destination, preview a change, observe reconciliation |
| Protect | Certificates & signing; Keys & hardware trust; Detection & posture | Issue/renew, manage custody, investigate an exposure |
| Observe | Audit & governance | Follow a change from request to receipt and recovery |
| AI workspace | Clyffy & AI workspace | Connect a local assistant, inspect its scope, review its plan |
| Operate | Instance operations | Build, upgrade, restore and inspect health |
| Learn | Guidance & accessibility | Contextual lessons, searchable help and safe sample previews |

This is proposed information architecture, not a replacement application shell.
Keep an explicit organization/project/environment context bar and persistent
breadcrumb. Offer a task-oriented starting page, command search and pinned recent
work. Advanced capabilities remain discoverable through the full catalog and
stable deep links. Presentation filters never change permissions. Search results
must respect resource authorization and never expose values through previews.

Each workspace follows **inspect → propose → review → execute → observe → recover**.
The default panel shows the next useful action and its prerequisites; deeper
configuration expands in place. Failure states retain safe drafts and explain
whether anything was applied. Bulk actions show affected scope, conflicts and
approval requirements before submission. Success comes from a service receipt,
not a lesson animation, optimistic label or assistant assertion.

Contextual tooltips explain unfamiliar terms; essential instructions remain
visible and keyboard reachable. Dialogs have focus management, cancellation,
validation and unsaved-change behavior. Clyffy's side panel shows references,
intended action, scope, parameters, policy result and receipt. It is not a second
API or a place to paste secret values. Catalog-backed UI/MCP actions share the
same authorization. Keep learning events separate from execution events.

Use the existing Vaultix vector identity, restrained elevation, readable contrast
and lightweight SVG. Load charts, protocol consoles and optional teaching media
on demand. Reduced motion must preserve meaning. Acceptance covers 320px reflow,
zoom, keyboard-only use and manual assistive-technology checks across real flows;
automated scans alone do not satisfy [0022](0022-accessibility-acceptance.md).

## Included software and proposed service previews

| Offering | Included experience | Boundary / decision |
| --- | --- | --- |
| Self-hosted Vaultix | All software capabilities, including enterprise-oriented controls as implemented and accepted | Operator supplies infrastructure and external-provider prerequisites; normal authorization still applies |
| Free hosted sandbox | Proposed small real workspace with guided onboarding and sample previews | Quotas, retention, idle expiry and external cost limits remain TBD after capacity measurement |
| Managed service | Proposed operations, capacity, support and availability commitments | Service charges must not reintroduce software security-feature locks; pricing/SLA unapproved |
| DevSCIF deployment profile | Same engine with explicit control and deployment requirements | Hardware, isolation, operation and assurance must be specified and tested for each profile |

“Preview” has two explicit meanings: a labeled sample walkthrough with synthetic
data, or a real limited service with published limits. Never imply that a sample
issued a certificate, rotated a credential or established a protected workspace.
Previews show prerequisites, what will execute, resource/cost limits and reset
behavior. Provider credentials stay in the authorized connection flow. Free
quotas must not weaken isolation, omit audit or silently skip approvals. No
numeric quotas, prices or government readiness claims are approved by this plan.

## Capability acceptance and completeness

The authored catalog records an outcome, implementation state, target stack,
acceptance criteria, phase, AI boundary and evidence references per requirement.
Generated maps separately account for routes, operations and source files. The
first provider list discovers connection, sync, rotation and dynamic-credential
adapters; it is not the full cross-product provider matrix.

Before marking a requirement complete, its work packet must contain:

1. Lifecycle children: create/import/read metadata/change/approve/execute/revoke/
   delete/recover as applicable, with exact source ownership and retained contracts.
2. Provider/protocol/auth-method/SDK matrix, supported versions and prerequisites;
   record unsupported combinations and externally blocked tests explicitly.
3. Allowed, denied, cross-tenant, empty, concurrent, stale, retry and outage results;
   cryptographic/storage compatibility and rollback evidence where relevant.
4. Real-image browser evidence, accessible loading/error/denied/success states,
   keyboard and assistive-technology review, measured performance budgets.
5. Source and image identities, reproducible commands, receipts and remaining
   operational limits. A count or inherited test suite is insufficient.

Track **implementation, authored review, stack migration, workflow acceptance,
provider acceptance, deployment readiness and AI eligibility separately**. The
initial catalog intentionally accepts no complete family. Existing scoped tests
are linked rather than discarded or inflated into a claim of parity.

## Delivery order and concrete next packets

| Phase | Scope | Exit / dependency |
| --- | --- | --- |
| P0: trustworthy foundation | I01/I03/I05, S11, A03, O01/O02/O03; real identity, policy, store, jobs, build/cache/recovery | Real issuer/session and tenant-denial proof, encrypted restore rehearsal, canonical image; no baseline reduction |
| P1: builder workflows | W02/W03/W05, S01–S07/S09, U01–U06; native project/import/reference/change/recover flows | Complete workflow slices on P0, safe local assistant setup, visible failure recovery and accessibility evidence |
| P2: team automation | I06–I10, A01/A02/A04/A05, C01–C05 plus provider-specific protection/access work | Policy composition decided, one adapter proven through full lifecycle before expanding its matrix |
| P3: controlled AI workspace | AI01–AI10 and S10; approved execution, delivery, egress and receipts | P0–P2 authority and recovery gates pass; adversarial reference-only boundary tests |
| P4: DevSCIF profiles | G04/G05, K03 and applicable O04/O05 controls | Explicit profile selected; deployment, hardware, independent review and operational evidence |

Phases are dependency gates, not calendar promises or a reason to remove existing
capabilities. Individual catalog phase assignments govern detailed sequencing.
Parallel research is possible; production acceptance cannot skip its dependencies.

The next implementation packets should be small enough to demonstrate:

- **F1 identity:** trace current entry/session callers, document Nomen registration
  requirements, prove issuer/audience/tenant/logout with a real issuer. Block only
  live issuer-dependent tests if registration is unavailable; continue local denial tests.
- **F2 recovery:** record encrypted-store fixture and supported upgrade path;
  restore a disposable copy, compare metadata/ciphertext access under policy,
  rehearse failed migration rollback without touching operator data.
- **B1 builder workspace:** implement grouped navigation in the actual authenticated
  app, preserve every deep link, verify denied/empty/mobile states; use this plan
  for review before expanding new artwork or teaching motion.
- **B2 change lifecycle:** trace create/import/reference/approve/restore end to end,
  author Go domain behavior and React interactions together; test old data and API
  compatibility before retiring the corresponding old path.
- **T1 automation:** select one already configured provider, define overlapping
  approval semantics and prove rotation or sync with timeout, retry and rollback.
- **AI1 execution boundary:** bind an approved reference-only action to exact
  parameters and workload; prove no value reaches the model, agent process or logs.

Each packet needs a named maintainer before scheduling. Product direction and
acceptance are owned by AngryVibes LLC; engineering ownership is not invented here.

## AI SCIF engineering target

Use “AI SCIF” as a proposed controlled AI workspace, not an accreditation claim.
DevSCIF requires a selected control profile, not simply a different domain name.

- Nomen identity, tenant isolation and least privilege apply to humans and agents.
  Local Codex sign-in remains in the user's local tool. Own-model/provider setups
  need explicit trust/egress policy; never collect subscription credentials.
- Clyffy sees references and redacted metadata. Values leave only at authorized
  injection redemption to a bound application workload, never the AI process.
  Rust delivery must validate identity, target, expiry and single-use semantics.
- Parameter-bound approvals, policy re-evaluation, idempotency and revocation
  prevent stale plans from becoming authority. Cancellation must report whether
  a remote side effect already happened and reconcile it.
- Approved outbound destinations, methods and paths require redirect/DNS/private
  address controls. Untrusted repository, tool and document content cannot expand
  permissions or choose an unapproved credential destination.
- Durable redacted receipts, outbox delivery, retention, emergency revocation and
  operational separation require tests under restart, partial failure and attack.
- Local/disconnected operation requires its own model, update, signature, custody,
  recovery and time policy. No offline or government suitability claim until proven.

## Validation and decisions still needed

Proposed release targets: zero unclassified baseline surfaces or migration rows;
no removed compatibility surface without approved migration; each accepted
workflow has the evidence above; canary-based checks find zero secret values in
AI context or logs. Keep performance targets from the existing UI performance
work and measure real server capacity before setting service limits.

Decisions still open: free hosted allowance policy and amounts; inventory and
placement of the three bare-metal servers; first external provider with test
credentials; DevSCIF control/data-classification requirements; assigned owners.
The software-included policy is the working assumption. These decisions do not
prevent source review, UI planning or local build/test work.

Public capability discovery was refreshed from official
[Infisical product families](https://infisical.com/pricing),
[Doppler product families](https://www.doppler.com/pricing),
[Doppler inheritance](https://docs.doppler.com/docs/config-inheritance),
[Doppler MCP](https://docs.doppler.com/docs/mcp),
[Doppler agent workflows](https://www.doppler.com/agents) and
[Infisical Agent Vault](https://infisical.com/platform/agent-vault), accessed
2026-10-28. These identify comparison questions, not implementation rights,
tested parity or Vaultix acceptance. Independent behavior specifications and
our stricter agent-value boundary govern implementation.

## Planning artifact verification, 2026-10-28

The generated map classifies all 273 preserved UI routes, 2,290 API operations and
9,387 migration-source rows. It discovers 189 adapter paths across six selected
roots. The additional planning/tooling files account for the source-count increase;
no product module was marked migrated by this work.

`scripts/test-capability-map.mjs` passes coverage, unknown/duplicate/cycle,
evidence-state, provider omission and read-only HTTP boundary checks.
`scripts/test-capability-explorer.mjs` passes filtering, empty/reset behavior,
keyboard dialog focus return, phase/provider views and 320px reflow. Six axe
states have zero reported violations; manual assistive-technology review remains
open. Local receipt: `.cache/capability-plan-UP4E0v/result.json`, with screenshots
and automated/manual-review findings alongside it. This verifies the planning
artifact only, not the capabilities described in it.
