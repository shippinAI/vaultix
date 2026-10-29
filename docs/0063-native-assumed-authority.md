# Native assumed-privilege authority

Workstream AUTH-01, prerequisite for READ-01. Acceptance pending.

The existing application issues a one-hour signed grant in the
`vaultix-project-assume-privileges` cookie after checking the requester's
assume-member/identity permission and target project membership. Native middleware
validates the ordinary session first, then asks the native assume service to
verify the grant and recheck requester permission. Invalid grants emit a cookie-deletion header and continue as the ordinary authenticated requester; they must never
retain the target's authority. Project permission resolution selects the effective
actor only for the matching requester and project.

## Work packet

- Read the complete native assume service, options, tests, permission checker,
  middleware injection and project permission selector; trace existing TypeScript
  issuance, verification, cookie lifecycle and route authorization.
- Characterize missing/future/invalid lifetime and malformed grant scope with
  signed fixtures. These tests establish a validation boundary, not a claim that
  an unauthenticated attacker can forge a server signature.
- Validate supported target types, nonzero actor/session/organization IDs and
  nonempty project scope before authority work. Bind verification explicitly to
  the authenticated requester, as well as the current session and organization.
- Keep the existing one-hour grant format, HS256 signature, encrypted store,
  permission checks and cookie fallback behavior. Require issued-at/expiration
  and a positive lifetime no longer than the issuer's hour. Use the existing
  zero-leeway expiration behavior; synchronized clocks remain an operator gate.
- Resolve effective project authority without modifying caller arguments.
- Prove real application-issued grants through native session authentication,
  cookie injection and project permission resolution for member/identity targets.
  Exercise role/membership/SSO revocation, wrong requester/session/project/org,
  invalid grants, disabled injection and ordinary-requester fallback. Explicitly
  label copied-database and signed-claim fixtures; never expose cookie/token values.
- Build the committed standalone image, run native unit/race/vet/lint and both
  cache integration suites, preserve packaged UI/API/recovery gates, then record
  exact hashes, reconcile reviews/maps and commit/push accepted changes.

No new public federation, credential collection, API, schema, second store or
native forwarding cutover is part of this prerequisite. The TypeScript endpoint
remains the current HTTP/audit owner. Nomen issuer/session acceptance, delegated
OAuth, complete native domains and public-cloud capacity/failover remain separate
gates. Passing grant tests does not establish complete authentication parity.

## Focused characterization and implementation

The unchanged service accepted all 12 malformed signed-claim fixtures; the valid
control also passed. The baseline has 13 failed entries including its parent,
not 13 distinct vulnerabilities. Receipt:
`.cache/native-assumed-authority/.cache/claims-baseline.json`.
The new policy rejects those fixtures before permission lookup and preserves the
valid control. Requester/session binding and missing trusted context have their
own unit cases. Native issuance rejects invalid target/scope inputs before
permission work. Database and cancellation failures during target lookup remain
operational failures rather than being misreported as missing membership.

The unchanged project resolver failed the 41-entry initial integration matrix,
including every valid-before-mutation assertion, because it modified caller actor
arguments. That receipt is
`.cache/native-assumed-authority/.cache/integration-baseline.json`. The corrected
resolver copies arguments before selecting an assumed actor. The expanded matrix
adds real Go-issued grants consumed by the existing application: project member
listing is allowed for the administrator, then denied with the no-access member
or identity grant. The reverse direction uses actual application-issued cookies
with native authentication, injection and project permission services. The native
HTTP probe is explicitly test-only; no production forwarding route is enabled.

Development proof uses canonical issuer image
`sha256:21eb31834d2f319b8ca4f58cf27af2c41d0401016fe38f13426a7a86fbf2f169`
and Go stage `sha256:24807440a627cecf482bea7600ceeae461c10d4751d2331fa6ed12745a97a801`
with explicit source/test mounts. Claims are signed fixtures only for malformed
cases; ordinary interoperability uses real issuers. Role/membership/tenant/SSO
mutations use copied PostgreSQL schemas without constraints. The revoked-session
case changes and restores only the disposable issuer database's access version;
it does not exercise a logout UI or Nomen. Secret values are never read by the
permission probes, and token/cookie values are not included in receipts.

Cookie clearing assertions inspect response headers. Browser deletion across
HTTP/HTTPS and the existing TypeScript cookie-path configuration still need
separate workflow acceptance. Nested assumption semantics, delegated OAuth,
issuer transition and native public API/audit ownership remain open; this packet
does not declare the full assumed-privilege feature migrated or Nomen live.

The final development matrix passes 45 integration entries with zero failures or
setup diagnostics; its additional four entries were not in the baseline run.
Receipt: `.cache/native-assumed-authority/.cache/integration-candidate.json`.
Focused native unit/race checks pass 346 entries across assume privilege,
authentication and permission packages:
`.cache/native-assumed-authority/.cache/native-focused.json`. Development full
lint passes with zero findings in
`.cache/native-assumed-authority/.cache/lint-development.json`; the snapshot
normalizes Go line endings exactly as the corrected committed archive does.
Canonical committed-image acceptance remains pending.
