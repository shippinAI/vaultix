# Vaultix implementation map

Start with [ADR-0027](../0027-native-stack-and-ai-migration.md). It defines the
current stack, target ownership, alternatives, AI value boundary, dependency
order, acceptance evidence, data/job cutover and rollback. This directory makes
the source mapping reproducible; it does not claim the mapped code was read.

The first map covers 9,322 product-code, test, operations and asset files in
1,055 source/workstream/target groups. All groups remain `unassessed`. This is
coverage of the selected inventory kinds, not completion of 1,055 reviews.

## Files

- `workstreams.json`: authored domain assignments, dependency DAG and required
  acceptance gates. Assignments are first-match path rules and require review.
- `generated/files.tsv`: every inventoried product-code, test, operations and
  asset file mapped to its source group, workstream, target, language, content
  hash and current review state. The original inventory remains authoritative.
- `generated/modules.tsv`: source-directory/workstream/target groups, file counts,
  aggregate content digest and reviewed-file count. Every migration state starts
  `unassessed`; generation never upgrades that state.
- `generated/summary.json`: coverage and dependency counts for inspection.

These groups are mechanical navigation units, not proof of architectural module
boundaries. A source group can span multiple workstreams; that is explicit in the
rows. Path rules can misclassify a file. Read it, trace its callers and amend the
rules before treating its assignment as an implementation decision. `intake`
means unclassified investigation, not permission to skip a file; CI refuses
unclassified files. Documentation,
locks, vendored/generated code and archives remain in the authorship inventory;
they are excluded from this implementation map and need provenance/dependency
review, not a claim that third-party code was newly authored.

The workstream DAG is a prerequisite map, not an extracted call graph. Exact
runtime/data/authorization dependencies and API-to-handler-to-table traceability
must be recorded during each module review. No automated map establishes them.

## Update and verify

```sh
node scripts/audit-codebase.mjs --write
node scripts/map-migration.mjs --write
node scripts/audit-codebase.mjs --write
node scripts/audit-codebase.mjs --check
node scripts/test-migration-map.mjs
node scripts/map-migration.mjs --check
```

The second inventory write records the generated artifacts. Generated migration
outputs are excluded from their own map input to avoid self-referential hashes.
Inspect source/assignment changes before regenerating. CI checks content drift,
coverage, duplicate inputs, missing workstreams and cyclic prerequisites. Its
unit tests also ensure a source hash change changes the group digest and that
discovery does not mark a module migrated.

The workstream `gates` arrays are required acceptance work, not a claim that all
those tests exist or run in CI today. Existing executable release checks remain
in GHCR and the hosted evidence ledger; each new gate must acquire runnable
evidence before its workflow is promoted.

## Work packet required before implementing a module

Copy this structure into the file's review evidence or a dedicated domain design:

1. **Identity:** source paths/content hashes; destination packages; responsible
   workstream; current routes, jobs, consumers and UI entry points.
2. **Behavior:** success, empty, denied, conflict, retry, cancellation, expiry and
   recovery; compatibility callers and deprecated behavior still in use.
3. **Data:** tables, encrypted formats, key ownership, migrations, transactions,
   indexes, caches, queue payloads, retention and backup/restore.
4. **Authority:** actor/tenant derivation, permissions, approvals, revocation,
   audit effects and value exposure; never infer authorization from UI controls.
5. **Implementation:** retained/replaced logic with reasons; React/Go/Rust
   responsibilities; typed contract and dependency changes; no new second store.
6. **Evidence:** runnable tests, versions/image digest, real versus fixture
   results, accessibility manual findings, external prerequisites and measured
   latency/concurrency budgets. Preserve inherited tests until equivalent tests
   cover their behavior, with an explicit reviewed retirement decision.
7. **Cutover:** single writer/consumer ownership, rollout conditions, rollback
   compatibility window, reconciliation and exact removal criteria for old code.

Mark a work packet complete only after all its gates pass. A feature-family gate
also needs its complete workflow and provider matrix; a single file review is
not sufficient. Keep unknowns explicit and continue independent work. Do not
invent dates, load targets, provider credentials or deployment readiness.

## First queue

`STACK-01 → AUTH-01 → READ-01 → ACTION-01 → INJECT-01`, as specified in ADR-0027.
Shared React upgrade/accessibility work can proceed alongside domain
characterization. The separate workstream gates then cover rotations/providers,
audit, KMS, PKI, PAM, scanning, hosted operation and legacy retirement.

No production WI/TX target, Nomen registration, hardware/provider account or
DevSCIF control profile is inferred by the map. These remain named prerequisites
for the corresponding acceptance tests.
