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
