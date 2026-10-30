---
name: implementation-verification
description: Verify that a Vaultix implementation satisfies its grounded plan across real boundaries, including regression and failure behavior. Use before completion, cutover or deployment claims.
---

Read the current immutable plan event and its source snapshot. Independently
compare the requested outcomes, implementation diff and acceptance matrix. Look
for missing consumers, bypasses, untested data transitions and changed authority.
Inspect test assertions and fixtures, not only exit codes or test counts.

Use checks that can falsify the implementation. Exercise a real consumer through
the changed boundary, a denied or invalid case, and relevant failure/recovery.
For security changes, include cross-tenant/revocation/canary cases; for persistence,
real migration/restore/concurrency; for UI, keyboard, loading/error, reflow and
real-service behavior. Record why an otherwise relevant dimension does not apply.
Use independent fixtures/oracles rather than computing expected results with the
same function under test. Where practical, prove a guard catches a deliberately
broken temporary fixture without weakening or modifying production checks.

Bind receipts to the exact plan event, command, source hashes, artifact digest,
environment and observed outcome. `node scripts/ai-journal.mjs run` executes the
predeclared argument vector and records bounded, redacted output. Fixture evidence
cannot satisfy a live-provider check. Source changes invalidate earlier receipts
for that plan. Unavailable, skipped, failed and pending checks stay visible.

Never lower a baseline, remove a failing test, retitle a requirement or promote
a fixture to live evidence to obtain green status. Replans are append-only and
must preserve earlier requirements/check obligations in the session. Genuine
scope changes need a new linked session and the user's recorded direction.

The journal's `assess`/`finish` commands prove receipt/plan consistency only.
They cannot prove that an agent wrote good requirements, that a test really
measures its claim, or that locally writable files are independently attested.
Explicitly review that gap. A passing isolated test or schema validator never
establishes whole-feature parity, accessibility or production readiness.

Run the canonical artifact and relevant real workflows for runtime changes.
Use source-layer equality for documentation-only image changes where applicable.
Publish exact evidence and remaining limitations; do not rerun unrelated suites
without a new change, failure or unresolved concern.
