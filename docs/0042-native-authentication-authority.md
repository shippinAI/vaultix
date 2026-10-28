# Native authentication reads authoritative state

Status: scoped local acceptance passed, 2026-10-28. Workstream: AUTH-01.
Preceding packets: [0040](0040-native-identity-lifetime-policy.md) and
[0041](0041-publication-history.md).

## Read and trace

The baseline native authenticator sent eight security decisions to `Replica()`:
session version, user acceptance/lock, organization hierarchy, project tenant,
legacy identity token state, service token state, effective membership and trusted
IP configuration. Scoped revocation already reads the primary. `pg.DB.Replica()`
chooses a configured replica and falls back to the primary only when none exist.
Single-database tests therefore cannot demonstrate behavior under replication lag.

The TypeScript trusted-IP DAL already explicitly uses the primary. Other issuer
paths still use replica-backed session, membership or generic ORM reads; these
remain separate compatibility/authority work. This packet must not claim that
all existing HTTP authentication is authoritative or that Nomen owns sessions.
The native membership query also differs from the issuer's explicit direct-first
lookup; mixed direct/group policy needs its own characterization before changing
membership precedence. Legacy subject/row binding remains another open question.

## Acceptance plan

1. Reproduce valid-before-change and denied-after-change behavior against actual
   PostgreSQL pools. A separate schema containing a frozen copy of only the
   disposable fixture's authentication tables models stale replica state. This
   is an explicit stale-state fixture, not a physical replication topology test.
2. Exercise user session invalidation, locks/acceptance, memberships, organization
   hierarchy, legacy identity state, trusted IP changes and service token/project
   resolution. Keep valid controls and group-based membership; do not modify
   operator data, clocks or existing development sessions.
3. Make native authentication consult the primary for its security authority.
   Preserve its validation/authorization and existing error contracts. A primary
   failure must fail closed without falling back to an available stale replica.
4. Verify positive and denied paths through native entry points, applicable real
   issuer API controls, unit/race/lint checks and both cache integration suites.
   Build the canonical image and run real packaged application acceptance.
5. Record exact baseline and repaired evidence, scope/performance tradeoffs and
   remaining gates; commit/push and update local dev only after acceptance.

Primary reads increase authority-query load. This change does not make multiple
authentication queries one serializable transaction, retroactively cancel an
in-flight authorized request, or establish provider/high-availability acceptance.
No new database store, schema migration, forwarding layer or identity runtime is
planned. Physical replicas, Nomen, native cutover and enterprise parity remain
separate gates.

## Publication follow-through

The corrected 0041 script passed real read-only preflight and then published
`5b6953074cbd623075a5a5e55fb4ee0aadb29f4c`, including its preceding tooling commit,
with an ordinary explicit-SHA push. `.cache/publication-live-preflight-final.log`
and `.cache/publication-live-push.log` record the actual execution. This is source
publication evidence; the account Actions blocker is not resolved by that push.

## Baseline findings

The first two attempts stopped in fixture setup: `CreateProject` returned 422.
The helper truncates its generated slug at 36 characters, which cut this fixture's
UUID immediately after a hyphen. The installed slug normalizer rejected that
trailing hyphen. The fixture now uses a short unique project name. These setup
failures are not authority evidence; the helper's general truncation behavior
remains a separately scoped follow-up.

With setup corrected, `.cache/authority-baseline-ready.json` records 29 stale-state
validations that still allowed access. Session invalidation and service-token
deletion performed no primary reads; the new identity path read revocation on
the primary but membership and trusted IPs on the stale pool. All valid controls
passed before mutation. The 90 failing test entries include parent tests and
the failure/group matrix; they are not 90 independent production defects.
Additional primary-only denial controls were then added to distinguish the stale
pool outcome from validation against fresh state.

Production changes are confined to the eight native authentication query sites:
they now use `Primary()` and retain their existing error/validation handling.
The database interface, membership precedence, actor/tenant claims and public
routes are unchanged. These checks do not enable native request forwarding or
change the current issuer's ownership.

