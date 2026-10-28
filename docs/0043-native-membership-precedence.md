# Native direct-membership precedence

Status: scoped local acceptance passed, 2026-10-28. Workstream: AUTH-01.

## Publication and local development

The preceding authority repair was committed and pushed as
`8e0fe6afd488b13e192cc0a50703745d2deeaeab`. The repaired publication script
completed an ordinary non-force push (`.cache/authority-live-push.log`). Local
development now runs canonical image
`sha256:a2230460955fa8e863484dd3efa3832ec9759d608bb7a3f43485f97efcf533c6`.
The backend is healthy; UI port 3000 and API status port 8200 return 200. Database
and cache container identities match the pre-rollout record. This local rollout
does not establish GHCR publication or WI/TX deployment.

## Trace and acceptance plan

The native authenticator combines direct and group organization memberships with
an OR predicate and LIMIT 1, without precedence. Its comment claiming an exact
port is inaccurate: the existing issuer's `orgDAL.findEffectiveOrgMembership`
first queries a matching direct row, then falls back to effective memberships.
Both filter scope, organization and accepted-or-null status. An inactive direct
row is still a matching row and is rejected by the validators; an active group
must not override it. Conversely, an inactive group must not override an active
direct membership. Status filtering occurs before direct precedence.

1. Characterize both actor types and dedicated/unified validation entry points
   against isolated PostgreSQL schema copies. Include current and legacy identity
   token formats, valid controls, conflicting activity states, null/invited
   statuses, wrong scope/tenant, missing memberships and unrelated group links.
2. Insert group rows before direct rows to expose the unordered native query.
   Record observed outcomes; insertion order is not a portable SQL guarantee.
   These fixtures model lookup policy, not group-management API acceptance.
3. Match direct-first semantics without ranking by activity or inventing a new
   multiple-group policy. Keep one primary query, existing errors and scope/status
   filters. Do not change role aggregation, issuer logic, ciphertext or schema.
4. Verify native regression, unit/race/lint, complete cache integration suites,
   canonical image and real application flow before commit/promotion. Trace an
   actual issuer membership lifecycle where possible, keeping fixture evidence
   distinct from real operations.

Only relevant issuer excerpts have been traced for this packet. They do not
receive whole-file review credit. The existing multiple-group fallback has no
explicit ordering on either side and remains separate policy work. Nomen, issuer
replica reads, legacy subject/row binding and native request cutover remain open.

## Baseline and implementation

The unchanged native validator produced 24 decisions contrary to the issuer's
direct-first policy: 12 accepted inactive direct memberships and 12 rejected
active direct memberships. All 78 cases reached validation and initial valid
controls passed. The baseline reports 72 passing and 33 failing test entries;
the failures include parent tests and are not 33 independent defects.
Evidence: `.cache/membership-baseline.json`, frozen runner
`sha256:c23c3fac6c498229892d2b83d86a8a36ac65c1cf3b0fcf3cd6eb23a82cd8fe63`
against the accepted 0042 application image. No setup diagnostics were reported.

The query now explicitly gives a matching direct row priority after the existing
scope and status filters. It does not sort by activity, query a replica, add a
second database call or change the authorization error. Ranking group rows as
equal leaves their relative order unspecified; multiple-group policy and
production query-plan/load acceptance remain separate work. This acceptance does
not enable native request forwarding or change session ownership.

The source publication's GHCR run `40631201870` did not execute any checks:
GitHub reports the same account payment/spending-limit block. Its panel and engine
jobs were skipped. `.cache/authority-github-blocker.json` retains the annotation;
`.cache/authority-dev-rollout.json` separately records the healthy local rollout.
An authorized direct push of that already accepted image to commit-specific
`ghcr.io/shippinai/vaultix:dev-8e0fe6a` was also attempted using Docker's existing
registry authentication. It failed resolving GHCR before a successful publication
was reported (`.cache/authority-direct-push.log`). This attempt does not prove
whether the existing registry login has package-write permission. No shared
release tag was selected.
After DNS recovered, one direct-push retry reached GHCR and returned
`unauthorized` (`.cache/authority-direct-push-retry.log`), with no published
manifest digest. Existing Docker authentication therefore did not authorize
this publication. No credentials were read, copied or changed. An authorized
registry login or restored Actions service is still required for publication.

