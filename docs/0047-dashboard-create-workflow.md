# Native environment dashboard create workflow

Status: scoped packaged-browser and cache acceptance passed, 2026-10-28.

The reference-editor checkpoint is committed/pushed as
`680410792f04c3be02305046519abbf00e513592`. Its exact-revision canonical image
`sha256:7ef6686423902188c64a35c7afb7df7747e609fcc1adcc3b7d1799eb5a64d493`
is healthy locally, with unchanged database/cache identities and HTTP 200 from
the integrated app/API and development UI. Evidence is in
`.cache/dashboard-reference-committed-comparison.json` and
`.cache/dashboard-reference-dev-rollout.json`. Registry/hosted publication remains
unverified independently of this local rollout.

## Scope and preservation plan

Read the complete existing environment dashboard `CreateSecretForm`, the relevant
`SecretDashboardPage` caller/import block, the v3 creatable selector and its story,
the Field/Sheet stories, and the existing overview form's corresponding patterns.
The large dashboard caller has not received whole-file review credit.

Convert the form and its existing modal entry in place to the native shared
Field/Input/Button/Sheet primitives. Keep the verified v2 reference editor until
the full wizard/editor compatibility matrix permits consolidation. Replacing that
editor with the superficially similar v3 wrapper is not part of this packet.

Preserve key trimming, auto-capitalization, key/value paste, optional empty values,
multiple tags and normalized tag creation, ordinary server creation, protected
branch submission, local batch staging and cancel. Keep the same hooks, stores,
project/environment/path, encrypted database and server authorization. Replace
the form's Zod resolver with typed React Hook Form rules; no new schema library.
Associate visible labels/errors, make contextual help keyboard reachable, retain
input after failures, and use a responsive sheet with correct nested-popup Escape.

## Acceptance gates

Run against the canonical standalone image's disposable authenticated application:
required/whitespace key focus, both paste callers, reference compatibility,
help/generator/menu dismissal, tags, ordinary creation and injected API failure
recovery, retained input, metadata-only persistence verification and cancellation.
Check desktop/320px reduced-motion layouts and selected axe results without rule
suppression. Continue existing login, overview, environment, chart and cache tests.

Protected approvals, batch staging/commit, restricted tag permissions and all
server denial paths require explicit cases; source retention alone does not prove
them. Record any remaining cases rather than marking this a complete lifecycle or
enterprise migration. No new AI value path, table, protocol or second store is
introduced. Promote only an accepted image, preserving operator data services.

## Caller tracing and baseline

The actual dashboard store sets batch mode on by default, so its create action
stages a pending change; the existing review/commit action persists it through
`/api/v1/pit/batch/commit`. Acceptance follows that real path instead of forcing
the dormant direct-create branch. The complete CommitForm was read, including
pending-resource presentation, explicit reveal handlers, reference queries and
save/reset behavior. Its commit handler has finally cleanup without a catch;
an API failure therefore retains pending state but escapes as an unhandled
rejection. Catch that failure without resetting pending changes or the commit
message, and retain the shared mutation error notification. The commit-message
label also needs a programmatic association.

The prior accepted image reproduces zero associated Key/Value/Tags labels at
`.cache/app-image-proof-avPkGo/dashboard-create-semantics.json`. The new test
requires all three before proceeding. Planned persistence proof creates a real
normalized tag, stages an empty-valued tagged secret without a write request,
injects one commit failure, then retries the actual commit and checks metadata
without fetching values. Protected-branch approval completion and restricted-role
paths remain explicit additional acceptance work.

## Authored and verified

The existing create form now uses the shared native fields, inputs, buttons and
responsive sheet. Its existing reference editor is retained with all 0046 checks.
Typed RHF validation preserves key/tag trimming and configured key casing; no
Zod remains in this form. Key/Value/Tags and validation messages are associated,
reference/whitespace help is keyboard accessible, and nested generator/tag menus
dismiss without closing the form. Tag creation and the direct-create fallback
retain entries on a rejected mutation; the latter is not the active dashboard
path and has not received a direct-create runtime acceptance claim.

The existing commit component now catches rejected saves, keeps pending changes
and the message, and relies on the shared mutation notification. The message uses
an associated native label; the previous file-wide label-rule suppression is gone.
No authorization, encrypted persistence, approval policy or value-reveal protocol
has been changed. Other commit operations and explicit reveal remain separate
acceptance work.

Canonical image
`sha256:d796d0e3c8029bae886c811e23443528e0685bced7704ff967aff1deadc131ba`
passes the full ordered real-image application suite at
`.cache/app-image-proof-1653IB` and Dragonfly API/MCP/queue/restart smoke in
`.cache/dashboard-create-policy-smoke.log`. The test verifies all three labels,
required/whitespace focus, configured casing, generator and tag-menu Escape,
real tag normalization/selection, zero commit requests during staging, an
injected first-commit 503, preserved message/pending change, actual retry and
metadata-only verification of the persisted tag with hidden value. The two commit
attempt reports retain booleans and environment only. Earlier paste/reference,
sign-in, overview, recovery, chart and environment checks remain green.

The desktop and 320px reduced-motion scans detect zero selected WCAG A/AA
violations. Incomplete generator `aria-controls` and empty textarea contrast
checks remain in `dashboard-create-accessibility.json`; no rule is suppressed.
The mobile screenshot was visually inspected. Real screen readers, filled-value
contrast and all other dashboard/commit states remain open.

The first candidate run (`.cache/app-image-proof-YGMBPF`) passed validation but
incorrectly expected uppercase keys in a project whose actual setting disables
auto-capitalization. The test now derives its expectation from the created
project's boolean setting. This was a harness assumption, not a product defect
or reason to change the user's project policy. The prior baseline failure at
`avPkGo` is retained. Canonical build includes type checking; targeted ESLint
passes for the form, caller and commit handler.

The same image also passes Redis API/MCP/queue/restart smoke checks
(`.cache/dashboard-create-redis.log`). The route/API preservation gate still
finds all 273 UI routes and 2,290 API operations; owned-source and migration-map
checks pass. These checks do not establish complete behavior or enterprise parity.
