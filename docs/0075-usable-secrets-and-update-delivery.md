# Usable secrets and reliable update delivery

Owner: AngryVibes LLC. Product: Vaultix.cloud. Suite: DevSCIF.com.
Direction: 2026-11-01. Starting source: `a18b9e03`.

The immediate deliverable is a complete operator/developer journey: obtain a
verified build, sign in to the selected instance, select a project, use secrets
in an application, update the running server, and repeat with existing data
intact. Real AI-client and accessibility acceptance are explicit outcomes.

This focuses the [execution queue](0069-execution-goal.md) while preserving the
[native migration](0027-native-stack-and-ai-migration.md),
[dual identity contract](0074-built-in-and-federated-identity.md),
[capability baseline](0026-capability-preservation.md), CLI parity,
whole-tree authorship and [public-cloud gates](0054-public-cloud-service.md).
Auth and Secrets remain the scope; Mesh needs separate authorization.

The [implementation specification](delivery/implementation.md) now supplies the
source findings, public protocol, native route ownership, CLI/UI state behavior,
artifact/signing/upgrade design and dependency-ordered task register. Its
[acceptance matrix](delivery/acceptance.md) defines concrete independent scenarios.
Those documents deepen this plan; their tasks and cases are not implementation
or verification claims.
Their P00 prerequisite records a concurrent `85361217` source-integrity regression
found during planning. Resolve its compile, branding-test and dependency/provenance
issues before LOGIN or accepting a new build; retain the earlier verified preview.

## Grounded starting state

| Boundary | Existing behavior | Missing delivery |
| --- | --- | --- |
| Web identity/secrets | Standalone-image sign-in, projects and selected secret workflows; existing accounts, factors, tenants and encrypted store | All-workflow accessibility and capability acceptance |
| Native identity | Go grants, approval authority, sessions, durable events and selected resource consumers, with scoped receipts under `docs/auth/` | Public discovery/HTTP composition, complete resource/MCP consumers, approval UI and CLI default as one usable journey |
| CLI login | `internal/cli/auth_cmds.go` validates domain, token and machine login; terminal default remains Nomen | Built-in remote approval without a separately registered Nomen client |
| CLI secrets | `internal/api/secrets.go` uses compatibility raw-secret APIs; `internal/cli/run_cmds.go` launches a child and falls back to local data on any sync error | Full image-level consumption proof, explicit outage versus authorization policy, target-bound Rust delivery for AI-managed use |
| MCP UI | Native packaged resource, shared React controls/guidance, actual CLI/two-server reference and revocation tests | Real AI-client rendering and assistive-technology acceptance |
| Updates | Version identity, release discovery, CLI/UI notices and local committed-source builders | Published coordinated artifacts, trusted manifest/signatures, verified installation and actual server upgrade/recovery |

The packaged CLI proof uses supplied tokens, machine identities and a labelled
fixture issuer. It does not approve a real built-in device request or prove an
application consumes a server secret. The current CLI reports a development
build. The owned GitHub latest-release endpoint returned 404 during this intake;
no stable downloadable release was established.

Reuse native component evidence at its exact scope. Begin with
[device consumers](auth/device-api-consumers.md),
[session lifecycle](auth/device-session-lifecycle.md) and
[event worker lifecycle](auth/device-event-worker.md). These are chronological
records: inspect current source/receipts before duplicating an earlier unfinished
prerequisite that a later increment completed. Inventory is not module review.

## Required user journey

These are acceptance targets, not claims that today's CLI implements every step:

1. Install a verified native `vaultix` or identical `vaultixl` binary. Run
   `vaultix login --domain=https://<instance>`. Discover that instance and print
   a short-lived approval URL/code usable on another device. Ordinary built-in
   login requires no OAuth-client administration, Nomen registration or bearer
   copying. `--vaultix` is not the executable syntax.
2. Use existing app login, MFA and organization selection. Approval identifies
   instance, client, organization and requested access. First-owner setup remains
   account/organization creation with an editable example name; federation setup
   is a later administrative workflow. Denial, cancellation and expiry recover
   accessibly without silently changing login method.
3. Verify protected access before saving CLI credentials. `vaultix auth status`
   confirms access without values. Select an authorized project/environment;
   deliver a secret to an actual application and observe a non-secret success
   result. AI and MCP receive references only.
4. Show updates only for an actual compatible release. Review changes, backup and
   migration/rollback requirements; verify and apply the exact build; confirm
   existing login and secret consumption. Errors identify failed steps without
   claiming "up to date", resetting data or losing operator configuration.
5. Connect Clyffy through the user's signed-in local AI client. Codex subscription
   and own-provider configurations stay separate from Vaultix credentials. A real
   rendering-capable host displays the native reference view. Text-only clients
   retain useful MCP tools and state their rendering limitation honestly.

## Ordered implementation and acceptance

Each packet needs a linked immutable journal plan before edits, complete reads
of affected modules, caller/data/authority traces, source fingerprints and exact
test commands. Component commits are allowed; consumer proof closes the packet.
Do not replace the immediate journey with unrelated UI polish.

