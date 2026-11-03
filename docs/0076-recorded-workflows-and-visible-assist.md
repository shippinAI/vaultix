# Recorded application, remade cards and visible AI assistance

Owner: AngryVibes LLC. Product: Vaultix.cloud. Suite: DevSCIF.com.
Plan date: 2026-11-01 (America/New_York).
Grounded source: `50f993659bf6aac93184a1687cd32930f7683fde`.
Status: **researched execution plan; the new capabilities below are not implemented**.

The outcome is a real Vaultix application whose existing cards and workflows are
authored in place, whose controls explain themselves, and whose approved actions
can be performed visibly by a connected assistant. Record that application and
produce Remotion lessons from the footage. The user must be able to watch, take
over, and repeat the workflow without AI.

This implements [0024](0024-interaction-and-teaching-system.md), extends the
[UI execution method](0029-ui-workflow-execution.md), and preserves
[0075's login, secrets and update delivery obligations](0075-usable-secrets-and-update-delivery.md).
It does not replace the encrypted store, introduce a second AI business API, or
claim whole-product authorship, enterprise parity or public-cloud readiness.
Remotion commercial use proceeds on the owner's already-recorded one-person
business eligibility. Rendering runs on owned infrastructure.

## 1. Grounding and decisions

| Existing source | Observed behavior | Required change |
| --- | --- | --- |
| [Media package](../core/media/README.md), [composition](../core/media/src/index.tsx), [renderer](../core/media/render.mjs) | Pinned Remotion 4.0.538 renders a 24-second illustrated reference lesson using actual guidance content. No authenticated app calls or screen capture. | Retain illustration as explicitly labeled explanation; add a separate composition consuming real recorded application footage and a provenance manifest. |
| [Image application test](../scripts/test-image-app.mjs) | Disposable image guard, real setup/login/project creation, screenshots and workflow receipts. Later helpers include fault fixtures, separately labeled. No video context. | Reuse real setup and workflow boundaries in an explicit capture mode; never record the entire mixed test suite and label it all live. |
| [Fixture UI test](../scripts/test-native-ui.mjs) | Controlled catalog/auth/action responses exercise UI states. | Keep for component/failure checks; never use its screenshots/video as proof of completed real operations. |
| [Card](../core/frontend/src/components/v3/generic/Card/Card.tsx) | Shared compact surface/layout slots; title slot is a div, requiring a semantic heading from its consumer. | Preserve composability while defining complete feature card patterns, states and headings. Remake consumers in place. |
| [Project category overview](../core/frontend/src/pages/organization/ProjectsPage/components/ProjectCategoryOverview.tsx) | Five product cards, statistics, loading/retry/denial, certificate selection, PAM resolution and access requests; full-card overlay button. | Separate primary navigation, help and secondary actions; preserve all branch behavior. Do not put a help button underneath the full-card overlay. |
| [Certificate distribution card](../core/frontend/src/pages/cert-manager/DashboardPage/components/CertificateDistributionCard.tsx) | Semantic region/heading, nonanimated chart, readable counts and keyboard filter rows; unknown entries can be noninteractive. | Preserve readable equivalents/filter semantics while adopting shared help/action patterns. Do not regress existing authored improvements. |
| [Tooltip](../core/frontend/src/components/v3/generic/Tooltip/Tooltip.tsx) | Zero default delay, hoverable content disabled and pointer events disabled. Guided help supplies local overrides. | Fix the shared hover/focus/dismiss pattern and test consumers, with interactive explanations in a separate popover/dialog. |
| [Dialog](../core/frontend/src/components/v3/generic/Dialog/Dialog.tsx), [notification dock](../core/frontend/src/components/notifications/NotificationDock.tsx) | Radix semantics, scrollable body/footer, portal exceptions and notification hosting within active dialogs already exist. | Keep these mechanics; add consistent pending/recovery/review and reduced-motion behavior. Verify notifications remain operable without covering actions. |
| [Environment form](../core/frontend/src/pages/secret-manager/SettingsPage/components/EnvironmentSection/EnvironmentForm.tsx) | Shared create/update form, duplicate-submit guard, slug warning, preserved input after failure and contextual guides. | Extract approved metadata commands while retaining these protections and form validation. |
| [Reference workspace](../core/frontend/src/components/vaultix/ReferenceWorkspace.tsx), [guide renderer](../core/frontend/src/components/vaultix/GuidedHelpView.tsx) | Shared reference controls and focus-based guidance; component-local selection/copy/query handlers. | Register semantic controls against one workflow adapter; distinguish focus/lesson completion from real action success. |
| [Catalog](../core/backend/src/services/vaultix/catalog.ts), [MCP](../core/backend/src/services/vaultix/mcp.ts), [reference service](../core/backend/src/services/vaultix/reference-service.ts) | Catalog and authenticated reference-only source actions exist. Catalog explicitly says remote viewport driving is not connected. | Extend the canonical contract and existing authorization path; do not expose unsupported mutations just because a UI control exists. |
| [MCP Apps bridge](../core/frontend/src/mcp-app/bridge.ts), [embedded view](../core/frontend/src/mcp-app/main.tsx) | Protocol 2026-01-26, bounded requests, parent/origin binding, allowlisted tools, one validated initial scope suggestion, user-triggered reads and disconnect clearing. | Preserve these guarantees. Embedded-view support and controlling an independently opened Vaultix tab require distinct acceptance. |

This is a focused source trace. It is not a completed review of every descendant
handler, card story or domain. Before modifying a packet, read its complete
modules, component stories, mutations, authorization, storage and tests; save
their exact hashes in the local journal. Catalog/router searches are discovery,
not whole-module authorship credit.

“AI register” is provisionally interpreted as **connect a client and discover
authored actions**. An optional clarification was asked; no answer is treated as
approval. Clients cannot register executable JavaScript, selectors, HTML or
arbitrary API calls. A future proposal mechanism could produce an offline change
for review, but cannot install handlers into a running user's session.

## 2. User experience and card redesign

Keep the [Vaultix visual system](../core/DESIGN.md): steel-dark surfaces, mint
project accents, owned vectors, meaningful borders and restrained elevation.
Depth distinguishes a floating dialog from a card; dense resource pages remain
compact. Artwork never replaces real controls or readable data. No decorative
animation dependency enters login or the main application bundle.

The first concrete redesign is the existing organization overview and Secrets
project cards. Its layout, implemented in the existing page, is:

```text
[owned vector icon]  Secrets Management                 [About secrets]
                    Store, organize and deliver secrets.

                    Projects 12    Environments 36    Secrets 840
                    Counts last refreshed ... / counts unavailable

[Open projects]      [Create project, when authorized]
                    [Show me how] / access explanation when denied
```

Numbers above are layout examples, not production counters. The real UI uses
authorized responses. Failed/pending statistics never become a fabricated zero.
Certificate/PAM entry retains setup, selection, membership and access-request
behavior. PAM resolution may bootstrap state and admin entry may join a project:
these paths must be classified as mutations, not harmless navigation for AI.

Use five feature compositions over the existing v3 primitives:

| Pattern | Contents and behavior |
| --- | --- |
| Product/project card | Semantic heading, purpose, authorized metadata, clear primary link/button, separate help and contextual menu; no full-card overlay when additional controls are present. |
| Resource card/row | Scope, reference-safe name, status, updated time where available, accessible menu and explicit selection. Dense lists retain table/list semantics rather than forced giant cards. |
| Metric/chart card | Title, definition/help, real counts, readable data equivalent, explicit filter action and separate empty/error states. Color is supplementary. |
| Setup/connection card | Readiness, prerequisites, current method, next action and recovery. Distinguish configured, enabled, connected and verified. Google and built-in credentials remain separate from optional Nomen federation. |
| Review/task card | Proposed metadata change, scope, consequence, approval requirement, pending/result receipt and recovery. No false completion when a lesson closes. |

Every composition has loading, empty, populated, denied, stale, submitting,
failure and recovery examples where applicable. Preserve compact/expanded modes
and current pagination/search/filter behavior. A failed request retains useful
edits and offers a targeted retry; destructive confirmations name their scope.

Review real desktop, short-height and 320-CSS-pixel layouts plus zoom, forced
colors and keyboard behavior. Use 44-pixel targets for new standalone help and
assist controls as a product goal; evaluate WCAG 2.2 AA target-size/spacing rules
for dense existing controls rather than calling 44 pixels an AA requirement.
Show the owner actual before/after application screenshots after the first card
packet. Carry corrections into the shared pattern before expanding to all cards.

## 3. Reusable help, modal and action pattern

These are **proposed component responsibilities**, not new shipped components:

| Responsibility | Implementation owner | Contract |
| --- | --- | --- |
| Context help | Evolve `GuidedHelpView`/`GuidanceHintView` and v3 Tooltip | A short noninteractive description on focus/hover; a named button opens a deeper explanation. Essential instructions stay inline. Touch users can open the same explanation. |
| Action trigger | Feature-owned React adapter + v3 Button/link/menu | Click, keyboard and approved assist events call the same command. Availability, pending and denial have readable explanations. A DOM click is not the command contract. Implementation uses explicit `data-vaultix-action`, `data-vaultix-action-scope` and `data-vaultix-action-target` attributes on actionable controls. |
| Review dialog/sheet | Existing v3 Dialog/Sheet + feature form | Scope and proposed metadata, consequence, explicit confirm/cancel, correct initial focus and restoration. Preserve validation and pending guards. Authentication/secret-entry fields remain human-only. |
| Action status | Existing notification API/dock + inline status | One outcome from the actual operation; polite progress, concise failure, persistent recovery for important failures. Toast is supplementary and contains no values or credentials. |
| Assist controls | Proposed `components/vaultix/assist/` | Explain, show, assist, pause, take over and try it yourself; visible actor, scope and next step. Controls remain reachable within the active modal focus boundary. |

Tooltip content must remain available while hovered, be dismissible without
moving focus, and have a useful relationship to its trigger. Escape dismisses
the topmost tooltip before an enclosing dialog. A tooltip receives no focus;
links/forms belong in a popover or dialog. Tooltip APG guidance is informative
and currently marked work in progress; WCAG 1.4.13 remains the acceptance basis.
See [WCAG hover/focus guidance](https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html)
and [tooltip pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tooltip/).

Dialogs require a name, appropriate initial focus, bounded keyboard traversal,
an operable close/cancel policy and restored focus to a meaningful trigger.
Do not open instructional modals on every interaction. Explicit help or a real
review requirement opens them. Nested help must preserve the parent form and
overlay stack. Respect reduced motion in shared primitives, not just selected
consumers. See [WAI modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/).

User-facing actions are modeled, not every keystroke or mouse movement. Editing
sensitive fields is registered as a **human-only boundary**, never serialized.
Semantic hover/help/focus actions may be local and ephemeral; they are not a
default behavioral telemetry stream. Registration covers controls, including
ones deliberately unavailable to AI, so exclusions are explicit and reviewed.

## 4. Authored action contract and registration

Extend the existing catalog/source-action authority. Proposed canonical schema:
`contracts/vaultix.ui-actions.v1.schema.json` (JSON Schema 2020-12), referenced
by the existing core contract rather than independently duplicated in clients.
Add generated/checked TypeScript and Go representations with compatibility
fixtures; no new product Zod dependency. A2UI catalog content describes approved
components and actions; it is not executable model-authored UI or a second API.

Separate three records, with exact keys, size limits and version rejection:

| Record | Required fields and constraints |
| --- | --- |
| Definition | Stable action ID/version, workflow/owner, label/help IDs, input/result schema refs, scope kind, effect class (`local`, `read`, `mutation`, `human-only`), permission/source-action reference, confirmation policy, replay policy and supported modes. No executable functions in JSON. |
| Mounted binding | Definition ID/version and digest, unique view ID/revision, current authorized scope, allowed target key, availability, and a local typed handler. Registered by authored code on mount; removed on unmount. Scoped duplicate registrations fail, never silently overwrite. |
| Invocation/result | Invocation ID, action/version, bounded typed metadata input, session and view generation, sequence, scope and expiry; result state, sanitized error, operation receipt and actual outcome. Authority/provenance derives server-side, not from a claimed `actor` field. |

Examples of candidate UI IDs are `vaultix.ui.project.open`,
`vaultix.ui.reference.environment.select`, `vaultix.ui.environment.review` and
`vaultix.ui.help.open`. These are **proposed**, not available MCP tools. Existing
`vaultix.projects.list` and `vaultix.secrets.references` keep their meanings and
source permissions. New mutations require source-service contracts and complete
backend acceptance before they are advertised or enabled for AI.

The runtime is a typed React provider/registry and feature adapters, proposed
under `core/frontend/src/components/vaultix/assist/` with contract consumers in
`core/frontend/src/hooks/api/vaultix/`. It is not a document-wide event listener
that replays arbitrary selectors. Native UI uses the same registry as an embedded
view where supported. Business validation remains in its feature/domain service.

Dispatch order is fixed:

1. Resolve an authored definition and mounted binding; validate exact version,
   input, expected scope and view revision. Reject hidden/unmounted/unavailable
   targets and incompatible catalogs. Treat resource names as data.
2. Check active control session and server-derived identity. Recheck permission
   and prerequisites at execution time; catalog visibility is not authorization.
   Effective authority is the intersection of client and browser session scopes,
   method restrictions and current tenant policy. A browser session cannot lend
   stronger privileges or MFA assurance to a weaker client session. Required
   step-up is a separate human authentication flow; no credentials are forwarded.
3. Render intent and required review in the current viewport. A confirmation is
   bound to the exact action, canonical input digest, scope, expiry and actor;
   changed input invalidates it. A model cannot confirm on the human's behalf.
4. Invoke the same local command used by keyboard/pointer. Source operations use
   existing authorized service methods and audit semantics. Native Go ownership
   follows the existing migration dependency gates; a relay is not a domain port.
5. Resolve from the service receipt and observed refreshed state. Distinguish
   successful, denied, failed, cancelled-before-dispatch and unknown-outcome.
   Never turn a missing response into success or blindly retry a mutation.

Use idempotency/operation reconciliation only where the source action supports
it. Implement and prove durable operation identity atomically with mutations
before exposing them to automated retry. Browser deduplication alone cannot
guarantee exactly-once effects. Repeated transport deliveries must not create a
second business operation. No general automatic mutation replay on reconnect.

## 5. Client connection, visible execution and takeover

There are three distinct registrations: developer-authored action definitions,
mounted UI bindings, and an authenticated AI client's explicitly paired control
session. None grants permissions by itself.

Use the existing Vaultix CLI/MCP authentication, supporting built-in and federated
identity. Codex subscription sign-in stays in the local Codex client. Other client
setups use the same tools. Do not collect provider subscriptions, browser cookies
or credential files in registration inputs. Built-in remote login remains a
dependency of the broad effortless-login claim under [0075](0075-usable-secrets-and-update-delivery.md).

For the normal Vaultix browser tab, implement a small authenticated orchestration
service, proposed under `core/backend-go/internal/services/assist/`, exposed
through existing source/MCP routing. It delivers typed intents and receipts;
it owns no alternate secret operations. The initial transport is bounded polling
from the visible browser (mutating claim/ack via POST), with distributed ephemeral
leases in the configured cache. Dragonfly is default; test Redis compatibility
and ElastiCache TLS/config separately. A later streaming transport must preserve
the same state machine and prove proxy/backpressure behavior before replacement.

Connection flow:

1. Authenticated client discovers supported action versions/modes and requests
   pairing. Browser shows the client name, actor, organization, scope, expiry and
   allowed action classes. Same-actor/same-tenant binding is required initially;
   machine identities cannot silently borrow a human browser session.
2. Human selects the intended tab and enables visible assistance. Pairing uses
   a short-lived single-use challenge bound server-side to both sessions; never
   a bearer credential in a URL, chat transcript or action payload. Rate-limit
   creation/attempts and test guessing, duplicate redemption and CSRF.
3. Browser claims one intent at a time, displays it and dispatches after current
   checks. Default mode is stepwise; bounded continuous read-only help can be an
   explicit preference. Mutations retain their review/approval policy.
4. Pause stops new dispatch locally. Takeover immediately disables the local
   dispatcher and requests server-side generation revocation. Show pending or
   failed revocation honestly until acknowledged; remain locally stopped on
   network loss. Server-side claim/dispatch checks must serialize against that
   revocation. Stale claims/acknowledgements cannot revive control. Operations
   already dispatched before the cutoff reconcile to their actual result, not
   fictional rollback.
5. Logout, permission revocation, tenant/resource change, view unmount or
   disconnect invalidates the relevant binding. Reconnect requires revalidation;
   closed/background tabs pause visible assistance. Session expiry does not
   delete audit outcomes or replace the underlying login-session lifetime.

Initial proposed limits for implementation tests: one active controller per
view, one in-flight invocation, at most eight queued intents, 8 KiB per invocation,
two-second idle polling, 30-second delivery lease and 15-minute idle pairing
expiry. Takeover uses an immediate invalidation request, independent of polling.
Tune from measured owned-infrastructure capacity before production; record any
change to limits instead of claiming these defaults establish scale. Cache loss
fails closed; multiple replicas must share revocation/claim state and avoid
duplicate dispatch. Do not use a process-local map as the public-cloud session store.

For **MCP Apps**, retain capability negotiation, CSP, parent/origin binding and
the existing allowlist. The host can render a registered resource in an iframe;
this does not authorize driving another browser tab. Extend only validated,
supported protocol messages. Unsupported hosts retain text/tool responses and
instructions to open Vaultix. The [MCP Apps overview](https://apps.extensions.modelcontextprotocol.io/api/documents/Overview.html)
describes capability negotiation and progressive enhancement; it does not prove
that any particular Codex client renders this resource. Record the actual tested
client/version and user-visible acceptance separately from sandbox fixtures.

Keep provenance explicit in the UI and audit: initiating assistant/client,
authorizing human, effective actor/method, scope, action and source receipt.
“Act for me” is delegated assistance, not falsifying a human click. Do not log
secret values, form contents, tokens, full DOM snapshots or model reasoning.

## 6. Record the actual application

Create a dedicated recorder, proposed `scripts/record-vaultix-workflow.mjs`,
using the real image harness's lifecycle without changing its existing assertions.
Do not simply enable video on all of `test-image-app.mjs`: it includes login,
secret-entry tests and deliberate response fixtures unsuitable for public footage.

The capture pipeline is:

1. Build `core/Dockerfile.standalone-vaultix` from committed source with
   `node scripts/build-self-hosted.mjs`. Record revision, immutable image digest,
   platform version, browser/version, dependency locks and exact workflow revision.
2. Start a disposable loopback-only instance with isolated volumes and owned
   demo tenant. Refuse the operator's initialized instance or public production
   URL. Use explicit run labels/ownership checks before cleanup. Seed fictional,
   publishable resource names through authorized APIs; record seeding separately.
3. Bootstrap/sign in outside video, trace, HAR and screenshot capture. Keep auth
   state in memory where possible and out of manifests. Start a dedicated video
   context only after authentication, with a reviewed safe initial route. Prove
   that session continuity works without persisting reusable credentials.
4. Use matching viewport and recording size (initially 1600 x 900, device scale
   one). Capture the real application at ordinary speed. Select by accessible
   role/name and assert the expected server result plus UI state. No API response
   fulfillment, fake count injection, hidden CSS replacement or post-edited success
   state in a clip advertised as an actual workflow. Block unexpected external
   traffic. External-provider demonstrations require a separate accepted run.
5. Record allowlisted semantic milestones and observed outcomes with monotonic
   times. Correlate capture start to video timestamps using a measured initial
   synchronization interval; verify alignment after decoding. Do not assume
   `performance.now()` equals the video timeline or fixed 30-fps capture.
6. Capture no production values, tokens, recovery codes, passwords, private names,
   clipboard contents or console/network bodies. Human-only input/value/reveal
   screens are excluded from public recording segments. Masking an input or
   blurring footage afterwards does not sanitize a trace or undo collection.
7. Await explicit browser-context closure to flush video, then probe duration,
   resolution and decode. Failed assertions/capture leave a private failed run;
   they cannot update the latest approved-media pointer. Always clean disposable
   resources without touching operator volumes.
8. Review raw footage, milestone timing and the allowlisted manifest. Scan
   textual artifacts for canaries and inspect decoded frames/contact sheets;
   scanners alone cannot certify absence of sensitive visual content. Promote
   only a reviewed output allowlist to the public asset set.

Playwright is **1.60.0 in the existing lockfile** (manifest range is `^1.55.1`).
Use its installed APIs, not an unverified latest example. Recording is off by
default, dimensions must be explicit, and video finishes when the context closes.
See [Playwright video documentation](https://playwright.dev/docs/videos).
Trace Viewer can expose DOM snapshots, actions and network details; public video
artifacts must not include trace archives, HARs or authentication state. Keep
diagnostic capture disabled by default and separately restricted if deliberately
enabled for synthetic testing. See [Trace Viewer](https://playwright.dev/docs/trace-viewer).

First recordings: real project navigation/creation, reference-only environment
and folder selection, contextual help and a real environment metadata change.
After the assist packets pass, record a second sequence showing the actual
connected AI client, visible execution, takeover and independent repetition.
Label multi-window/composited views explicitly. A browser video alone cannot
prove that an external AI client initiated the action.

## 7. Remotion production and public playback

Extend `core/media` with a separate recorded-workflow composition. Keep package
versions aligned with existing **4.0.538**. The installed package exports
`OffthreadVideo`; use it for the first frame-extracted composition without adding
an application dependency. Current Remotion guidance recommends `Video` from
`@remotion/media` for new work; evaluate a matching pinned package with a real
recorded WebM decode/render comparison before switching. This version decision
must not silently import a newer API into the pinned toolchain. See
[component selection](https://www.remotion.dev/docs/video-tags) and
[OffthreadVideo](https://www.remotion.dev/docs/offthreadvideo).

Remotion provides branded intro/outro, restrained zoom, callouts, step markers
and captions around actual footage. Frame selections and crop rectangles are
bound to the recorded viewport; labels come from the authored guide/action IDs
and successful observed milestones. Keep raw recordings untouched. An edit map
records every trim, speed change and inserted illustration. Disclose compressed
waiting; do not remove an error and imply an uninterrupted successful transaction.

Proposed manifest owner: `core/media/workflow-recording.schema.json`, separate
from the product action schema. Include schema version, source and image identity,
workflow/action versions, capture environment, input-media SHA-256, duration and
dimensions, milestone timing, source receipts, edit map, output digests and review
status. Relative allowlisted local assets only: reject traversal, remote URLs,
invalid timing/ranges, unknown action IDs and mismatched source/version/digests.
Existing renderer success is not permission to publish arbitrary input files.

Produce an H.264 MP4, poster, WebVTT captions, transcript, review frames and receipt
locally. Keep original capture/evidence private. Captions and transcript describe
essential visible state; if narration is introduced, include accurate captions
and an equivalent description of meaningful visual information. Review timing,
legibility, audio levels if present, complete playback and seeking in real browsers.

Start with the existing 5 MiB clip / 512 KiB poster budgets for a short lesson.
Measure real footage before choosing a longer hero; split into chapters or provide
an explicit alternate rendition rather than silently raising budgets. Avoid
applying small-text-destroying compression just to pass a byte test. Public playback
uses native controls, `preload="none"`, a fixed-aspect poster, captions, a visible
transcript and no autoplay. No Remotion runtime is needed in the app for playback.
Cache content-addressed public media; never give authenticated pages/data that
same cache policy. Existing login payload gates remain unchanged.

The public Vaultix.cloud landing page uses this reviewed output. Preserve the
self-hosted setup/login entry and authenticated project routing. An explicit
cloud front-door mode can serve public `/`, with `/login` and `/signup` behavior
tested separately; do not infer cloud mode from an untrusted Host header.
Early-access submission requires actual persistence, abuse limits, useful failure
states and honest pending/invited status. A decorative form is not completion.
Google login/provider readiness and optional Nomen linking remain real auth work,
not something a video can demonstrate before that provider is configured/tested.

## 8. Ordered packets and source ownership

All packets below are **planned**. A new path is marked proposed. No placeholder
script or string-presence test closes a packet. Record an immutable journal plan
with exact commands and source hashes before implementing each one.

| Packet | Dependencies | Work and files | Done only when |
| --- | --- | --- | --- |
| UI-01 baseline and contract | This plan | Read complete first-workflow consumers/stories; extend core action contract with proposed UI schema and coverage ledger at `docs/interaction/workflows.json`; baseline screenshots/payloads. | Typed schema rejection/compatibility tests and human-reviewed action-to-handler/source mapping; hidden mutations and human-only boundaries classified. |
| UI-02 primitives and first cards | UI-01 | Existing Tooltip/Dialog/Sheet/notification primitives; ProjectCategoryOverview and project list cards. Add feature compositions, not a replacement viewport. | Real image card navigation, setup/access branches and tooltips/dialogs pass keyboard, reflow and failure tests; owner sees concrete before/after. |
| REC-01 real capture | UI-01; capture accepted UI-02 candidate | Proposed recorder and recording manifest; reuse disposable setup. | Playable raw app recording with real operation receipts, no fixtures or sensitive capture; fail-safe cleanup and invalid-target refusal tested. |
| MED-02 recorded composition | REC-01 | Extend existing `core/media` composition/renderer; captions, edit map and manifest validator. | Raw-to-edited provenance, genuine decode/render and browser playback; rejected bad inputs; reviewed output within budgets. |
| UI-03 shared reference actions | UI-01/UI-02 | ReferenceWorkspace, guidance and feature adapters; local registry. | Human click/keyboard/explain/show use the same typed handlers; stale targets and invalid scopes fail; secret-value canary absent. |
| AI-01 paired control session | UI-03; source auth contract from 0074/0075 | Proposed Go assist session service, existing source/MCP adapters, browser dispatcher and takeover controls. | Real authenticated browser + client requests across replicas; pairing/revocation/replay/tenant tests, visible intent and measured takeover. No production enablement from fixtures alone. |
| AI-02 actual host acceptance | AI-01; 0075 host/login gates | Existing MCP Apps view/bridge, compatible client adapter and actual selected client. | Named client/version renders or explicitly falls back; connects, drives authorized reference workflow, disconnects and lets user take over. Record real multi-surface evidence. |
| UI-04 first mutation | AI-01; source mutation contract | Existing environment form/dialog/mutation/service; durable operation receipt as needed. | Human review bound to exact change, permission loss/duplicate dispatch/lost response reconciled, preserved retry/slug behavior and persisted result independently checked. |
| MED-03 assist teaching | AI-02/UI-04 | Real recording plus recorded-workflow composition. | Actual assistant action and human takeover demonstrated; user can repeat without assistance. No simulated AI activity labeled live. |
| WEB-01 landing/enrollment | MED-02; auth/enrollment readiness | Native public route, player, actual early-access persistence and explicit cloud mode. | Public and self-hosted entry checks, real submit/failure/duplicate behavior, auth navigation, privacy and accessible media. Do not block independent CLI fixes on landing art. |
| UI-05 domain expansion | Accepted first patterns | Secrets dashboard, imports/versions/approvals/rotation; identity/access/MFA; integrations; PKI; KMS; scanning; PAM; audit/admin and DevSCIF workflows. | Each complete workflow has source review, interaction coverage and real behavior/denial/recovery evidence. No blanket parity claim. |
| REL-01 delivery | Accepted relevant packets + 0075 update/recovery gates | Existing self-hosted build and planned signed release/update path. | Source pushed, immutable image built, migration/backup/rollback verified and confirmed target deployed; server digest/version and smoke checks recorded. |

Earliest useful visible milestone is **UI-02 + REC-01 + MED-02**: remade real
cards and a reproducible recording, without waiting for the full remote driver.
In parallel only where dependencies permit, preserve 0075's CLI device login,
target injection and update work. Do not count this scheduling independence as
permission to begin Mesh or create another identity/store implementation.

## 9. Verification that can disprove the plan

| Acceptance ID | Required evidence and independent failure checks | Closes |
| --- | --- | --- |
| V01 source/coverage | Compare original route/API baseline with reviewed ledger and actual handlers. Remove a binding in a temporary test fixture: coverage must detect the missing required control. Inventory alone is insufficient. | UI-01, each UI-05 family |
| V02 cards/help | Real keyboard/pointer/touch-intended controls; complete five-product navigation and access branches; hover-to-tooltip/Escape/focus restoration, nested dialog/toast overlap, 320px/zoom/forced colors/reduced motion. No suppressed axe rules. | UI-02 |
| V03 human/AI equivalence | Human and authorized assistant invoke same command; independently verify service state/receipt. Deny wrong tenant, hidden target, revoked permissions, forged actor, unknown version and malicious resource text. | UI-03/AI-01/UI-04 |
| V04 control lifecycle | Two tabs/clients and two replicas; duplicate claims, stale view/scope, expiry, lost replies, reload, cache outage, backgrounding, disconnect and takeover race. Queued work never executes after invalidation; in-flight outcome remains honest. | AI-01 |
| V05 write reconciliation | Duplicate/reordered invocation with one durable operation; altered confirmation rejected; validation/error preserves edits; independent DB/API metadata read proves one intended change. Refuse unsafe automatic retry after unknown outcome. | UI-04 |
| V06 safe real recording | Real canonical image + no response mocks; recorder rejects initialized operator/remote target, failing assertion prevents promotion, context-close produces complete video, cleanup only touches owned resources. Synthetic canaries test artifact exclusion; human reviews frames. | REC-01 |
| V07 media truth/quality | Digest/version mismatch, unsafe path, remote URL, malformed schema and invalid timing rejected; raw/cut timing compared; first/middle/last frames and full decode/play/seek/captions/transcript reviewed. No render-library stubs. | MED-02/MED-03 |
| V08 actual client | Document host name/version, auth mode, capability negotiation, renderer and observed UI action receipt; live takeover and unassisted repetition. Sandbox parent fixtures remain a separate column. | AI-02/MED-03 |
| V09 accessibility | NVDA with Edge/Firefox and VoiceOver with Safari on complete changed workflows. Record versions, focus/announcements, errors and defects. Automated checks cannot substitute for this manual gate. | Changed UI release |
| V10 loading/scale | Keep login decoded limits 3.1 MB JS / 3.65 MB total; no media/renderer startup downloads. Baseline each changed route and compare interaction latency/requests/memory. Measure pairing/poll queues, cache failure and replica behavior under declared load. | Changed UI/assist release |
| V11 landing/delivery | Public route vs self-hosted setup/login, truthful early-access result, actual provider readiness; artifact signature/digest, backup/restore/rollback and server smoke. Public URL is not a deployment credential. | WEB-01/REL-01 |

Use existing `scripts/test-image-app.mjs`, `scripts/test-environment-workflow.mjs`,
`scripts/test-dashboard-create-workflow.mjs`, `scripts/test-native-ui.mjs`,
`scripts/test-notification-ui.mjs`, `scripts/test-mcp-app-image.mjs`,
`scripts/test-vaultix-media.mjs`, `scripts/check-ui-loading.mjs` and
`scripts/build-ui-report.mjs` where applicable. Invoke workflow helpers through
their actual harness, not as invented standalone commands. New recording/assist
suites are required for V03-V08; existing tests do not already prove them.

The proposed coverage ledger records route, control/action ID, owner, input and
scope schemas, source handler/permission, sensitive/human-only reason, tested
states, source/image hashes and fixture/real/manual receipt references. Statuses:
unreviewed, planned, implemented, fixture-verified, image-verified, live-reviewed.
Missing evidence stays missing. A generated count never marks a row reviewed.
Require all applicable states for a workflow before advancing its status.

## 10. Anti-drift, rollout and remaining gates

Every packet begins from a journal plan with requirements mapped to V01-V11,
actual files and planned assertions. Save deviations before accepting a new
scope. Preserve prior failed receipts and baseline surfaces; do not recapture a
reduced baseline or test only the new helper in isolation. Verify negative paths
across the real boundary, with expected outcomes independent of implementation.

Keep visible-assist enablement an operational feature switch, separate from free
software availability and authorization. Roll out read-only references first;
then individually accepted metadata mutations. Disabling assist removes sessions
and dispatch, leaving normal UI/source actions functioning. Additive persistence
must remain compatible with the rollback binary; never roll back encrypted data
by deleting new records. Pin released footage to the compatible UI version and
regenerate when action IDs/layout change; unavailable footage falls back to text.

The current plan has no claim of live AI driving, actual-client rendering,
manual accessibility completion, a public early-access backend or deployed media.
The previous illustrated clip and image receipts retain their original scope.
Built-in CLI remote approval, signed update delivery, provider configuration and
confirmed remote host access stay in the delivery plan. Finish these with actual
evidence before presenting the combined experience as ready for public use.

Research used primary Playwright, Remotion, W3C and MCP sources linked above,
retrieved 2026-11-01 local / 2026-11-02 UTC. Current documentation is interpreted
against pinned project versions. Source fingerprints, research records, optional
question, planning checks and handoff are saved privately through the project
journal; these records do not contain hidden reasoning or credentials.
