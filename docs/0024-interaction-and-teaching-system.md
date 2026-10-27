# Native interactions and guided teaching

Accepted direction, 2026-10-26: rewrite existing Vaultix workflows in place for
scale, clarity and interactive teaching. Convert the full UI methodically,
including contextual explanations, accessible dialogs, visible events and guided
motion. This extends [0021](0021-product-authorship-review.md) and
[0022](0022-accessibility-acceptance.md); adding a help button does not complete
the surrounding workflow's conversion.

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

## Boundaries and remaining work

This checkpoint provides catalog-backed native UI events and lessons, not a
general A2UI message-stream renderer, remote Clyffy viewport driver or completed
authenticated-UI conversion. The older optional panel runtime is not imported or
used as a second application. Its historical v0.9.1 envelope implementation must
be reconciled with the native contract before claiming transport interoperability.

Guided motion currently means interactive, user-paced lessons. Remotion-rendered
lesson videos have not been added; they need an explicit media/interaction
specification and must reuse authored content and respect reduced motion. They
must not substitute simulated operations for real workflow evidence.

Verification: `node --experimental-strip-types scripts/test-guided-interactions.mjs`
checks event rejection, stale actions, boundaries, pause/resume, completion and
bounded history. The backend MCP/HTTP tests check identical documents and input
rejection. `scripts/test-native-ui.mjs` exercises dialog navigation, unavailable
targets, focus restoration, contextual help, narrow layouts, reduced motion,
and rejection of unsupported components and out-of-scope focus targets.
