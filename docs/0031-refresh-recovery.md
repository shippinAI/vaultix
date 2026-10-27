# Recover interrupted browser refreshes

The environment image proof exposed an existing authentication defect during
repeated full-page navigation. `.cache/app-image-proof-Ddik5B/auth-navigation.json`
records a cancelled refresh, successful grace responses, then `TokenReuse` and
return to login. The route accepts the old cookie for ten seconds after rotation
but does not send a current cookie on a grace hit. A lost response therefore
leaves the browser unable to recover before the grace window expires.

This packet repairs the existing first-party login compatibility path. Nomen
remains the target identity/session owner; this does not implement Nomen wiring.

## Retained security boundaries

- Verify the signed refresh token and existing session before recovery. Accept
  only the immediately preceding version while its existing cache marker lives.
- Reissue the validated claims with the current refresh version and the original
  expiry. Do not increment the version or extend the grace marker or lifetime.
- Do not admit delegated OAuth tokens through the browser refresh endpoint.
- Clear grace when a session is invalidated. Logout must invalidate both the
  current cookie and its predecessor; expired-grace replay must still revoke the
  session family. Preserve organization, suborganization and MFA claims.
- Keep errors, cookie attributes, response contract and authorization checks.
  No new store, cryptographic algorithm, schema library or value-bearing AI API.

## Acceptance

Add real PostgreSQL/cache tests that first fail against the existing source:
lost-response recovery, expiry/version preservation, unchanged grace TTL,
replay revocation and logout during grace. Run against Dragonfly and Redis.
Then run the canonical image through the complete browser/environment workflow.
Diagnostics retain status and classified failure names, never tokens or cookies.

Simultaneous refresh rotation, replica lag, delegated OAuth refresh recovery and
real Nomen acceptance remain separate review gates. This bounded recovery fix
does not certify the complete authentication service.

The corrected pre-change tests run against `HEAD` copies of the service/router
inside the disposable test container, without replacing workspace edits.
`.cache/core-proof-ULt89h/test-results.json` reproduces two failures: no recovery
cookie and successful refresh after logout with the predecessor cookie. The
outside-grace replay test passes on the baseline. The first test attempt used
an uninitialized test-process crypto wrapper for claims inspection; the corrected
test verifies server-issued JWTs with the existing JWT library and fixture key.

The patched backend passes all 168 selected database tests on Dragonfly
(`.cache/core-proof-5OZCo8`) and Redis (`.cache/core-proof-lZJx7V`), including
recovery, original-expiry/version/grace preservation, replay revocation, logout,
existing login, references, approvals, SCIM and secret CRUD/version cases.
`.cache/unit-proof-UPFDNN` reports 1,849 passing unit tests and 22 existing skipped
tests across 118 files; nine new guard/claim checks preserve organization,
suborganization, MFA and timestamps and reject mismatched/delegated contexts.

The first broad runs overlapped the image build and timed out in bulk-secret
cases at the unchanged five-second deadline (`.cache/core-proof-mRlyzl` and
`.cache/core-proof-E1qFE2`). Fresh isolated runs passed with the same deadline;
this supports resource contention as the cause, not a scalability guarantee.

The canonical packaged application also passes the intentionally lost refresh
response and authenticated reload after grace expiry in
`.cache/app-image-proof-SxVC1r/auth-navigation.json`. Its complete workflow result
passes; both cache smoke/restart checks pass on image
`sha256:6f74b5d249a7f0098413fb4f6da27150a3011b34b488cb98b29854a8e10af739`.
Backend type checking and scoped lint pass. Publication still requires the
committed source's GitHub pipeline; local evidence does not establish that result.
