# Guided environment creation and updates

## Work packet

Author the existing authenticated environment form in place. Read the full shared
form, create/update modal callers, guidance renderer/reducer/reader, catalog
content and real-image lifecycle test. Preserve environment create/update APIs,
validation, slug suggestion/override, submission guards, permission checks,
retained edits, notifications and dialog focus recovery. No database/schema,
encrypted data, jobs, authorization or provider changes are part of this packet.

The guide explains environment scope, name versus slug, client impact and retry.
A lesson never submits or saves a form. Existing mutation hooks and the backend
remain authoritative. No input values are read by teaching, captured in guide
history or passed into model content. Ordinary create/update workflows continue
even when help is unavailable.

## Contract and interaction

Keep the original four `guides` entries intact for existing clients. New optional
`workflowGuides` entries supply create/update teaching; the current reader accepts
an absent extension from an older server. Unknown IDs, components, out-of-scope
targets, duplicates and oversized content are rejected. The reader is extracted
into a pure contract module for direct tests; the existing React query continues
to own fetching. HTTP and MCP share the same authored document.

The form passes its own element ref to the renderer. Allowlisted target names
resolve only within that form, never through a server-supplied selector or a
second mounted form. Existing root guides retain their fixed ID targets. The
nested dialog must trap focus, restore its trigger on Escape, retain parent form
edits and move focus to the selected control only after closing the lesson.
Disabled controls remain unavailable. Essential slug warnings remain visible.

## Acceptance gate

Run contract and reducer tests, frontend/backend types and scoped lint. Build
`core/Dockerfile.standalone-vaultix` from committed source. Extend real-image
create/update acceptance with nested keyboard navigation, scoped focus transfer,
Escape, pause/resume/completion, retained fields, no mutation from lessons,
320px reflow and reduced-motion scans. Retain all existing lifecycle, denied,
failed-save/retry, pending-submit and baseline gates. Record actual results below
before claiming this packet verified. Manual screen-reader acceptance, complete
UI authorship, Nomen migration and enterprise parity remain separate work.

## Accepted evidence, 2026-10-28

Source `217aa3dbd8c66e39976fa778bec4df80ec8815c2` built the canonical standalone
image `sha256:9589f555ff1b9339b108f8a16aa0dfdd904762a0d94c2931492c8347faeacf32`.
Receipt `.cache/self-hosted-build-UyUBo1/result.json` passed, including all 18
identity-lifetime cases, real Dragonfly application checks and Redis API/queue/
restart checks. The preserved surface remains 273 UI routes and 2,290 API
operations. No operator data was used as a fixture.

The real application run `.cache/app-image-proof-sKT8bZ/workflow-result.json`
passed the existing onboarding, project, environment, secret and recovery checks.
`environment-teaching.json` records both create and update: nested keyboard focus,
Escape without parent dismissal, scoped control focus, pause/resume/completion,
retained edited values and zero environment mutations during guide use. The
ordinary create/update actions then persisted successfully. The existing nine
real environment lifecycle checks and five explicitly injected recovery/permission
checks passed. Eight environment axe states reported zero automated violations;
manual findings remain in `environment-accessibility.json`. Both 320px lesson
screenshots were visually reviewed. The update screenshot includes the preceding
duplicate-slug error in the existing notification dock; it is not a guide-generated
error or a new save attempt.

The separate packaged native UI suite used artifacts extracted from that exact
image. `.cache/ui-proof-6gtdSD/accessibility.json` has 20 states with zero automated
violations. Its auth/action responses are fixtures; the real-image results above
are separate. Existing root guide behavior and old-server catalog compatibility
remain covered. Contract/reducer tests, 18 HTTP/MCP unit tests, both TypeScript
checks, scoped ESLint, migration/capability-map checks and route preservation
passed. Full backend/Go matrices were not rerun for this teaching-only packet.
No whole-UI, screen-reader, live Nomen, provider, or enterprise parity claim is made.

The evidence follow-up keeps `core/` identical to the tested source revision.

The local preview at `http://127.0.0.1:8200/` was updated by immutable image ID.
It is healthy, the original PostgreSQL/Dragonfly container IDs remain unchanged,
and API/root/Vite checks return HTTP 200. Live login and catalog reads confirm the
two workflow guides without creating accounts or invoking authenticated operator
mutations. Receipts: `.cache/environment-guide-preview-result.json` and
`.cache/environment-guide-live-check.json`. No operator environment file or volume
was replaced. Open Project Settings, Environments, then Create or Edit to use the
new guides after signing in with your existing account.
