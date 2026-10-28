# Native create-secret workflow authorship

Status: scoped packaged workflow and both cache image gates accepted locally,
2026-10-28. Workstream: native UI/secrets.

## Accepted preceding checkpoint

The membership repair was committed and pushed as
`a1cf6c25b28f6e0fc9661b3f2dda0e0cc24f0600`. Local development now runs accepted
canonical image
`sha256:29d86c909dd895021f9de0c8e121ac0e883743150402857e629ffe93feb283dd`.
The backend is healthy, UI/API return 200, and database/cache container identities
were preserved (`.cache/membership-dev-rollout.json`). Source push evidence is
`.cache/membership-live-push.log`. This does not resolve GHCR authentication,
Actions billing, Nomen registration or WI/TX deployment.

## Read and trace

The main project overview and environment dashboard have separate create-secret
forms. Both complete form files and the shared `helpers/parseEnvVar.ts` parser
have been read. The overview's Sheet caller, mutation hook, field primitives and
secret editor forwarding were traced; partial reads of those large callers do
not count as complete authorship. The main viewport remains the existing native
application, with in-place changes to these workflows.

The overview form must preserve environment/path selection, direct creation,
approval responses, pending batch changes, create-more behavior, comments,
multiline encoding, tags, encrypted metadata, password generation, secret
references and bulk-paste handoff. The dashboard form also remains supported.
Both use the existing `useCreateSecretV3` mutation and encrypted store. Human
inputs stay in the existing application data path; no values enter AI guidance,
catalog events or test evidence.

Source findings awaiting browser proof include unassociated field labels,
unnamed repeated metadata controls, nonfocusable tooltip icons, lost validation
focus, and ambiguous handling of an explicit empty pasted assignment. The
overview also closes/resets after partial multi-environment success and filters
out metadata with empty values despite accepting that shape in validation.
Each needs a deliberate behavior decision and regression evidence, not a bulk
rename or a superficial component replacement.

## Acceptance plan

1. Capture the unchanged actual Overview sheet in a disposable canonical image.
   Check labels, validation focus, explicit-empty paste, advanced controls and
   axe findings. Use public dummy input only, clear it before screenshots and
   never submit a secret to the operator instance.
2. Author input semantics, keyboard help, validation and pending/error/retry
   states in place. Use v3 equivalents, existing tokens and compact layouts.
   Preserve current parsing compatibility outside the explicitly tested fix.
   Do not add Zod to authored product TypeScript or create another mutation API.
3. Exercise both parser callers and overview/dashboard workflows, including
   permissions, failure retention, approval and batch outcomes, multi-environment
   partial results, advanced fields and narrow layouts. Distinguish fixture
   failure/permission cases from actual API operations.
4. Verify real secret lifecycle operations against an isolated standalone image,
   keyboard focus and contextual help, reduced motion and selected WCAG 2.2 AA
   checks. Keep all route/API baseline entries. Manual screen-reader and full
   enterprise/provider acceptance remain separately recorded gates.
5. Run applicable type/lint/tests, build the canonical image, record exact source
   and artifact evidence, then commit/push and promote the accepted image locally.

The initial browser probe is temporary `.cache` tooling. It records findings;
false checks are not accepted as a passing UI gate. A release regression runner
must be committed with the final authored workflow.

## Reproduced baseline and first repair

The unchanged membership image was exercised in a disposable database/cache.
`.cache/app-image-proof-bc4CYf/create-secret-baseline.json` records all eight
label/focus/empty-assignment checks failing. Axe found one invalid ARIA attribute,
seven unnamed buttons/switches and two unnamed select inputs. The initial probe
expected the specific key error but the untouched form returned generic
`Required`; the revised characterization recorded that difference rather than
claiming the baseline passed. Neither run submitted a secret.

The first implementation replaces the overview's form schema with typed React
Hook Form field rules, preserves key/tag trimming at submission, reconnects the
key ref for validation focus, and associates visible labels and error text.
Repeated metadata controls have unique labels and a two-column layout. Tooltip
help uses named keyboard buttons. The shared paste parser distinguishes a plain
key from an explicit empty assignment; both callers consume that distinction.
Eleven parser compatibility cases pass locally. The dashboard's broader control
migration remains open; its paste caller is included in compatibility checks.

