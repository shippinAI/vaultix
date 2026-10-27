# Bootstrap identity issuance

Status: local issuance/lifecycle acceptance passed, 2026-10-27; committed CI pending.

The native Go integration run against the canonical environment image exposed a
bootstrap defect. `super-admin-service.ts` creates the instance admin identity
token by signing the legacy identity/token-row IDs without `exp`. The existing
identity validator rejects expiry-free tokens after the configured enforcement
date plus maximum age. The defaults are May 4, 2026 and 90 days, so a freshly
bootstrapped instance can receive an already unusable credential.

The failed `.cache/go1273-integration-dragonfly.jsonl` run records HTTP 401
`Identity access token exceeded max age` during fixture project/identity creation.
The image is the real local canonical artifact. No entitlement patches or
foreign image are used. The compiler upgrade cannot repair this token format.

## Required repair and acceptance

Read the entire bootstrap service and trace its token DAL, shared issuance and
signing helpers, token-auth caller, validator and initialization state. Author
bootstrap issuance using the existing bounded token format and lifetime rules.
Preserve the existing encrypted store, initial organization/membership, token
management/revocation record and one-time setup guard. Do not change the legacy
enforcement date, remove expiry/revocation checks or grant extra authorization.

Prove a new bootstrap credential has bounded expiry and correct identity/tenant
claims, can perform its existing authorized setup operations, and is rejected
after expiry/revocation. Preserve already-initialized rejection. Exercise the
canonical image and the Go integration suite again after the repair, recording
provider skips and remaining Go/TypeScript authentication differences explicitly.
This packet does not establish Nomen issuer/session ownership or full auth parity.

## Implementation and characterization

Bootstrap now injects the existing `issueIdentityAccessToken` service. Issuance
stays within the identity/membership transaction, persists the named Token Auth
row, carries root/parent/organization claims and uses the configured maximum age.
Wildcard trusted IPs are shared by the persisted auth configuration and issuer.
The surrounding setup workflow, encrypted user record and setup guard remain.

`tests/platform/bootstrap/bootstrap_test.go` exercises a disposable canonical
instance: required expiry/signature, tenant and token-row correspondence,
authorized project creation, second-bootstrap rejection, expired-token denial
and admin revocation. Against the preceding image it fails with `exp claim is
required` (`.cache/bootstrap-regression-before.jsonl`). TypeScript and scoped
ESLint checks pass on the repaired service/composition.

The existing core maps expired JWTs to 403; the test preserves that observable
behavior. An initial empty-body Resty revoke request used an unsupported media
type. The backend log identified `FST_ERR_CTP_INVALID_MEDIA_TYPE`, and the fixture
now sends JSON. Separately, the shared error mapper changes that Fastify 415 to
a generic 500; record this for the API error contract work rather than claiming
the revocation service caused it. No diagnostic credential or operator values
are committed.

The final standalone image
`sha256:24560020369fd738e0e4e3c59cc5debdc798f8baf7ab862db7e338b29bd6929d`
passes the lifecycle test (`.cache/bootstrap-lifecycle-final.jsonl`) and both
complete Go integration runs: 204 passes, 8 provider skips per cache, zero
failures (`.cache/go-proof-QbLrCU/result.json`, `.cache/go-proof-mlYewa/result.json`).
Each run verifies a fresh disposable store. The separate real-browser image
proof also passes. This fixes newly issued bootstrap tokens; existing legacy
tokens are not silently upgraded or granted an extended lifetime.
