# Native project permission authority

Status: scoped local acceptance passed. Workstream: AUTH-01, prerequisite for
READ-01 in 0027. Broader authorization parity and native cutover remain incomplete.

The complete `core/backend-go/internal/services/permission/permission.go` was
read and traced through project ownership/type checks, direct/group roles,
additional privileges, temporary grants, identity template variables and service
token scopes. Its five database query sites select `Replica()`. Authentication
uses primary authority after 0042, but a valid authenticated actor can still
receive a stale project permission set. The existing single-pool tests cannot
distinguish these paths.

## Implementation and proof plan

- Characterize current behavior with real PostgreSQL schema copies, created only
  inside the disposable integration database. Seed actors/projects through the
  existing application; explicitly label subsequent copied-schema mutations as
  fixtures. Keep a frozen replica and changed primary, plus primary-only denial
  controls, to distinguish stale reads from policy defects.
- Cover project ownership/type/deletion, direct/group membership, role and custom
  permission changes, temporary/additional grants, identity metadata/name template
  changes, service scope changes and database failure/cancellation. A stale pool
  must not restore revoked access or obsolete project enforcement.
- Read all five permission authorities from the primary. Retain existing role
  composition, matching, errors and schema. No new permission cache or store.
- Run focused before/after proof, Go unit/race/vet and full integrations against
  Dragonfly and Redis. Build the canonical standalone image from committed source
  and retain the packaged application, isolation, recovery and admission gates.
- Record exact source/image/runner identities and results before merging/pushing.

## Boundaries and remaining work

This is a Go authorization prerequisite, not a completed reference-domain port.
The TypeScript HTTP/MCP reference service remains the current owner. Nomen issuer
acceptance, SSO enforcement parity, assumed privilege semantics, organization
membership policy and all inherited permission behavior still require their own
proof before native cutover. The existing TODOs are not waived by this change.

Primary reads add authority-query load and fail closed on primary failure. They
do not provide a serializable snapshot across the separate queries, cancel
already-authorized work, or prove physical-replica failover and public-cloud
capacity. No schema or encrypted-data migration is needed; rollback restores
the previous binary and its known stale-permission risk. No new API/UI contract
or provider dependency is introduced.

## Characterization and focused result

The unchanged implementation failed all 30 stale-state revocation cases after
their valid-before-change and primary-only denial controls passed. Obsolete
project enforcement also remained visible for user, identity and service actors.
The baseline contains 38 failed test entries including parent groups; those are
not 38 separate vulnerabilities. Receipt:
`.cache/native-permission-authority/.cache/baseline.json`.

With all five query sites on the primary, the focused suite passes 46 entries,
including the parent groups, eight injected primary-query failures, pre-cancelled contexts
and recovery controls. Receipt:
`.cache/native-permission-authority/.cache/candidate.json`. It uses canonical
issuer image `sha256:b61bdb91968bd442a29455e694952d2888a9aa88f3cdbfd1b13410ff735c3b67`
and Go test image `sha256:5098cbb6accf316e94159400647d8b8c0905b78cf11e2f1fcb632035663d5ce2`
with the explicit new test/source files mounted. The baseline runner permission
source matches the starting source after line-ending normalization. These are
focused development results; final committed-image evidence follows below.

The matrix includes user/identity direct and group membership removal, role
downgrade, a shortened temporary grant, custom-role rules, additional privileges,
name/metadata template conditions, project tenant/type/deletion, and service
scope/permission removal. Schema copies omit constraints and mutation fixtures
do not establish the corresponding management API behavior. The permission
assertions neither retrieve nor decrypt vault secret values.

## Committed-image acceptance, 2026-10-29

Runtime source: `44028a54a79abd0389c7c072b34439602df5251b`.
Canonical image: `sha256:06edf941e8038f283b3b13b5a76fd61c79eae6abbf5a8b83908851fe6ed3f678`.
Go test stage from the same committed archive:
`sha256:ef3ee02cc0a3c16477d2e09656ddb29150e8d6e25443412cfa3b5307fcf04ded`.
The test-only helper was changed to take a pointer after focused lint identified
a large argument copy; the final integration suites exercise that exact source.

Receipts are local/ignored, relative to the main checkout. Reproduce the image
and integration gates with `node scripts/build-self-hosted.mjs --capabilities`.

- Canonical application pipeline: all 16 gates passed in
  `.cache/native-permission-authority/.cache/self-hosted-build-4fon0d/result.json`.
- Go unit/race: 597 passed, none skipped or failed. `go vet -tags integration
  ./...` passed. Receipt:
  `.cache/native-permission-authority/.cache/native-unit-vet.json`.
- Full Dragonfly Go integrations: 521 passed, zero failures, eight existing
  external-provider skips, no setup diagnostics:
  `.cache/native-permission-authority/.cache/go-proof-mRjjMA/result.json`.
- Packaged browser workflow: passed, including real setup, sign-in, project,
  secret, environment and recovery paths. Fixtures are labelled separately:
  `.cache/native-permission-authority/.cache/app-image-proof-KDkSJt/workflow-result.json`.
- Nine encrypted-recovery checks, eleven tenant-isolation checks and four proxy
  checks passed, with cleanup successful in each receipt:
  `.cache/native-permission-authority/.cache/encrypted-recovery-vDWDIB/result.json`,
  `.cache/native-permission-authority/.cache/tenant-isolation-DVnFZX/result.json`,
  `.cache/native-permission-authority/.cache/proxy-boundary-jp9N2N/result.json`.
- Admission: four checks per cache passed, cleanup successful:
  `.cache/native-permission-authority/.cache/production-admission-GWIGIy/result.json`
  (Redis) and `.cache/native-permission-authority/.cache/production-admission-uLPGJ2/result.json`
  (Dragonfly).

The first full Redis Go run failed during the permission package's disposable
application bootstrap with a timeout before any tests in that package ran.
Other packages reported 454 passes, no test failures and eight provider skips:
`.cache/native-permission-authority/.cache/go-proof-Lw5tYh/result.json`.
The cause remains unresolved. An isolated run of the complete permission package
against the same immutable images then passed all 67 entries with no diagnostics:
`.cache/native-permission-authority/.cache/go-proof-N0OB4V/result.json`.
No timeout, production code or assertion was relaxed. The complete same-image
Redis rerun then passed 521 entries, zero failures, eight existing provider skips
and no setup diagnostics:
`.cache/native-permission-authority/.cache/go-proof-pBYTBb/result.json`.
The earlier bootstrap failure remains an unresolved reliability finding; the
passing rerun is not a diagnosis or repair of it.

Full lint is **not clean**: both the baseline and candidate immutable Go images
report the same three existing `goimports` findings in `internal/database/redis/redis.go`,
`internal/ee/services/hsm/hsm.go` and `internal/libs/bootstrap/bootstrap.go`.
There are no findings in the changed permission source/test. Exact compared
output and normalized baseline-source identity are in
`.cache/native-permission-authority/.cache/lint-result.json`. These findings
remain open; no lint rule was suppressed and no whole-tree lint success is claimed.

The UI/API baseline remains 273 routes and 2,290 baseline operations. The existing
additional learning endpoint is retained. Source inventory and migration/capability
maps are reconciled without treating discovery as authorship. External-provider
skips, manual UI accessibility, live Nomen, physical-replica/failover acceptance,
native API cutover and public-cloud release gates remain open.