The reference textarea now uses the documented Radix Popover Anchor positioning
API instead of receiving button-trigger attributes. The controlled popup handles
dismissal and is named; its width is constrained to the viewport. This follows
the [Radix Popover reference](https://www.radix-ui.com/primitives/docs/components/popover#anchor).
Keyboard suggestion behavior must pass the packaged regression before acceptance.
The generator trigger is named; this is not a full generator accessibility review.

Type checking and scoped ESLint pass. The canonical image is being built.
An attempted smoke run before that image existed failed to resolve the local
candidate; it is not product failure or smoke evidence. The committed regression
module is wired into the disposable real-application runner, and the parser check
is wired into GHCR checks. Passing results are still pending.

## Packaged interaction evidence and recovery work

Canonical candidate `sha256:d8dd85707c1ecbe36b03f025603c951c93b589ccea56e4ee4a0f0cb6a5957b94`
passes the complete existing Dragonfly image/application/restart workflow with the
new desktop interaction checks (`.cache/app-image-proof-MUacbv`). The advanced
sheet scan has zero selected-rule violations. Incomplete results remain for the
closed generator's portal relationship and layered input/placeholder contrast;
they are not suppressed or claimed as resolved. The screenshot was reviewed.

Two earlier runner failures remain recorded: `NMtTqL` did not wait for generator
focus/animation before Escape, and `MYdmN4` checked a second validation while the key was
already focused. The corrected checks wait for focus inside the generator and
start shortcut submission from the submit button, making focus transfer observable.
No product timeout was increased or accessibility rule disabled.

Recovery candidate `sha256:03f2a9650d39347b201c57429427d51b9802b9357830afcf1c33e15106c3e1a1`
adds preservation of empty metadata and failed-environment inputs. The run at
`.cache/app-image-proof-bhn3b9` passed desktop and 320-pixel selected scans but
failed before creating anything because Escape closed the parent sheet after
environment selection. An isolated probe (`.cache/app-image-proof-9sKVIN`)
confirmed `aria-expanded=true` on the select immediately before Escape and the
sheet moving to `data-state=closed`. This is a reproduced workflow defect.

The sheet caller now keeps Escape within an expanded combobox. Its mobile width
uses the full viewport: the earlier 320-pixel screenshot fit without horizontal
scroll but left metadata inputs cramped. The new regression requires usable
metadata input width as well as no horizontal overflow. Only the relevant caller
block in the large Overview module was reviewed; this edit does not grant a
complete-file authorship credit. The shared select exposes an optional typed
focus ref for missing-environment validation.

The recovery implementation retains all inputs and selects only failed
environments after mixed results. Completed creates and approval responses are
not automatically retried. An injected production outage with real development/
staging creates, followed by a real production retry, is the pending acceptance
case. Empty encrypted metadata is checked in the request and its entry is checked
through the existing API with `viewSecretValue=false`; no value read is required.
Actual policy approval, batch, denied-role, provider and full lifecycle acceptance
remain separate gates; this packet is not whole-form or enterprise parity.

Canonical candidate `sha256:80b755e014eb45d78a03870be41218cdb6655882c047a1ac0cb18c27a7345bf1`
passes all eight recorded interaction groups, including missing-environment focus
and usable mobile input width (`.cache/app-image-proof-6NWQeM`). The mixed create
case reached two real successful writes and the injected production failure,
then stopped on an incorrect test assumption: the existing create-response schema
does not return metadata. The test now verifies the retained encrypted metadata
entry via an authenticated metadata-only read after retry. It does not change the
API response to accommodate a fixture. That corrected complete run is pending.

The changed source passes TypeScript and scoped lint. The large caller initially
reported CRLF formatting errors; normalizing that file's line endings resolved
them without additional Git content changes. CI YAML parses locally and retains
all new reports. These checks are local evidence; the latest GitHub run
`40634859269` again has zero executed steps and an account billing/spending
annotation (`.cache/membership-github-blocker.json`).

The corrected read harness initially used Playwright's `response.status()` spelling
on a native fetch response; `ujeGJ8` records that runner failure after the correct
four attempts (development/staging succeeded once, production failed then
succeeded). It now uses the native `status` property. `z4dbSP` then passed the
metadata-only checks but encountered the first-secret invitation nudge before
checking the rendered resource. No invitation was sent.

Review of the existing activation hook found a 1500ms timer scheduled even after
partial success. The controlled unchanged-image probe at
`.cache/app-image-proof-IzdsTh` waits 1800ms while production still needs retry
and reproduces the invitation dialog covering the form. The form now remembers
real creations across retries and create-more operations, and requests the nudge
only after a completed creation closes the sheet. The nudge remains available;
the accepted-flow test dismisses it through its existing “Maybe later” action.
This does not rewrite the activation hook or invitation permissions.

The repaired nudge image
`sha256:1bdd77c12dc80fad2141eaba7081e5dfac2cd6f0f2c8d48ca4b02b1ce6d15898`
passes the paused recovery, three actual creates, metadata-only persistence
checks, and invitation dismissal (`.cache/app-image-proof-Iq57V4`). That run then
exposed a final locator mistake: secret names are editable textboxes in table
rows, not text nodes. The resource assertion now checks the named row and its
textbox value. No production behavior was changed for that correction. The
complete runner, including the separate dashboard paste check, is being rerun.

`9jyCQA/create-secret-recovery.json` records the complete passing recovery result:
three persisted creates, only production retried, metadata-only reads with values
hidden, retained inputs, deferred nudge and rendered editable table row. Its next
dashboard check initially expected the native sheet's accessible title; the older
dashboard modal includes its subtitle in the dialog name. The compatibility
locator now uses that actual name. This records the legacy semantics rather than
claiming that form's accessibility migration is complete.

The next legacy check (`xi5Ks1`) found its v2 modal's outer role container has no
layout box: the inner card is fixed-positioned. The compatibility test now checks
the open state and the actual visible key input. It still requires working paste,
visible controls and cancellation with zero create requests. The enclosing modal
semantics remain an explicit part of the subsequent v3 migration.

## Accepted local application evidence

The complete corrected runner passes on canonical image
`sha256:1bdd77c12dc80fad2141eaba7081e5dfac2cd6f0f2c8d48ca4b02b1ce6d15898`.
`.cache/app-image-proof-Wkcm5I/workflow-result.json` includes the existing real
sign-in, completed project, navigation, recovery/chart/environment gates plus:

- Eight create-secret interaction groups, including key and environment error
  focus, empty assignment, reference browsing, generator dismissal and repeated
  metadata controls.
- Desktop and 320-pixel reduced-motion selected axe scans with zero violations;
  manual-review items remain in `create-secret-accessibility.json`.
- Three actual empty-value creates and encrypted metadata entries, one injected
  production outage, and retry of production alone. Metadata-only reads return
  `secretValueHidden=true` for all three environments.
- No activation nudge during the failure pause; its normal post-completion
  invitation is dismissed without sending anything.
- The separate dashboard form preserves a key-only paste, clears both explicit
  empty assignment delimiters, and cancels with zero create requests.

The same image passes the Dragonfly queue/restart/API/MCP smoke gate
(`.cache/create-secret-accepted-smoke-controls.log`). The same image also passes
Redis queue/restart/API/MCP checks (`.cache/create-secret-accepted-redis.log`).
The operator's data services have not been recreated by these disposable tests.
The local UI at port 3000 is the existing Vite development server; the integrated
standalone image is served through port 8200 after promotion.

Final review accounting is 11,829 inventoried files: 108 scoped verified, 37
authored, 13 reviewed and 11,671 unread. The four new regression scripts map to
delivery tooling under the existing first-match rules; all 1,062 migration groups
remain unassessed. This accounting is not whole-tree completion. The large
Overview caller remains without whole-file review credit.
