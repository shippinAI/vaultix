# Native assumed-privilege authority

Workstream AUTH-01, prerequisite for READ-01. Scoped prerequisite accepted;
full feature migration remains open.

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
Canonical committed-image acceptance is recorded below.

## Final committed-image acceptance, 2026-10-29

Runtime/build source: `8a0ec825417efa7464be09323f74467d4f564906`.
Canonical image: `sha256:6254154ac8021ab382e6598fd41f1efcacd219bc94c9fd052f3e853e650a28a5`.
Go test stage from the same committed archive:
`sha256:4495c4b5662fac6c2f3c7ea561369d8d4716469d3f9832f8801a8042c9c5f2c2`.
Native forwarding remains disabled. The existing encrypted store is unchanged.

All receipts below are local and ignored, relative to the main checkout.

- All 16 canonical application gates passed:
  `.cache/native-assumed-authority/.cache/self-hosted-build-Z8WJ6a/result.json`.
- Native unit/race: 673 passed, zero failed/skipped; integration-tagged vet passed:
  `.cache/native-assumed-authority/.cache/native-unit-vet.json`.
- Full native lint with integration tags: zero issues, exit 0:
  `.cache/native-assumed-authority/.cache/lint-image-final.json`. The existing
  linter deprecation notice remains; no rule was disabled.
- Full native integrations: 653 passed, zero failures, eight existing external
  provider skips per cache, with no setup diagnostics. These include the 45-entry
  assumed-authority matrix, with real issuers in both directions. Dragonfly:
  `.cache/native-assumed-authority/.cache/go-proof-PVcp9F/result.json`; Redis:
  `.cache/native-assumed-authority/.cache/go-proof-qx0wiB/result.json`.
- Real packaged browser workflows passed: setup, sign-in, projects, secrets,
  environments and recovery. Injected UI fixture states remain separately labelled:
  `.cache/native-assumed-authority/.cache/app-image-proof-AAzJSj/workflow-result.json`.
- Nine encrypted recovery, eleven tenant isolation and four proxy boundary checks
  passed with successful cleanup:
  `.cache/native-assumed-authority/.cache/encrypted-recovery-hBYjsV/result.json`,
  `.cache/native-assumed-authority/.cache/tenant-isolation-vw666Y/result.json`, and
  `.cache/native-assumed-authority/.cache/proxy-boundary-cJ613X/result.json`.
- Admission passed four checks per cache with successful cleanup:
  `.cache/native-assumed-authority/.cache/production-admission-lgfTNC/result.json`
  (Dragonfly) and
  `.cache/native-assumed-authority/.cache/production-admission-AzoJE5/result.json`
  (Redis).

The 273 UI routes and 2,290 baseline API operations remain preserved. These are
surface checks, not behavioral evidence for every capability. The earlier Redis
package-bootstrap timeout in 0061 remains an unresolved reliability finding;
these passing runs do not diagnose it. Browser cookie deletion, nested assumption,
delegated OAuth, Nomen issuer/session ownership, native public API/audit ownership,
ElastiCache, physical replication/failover and public-cloud capacity remain open.
Automated checks do not establish manual assistive-technology acceptance,
whole-product parity or enterprise/government certification.

Reproduce application acceptance with `node scripts/build-self-hosted.mjs`.
Build the `go-builder` stage from that receipt's archived `source/core`, then run
`node scripts/test-go-core.mjs <canonical-image-id> <dragonfly|redis> <go-stage-id>`
for each cache. Unit/race, integration-tagged vet and lint use the same Go stage.
