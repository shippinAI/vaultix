# Native organization SSO enforcement

Workstream AUTH-01, prerequisite for READ-01. Acceptance is pending.

The native project permission service currently leaves SSO enforcement as a TODO.
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
with explicit test/source mounts. Final committed-image acceptance is pending.
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

Final acceptance requires the corrected committed archive/image, full lint and
both cache integration suites. Initial receipts remain at
`.cache/native-sso-policy/.cache/self-hosted-build-3l8mpQ/result.json`,
`.cache/native-sso-policy/.cache/go-proof-WKCATq/result.json`, and
`.cache/native-sso-policy/.cache/lint-image.json`. They do not establish acceptance
of the corrected artifact.