## Verification

The controlled unchanged baseline is `.cache/authority-baseline-controlled.json`:
runner `dd2fbdbacf0329db6d4935b7b4d0910cc143215592f93ed7a6d34bade048dee7`
against the accepted 0040 issuer image. Primary-only changed-state controls deny;
all 29 frozen-replica comparisons still allow. The repaired focused runner
`2ce0c4ef18a13f0828273dcfc9926370f64eb4f70a8e9fa7034059b6a1822f6a`
passes all 90 tests in `.cache/authority-candidate.json`, including group-only
membership removal/deactivation and injected primary failures at every checked
read position. No frozen-replica comparison remains allowed.

The final test source additionally covers sub-organization ancestry changes and
service-project tenant resolution. User, machine and service credentials originate
from actual isolated issuer operations; legacy-format and sub-organization claims
are explicitly signed fixtures. Schema copies omit constraints and model only
read authority. They do not prove real replication, group-management APIs or a
new Nomen login. Primary-only controls and unchanged valid controls distinguish
read routing from membership-policy changes.

The canonical candidate is
`sha256:a2230460955fa8e863484dd3efa3832ec9759d608bb7a3f43485f97efcf533c6`;
the final Go test snapshot is
`sha256:c50a882a07d81cc76a1026a3741ab02fe80d6d826d385a50fdd03f6c244a37d6`.
All 597 Go unit/race tests pass (`.cache/authority-go-unit.jsonl`), and final
native lint reports zero issues (`.cache/authority-go-lint-complete.log`).
Initial lint caught an omitted explicit nil dependency and a large value receiver
in the fixture; both were corrected. No issuer, UI, schema or encrypted-store
source changed in this packet. Full integration and packaged image results follow.

The first full Dragonfly run (`.cache/go-proof-YAhJWL/result.json`) passed 343
tests with eight provider skips, but the permission package failed during
bootstrap with a timeout before its tests ran. The cause remains unknown. No
timeout was raised and no production change was made in response. An isolated
permission run passed all 21 tests (`.cache/go-proof-qTT5Tt/result.json`), and the
complete same-image/same-runner rerun passed all 364 tests with eight external-KMS
skips and no setup diagnostics (`.cache/go-proof-wuhCU6/result.json`). This final
run includes the ancestry and project-tenant tests added after the focused proof.
The full Redis run also passed 364 tests with eight external-KMS skips and no
setup diagnostics (`.cache/go-proof-1lgUPf/result.json`). Both final suites use
the exact canonical candidate and frozen Go test snapshot identified above.

The canonical Dragonfly smoke/restart run passed
(`.cache/authority-image-dragonfly.log`). Its real packaged browser proof
(`.cache/app-image-proof-vLGe70/workflow-result.json`) includes email sign-in,
loaded product categories, real project creation and a completed overview
response, authenticated navigation, denied anonymous access and Vaultix branding.
The project metadata report confirms a 200 response for the created project,
rendered empty state, enabled Add Secret control and removal of the loading
table. The completed project screenshot was visually inspected. Recovery/chart
fixtures remain separately labelled within that runner; this is not whole-UI,
Nomen or enterprise-provider acceptance. Source and image checks retain all 273
UI routes and 2,290 API operations, without recapturing the capability baseline.
The Redis canonical-image smoke/restart suite also passed
(`.cache/authority-image-redis.log`), including its packaged API error contract
checks (`.cache/api-error-proof-2mnBGA`); Dragonfly error evidence is
`.cache/api-error-proof-kwxPRg`. Redis did not repeat the unchanged browser suite.
The owned-source check passed. These local results permit promotion of this
artifact to local development; source publication and actual rollout outcomes
must still be recorded separately from the test result.

The existing GitHub CLI session is authenticated but its reported scopes omit
`write:packages`; metadata-only inspection is recorded in
`.cache/registry-publish-capability.json`. No credential material was read or
authentication changed. This does not establish whether another authorized
publisher exists. GitHub Actions billing remains a separate publication blocker.
