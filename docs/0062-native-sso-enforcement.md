# Native organization SSO enforcement

Status: scoped local acceptance passed. Workstream AUTH-01, prerequisite for
READ-01. Provider/issuer acceptance and native cutover remain incomplete.

At the start of this work, the native project permission service left SSO
enforcement as a TODO.
The existing TypeScript policy checks the authenticated user's method on every
request. SAML/OIDC enforcement and Google enforcement are separate requirements;
when both are set, both apply unless an explicitly permitted bypass applies.
Machine identities and service tokens keep their separate authentication policy.

## Work packet

- Read the complete native permission service, its secret/assumed-privilege
  callers, existing TypeScript enforcement/bypass/role construction, permission
  DAL joins and CASL's subject-type matching behavior before authoring the change.
- Use primary-backed project policy and organization role reads. A bypass requires
  the organization's bypass switch and an active organization-level
  `bypass-sso-enforcement` permission. Project administration is insufficient.
  Root-organization roles govern the bypass for sub-organizations, as today.
- Preserve direct/group/custom roles, additional and temporary privileges,
  deny precedence, and the existing CASL subject-type query semantics. Compare
  authored policy vectors against the installed TypeScript CASL implementation.
  Invalid role encodings must fail closed without logging their contents.
- Prove valid and denied methods, switch/role revocation, root/group policy,
  stale replicas, primary failure and machine/service compatibility against
  disposable PostgreSQL. Fixture method labels are not provider sign-in proof.
- Build the canonical committed image, run unit/race/vet and both cache
  integration suites, preserve real packaged UI/API/recovery checks, then record
  exact evidence and commit/push accepted source.

## Authority and compatibility

No new API, user registration, federation wizard, session owner, schema, encrypted
store or feature entitlement is introduced. The native query uses organization
memberships only while active; disabled memberships cannot grant an SSO bypass.
The existing TypeScript DAL does not filter that flag in its permission join;
this stronger native revocation boundary is intentional and needs denial proof.

Native request actors carry a string authentication method from verified identity.
They do not represent the TypeScript internal-job `null` exemption. Empty methods
remain compatible when enforcement is off; when enforcement is on they fail
closed even for an administrator. No missing JWT field becomes a trusted internal
job exemption. Existing TypeScript routes and login stay in place.

Nomen issuer/session acceptance, real SAML/Google/OIDC providers, delegated OAuth
scope parity, complete assumed-privilege policy, physical replication, all native
domain cutover and public-cloud readiness remain separate gates. This change
must not enable the commented native forwarding routes or claim complete parity.

## Focused characterization

The unchanged native service failed 52 test entries (including parent groups)
in the initial valid-fixture method/bypass/revocation matrix, with 31 passing.
The expanded candidate passes 87 entries with zero failures or setup diagnostics,
including an actual issuer email session validated by the native authenticator.
Receipts are `.cache/native-sso-policy/.cache/baseline.json` and
`.cache/native-sso-policy/.cache/candidate.json`. The baseline preceded three
added bypass/group cases and the real-session test; counts are not a one-to-one
differential or a count of separate vulnerabilities. Initial invalid-role fixture
attempts were rejected by PostgreSQL; the accepted fixture uses valid JSON with
an invalid rule shape so the authorization code is exercised.

The focused runs use the previous canonical issuer image
`sha256:06edf941e8038f283b3b13b5a76fd61c79eae6abbf5a8b83908851fe6ed3f678`
and Go stage `sha256:ef3ee02cc0a3c16477d2e09656ddb29150e8d6e25443412cfa3b5307fcf04ded`
with explicit test/source mounts. Final committed-image acceptance is recorded below.
The 22 shared bypass vectors agree with the installed CASL implementation.
A 15-second, two-worker parser fuzz run passed 815,876 executions. Fixtures use
copied schemas without constraints and do not prove management API behavior,
physical replication or real external SSO provider sign-in.

## Canonical archive correction

The first committed SSO image from `5c4916c23badd2d17954e5427d3bc6a23f219ed9`
passed all 16 application gates, 636 Go unit/race entries, vet and 608 Dragonfly
integration entries (eight external-provider skips). It still reported the same
three `goimports` findings previously recorded in 0061. Investigation compared
exact file bytes: the Git blobs and worktree use LF, while `git archive` under
Windows `core.autocrlf=true` emits CRLF. The three image files match the archive
and differ from the blobs only by those line endings. No domain-code formatting
change or lint suppression is necessary.

