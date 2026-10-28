# Learning-context integration and reproducible dependencies

Main advanced to `2e29c71a518433d7fbde9e8e8d0650db2c8df4eb` while the
[machine tenant isolation packet](0056-machine-tenant-isolation.md) was being
verified. Its new learning-context HTTP/MCP feature is retained and repaired in
place. The earlier packet's image evidence predates these runtime changes.

## Teaching contract

`POST /api/v1/vaultix/learning-context` and `vaultix.learning.profile.get` use one
bounded parser and publish the same JSON Schema. The parser accepts only the
documented context names, six area choices, bounded strings and an integer
interaction count from zero to one million. Null, arrays, coercible numbers,
unknown fields and invalid field types fail without reflecting submitted data.
Both transport bodies are limited to 16 KiB. Empty MCP arguments remain supported.

The original MCP tool advertised an empty argument schema while accepting context,
and malformed context could reach string normalization and throw. The original
HTTP body schema also reached the inherited Zod compiler, which cannot parse JSON
Schema. OpenAPI generation failed for the same reason. Runtime validation is now
explicit before the inherited compiler; the Swagger adapter publishes the shared
schema after its legacy transform, as it already does for reference queries.
Tests exercise the inherited compiler and the real Swagger generator.

This is public, stateless teaching assistance. It reads no organization/project
records, persists no activity and grants no authority. `skillLevel` is retained
for response compatibility and is only a context-density heuristic, not measured
expertise. `recentEvents` describes supplied context at response time, not an audit
history. Send names only: the server cannot distinguish a credential mistakenly
entered in a free-text name field. Descriptions explicitly forbid credentials and
secret values. Protected reference actions continue to derive authority from the
verified request, never teaching context.

## Dependency and provenance repair

The concurrent baseline globally replaced third-party source names with the typo
`valutix`, including npm coordinates and Go checksum entries. Registry checks on
2026-10-28 returned 404 for all three renamed npm versions and 200 for the
published LDAP version. The original versions, URLs, checksums and provenance are
restored. Product imports remain `@vaultix/ldapjs`, `@vaultix/pg-view-generator` and
`@vaultix/quic` through npm aliases. An alias is dependency resolution, not product
authorship; it does not replace the requirement to migrate complete use cases.

The same exact typo-only substitutions in competitor citations and negative
legacy-brand tests are reversed. These citations describe external products;
renaming their domains would invalidate capability research. No package was
downloaded from a snapshot host and no provenance is reassigned to Vaultix.

## Acceptance and remaining scope

Targeted tests cover invalid input on both transports, schema publication,
matching profiles, Unicode length bounds, nonfinite numbers, body limits and empty
arguments. The full Linux backend suite, canonical standalone build and real-image
application/isolation/recovery checks must pass for the integrated revision.
Evidence is recorded below when complete. Source inventories and acceptance maps
must retain the existing capability baseline; this packet does not establish
whole-product parity, public enrollment, live Nomen sessions, multi-replica
isolation or measured cloud scale.

### Committed-image evidence, 2026-10-28

Source `ba809e15d0fc00391f816db1f82efe86ee8e8cae` built
`sha256:80cd937b95773e4652195e440ea1ce504e233ca104102108bcf375af9de8ca04`
with `core/Dockerfile.standalone-vaultix`. The local application build completed
every mandatory step against that immutable image. Paths below are relative to
the main checkout:

- Canonical build, exact revision identity, 18 invalid identity-policy startup
  cases, Dragonfly/Redis queues and restarts, teaching-context HTTP/MCP acceptance,
  and all application/recovery/isolation gates:
  `.cache/tenant-isolation/.cache/self-hosted-build-1xNJIs/result.json`.
- Real owner setup, password sign-in, project/dashboard loading, secrets workflows,
  dashboard recovery, charts and environment interactions using installed Chrome:
  `.cache/tenant-isolation/.cache/app-image-proof-YfJbL1/`. See `result.json`,
  `workflow-result.json`, `onboarding-result.json` and captured screenshots.
- Nine encrypted-recovery checks with cleanup:
  `.cache/tenant-isolation/.cache/encrypted-recovery-9qHHSD/result.json`.
- Eleven tenant-isolation checks, including revocation after restart, with cleanup:
  `.cache/tenant-isolation/.cache/tenant-isolation-Tw5Sz7/result.json`.
- Linux backend suite: 123 files pass; 1,918 tests pass and 22 existing tests skip:
  `.cache/tenant-isolation/.cache/unit-proof-x7QKiA/test-results.json`.
- Eleven orchestration fixtures pass:
  `.cache/tenant-isolation/.cache/self-hosted-fixtures-PALIF0/result.json`.

Backend TypeScript checking, targeted ESLint, panel Go tests, owned-source checks
and generated-map checks pass. The original surface baseline remains unchanged
at 273 UI routes and 2,290 API operations; the real image exposes 2,291 operations
with the additive learning-context endpoint. Browser accessibility scans retain
manual-review findings and do not establish whole-product WCAG conformance.
No GitHub Actions run or registry publication was needed for this evidence.
