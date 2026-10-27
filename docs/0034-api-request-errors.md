# API request-body failures

Status: scoped local handler acceptance passed, 2026-10-27; eager-upload transport acceptance remains open.

The canonical bootstrap lifecycle proof exposed a shared API defect: Fastify's
`FST_ERR_CTP_INVALID_MEDIA_TYPE` (415) is converted to a generic 500 by
`core/backend/src/server/plugins/error-handler.ts`. Malformed, empty, oversized
or incorrectly framed JSON requests can take the same unrecognized-error path.
This prevents humans and AI clients from distinguishing bad requests from an
unavailable service and encourages ineffective retries.

Read the entire shared handler, trace the pinned Fastify parser/error classes,
and add actual parser-boundary tests before changing response handling. Recognize
only the explicit request-parser error constructors. Preserve unknown/internal
500 handling, authentication/authorization responses, SCIM/ACME protocol formats
and the existing certificate-request JSON guidance. Do not accept arbitrary
third-party `statusCode` or code-shaped objects as authority for a response.

Return bounded, static remediation text and a plain `error` string. Request body
values must not enter the response or expected-error log. Classify these failures
as validation for the HTTP error metric. No new routes, store or model-only API.

Acceptance requires the reproduced failing parser tests, passing exact-source
unit/type/lint checks, real HTTP tests against the canonical standalone image,
and retained authenticated image workflows. Include malformed/empty JSON,
unsupported media, oversized body and content-length mismatch, plus success,
unknown-error and existing auth/CSR behavior. Keep the existing UI/API baseline.

Previous checkpoint `fc8739db767cf5e3c7cc34604d7d78afdc641e41` is pushed. Its
canonical image `sha256:24560020369fd738e0e4e3c59cc5debdc798f8baf7ab862db7e338b29bd6929d`
is healthy in local development (8200 API and 3000 source UI both return 200).
GHCR run 40587622427 is pending acceptance; publication is not yet claimed.

## Implementation and characterization

The five actual Fastify parser constructors now map to 400, 413 or 415 with
static remediation text and a plain `error` string. The warning log uses the
same bounded text. Unknown errors and objects merely carrying a matching code
remain redacted 500 responses. Existing auth expiry/denial and CSR guidance
are preserved; no routes, permissions, token lifetimes or encrypted data change.

The regression suite reproduces six wrong-500 parser cases before the change
(`.cache/body-error-baseline-results.json`, six failures/four passes). The full
backend unit suite then passes 1,859 tests with 22 existing skips across 119 files
(`.cache/unit-proof-W10CST/test-results.json`). The final typed assertions pass
all ten focused tests (`.cache/body-error-focused.log`), scoped ESLint and the
backend TypeScript check (`.cache/body-error-lint-final.log`,
`.cache/body-error-types.log`). Tests assert that rejected requests never enter
the route handler and planted request values stay out of responses/warning logs.

The disposable image probe sends real HTTP requests and requires the exact
status/error response. Initial fetch and Node HTTP runs intermittently hit
ECONNRESET on eager oversized uploads through Docker Desktop; these failures
are not accepted as 413. Independent connections alone did not solve that race.
An attempted `100-continue` exchange also reproduced the reset, so it did not
establish reliable transport acceptance. The final oversized probe sends only
headers declaring a body above the limit and requires an early 413 before body
transmission. Its name and evidence scope explicitly say declared-length
rejection; the Fastify regression suite exercises parser handling separately.
The probe still fails on transport errors. A reliable JSON 413 for every eager-upload client is not
established, and the shared handler does not change Fastify's connection closure.
Content-length
mismatch is exercised with Fastify injection; malformed wire framing can be
rejected by Node's HTTP parser before the shared handler. The image probe is
part of both cache smoke gates and retains only bounded outcomes in CI artifacts.

This acceptance scope does not cover every framework/plugin error or alternate
content parser. In particular, the separate SCIM JSON parser and protocol-specific
error responses still need dedicated malformed-body workflow coverage. Existing
SCIM/ACME branches remain unchanged; this packet does not establish their complete
behavior or whole-API parity.

## Canonical artifact

The final `core/Dockerfile.standalone-vaultix` build is
`sha256:0726fe6b9fa18bab22cd3c02cee6d275d15f7e0af1721905eac61a5571675418`
(`vaultix:request-errors`). Its real packaged sign-in, dashboard, charts and
environment workflows pass in `.cache/app-image-proof-PM9CDX/workflow-result.json`.
The packaged login screenshot was visually reviewed. The unchanged baseline
contains 273 UI routes and 2,290 API operations. Fixture cases remain labelled;
this is not Nomen, full enterprise or whole-UI accessibility acceptance.

Both final cache smoke gates pass: `.cache/request-errors-smoke-dragonfly-length.log`
and `.cache/request-errors-smoke-redis-length.log`. Their bounded HTTP reports are
`.cache/api-error-proof-aihO25/result.json` and `.cache/api-error-proof-Dfar5o/result.json`.
The eager-upload and 100-continue failed experiments remain explicitly excluded
from that scope. Committed CI/publication is a separate gate.

## Eager-upload characterization

An isolated Docker Desktop run against `vaultix:request-errors` sent twelve
1.2 MB JSON requests to the uninitialized disposable instance: six returned
`413 RequestBodyTooLarge` and six returned `ECONNRESET`. A separate minimal
Fastify comparison produced 4/20 responses and 16/20 resets with the normal
handler, versus 3/20 responses and 17/20 resets when the rejected incoming
stream was immediately resumed. These are small local samples, not a rate
estimate; the attempted resume is not adopted as a fix. Fastify closes the
connection on parser errors, and its body limit remains in force.

`VAULTIX_EAGER_UPLOAD_PROOF=1 bash scripts/smoke-image.sh IMAGE dragonfly`
runs an opt-in test against a disposable image. It sends twelve eager uploads,
prints only counts and fails unless every request receives the expected 413.
The normal image gate is unchanged; the separate test makes the unresolved
transport behavior visible rather than treating a reset as a successful 413.
Resolving this requires a bounded design and verification for slow, unbounded,
and aborted uploads as well as real deployment proxies.
