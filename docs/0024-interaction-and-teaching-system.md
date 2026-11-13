# Native interactions and guided teaching

Accepted direction, 2026-10-26: rewrite existing Vaultix workflows in place for
scale, clarity and interactive teaching. Convert the full UI methodically,
including contextual explanations, accessible dialogs, visible events and guided
motion. This extends [0021](0021-product-authorship-review.md) and
[0022](0022-accessibility-acceptance.md); adding a help button does not complete
the surrounding workflow's conversion.

The concrete [recorded-workflow and visible-assist execution plan](0076-recorded-workflows-and-visible-assist.md)
maps existing cards, help primitives, source actions and image tests to ordered
implementation packets. It separates real app footage from illustrations and
defines client pairing, shared command dispatch, takeover and acceptance gates.
Those planned additions do not change the implemented scope recorded below.

The [domain scripted UI standard](0114-domain-scripted-ui-standard.md) adds a
machine-checked partial ledger, public/auth/tenant boundaries, per-domain MCP
discovery design and a comparative token/resource benchmark plan. Existing local
commands remain local; the new contract does not enable remote execution.

## Owned interaction architecture

The core authors lesson content in `services/vaultix/guidance.ts`. The native
`GET /api/v1/vaultix/guidance` and MCP `vaultix.guidance.get` return the same
document. Lessons use the pinned A2UI `configure-step` vocabulary and explicitly
identify their catalog source. The public read has no inputs, user state or
credentials. It does not execute business actions.

`frontend/src/components/vaultix/GuidedHelp.tsx` is a reusable native renderer,
used within the reference and connection workflows. A single React Query key
shares the authored document across help controls. The reader validates version,
source, guide IDs, bounded text, unique steps, component names and exact local
control targets. Unknown components or arbitrary targets refuse to render.
No model-generated HTML, selectors, URLs or executable commands are accepted.

`guidance-state.ts` is a pure event reducer. Explicit events cover open, next,
previous, pause/dismiss, focus, restart and review completion. It rejects stale
steps, unknown events and extra payload fields. Only the eight most recent
identifier-only events remain in local component memory. These teach the user
what happened; they are not a durable security audit or business-operation log.
There are no per-step network writes or hidden analytics submissions.

## Interaction behavior

- Guide Me opens the workflow lesson. Contextual help shows a short tooltip and
  opens the relevant lesson step on click, keyboard activation or touch.
- Next/Back advance at the user's pace. Closing pauses; reopening the same
  mounted guide resumes. Restart clears lesson progress. Finishing means the
  lesson was reviewed, never that a secret operation or sign-in succeeded.
- Show This Control closes the dialog and focuses/scrolls to an allowlisted,
  available control. Disabled or absent controls produce useful guidance instead
  of invoking actions or navigating into an unauthorized context.
- Dialogs restore trigger focus on ordinary dismissal, provide names and
  descriptions, retain scrolling on narrow screens, and expose progress and
  narration through accessible status text. Tooltips remain hoverable and have
  a click-accessible explanation.
- Motion reinforces a user-triggered step change. No autoplay, timers, ambient
  animation or invented execution progress. Reduced motion disables dialog and
  tooltip animation, including overrides from open-state styles.

## Conversion at scale

Apply the same method to existing authenticated workflows: project/environment
setup, secret editing/import, approvals, rotation, identities/access policies,
audit, PKI, PAM and KMS. For each flow, read its existing modules and callers,
separate authored teaching from execution, consolidate repeated controls, and
test success, permission denial, invalid input, recovery and accessibility.
Small contextual dialogs supplement a clear page; essential instructions remain
visible. Large forms use the shared Sheet pattern. Do not make users dismiss a
modal to perform every routine action.

Business actions must keep their existing authorization and encrypted store,
then move into the shared native source-action contract with explicit observable
pending/success/failure events. User input and provider content remain untrusted
data. Values cannot enter teaching, narration, event history, models or telemetry.

## Visible assist is a product requirement

Owner clarification, 2026-11-01: every user-facing workflow must expose authored,
scripted semantic events so an AI assistant can operate the same visible controls
and teach the user to perform the task independently. This applies throughout
Vaultix and DevSCIF. Tooltips, a chat panel, video playback and focus-only lessons
are useful components, but do not satisfy visible assisted execution.

