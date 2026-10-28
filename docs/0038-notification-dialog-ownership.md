# Notification and dialog ownership

Status: locally verified; publication and hosted acceptance remain separate. This packet follows the real-image environment workflow's
finding that a global toast can obscure modal footer controls. It does not
establish whole-UI accessibility or capability parity.

## Read and preserve

The shared notification renderer, v3 Toast/Dialog/Sheet, v2 Modal/Drawer,
application root and React Query mutation error handling were read in full.
The notification API, direct Sonner callers, persistent/loading messages,
request-ID copy, permission details, validation auto-open, caller-handled errors,
keyboard dismissal and return focus must remain available.

Today validation and permission dialogs are children of a toast. Moving that
toast inside the active modal would make it a descendant of its own dialog.
Separate detail-dialog ownership before changing notification placement. Retain
only formatted validation paths and response details, never the Axios request
body, in persistent dialog state.

## Execution and acceptance

1. Capture actual shared-component failures with browser fixtures: notification
   overlap, trapped keyboard focus, and error-detail lifecycle. Fixtures do not
   count as successful API operations.
2. Give request-error details independent application-root ownership. Verify
   validation auto-open, permission action, detail lifetime, close/return focus,
   mutation suppression and malformed-response fallback.
3. Evaluate a single stable notification renderer with active-modal docking.
   Preserve notifications and timers while changing hosts; reserve bounded
   layout space rather than covering actions. Verify nested modal restoration,
   direct Sonner calls, multiple and persistent messages, short/narrow viewports
   and reduced motion across the shared modal families.
4. Run frontend checks and browser fixtures, build the canonical standalone
   image, then run real-image application workflows and both cache smoke gates.
   Record precise evidence, update exact-blob review entries, commit and push.

External Nomen registration and WI/TX deployment details remain unresolved. This
UI work does not enable native authentication cutover; scoped revocation and the
remaining gates in 0032/0037 still apply.

## Reproductions and implementation

`.cache/notification-before-tall/result.json` records the original tall-dialog
failure: Save is covered, the toast is outside the dialog, and its copy control
cannot be reached with Tab. The screenshot was visually reviewed. A separate
320-pixel drawer check records a left edge of -64 pixels in
`.cache/notification-drawer-width-before/bounds.json`.

The first full fixture matrix (`.cache/notification-proof-dk101T`) passed 14
cases, then exposed the short confirmation dialog's obscured footer. Its
screenshot was reviewed; it is retained as a failed intermediate result.
The next matrix (`.cache/notification-proof-c320Ks`) reached the confirmation
case but failed its post-Escape focus assertion while permission details were
still visible. An isolated rerun passed. The test now explicitly establishes
focus in the detail dialog and waits for any copy tooltip to close before
testing Escape; it does not attribute that intermittent result to a proven
production defect. Failure diagnostics retain modal/focus state and screenshots.

Request-error details now have independent root ownership. Validation opens
automatically; permission details remain an explicit action. Closing a toast
does not close its detail dialog. Concurrent validation details are queued;
closing them restores the originating control. Request bodies are used only
while formatting validation paths and are not saved in dialog state.

One stable Sonner portal moves into the active shared modal host without
remounting. Its bounded, scrollable region takes layout space ahead of footer
actions. Dialog, Sheet, AlertDialog, legacy Modal and legacy Drawer register
hosts; closing nested details restores the previous host. Sonner continues to
own timers, IDs, direct grid messages and promise updates. Outside modals it
retains its existing viewport placement. Invisible queued notifications no
longer override Sonner's pointer-event suppression.

Shared copy/dismiss targets are at least 24 CSS pixels, v3 dialog/sheet close
targets are 32 pixels, and headers reserve close-control space. Clipboard
failure has visible feedback. The legacy drawer now has an associated title
and fits narrow viewports. Confirmation content can shrink and scroll while
keeping its footer available. The loading icon respects reduced motion, with
its computed animation checked in the fixture. These changes do not establish screen-reader,
forced-color, browser-zoom or whole-workflow conformance.

