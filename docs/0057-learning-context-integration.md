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