Extend the existing catalog and source actions in place. Each interaction has a
stable event ID, versioned validated input, owning workflow/control, prerequisites,
permitted actor/scope, observable outcome and recovery behavior. A click, keyboard
activation and authorized assistant request invoke the same application handler;
models do not receive a separate business API or permission path. Internal React
renders, pointer coordinates and every keystroke are not semantic action events.
Sensitive fields remain user-controlled; secret values, passwords, tokens and MFA
answers never enter event payloads, narration, model context or recorded history.

The assist components must provide:

- **Explain:** contextual tooltip or accessible dialog using authored catalog text.
- **Show:** identify the exact mounted control and explain the next step visibly.
- **Assist:** invoke a validated shared action in a user-enabled assist session,
  showing its scope, initiator and pending/result state in the existing workflow.
- **Take over:** pause queued actions immediately and return control to the user.
  Pausing does not pretend to undo a request already accepted by the service.
- **Try it yourself:** let the user repeat the learned workflow with the same
  controls, without requiring an AI client to remain connected.

Delegation acts with the user's permitted authority while preserving assistant
provenance. It must never forge a human audit event. Session, tenant, selected
resource and view revision bind each request. Reject unknown events, stale views,
replayed IDs, unavailable controls and changed permissions. After takeover, scope
change, sign-out or transport loss, invalidate queued work; do not silently resume
mutations on reconnect. Existing confirmation, step-up and approval policies apply.
Only confirmed service results establish business success. UI teaching progress
and proposed steps are separate from executed actions.

The browser renderer remains an allowlisted native React adapter. Do not expose a
global arbitrary-click/eval bridge, accept model-authored selectors or replace the
application viewport. The authenticated MCP/source-action transport must bind an
explicit visible client session before driving it. A remote action that completed
without a connected viewport cannot claim the user witnessed its execution.

### Coverage and acceptance

Track each route's reachable interactions in the existing UI workflow execution
ledger: event and schema version, handler, source action (if any), permission and
confirmation requirements, component, pending/result/recovery states, and evidence.
Navigation, selection, dialogs, help, submissions, notifications and recovery all
need coverage. Mark unsupported interactions explicitly; never treat a generated
inventory or a few converted screens as whole-UI acceptance.

For every converted workflow prove human/AI handler equivalence, visible execution,
keyboard/reflow/reduced-motion behavior, pause/takeover, stale/replay rejection,
scope changes, denied authorization, failed requests and reconnect recovery.
Check canaries never enter assist payloads or history. A real AI client must drive
the packaged application while a human observes and takes over; fixture dispatch
alone does not satisfy this gate. Secrets-changing actions require real service
and encrypted-store evidence in addition to UI traces.

## Boundaries and remaining work

This checkpoint provides catalog-backed native UI events and lessons, not a
general A2UI message-stream renderer, remote Clyffy viewport driver or completed
authenticated-UI conversion. The older optional panel runtime is not imported or
used as a second application. Its historical v0.9.1 envelope implementation must
be reconciled with the native contract before claiming transport interoperability.

Guided motion currently means interactive, user-paced lessons. The local Remotion
authoring package in `platform/engine/media/` renders the existing reference lesson into a
workflow illustration, poster and transcript. It is separate from the live assist
driver. Public landing integration must use explicit playback, a static initial
poster, accessible controls and the transcript; no autoplay or renderer dependency
in the application bundle. The owner confirms AngryVibes/wiredFRONT is a one-person
business eligible for Remotion commercial use. Proceed on that basis.

Public landing/enrollment, live assisted execution and whole-UI conversion remain
open. Media rendering does not close their acceptance gates.

Verification: `node --experimental-strip-types scripts/test-guided-interactions.mjs`
checks event rejection, stale actions, boundaries, pause/resume, completion and
bounded history. The backend MCP/HTTP tests check identical documents and input
rejection. `scripts/test-native-ui.mjs` exercises dialog navigation, unavailable
targets, focus restoration, contextual help, narrow layouts, reduced motion,
and rejection of unsupported components and out-of-scope focus targets.