## Verification and fixture correction

The repaired focused matrix passes 105 test entries and all 78 validation
comparisons (`.cache/membership-candidate.json`, runner
`sha256:c6a65e04e082acc67337cfb74a4aad8ade0a4d610f293022c83b6256932f011c`).
Go unit/race checks pass all 597 tests (`.cache/membership-go-unit.jsonl`).

An additional user lifecycle test uses real invitation, group creation/linking,
deactivation and reactivation APIs. User acceptance and the test session/JWT are
explicit setup fixtures, not proof of sign-in. Its first run failed all three
HTTP state probes with 400. The native parsing struct used for signing serialized
an absent optional sub-organization as the zero UUID. The issuer treats that
nonempty string as a requested sub-organization and rejects it before membership
validation. The fixture now signs an explicit payload that omits that claim;
production claim parsing and issuer behavior were not changed. Initial outcomes
and numeric-only diagnostics are retained in `.cache/membership-lifecycle.json`
and `.cache/membership-lifecycle-diagnostics.json`.

Two builder attempts failed resolving Docker Hub before compilation. A local
runner derived from the already frozen candidate allowed independent verification
to continue; it is not a canonical release image. The canonical build later
succeeded without changing global Docker/network settings. A lint attempt also
failed downloading its tool; the existing workspace copy of pinned golangci-lint
2.15.0 was mounted read-only instead. Final `make lint` reports zero issues
(`.cache/membership-go-lint-final.log`). Source runner and final image identities,
full cache acceptance and corrected lifecycle evidence follow below.

The corrected lifecycle passes all four entries in
`.cache/membership-lifecycle-corrected.json`: initial, deactivated and reactivated
states plus their parent test. Real API group linking remains active throughout;
HTTP access returns 200, 403, then 200, and both native user entry points agree.
This verifies user membership operations with the explicit session fixture, not
Nomen, browser sign-in or the machine-identity lifecycle API.

Final canonical image:
`sha256:29d86c909dd895021f9de0c8e121ac0e883743150402857e629ffe93feb283dd`.
Final test source snapshot:
`sha256:92014b64e85a2bc8a595bd4dca7d6cfb02f8789aed421b09afec07094072fec3`.
The 597 unit/race checks used the preceding local runner; only the later fixture
payload changed. The complete 141-file internal/cmd/module-input comparison
matches between those runners (`.cache/membership-production-source-comparison.json`),
including the authenticator and its unit tests. Full integration runs use the
final canonical image and final test snapshot together.

The complete Dragonfly integration/race run passes 473 tests with eight explicit
external-KMS skips and no setup diagnostics (`.cache/go-proof-bNqRaC/result.json`).
This includes the entire authority matrix, direct-precedence matrix and corrected
user lifecycle test. The complete Redis run also passes 473 tests with eight
external-KMS skips and no setup diagnostics (`.cache/go-proof-x2Dwce/result.json`).
Both runs use the final image and test snapshot.

Dragonfly canonical-image smoke/restart checks pass
(`.cache/membership-image-dragonfly.log`), including the API error contract
(`.cache/api-error-proof-8kyQDV`). Real packaged browser acceptance passes
(`.cache/app-image-proof-UAkQBx/workflow-result.json`) with completed project
loading, email sign-in, navigation and denied anonymous access. Its project
screenshot was inspected; recovery and chart fixtures remain separately labelled
by the existing runner. The unchanged capability baseline still contains 273 UI
routes and 2,290 API operations. The owned-source check also passes.
Redis image/queue/restart and API error checks also pass
(`.cache/membership-image-redis.log`, `.cache/api-error-proof-Eb3PEL`). The
unchanged browser workflow was not repeated for Redis. These results permit
promotion of this exact image to local development; actual source publication
and local rollout outcomes are recorded separately after execution.
