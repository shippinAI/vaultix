# Project role refresh

AUTH-01 / native React permission consumers. Implementation and acceptance in progress.

## Work packet

Read `core/frontend/src/context/ProjectPermissionContext/ProjectPermissionContext.tsx`
and the permissions query contract. The hook uses the route project ID, falling
back to the organization's PAM project, and polls the existing permission API
every minute. CASL rules and memberships come from the same response. Keep this
query key, interval, focus behavior, ability evaluator and assumed-actor context.

The role callback currently captures the first memberships forever. Author it to
follow the current query result so role-based controls agree with refreshed
permissions. Preserve exact role matching across memberships and roles. UI role
checks are presentation controls; the server remains the authorization owner.
No API, schema, encrypted record, grant or audit format changes are required.

Consumers traced: audit retention, secret version retention, ignored detection
values, the legacy secrets upgrade, approval merge eligibility, certificate
navigation/admin-only pages, application creation/profile configuration and
certificate assignment. The certificate table has only been inspected around
its role predicate; this is not a full table review. Do not mark these consumers
authored or claim their complete workflow/provider acceptance from this hook fix.

## Acceptance plan

- Reproduce on source `4379096142d4d61135902fef59f38884448d020c`, canonical image
  `sha256:b228ed4142c08edeb00408ae77622a191ef5aa4baf5253ac64b90c8f1b6bc3a1`.
- Create a disposable identity and project membership using the real API. Sign
  in, assume that identity through the UI and keep a dirty version-retention
  form mounted while another authorized request changes its role.
- Observe the existing periodic permission refetch without mocked responses,
  query-cache injection, accelerated time or a document reload. Check revocation,
  retained unsaved input, restoration, and one explicit successful save.
- Prove a direct settings update under the revoked grant is denied by the API.
  Keep credentials and grant values in memory, outside evidence and screenshots.
- Verify a second page initially loaded as viewer responds to promotion, too.
- Run frontend type/lint/build checks and the committed standalone image gates;
  preserve the 273 UI / 2,290 API surface baseline. Record precise scope before
  merge/push and deploy only the accepted immutable image to local preview.

## Remaining work

Organization permission callbacks show a similar initial-membership capture and
use an infinite stale time. Their membership invalidation, navigation and actual
organization-role workflows need a separate review and acceptance; project polling
does not prove organization revocation. Other project consumers, group and custom
roles, expiry, query failure UX, manual accessibility, Nomen/session cutover and
native authorization/API ownership retain their existing gates. Existing paid-plan
copy in retention and unverified timing/performance claims in the legacy upgrade
UI also remain authorship work; this packet does not validate those claims.

## Baseline evidence

The unmodified canonical image above reproduces the problem. Its periodic
permission request returns HTTP 200 with a viewer membership in the same
document, but the version-retention input remains enabled. The expected-disabled
browser assertion fails. Receipts are
`.cache/assumed-workflow/.cache/role-characterization.json` and
`role-characterization-refresh.json` in the same directory. The disposable
database, cache, application and network were cleaned up successfully.

The callback now depends on the current memberships. Query/ability behavior and
server authorization are retained. Frontend type checking and production build
pass, with existing chunk/circular-dependency warnings. Scoped ESLint passes
after normalizing the touched file to LF. No rule or capability baseline changed.

Development acceptance passes with the rebuilt frontend mounted read-only into
the baseline image. All four real check groups pass: a dirty open form disables
after revocation; the same session's direct update returns 403 with a plain error;
a second document initially opened as viewer enables after promotion; the original
draft survives and one explicit save succeeds. Both role refreshes return 200 in
the same document. There are zero observed unexpected API responses or browser
errors. Cleanup passes. Receipts:
`.cache/assumed-workflow/.cache/role-development.json` and
`project-role-refresh.json` in that directory. These are source-mount results,
not committed-image acceptance.

The first development harness incorrectly paired the grant with the bootstrap
token, which belongs to another session. That did not exercise the assumed actor.
The corrected denial request uses the authorization header from the browser's
real permissions request and its grant cookie, both retained only in memory.
The failed harness receipt remains `role-development-session-fixture.json` in
the same evidence directory. No product authorization was weakened to pass it.

Committed-image acceptance remains pending.