### 1. LOGIN — complete public native login

Finish discovery and bounded HTTP routes around the existing Go device owner.
Trace `core/backend-go/internal/services/auth/device`, native auth middleware,
`core/backend/src/server/routes/vaultix-router.ts`, existing frontend login/org/
session consumers and root `internal/cli`. Extend the existing versioned core
contract, then author approval UI and CLI method selection/storage/renewal.
Preserve browser, delegated OAuth, workload and device credential separation;
shared existing tenant/MFA policy; and canonical account/session ownership.

Proof: packaged CLI → real browser approval → public HTTP → native session →
protected source action on the standalone image. Test Nomen-unavailable built-in
login, permitted federation through approval, enforced SSO without downgrade,
MFA, denial/expiry/cancellation, polling/backoff, one-use redemption, refresh/reuse,
restart, multiple replicas, changed membership and revoked sessions. Provider
method fixtures do not establish live provider acceptance. Never advertise
discovery profiles before their enabled consumers exist.

### 2. SECRETS — prove application consumption

Trace project selection, `internal/api`, `internal/syncer`, `internal/store`,
CLI sync/run, native references and existing secret mutations. Preserve encrypted
storage and compatibility APIs. Resolve stale-cache fallback on denial explicitly;
revocation is not connectivity loss. Implement the scoped Rust broker and
target-bound delivery protocol in the existing migration plan before advertising
AI-managed injection. MCP remains metadata-only; no secret values in chat.

Proof: real project/secret creation, scope selection, edit/version/restore where
supported, imports/precedence, conflict, empty/invalid scope and an independent
canary-consuming application. Test cross-tenant/revoked denial and explicit
offline policy. Target-bound delivery rejects wrong executable/launch, replay
and expiry. Canary values must be absent from MCP, AI transcripts, logs and UI
events. Existing `run` commands alone do not establish this boundary.

### 3. UPDATES — distribute and recover exact builds

Extend existing CLI/image builders, release contract/owners and operator tooling.
Publish coordinated versioned artifacts from committed source: CLI hashes,
registry digest or image archive hash, source identity, versioned manifest,
trusted signatures, supported platforms, release notes and migration/backup
requirements. Builds run on owned infrastructure; hosted Actions are optional.

Proof: a fresh consumer retrieves the published artifacts and verifies trust.
Start an older supported image with encrypted data, upgrade from that retrieved
release, then repeat login and workload consumption. Reject tampering, wrong
platform, incomplete release, incompatible schema and interrupted downloads.
Rehearse compatible binary rollback and incompatible-schema backup restore.
Notices must refer to the release actually available, not merely a source tag.

### 4. AI-HOST — accept actual clients

Use the released `vaultix mcp`, existing source catalog and native resource/bridge;
no second model API or product viewport wrapper. Inventory installed clients and
check their primary documentation before promising rendering. Codex is the
primary requested AI workflow; if its selected version cannot render Apps, verify
the Apps surface in a real rendering-capable client and retain that limitation.

Proof: recorded client/version/OS, transport negotiation, authenticated project/
reference tools, rendered view where supported, tooltips/dialogs, revocation,
disconnect/reconnect, cancellation and no-value output. Text fallback and native
rendering are separate results. A custom Playwright host cannot close this gate.

### 5. A11Y — accept the real workflows

Automated and keyboard checks run throughout packets 1–4, with manual acceptance
before claiming those workflows ready. Use existing React controls and WCAG 2.2
AA requirements. Shared-component fixes require consuming-workflow retests.

Proof: actual NVDA with Edge/Firefox and VoiceOver with Safari on login/approval,
project/secret workflows, update guidance and Clyffy/MCP dialogs. Record versions,
routes/roles/states, names/descriptions, reading order, error/status announcements,
focus containment/restoration, cancellation and defects/retests. Include 320px
reflow, 200% text, 400% zoom, forced colors, text spacing and reduced motion.
Retain axe incomplete results. A zero-violation scan is not manual acceptance.

### 6. SERVER-ACCEPT — prove the owned deployment

Use the selected server's existing deployment identity, keys, volumes and backup
process. Confirm OS/architecture, storage, TLS/reverse proxy, trusted-proxy policy,
service ownership and recovery targets before cutover. Record retrieved artifact
identity, durable existing data, real browser/CLI login, application consumption,
restart, upgrade and recovery timings. This accepts that deployment only, not all
public-cloud gates. It closes the server portion of LOGIN, SECRETS and UPDATES.

Release tooling and independent local tests can advance while a live provider,
host or operator input is missing. Its evidence stays open. Built-in operation
does not depend on Nomen. Go forwarding old business logic is not domain migration.

## Distribution and recovery invariants

Source, artifacts and installed deployments are distinct. A source push does not
update a server; an image pull does not recreate it. A local image ID differs from
a remote registry manifest digest. Record the appropriate identity and pin it;
do not rely on mutable `latest` tags.

Owned builds remain primary. A registry is optional: transfer a verified image
archive to a same-architecture host, or publish to an explicitly selected registry
and pull by digest. Use one manifest contract for both. Provision signing trust
independently of the downloaded manifest. Downloading an untrusted key alongside
a binary is not provenance. Signing-key custody/rotation stay in operator tooling.

