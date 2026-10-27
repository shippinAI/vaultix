# Capability preservation during Vaultix authorship

Vaultix.cloud evolves the existing application in place. Every product-owned
module remains in the authorship scope in [0021](0021-product-authorship-review.md).
Changing labels or domains does not establish authorship. Replacing a workflow
must preserve supported behavior or provide an explicit compatibility and
migration design. Retain dependency notices and generated-code provenance.

## Preservation baseline

`contracts/vaultix-capability-surface.v1.json` records 273 generated UI paths and
2,290 documented API method/path pairs from the working application at commit
`1b08567bf7a6346d474988bbce841370526bd68c`. Its canonical standalone image passed
real sign-in, dashboard loading and Dragonfly/Redis checks before capture.
Provider identifiers, including the Doppler connector, remain provider names.

After generating routes, CI checks that existing UI paths remain. Each image
smoke test compares its live OpenAPI operations with the same baseline. Removed
methods fail even when their path still exists. New routes are permitted. A
deliberate migration requires compatibility evidence and a reviewed baseline
change; do not recapture just to make CI pass.

```sh
node scripts/test-capability-surface.mjs
node scripts/check-capability-surface.mjs --check-ui
node scripts/check-capability-surface.mjs --check http://127.0.0.1:8200
```

This gate does not compare response schemas, undocumented routes, authorization,
stored data, provider protocols, performance or workflow results. Those need
behavioral checks. It does not establish a complete historical inventory of the
owner's earlier project.

## Behavioral acceptance

The image browser test uses a disposable database and generated test credentials.
It signs in through the real form, loads the dashboard, creates a Secrets
Management project through the existing dialog and opens its overview. It also
checks unauthenticated project denial and keyboard navigation through all five
product categories, including the provisioned certificate project and PAM
accounts. Real-service results are written to `result.json`.

Dashboard outage, denied-card, empty setup and multi-instance picker checks deliberately
substitute selected responses after real sign-in. Their separate evidence in
`dashboard-recovery.json` has `fixtures: true`. They establish browser behavior,
not server-side authorization or certificate-provider behavior. No fixture
project identifier is submitted to a real mutation.

Full-page axe reports for the authenticated dashboard and certificate setup are
retained in `accessibility.json`. Detected A/AA violations in these states fail
the runner. Incomplete results require manual review. These states do not
establish all-UI accessibility, screen-reader acceptance or enterprise parity.

## Current module review

The complete `ProjectCategoryOverview.tsx` and
`CertManagerSelectInstanceModal.tsx` files were read with their route callers,
query/mutation hooks, permission decisions, preference helper and dialog APIs.
The authored overview preserves the five product categories, certificate
setup/selection, membership versus admin access, access requests and lazy PAM
resolution. Server authorization remains authoritative. Query errors now have
retry paths; a failed certificate lookup cannot mean no configuration. Cards use
native buttons, flat surfaces, readable descriptions and persistent denial
explanations. The picker labels its control and refuses a selection absent from
the available instance list.

The existing PAM bootstrap GET, duplicate mutation-error notifications, sub-org
cases, admin auto-join/revocation races and real provider lifecycles still require
their own review and acceptance. Authorship of these files does not establish
that their surrounding modules have been rewritten.

Continue through project/environment and secret lifecycle workflows, then
approvals, identity/provisioning, rotation/sync, audit and PKI/PAM/KMS. Preserve
existing tests, add meaningful positive/denied/failure/recovery evidence, and
reconcile exact file hashes in `docs/code-audit/reviews.json`. Do not mark the
whole product regression-free from a green subset of tests.