`scripts/test-notification-matrix.mjs` runs a private Vite server and 15 isolated
component cases, across five shared modal types at 390×500, 320×500 and 390×320.
The fixture blocks API calls and replaces clipboard writes with a local test
stub. It checks placement, keyboard reachability, copy success/failure, detail
ownership and return focus, concurrent validation, caller-handled errors,
malformed message fallback, six queued notifications, promise resolution,
stable DOM ownership across host changes and finite expiration. Axe results
and incomplete checks are saved without rule exclusions. This fixture is not
a production route and does not count as an API capability proof.

The GitHub image checks run the matrix and retain its evidence. Existing
real-image environment recovery checks additionally assert that notices are
docked and leave Create, Update and deletion actions uncovered.

## Verification checkpoint

The preceding component matrix passes all 15 cases in
`.cache/notification-proof-kjzGAu/result.json`. Every scoped axe 4.14.0 scan has
zero detected violations; incomplete/manual-review findings remain in the
per-case reports. Final narrow-drawer and short-confirmation screenshots were
visually reviewed. Type checking and scoped lint pass in
`.cache/notification-types-final.log`, `.cache/notification-lint-final.log` and
`.cache/notification-toast-lint.log`.

An intermediate standalone image built as
`sha256:2020eefedf24a0a9a52d97c15244f2b762af34cc3c4d8b5621cb5c2956701e6b`
(`vaultix:notifications-verified` at that checkpoint). Cold loading checks used the UI extracted
from that image, not an older source build. All three runs pass the existing
budgets: 3,010,356 decoded JavaScript bytes and 3,539,378 total decoded asset
bytes, with no browser errors (`.cache/loading-proof-EuxVvE/result.json`).
Local timing is diagnostic and is not a hosted performance commitment.

That intermediate image passed both cache gates and the original packaged
workflow checks (`.cache/app-image-proof-Z79LAH`), but visual review of
`environment-long-confirmation-controls.png` caught overlapping destructive
warning text. The attempted flex layout let the existing alert shrink to its
explicit minimum height. This image was not deployed. Confirmation content
now retains a grid with intrinsic row heights; its footer remains sticky and
the content scrolls without compressing the warning. The short confirmation
fixture still passes. A new real-image geometry assertion checks that the
warning contains its text and that the confirmation label starts below it.

The UI surface remains 273 routes and the API surface remains 2,290 operations.

The corrected canonical image is
`sha256:2a9ddfb139a81ffc9397f02eb8c1e2e47b6ef7daa5f85ddc330b6f6518014b70`.
Its final component matrix passes all 15 cases in
`.cache/notification-proof-gVnaex`, and the changed confirmation primitive's
lint passes in `.cache/notification-alert-lint.log`. Real-image application
checks pass in `.cache/app-image-proof-tGRW3B`, including the new warning
geometry assertions and four notification/action checks. The long-confirmation
screenshot was visually reviewed again and no longer has overlapping warning
text. A final rerun also checks that the focused confirmation input and Cancel
control are uncovered, rather than relying only on viewport intersection.

The corrected packaged UI passes the guide/login fixture suite in
`.cache/ui-proof-GghdeD` and the loading budget in `.cache/loading-proof-cFtw5I`:
3,010,361 decoded JavaScript bytes and 3,539,425 total decoded asset bytes, with
no browser errors across three cold runs. Backend business logic and schemas
are unchanged in this packet; the preceding backend unit/database evidence
remains separately scoped in 0036/0037.

The final packaged application run passes in `.cache/app-image-proof-hoAOol`,
including focused input/Cancel occlusion checks, warning geometry and the four
notification/action checks. Both final cache smoke/restart/MCP/queue gates pass
in `.cache/notification-final-smoke-dragonfly.log` and
`.cache/notification-reviewed-smoke-redis.log`. Their API error reports are
`.cache/api-error-proof-f4Pt8l/result.json` and
`.cache/api-error-proof-e5glHS/result.json`. No operator data was reset.

Remaining scope includes real assistive-technology review, all consuming
workflows, nonmodal queue accessibility and status-specific generic error copy.
The inherited generic error headline still says Bad Request for other HTTP
failures. These are explicit follow-up work, not conformance claims.
