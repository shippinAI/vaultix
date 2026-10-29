# Native project permission authority

Workstream: AUTH-01, prerequisite for READ-01 in 0027. Acceptance is pending.

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
including the parent groups, eight injected primary-query failures, cancellation
and recovery controls. Receipt:
`.cache/native-permission-authority/.cache/candidate.json`. It uses canonical
issuer image `sha256:b61bdb91968bd442a29455e694952d2888a9aa88f3cdbfd1b13410ff735c3b67`
and Go test image `sha256:5098cbb6accf316e94159400647d8b8c0905b78cf11e2f1fcb632035663d5ce2`
with the explicit new test/source files mounted. The baseline runner permission
source matches the starting source after line-ending normalization. These are
focused development results; final committed-image acceptance remains pending.

The matrix includes user/identity direct and group membership removal, role
downgrade, a shortened temporary grant, custom-role rules, additional privileges,
name/metadata template conditions, project tenant/type/deletion, and service
scope/permission removal. Schema copies omit constraints and mutation fixtures
do not establish the corresponding management API behavior. No secret values
are selected by this permission suite.
