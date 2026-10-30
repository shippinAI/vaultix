# Device session renewal and recovery

2026-10-29. This packet continues [headless login](0067-headless-ai-login.md)
in the root Go CLI. The server's actor, organization and permission checks are
unchanged. It does not establish live Nomen sign-in or public-cloud readiness.

## Session behavior

Device login retains the approved issuer, public client ID, discovered token
endpoint, access expiry and optional refresh token in the selected credential
store. Login still verifies protected project access before saving anything.
The CLI requests `openid profile email offline_access`; `--scope` can select
the public client's registered scopes. The issuer decides whether to grant
offline access. No client secret is requested. Existing no-refresh sessions
remain usable until expiry and then require another login.

Saved sessions renew near expiry, with a margin of ten percent of their
remaining initial lifetime, capped at thirty seconds. The pinned endpoint is
used without rediscovery or environment overrides. HTTPS cannot downgrade to
HTTP; literal loopback HTTP remains available for local tests. Responses and
timeouts are bounded; redirects and reflected provider errors are rejected.
A returned refresh token replaces the previous one; if omitted, the current
token is retained as specified by [RFC 6749 section 6](https://www.rfc-editor.org/rfc/rfc6749#section-6).
The refreshed access token must pass protected Vaultix project access before
it can replace the saved session. No secret-value or encrypted-store read occurs.

CLI calls and the existing stdio MCP use the same session lifecycle. The MCP
catalog and server authorization remain the source of available actions.
External `VAULTIX_TOKEN` and `VAULTIX_TOKEN_FILE` overrides are read-only and
never refreshed, even if they contain a serialized Nomen credential. API
binding prevents reuse against another instance.

## Rotation, concurrency and interruption

Saved login, local logout and refresh writes share an operating-system lock.
For the OS keyring it is per OS user, independent of `VAULTIX_HOME`, matching
the existing single-account credential slot. For a private POSIX credential
file it is beside that file. Lock files contain no credentials, remain on disk,
reject symlinks/non-private POSIX paths and are never deleted to resolve a
wait. Windows uses `LockFileEx`; supported POSIX systems use `flock`.
Waits are cancellable and bounded to forty-five seconds. The operating system
releases locks when a process exits. Windows continues to use Credential Manager;
mode bits are not used as Windows credential-file privacy evidence.

Stop older CLI/MCP processes before upgrading a shared credential store: older
binaries do not participate in the rotation lock. Processes sharing the keyring
must also use the same OS user configuration directory for the lock. Separate
`VAULTIX_HOME` values do not create separate keyring accounts.

The lock holder re-reads the credential after waiting. A prior logout or
replacement cannot be overwritten by a stale renewal. Before contacting the
issuer, it persists a pending-renewal marker. POSIX writes sync both the file
and its directory entry. An interrupted request, rejected grant, invalid
response or failed protected-access check leaves the session unavailable and
asks the human to sign in again. A failed replacement is also reported; the
pending marker blocks reuse of the old grant if the replacement did not land.
It never automatically
replays a possibly consumed refresh token. This favors safe recovery over
transparent retries during an outage. Successful renewal clears the marker
only when the replacement is persisted. Logout removes the selected local
credential; it still does not claim issuer logout or revocation.

The issuer must enforce its public-client refresh policy, including rotation
or sender-constrained tokens and replay detection, as described in
[RFC 9700 section 4.14](https://www.rfc-editor.org/rfc/rfc9700#section-4.14).
Client-side locking is not a substitute for issuer-side enforcement. This
implementation does not add DPoP, mTLS or a new identity runtime.

## Acceptance boundaries

Unit tests exercise refresh replacement/omission, denied and ambiguous responses,
TLS/redirect/cancellation denial, API and issuer binding, private storage,
concurrent rotation, logout/replacement races, pending-state recovery and short
lifetimes. Real child processes exercise Windows and Linux lock exclusion.
Process-death tests also verify lock release. Windows renewal tests use the
keyring library's memory fixture; they do not
establish live Credential Manager persistence. Existing Linux race tests cover
the actual private credential-file path.

The expanded `scripts/test-cli-headless.mjs` runs a clearly labelled loopback
issuer fixture only inside its disposable application container. Real Vaultix
APIs provision its access tokens and enforce projects, references and revocation.
Four independent CLI processes must consume the fixture refresh token once;
the renewed MCP must read authorized references without values; rejected renewal
must not replay. One expired-session state is explicitly staged for failure
testing. No real Nomen registration, browser approval or identity mapping is
inferred from this fixture. Test secrets never enter public receipts.

The actual Nomen integration still needs a registered public device/refresh
client, audience and subject mapping to existing Vaultix membership, real human
approval, logout/revocation and tenant-isolation acceptance. Current core token
verification expects Vaultix-signed application tokens; it does not accept an
external Nomen access token merely because device authorization succeeded.
Those requirements must be implemented without trusting email claims as account
links or weakening the existing authorization boundary.

## Accepted artifacts

Engine source: `2e204ce752a21647ecd052d71fee9c29d39007aa`. CLI source: `30c06fe11c563d5ab48953da28a49e9b1ed0c709`. Canonical standalone image:
`sha256:5224eaea3727f59898203434749ddbda1e19b4c50a1a0137894731861915efdf`.

- 101 Linux root Go unit/race checks passed with no test failures or skips;
  Windows vet passed. Receipt: `.cache/headless-ai-login/.cache/nomen-renewal-unit-build.json`.
- 88 targeted Windows checks passed, with 4 explicit POSIX-only skips.
  Receipts: `.cache/headless-ai-login/.cache/nomen-renewal-windows-tests.jsonl` and
  `.cache/headless-ai-login/.cache/nomen-renewal-windows-storage.jsonl`.
  The unrelated existing Windows encrypted-store mode-bit test still fails;
  it was not changed or suppressed. The full root suite passed on Linux.
- All 16 canonical build/application gates passed:
  `.cache/headless-ai-login/.cache/self-hosted-build-34K89D/result.json`.
- All 12 committed CLI/image integration checks passed and disposable resources
  were cleaned up: `.cache/headless-ai-login/.cache/cli-headless-A5JhpU/result.json`.
- Committed-source Windows/Linux amd64 artifacts:
  `.cache/headless-ai-login/.cache/cli-build-VDpdVM/result.json`.
  Linux SHA-256: `5a2da0a1afc80b089174c45f0bd9a92c44b456df80ed1e73fb19499799821b99`.
  Windows SHA-256: `4b5ae177052979b47029d1fa63b2d2502647b65433f715ce257da861fa90601e`.

The final CLI-only correction includes the stored newline in its 64 KiB limit.
The Linux private-store race tests additionally prove rejection at 65,536 bytes
and round-trip success at 65,535 bytes. Receipt:
`.cache/headless-ai-login/.cache/nomen-renewal-boundary-tests.jsonl`.

The standalone engine and root CLI remain separate artifacts. This packet
changes no `core/` application source or database schema. Earlier 0067 image
evidence remains historical; the accepted image above was rebuilt with the
current committed-source revision. No GitHub Actions or registry build was used.

## Next server integration package

The implementation trace found two distinct existing boundaries. The TS
`server/plugins/auth/inject-identity.ts` and Go
`services/auth/apiauth/authenticator.go` verify application tokens and existing
user sessions; the Go path also checks account locks and active organization
membership. The existing browser OIDC service in
`core/backend/src/ee/services/oidc/oidc-config-service.ts` uses a configured
confidential client and looks up aliases by external subject, organization and
OIDC alias type. That browser flow is not a public-device access-token verifier.
These were dependency traces, not whole-module authorship acceptance.

Before native Nomen access is enabled:

1. Define the trusted issuer, intended API audience, public CLI registration and
   token format/revocation contract. Do not accept ID tokens as API access tokens.
2. Implement validated issuer-and-subject binding to an existing user, with
   explicit organization selection and active membership checks. Existing aliases
   cannot be assumed issuer-bound without reviewing configuration-change and
   account-linking semantics. No email-only automatic link or first-login admin.
3. Reuse the native permission evaluator and audit identity on the same project
   and reference actions. Keep browser session ownership in Nomen and preserve
   existing local login as the migration/rollback path. No second secrets store.
4. Prove wrong issuer/audience/signature/expiry denial, membership removal,
   cross-tenant denial, issuer revocation and real remote browser approval on
   the canonical image before changing the public connection instructions.