Upgrade tooling must preserve the existing Compose project/volume bindings,
database, encryption keys and operator configuration. Persist the desired image
selection so a later restart does not revert it. Lock concurrent upgrades;
preflight version/platform/disk/backup/schema; verify artifacts; apply the intended
service changes; await health; run protected workflows; record revision/digest.
Keep the prior artifact and recovery instructions. Never prune unrelated services.

Rehearse on disposable restored data before cutover. Older-binary rollback is
valid only with compatible schema/data. Otherwise restore the matching database
and key backup with an agreed recovery point/downtime. Health alone cannot prove
secret usability. Credentials and production backup contents stay out of receipts.

## Enforced checks and drift control

Use the existing journal schema and `scripts/ai-journal.mjs`, not a competing
readiness database. The immutable parent carries LOGIN, SECRETS, UPDATES, AI-HOST,
A11Y and DRIFT. Required checks are recorded before implementation.

The integration entry point below is **reserved work, not yet implemented**.
Its subcommands must exercise actual boundaries, load non-secret artifact inputs
from a versioned local receipt, and fail when an artifact, environment or assertion
is missing. No placeholder pass, mock application or skip-as-success is acceptable.

| Check | Predeclared command/review | Required evidence |
| --- | --- | --- |
| `login-system` | `node scripts/accept-vaultix-delivery.mjs login` | Real browser/public endpoint/session/CLI/protected action |
| `secrets-system` | `node scripts/accept-vaultix-delivery.mjs secrets` | Real store and intended target consumption, including denials |
| `updates-system` | `node scripts/accept-vaultix-delivery.mjs updates` | Published download, verified trust, upgrade and recovery |
| `ai-host-system` | `node scripts/accept-vaultix-delivery.mjs ai-host` | Integration prerequisites; actual-client review still required |
| `a11y-system` | `node scripts/accept-vaultix-delivery.mjs a11y` | Packaged keyboard/reflow/axe and failure/recovery |
| `drift-integration` | `node --test scripts/ai-journal.test.mjs` | Staleness, weakened-plan, missing-layer, tamper and failure controls |
| `source-integration` | `node scripts/accept-vaultix-delivery.mjs source` | Current source compiles; branding/dependency/provenance checks and fresh canonical artifact pass after P00 repair |
| `updates-manual` | Actual owned-server deployment/recovery review | Server identity, retrieved artifacts, protected journeys and timings |
| `ai-host-manual` | Actual supported-client session | Versions/capabilities, steps, outcomes and limitations |
| `a11y-manual` | Actual assistive-technology review | Browser/AT, workflow states, announcements, defects and retests |

Before edits, each implementation packet registers exact commands and complete
source dependencies. After edits, append refreshed fingerprints with a reason
and run checks against that candidate. Changes invalidate old receipts.
Requirements/layers/checks cannot silently be removed or weakened. Genuine scope
changes require a linked decision preserving unmet parent obligations. Keep one
active implementation packet and its next acceptance failure in the handoff.

Retain canonical image gates and unchanged UI/API baselines. Add journey proofs;
standard gates alone cannot close them. Use independent expected outcomes,
old-binary controls and isolated mutation tests to show crucial guards fail when
broken. Never reduce a baseline or change production behavior to make tests pass.

Receipts bind source hashes, command, image/binary identity, environment, scenario,
result and remaining scope. Long builds keep separate logs and terminal results;
a bounded verifier must validate those artifacts and all required outcomes, not
trust a stale JSON `passed` flag. Counts alone are not completion evidence.

Run `assess` after each packet. Missing, failed, stale and manual checks remain
visible. The runner cannot manufacture manual evidence with a command. Record
actual reviews separately; keep its manual gate unresolved until an explicit
reviewed evidence policy handles it. Local hashes check consistency, not independent
attestation or the adequacy of requirements/assertions.

## Inputs, research and next action

The first server's SSH alias/hostname, OS/architecture and intended URL were
requested. Inspect available operator references before repeating questions;
credentials remain external. Meanwhile complete local login, acceptance tooling
and artifact/recovery work. Inventory actual AI-client and assistive-technology
environments; a subscription does not establish rendering support.

Primary sources reviewed 2026-11-01:

- [RFC 8628](https://www.rfc-editor.org/rfc/rfc8628.html): remote device approval, pending/slow-down/expiry/denial.
- [RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html): scope/resource binding and public-client refresh security.
- [Docker pull](https://docs.docker.com/reference/cli/docker/image/pull/): digest pinning and platform selection.
- [W3C evaluation](https://www.w3.org/WAI/test-evaluate/): tools alone do not establish accessibility; human evaluation remains necessary.

**Next packet: P00, then LOGIN.** Repair the recorded current-source regression;
reconcile accepted native grant/session/event/consumer
work, fully trace remaining public composition and authority, freeze the contract
and predeclare real browser/CLI acceptance before changing the CLI default. The
exit is usable built-in login against the image, not another unmounted component.
