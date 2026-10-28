# Catalog learning and upload integration

This integrates the outstanding bounded-upload branch and the unfinished native
learning panels into main. First-owner atomic setup remains intact. The existing
authenticated application stays at `/`; learning panels belong to the optional
`/help` reference and connection workflows.

## Learning boundary

The catalog authors short tips for reference and client-connection workflows.
HTTP and MCP return the same document. The UI filters only by the fixed workflow
identifier and uses the shared accordion for optional reading. It neither infers
user expertise nor records project names, folder paths, searches, or activity in
browser storage. No model generation, database-derived teaching, remote viewport
execution, or persistent learning profile is claimed. Existing Guide Me dialogs
remain the interactive lesson path.

New catalog arrays are additive. An older server without them still renders the
existing guide. Present-but-invalid arrays fail validation: bounded text and list
sizes, unique identifiers, supported contexts/kinds, catalog provenance, and
separate inclusion/review fields are required. Plain text is rendered by React;
there are no authored URLs, HTML, selectors, or executable commands in tips.

Capability families organize the roadmap. Software inclusion is independent of
verification, configuration, and permissions. All listed families explicitly
remain under migration/review; the panel does not establish enterprise parity.
The public content contains no tenant data and grants no permissions.

## Upload merge

`fix/bounded-oversized-upload` is merged with its ancestry preserved. Its parser
handler discards at most an additional 2 MiB plus one stream chunk or waits
250 ms before replying to rejected oversized requests. Existing body limits and
Connection: close behavior remain. See 0034 for client/proxy limitations. No
storage, schema, authorization, provider, or first-owner contract changes here.

## Acceptance

Source contract checks cover absent optional fields, context filtering, bounded
content, duplicate IDs, provenance, and unverified capability labels. Browser
checks add keyboard expansion, optional roadmap reading, narrow layouts,
accessibility scans, and old-server compatibility to the existing guided-help
suite. The canonical standalone image and runtime acceptance passed on the integrated
source revision below.

Full authenticated UI conversion, Nomen session migration, live AI teaching,
manual screen-reader review, external provider parity, and remote bare-metal
rollout remain separate work.

## Verified integration, 2026-10-28

Merge commit `53c9e31a728afd781199c448cd64cafff216295d` includes the upload
branch with both parents preserved and all seven previously pending learning
files authored in place. Original unfinished copies are retained locally under
`.cache/learning-before-integration`; they are not runtime or published files.

- Canonical standalone image:
  `sha256:926a43aa9bd7f9f44c5c2015d520954480f906e2ee5c1cc2361bfe5ef5526787`.
  Receipt: `.cache/self-hosted-build-9d0xxS/result.json`, passed.
- All 18 identity-lifetime startup cases passed. Dragonfly real onboarding,
  sign-in, dashboard, environment and secret workflows, plus Redis smoke,
  queue and restart checks passed. Each cache also passed 12 eager oversized
  uploads with plain 413 errors. UI/API preservation remains 273/2,290.
- Real-image workflow receipt:
  `.cache/app-image-proof-mfxTPT/workflow-result.json`. Individual reports
  distinguish real operations from injected failure/response fixtures.
- Backend unit suite in Linux: 1,897 passed, 22 existing skips, 122 files.
  `.cache/unit-proof-kE4Mk6/test-results.json`. An initial broader Windows
  selection could not load the local re2 native binary; 49 tests passed there,
  then the complete Linux suite passed without changing or skipping the tests.
- Native UI acceptance used frontend/backend artifacts extracted from the same
  image: `.cache/ui-proof-OP5cxr/accessibility.json`, 20 scanned states, zero
  automated violations. Keyboard expansion, old-server compatibility, denial,
  reference-only responses, existing guided dialogs, narrow layouts, and reduced
  motion checks passed. Authentication/actions in this suite are fixtures.
- Frontend/backend type checks and scoped lint passed. The final API lint retry
  normalized only local Windows line endings; committed Git content did not
  change. Learning-contract, guided-event, capability-map and preservation-gate
  tests passed. This is not a full all-file lint or manual accessibility claim.

The evidence-only follow-up does not change `core/` from the tested merge commit.
Native Go and backend database integration matrices were not rerun for this
catalog/UI/HTTP-parser packet; their prior first-owner evidence remains in 0051.
Older unrelated GitHub proposals remain open for separate reconciliation; this
merge does not apply their alternative tenancy, licensing, or identity designs.

The local preview now runs this immutable image at `http://127.0.0.1:8200/`.
Its backend is healthy; PostgreSQL and Dragonfly container IDs are unchanged.
The existing account still opens the login screen. The live `/help` connection
panel was opened, expanded and visually reviewed without account creation or
authenticated mutations. Receipts: `.cache/learning-preview-result.json` and
`.cache/learning-live-check.json`; screenshot `.cache/learning-live-panel.png`.
No operator environment file, volume, password, or database was replaced.
