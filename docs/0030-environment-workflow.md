# Environment workflow authorship

Continue the existing Secrets Management settings workflow: create, rename,
reorder, schedule deletion, restore, and permanently delete an environment.
This packet follows 0021, 0022, 0026 and the staged migration in 0027.

## Trace and retained contracts

The four EnvironmentSection components consume ProjectContext and existing
project mutation hooks. POST/PATCH/DELETE `/api/v1/projects/:projectId/environments`
and the ID/restore variants remain authoritative. Mutations invalidate the
existing project query. No second store, route replacement or model-only API is
introduced. Environment names/slugs are metadata; this workflow does not read
or expose secret values.

The existing server enforces project Create/Edit/Delete environment permissions;
restore requires Delete. It creates a root folder transactionally, updates
positions, checks approval-policy references before deletion, reserves deleted
slugs, retains a 14-day restore window, and appends restored environments. Audit
events remain server-owned. The current implementation and its lock/marker
coordination still require concurrency characterization before a Go cutover.
This UI packet does not certify the entire server service.

## Authored changes and acceptance

1. Share create/edit form behavior with associated labels, validation, stable
   input after failure, explicit pending state and no unhandled rejected promise.
   Match existing trimmed name (1–255) and canonical slug (1–64) constraints.
   Use existing slugify and React Hook Form; introduce no Zod dependency.
2. Keep destructive dialogs open until success. Prevent duplicate submission,
   retain typed confirmation on failure, label it, and preserve exact-slug
   confirmation for permanent deletion. Dismissal during a request must not
   silently discard the operation's status.
3. Preserve all permission checks and keyboard reorder controls. Remove obsolete
   paid-plan UI branches from this included capability; server authorization and
   operational rejection still apply. Make deletion timing and actor information
   readable without hover. Provide one global mutation-error notification.
4. Correct the shared header's narrow reflow without changing its caller contract;
   verify representative project, certificate and settings headings/actions.
5. Exercise real create/edit/reorder/delete/restore/permanent-delete against a
   disposable image; separately label injected denial/outage/pending fixtures.
   Verify no duplicate writes, retained input, retry, focus recovery, keyboard
   operation, narrow layout, reduced motion and scoped accessibility.
6. Build the canonical image, retain the UI/API surface, run both cache smoke
   suites, reconcile file reviews/maps, commit/push and update local development.

Provider effects, concurrent server mutations, real role matrices and manual
screen-reader acceptance remain separate gates. Do not mark this packet verified
until the described executable evidence exists.

## Findings during executable review

The first image run reproduced 3.9:1 contrast for the shared v3 table headings.
Their default now uses the existing full muted token. The next run passed the
environment-list scan, real create and duplicate-slug rejection, edit retry,
keyboard reorder and anonymous mutation denial, then found pointer input blocked
after the menu-to-dialog transition. Environment action menus now use nonmodal
menu behavior while edit/destructive dialogs remain modal. Focus recovery waits
for refreshed project data after reorder/restore and respects subsequent user
focus movement. These changes require a complete rerun before acceptance.

The nonmodal menu change resolved the pointer lock. Rapid cancel/reopen still
failed: the focus trace in `.cache/app-image-proof-pXry11/environment-focus.json`
shows the closed menu remained mounted when the next trigger click arrived.
The environment menus now omit their exit animation so the obsolete dismissal
layer unmounts before another interaction. Opening motion remains available;
the test keeps rapid reopening and adds no fixed delay. Acceptance still requires
a rebuilt image containing that style and a complete passing workflow.
A later run exposed interrupted refresh
recovery and logout/grace defects in the existing core; these are traced and
repaired under [0031](0031-refresh-recovery.md) before this workflow is accepted.

The invalid-form scan reports an undetermined background on the dialog container
because of overlapping elements. The retained validation screenshot was reviewed;
error text uses `#e74c3c` on `#141617` (4.75:1), and muted labels use `#a0adbc`
on that surface (7.95:1). The original incomplete axe finding remains in the
report. This targeted review does not establish every dialog/zoom/AT state.

The earlier certificate image CI run `40562282347` separately failed its five-second
dashboard navigation assertion during filter checks. It did not capture the
failed route state. The check now has a bounded 30-second navigation wait and
captures pathname/headings plus a fixture screenshot on failure. This is a
diagnostic change, not proof that the CI failure is resolved.

The rebuilt image passes rapid menu reopening and the real deletion/restore
paths in `.cache/app-image-proof-FT8ZDP`. That run then stopped on a test locator:
the shared button correctly becomes disabled, but its loading status changes
its accessible name from `Create` to `Create Loading`. The pending-state check
now recognizes that existing contract and awaits held fixture responses during
cleanup. No product permission or pending-state behavior was weakened.

## Executed checkpoint

The canonical image `vaultix:environment-release`, ID
`sha256:6f74b5d249a7f0098413fb4f6da27150a3011b34b488cb98b29854a8e10af739`,
passes both Dragonfly and Redis smoke/restart checks. The complete disposable
application run is `.cache/app-image-proof-SxVC1r/workflow-result.json`.
Its separate lifecycle report covers nine real checks; its recovery report
covers five injected outage/pending/permission checks. Authentication recovery
also survives the ten-second grace window. No secret values are in these reports.

Six environment axe states have no detected violations. Incomplete background
contrast findings remain in the report. Screenshots show wrapping at 390 and
320 pixels, and the longest confirmation's input/cancel controls can be reached
by keyboard. Visual review also found that the existing global notification
stack can cover the bottom of a tall dialog. This remains an explicit shared
notification/modal acceptance gap; viewport intersection alone does not prove
an unobscured focus indicator. Whole-UI accessibility is not complete.

TypeScript, scoped ESLint, the production build and preserved surface checks
pass. Prior shared UI verification in `.cache/ui-proof-TFz4c7` covers 18 states;
`.cache/loading-proof-BAqS1T` measures 3,008,408 JavaScript and 3,536,865 total
decoded bytes at cold login, with zero browser errors. The final scoped menu
exit-style change is additionally compiled and exercised in the image above.
Backend recovery evidence is recorded in [0031](0031-refresh-recovery.md).
External provider, real role-matrix, Nomen, concurrency and manual assistive
technology acceptance remain open. This checkpoint is functional workflow
evidence, not completion of every gate in this packet or the migration program.