The build now sets `core.autocrlf=false` and `core.eol=lf` for its archive command
only. Operator/global Git settings are unchanged. The new orchestration case uses
real Git with Windows line-ending settings and asserts extracted source bytes.
It fails before the change and passes afterward; all 15 orchestration fixtures
pass in `.cache/native-sso-policy/.cache/self-hosted-fixtures-tYqIC9/result.json`.
The failing baseline is retained in
`.cache/native-sso-policy/.cache/archive-regression.txt`; the direct comparison is
`.cache/native-sso-policy/.cache/archive-eol-yu1jj3b5/result.json`.

Acceptance of the archive correction requires the corrected committed image,
full lint and both cache integration suites, recorded below. Initial receipts remain at
`.cache/native-sso-policy/.cache/self-hosted-build-3l8mpQ/result.json`,
`.cache/native-sso-policy/.cache/go-proof-WKCATq/result.json`, and
`.cache/native-sso-policy/.cache/lint-image.json`. They do not establish acceptance
of the corrected artifact.

## Final committed-image acceptance, 2026-10-29

Runtime/build source: `63f58e8d5c6200ed04e823aecd9630634292c888`.
Canonical image: `sha256:21eb31834d2f319b8ca4f58cf27af2c41d0401016fe38f13426a7a86fbf2f169`.
Go test stage built from that same corrected committed archive:
`sha256:24807440a627cecf482bea7600ceeae461c10d4751d2331fa6ed12745a97a801`.
No production forwarding, external provider or issuer configuration was enabled.

All receipts below are local and ignored, relative to the main checkout.

- All 16 canonical application gates passed:
  `.cache/native-sso-policy/.cache/self-hosted-build-JXWygI/result.json`.
- Go unit/race: 636 passed, none failed/skipped. Integration-tagged vet passed:
  `.cache/native-sso-policy/.cache/native-unit-vet.json`.
- Full lint with integration build tags: exit 0, zero issues:
  `.cache/native-sso-policy/.cache/lint-image-final.json`. The linter still emits
  its existing deprecation notice; no rule was disabled. This resolves the three
  archived-file formatting findings recorded in 0061 for the corrected artifact.
- Full Go integrations: 608 passed, zero failures, eight existing external-provider
  skips per cache, with no setup diagnostics. Dragonfly:
  `.cache/native-sso-policy/.cache/go-proof-gCMrmS/result.json`; Redis:
  `.cache/native-sso-policy/.cache/go-proof-j8tVmu/result.json`.
- Parser fuzzing: 15 seconds, two workers, 810,708 executions, passed:
  `.cache/native-sso-policy/.cache/fuzz-final.json`.
- All 22 shared bypass vectors agree with the canonical image's installed CASL:
  `.cache/native-sso-policy/.cache/casl-image-final.json`. The comparison script
  and fixtures are mounted read-only; this is an explicit comparison, not an
  automatically registered application gate or a full organization-role proof.
- Real packaged browser workflows passed, including setup, sign-in, projects,
  secrets, environments and recovery. Fixture-only UI states remain labelled:
  `.cache/native-sso-policy/.cache/app-image-proof-ODg8jv/workflow-result.json`.
- Nine encrypted recovery, eleven tenant isolation and four proxy boundary checks
  passed, with successful cleanup:
  `.cache/native-sso-policy/.cache/encrypted-recovery-rqd9dO/result.json`,
  `.cache/native-sso-policy/.cache/tenant-isolation-j35CT9/result.json`, and
  `.cache/native-sso-policy/.cache/proxy-boundary-vv019G/result.json`.
- Admission passed four checks per cache, with successful cleanup:
  `.cache/native-sso-policy/.cache/production-admission-PYMOac/result.json`
  (Dragonfly) and
  `.cache/native-sso-policy/.cache/production-admission-6s0vV2/result.json` (Redis).

The existing 273 UI routes and 2,290 baseline API operations remain preserved.
The earlier Redis package-bootstrap timeout in 0061 remains an unresolved
reliability finding; this packet's passing runs do not diagnose or repair it.
Automated browser checks do not establish manual screen-reader acceptance or
whole-UI accessibility. Nomen issuer/session acceptance, real SSO providers,
assumed privileges, delegated OAuth, physical replication/failover, ElastiCache,
complete native domain ownership, capacity and public-cloud release remain
separate gates. No enterprise/government certification or full parity is claimed.

Reproduce application acceptance with `node scripts/build-self-hosted.mjs`.
Build its `go-builder` stage from the receipt's archived `source/core`, then run
`node scripts/test-go-core.mjs <canonical-image-id> <dragonfly|redis> <go-stage-id>`
for each cache. The shared policy comparison is
`node scripts/test-sso-policy-parity.mjs [backend-package-json]`; native unit/race,
fuzz, integration-tagged vet and lint use the same Go stage.
