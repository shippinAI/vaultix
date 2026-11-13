# Native project and reference reads

READ-01. Scoped read-domain implementation verified; workflow migration and production cutover remain open.

## Work packet and dependencies

Continue from the scoped authority/SSO/assumed-actor acceptance in 0061–0063.
The existing React reference UI and MCP actions share `vaultixReferenceService`.
Keep one implementation for both callers when ownership moves. Native services
must query the existing PostgreSQL store directly; forwarding to TypeScript does
not complete this migration. The working project/secrets deployment stays live.

Read the complete reference service, input contract and router; trace project
listing, folder resolution, reference-page SQL and the permission predicates.
The surrounding large project/folder/secret DAL files are only traced at the
relevant methods so far, not fully reviewed. Go project/environment services,
folder lookup entry, auth identity context and secret permission checker are
read as dependencies; this does not verify those whole workflows.

### Implementation sequence

1. Author a native reference service with mandatory authenticated context and
   project permission resolution. Preserve user/machine actors, assumed authority,
   legacy read/describe permissions, tag conditions and safe errors.
2. Query only shared reference identifiers, names, versions and timestamps.
   Personal overrides, comments, values/ciphertext, custom metadata and imports
   are absent from the current reference response; never call the value-reading
   secret service to implement metadata reads. Imported-reference convergence is
   a separate compatibility decision, not an implicit expansion of this API.
3. Preserve physical-row pagination before per-row permission filtering. An empty
   visible page may have `nextOffset`; clients must continue until null. Bound
   input and use parameterized SQL. Match existing UTC millisecond timestamps.
4. Author project/environment listing with direct and group membership semantics,
   active project/environment filters and deterministic ordering. Trace selected
   organization authority and assumed-actor behavior before replacing that path.
5. Add native HTTP/OpenAPI and shared action/MCP dispatch, origin/rate/error
   boundaries and audit ownership. Define rollout/rollback and retire the old
   domain only after equivalent UI/MCP and denial/failure tests pass.
6. Verify differential behavior against the canonical application, value canaries,
   query failures, cancellation, tenant/role revocation, pagination and stale
   replica cases. Build the committed standalone image; run native lint/race/
   integration and the preserved application gates before cutover.

## Data and authority decisions

Reference filtering uses secret tags as authorization inputs. Native reference
rows and tags will come from the primary database, alongside the existing native
primary-only permission resolver. Reading stale tag assignments from a replica
could make revoked conditional access appear valid. These separate statements
are not a serializable authorization snapshot; do not claim race-free revocation.
The native folder query resolves only the requested path rather than loading all
folders for an entire project. Existing encrypted formats and schema remain intact.

The current API admits JWT users and identity access tokens only. Unsupported
actors, absent selected organization, invalid bounded queries and missing authority
must refuse before metadata queries. Fine-grained filters remain mandatory even
after a subject-level describe check. Transport errors must mask unavailable and
forbidden resources consistently and keep a plain `error` string.

No native route forwarding, Nomen registration, new AI mutation or second secrets
store is enabled by this work packet. Public-cloud/provider/manual accessibility
and full capability parity remain under their existing acceptance gates.

## Domain implementation and discovered differences

`platform/engine/backend-go/internal/services/secretmanager/reference` now owns primary-only
project/environment metadata and bounded reference-page queries against the
existing tables. No TypeScript service is called by this implementation. It is
not wired to production routes yet; HTTP/MCP, audit ownership and final cutover
remain steps 5–6 above. Project creation remains outside this read slice.

Project discovery preserves direct/group membership, including visibility for a
member whose role is `no-access`; discovering a project never grants reference
access. It excludes other products and deleted projects/environments, returns
empty arrays, and deduplicates overlapping direct/group membership. Ties gain
stable project/environment ID ordering. Groups must belong to the selected
organization. This explicitly rejects corrupt cross-organization group links;
the older DAL does not check that invariant itself. Project listing retains the
existing unpaginated contract; this is not measured large-tenant capacity proof.
Organization-session enforcement and assumed-requester discovery still require
transport-level acceptance before cutover.

The first real differential found an array permission mismatch: the vendored Go
`$in` operator compares an entire tag slice with each candidate. The application's
CASL matcher compares its elements. Product-owned operator extensions now apply
element membership and negate the complete match for `$nin`, while retaining
scalar evaluation, compiled variable resolution and other rule conditions.
The vendored implementation and its provenance are unchanged. The regression
tests fail before the fix for a matching `$in` grant and `$nin` exclusion.
This is scoped operator compatibility, not full CASL equivalence: array `$eq`/
`$ne`, other operators and rule-order differences between the native deny-first
evaluator and CASL need broader comparison before route ownership changes.

The first reference differential failed on the conditional-tag case; its receipt
is `.cache/assumed-workflow/.cache/native-reference-dragonfly-before-membership-fix.json`.
After the fix all 17 then-existing checks passed. A later expanded run passed
33 checks and failed the value-only denial fixture, which incorrectly expected
HTTP 403. The existing Vaultix transport masks forbidden resources as HTTP 404.
The corrected test checks HTTP 404 alongside a native service-level 403 and no
page. The failed receipt remains `native-reference-dragonfly-denial-fixture.json`
in the same directory. No authorization behavior was relaxed.

The integration fixture's reference reader has column-level SELECT grants for
names, IDs, versions, timestamps and permission tags. A broad secret SELECT is
explicitly denied by PostgreSQL. Value, personal-value, comment and metadata
canaries are absent from responses; imported values are not read. Permission
resolution uses its separate normal primary connection. A replica accessor panics
if used. Real tag removal, unavailable metadata primary and cancellation are
exercised. Trusted service contexts are fixture inputs, not native HTTP auth proof.

Full development lint passes with integration tags, zero issues, and the existing
`exhaustruct` deprecation warning. A broad source-mounted unit run failed with a
Docker filesystem `cannot allocate memory` error during package enumeration;
its receipt is `.cache/assumed-workflow/.cache/reference-unit-development.log`.
The isolated snapshot run completed 724 passing checks and identified two failing
entries in one new variable-resolution fixture; integration-tagged vet passed.
That fixture incorrectly assumed recursive variable interpolation inside a vendor
array. It now supplies a direct variable containing the candidate list, matching
the vendor compilation contract. Product rule interpolation remains unchanged.
The failed receipt is `native-reference-unit-vet-variable-fixture.json` in the
same evidence directory. Committed-image acceptance remains pending.

The final development reference/project differential passes 35 checks with zero
failures/skips or setup diagnostics on Dragonfly:
`.cache/assumed-workflow/.cache/native-reference-dragonfly.json`. This uses the
previous canonical application image and mounted candidate Go source, not a new
committed artifact. Redis and full immutable native/application checks follow.


## Committed-image evidence, 2026-10-29

Runtime/build source: `5dfd65bde8cc4b5613632f32c2eee450ad5918bf`.
Canonical image: `sha256:c8a83c185c5a7a32c3ffa2455815ff16fd716a73c2599c85b53d5c92a402ee5c`.
Go test stage from the same committed archive:
`sha256:607417d3e0586889e2062bf0169bb6cc0777f107214d80839bf95b06dc6f9373`.

Receipts are local/ignored, relative to the main checkout:

- All 16 canonical build/application gates passed:
  `.cache/assumed-workflow/.cache/self-hosted-build-U1usns/result.json`.
- Full native unit/race: 726 passed, zero failures/skips; integration-tagged vet
  passed: `.cache/assumed-workflow/.cache/native-unit-vet.json`.
- Full immutable native lint with integration tags: zero issues, exit 0, existing
  linter deprecation notice only:
  `.cache/assumed-workflow/.cache/lint-image-final.json`.
- Full native integration suites: 688 passed, zero failures, eight external-provider
  skips per cache, zero setup diagnostics. Dragonfly:
  `.cache/assumed-workflow/.cache/go-proof-QlqaEO/result.json`; Redis:
  `.cache/assumed-workflow/.cache/go-proof-Vo69C4/result.json`.
  Each includes all 35 new reference/project checks. External skips remain gaps.
- Packaged browser workflows passed, including real setup/sign-in, project,
  environment, secret and role-refresh operations. Injected UI fixture states are
  separately labelled:
  `.cache/assumed-workflow/.cache/app-image-proof-muFFRf/workflow-result.json`.
- Nine encrypted-recovery, eleven tenant-isolation and four proxy-boundary checks
  passed with successful cleanup. Production admission passed four checks for
  each cache. Their exact receipt paths are in the corresponding logs under the
  canonical build directory above.

The 273 UI route and 2,290 API operation baseline is preserved. There is no schema,
encrypted format, frontend or TypeScript runtime change in this packet. Native
forwarding remains disabled; existing projects/secrets keep their current owner.
The earlier 0061 Redis bootstrap timeout remains undiagnosed despite these passes.
These counts do not establish complete feature, permission, accessibility,
ElastiCache, Nomen, public-cloud or provider acceptance.

The daemon restarted during the final Redis admission gate. Its incomplete result
and lock were preserved as `interrupted-result.json` and `interrupted-lock.json`
under the canonical build directory. After confirming the runner was dead, only
that run's four disposable containers and internal network were removed. The
final gate was rerun against the same image, passed all four checks, and cleaned
up successfully (`production-admission-ubdLWG/result.json` in the same evidence
root). Clean source revision and image identity were checked again before the
combined receipt was marked passed. The prior 15 gates and native suites were
retained, not rerun or inferred from the interruption.

Reproduce with `node scripts/build-self-hosted.mjs`, then build the `go-builder`
stage from that run's archived `source/platform/engine`. Run unit/race, integration-tagged vet
and lint against that immutable stage, and
`node scripts/test-go-core.mjs <image-id> <dragonfly|redis> <go-stage-id>`.

## Confirmed next cutover gates

An additional fixture-only comparison against the installed application's CASL
and the immutable Go stage confirms three `$all` tag mismatches and two
last-matching-rule precedence mismatches. Its eight-case receipt is
`.cache/assumed-workflow/.cache/reference-operator-characterization.json`.
The SecretConditionV2 schema explicitly permits `$all` tag lists, so this is
required compatibility work before switching reference routes. The first native
read domain has not closed those gaps. Do not treat the passing existing suites
as evidence for cases they do not exercise.

Transport review identifies the remaining work before switching ownership.
The 2026-11-09 transport groundwork below closes only the private proxy-trust
and canceled-enqueue checks. It does not switch the public route.

- Transfer the existing UI/MCP action dispatch and metadata-only audit callback
  together, preserving all guidance tools and protocol negotiation. Open.
- Preserve bounded inputs, no-store, origin checks, masked denials and redacted
  errors. The shared native error handler currently logs richer causes and uses
  a different response shape. Open. Direct public exposure of the Go listener
  is not accepted.
- Preserve the TypeScript route budgets for self-hosted deployments. The native
  limiter still starts only for cloud production, which is not those budgets.
  Open.
- Native audit retention still depends on the license plan and the Node
  ClickHouse consumer in stream mode. Retention ownership is open.

No production routing, permission rule-order policy, audit ownership or public
exposure is changed by this evidence commit. Continue the complete-use-case
sequence above; the deployment remains usable while that work proceeds.

## Serving permission semantics, 2026-11-09

The project permission builder in
`platform/engine/backend/src/shippin/services/permission/permission-service.ts` sorts allows
before forbids and expands a forbid of `describeSecret` or `readValue` so it
also forbids the legacy `read` action. CASL then uses the last matching rule,
so a matching forbid wins. That is the behavior served by
`GET /api/v1/vaultix/secret-references`. An unsorted CASL check, where a later
allow overrides an earlier forbid, is not the serving contract.

`buildProjectPermissionRules` now applies the same expansion and order. The
native evaluator stays deny-first, which matches that result, and
`vaultixpolicy.Can` is unchanged for callers that do not use this builder.
`PermissionFieldOps` treats `$all` as CASL/Mongo containment. The vendored
nested-condition `$all` remains for other callers.

`reference.PublicOwner` stays `typescript`. HTTP/MCP dispatch, native error
shape, self-hosted rate-limit parity, and audit retention are still open, so
the public route was not switched. Direct public exposure of the Go listener
remains unaccepted.

`go test -count=1 ./internal/services/permission/ ./internal/services/secretmanager/reference/`
passed. Against image `sha256:cb2e170c6186e8af1e637438b8a7e3873f310e2c6e6f2f18cfb2a0acda5290d1`
from commit `d3214bf5336506398d5e29597aadaa804a3d4533`,
`go test -tags integration -run TestReference_MetadataOnlyDifferential ./tests/secretmanager/secrets/`
passed. That run compares this Go source with that image's TypeScript route,
including `$all`, the legacy-read forbid, a foreign organization, value-only
denial, and canary exclusion. The image does not contain this Go source change,
and its public behavior was not rebuilt.

## Transport groundwork, 2026-11-09

`auth.ClientIP` accepts `X-Real-IP` only when the TCP peer is loopback, which
is the private Node ingress after it replaces client-supplied address headers.
It never reads `X-Forwarded-For`. Any other peer is attributed by its socket
address. `RequireAuth` and the device-authorization handler use that helper.
The hosted native limiter, when enabled, keys a bearer token or otherwise
`ClientIP`, so a non-loopback client cannot rotate `X-Real-IP` into a new
budget. `NativeLimiterEnabled` remains cloud and production only. Self-hosted
Go routes stay unlimited by that service; the public TypeScript routes keep
their own budgets, including 120 catalog reads per minute.

`queue.Enqueue` returns `context.Canceled` before delivery and passes the
context to `EnqueueContext`. Audit retention is unchanged: a missing plan fails
closed, and stream mode still uses the Node ClickHouse consumer.

Route tests on `registerVaultixRouter` show an unauthenticated
`GET /secret-references` and `vaultix.secrets.references` call return before
the reference service or audit callback, ignore spoofed actor and address
headers, and omit the canary value. The 121st `GET /catalog` on a fresh router
returns 429 with a string `error`. Guidance tools and MCP session negotiation
stay on this router. No image rebuild was required: the public TypeScript
runtime is unchanged, and the recorded image
`sha256:cb2e170c6186e8af1e637438b8a7e3873f310e2c6e6f2f18cfb2a0acda5290d1`
does not contain the Go helper.

## Transport integration, 2026-11-09

`VAULTIX_REFERENCE_DISPATCH=go` makes both `GET /api/v1/vaultix/projects` and
`GET /api/v1/vaultix/secret-references`, and the authenticated MCP tools
`vaultix.projects.list` and `vaultix.secrets.references`, call the native
reference service. The public ingress forwards only the verified bearer and
the socket address. `X-Actor-Id` and `X-Org-Id` are not copied. Anonymous
guidance, origin checks, and MCP session negotiation stay on the TypeScript
router. The code default remains `typescript`.

The native handler returns `{ "error": string }`, masks forbidden and missing
resources as 404, and does not put a cause in the body. Direct reference and
project routes allow 60 requests per minute on every deployment, including
self-hosted. A loopback peer with `X-Vaultix-Dispatch: mcp` does not consume
that budget, because the public MCP route already allows 120 per minute. Any
other peer sending that header is still counted.

Reference reads enqueue `get-secrets` with the name count only. Delivery
failure does not fail the read. Retention uses the plan days, and a shorter
positive project `auditLogsRetentionDays` caps it. The included self-hosted
plan is 365 days. Zero retention still stores nothing. The Node stream consumer
remains the storage writer; native delivery appends the same `audit-log-stream`
envelope. A canceled enqueue still returns before delivery.

The packaged image sets `VAULTIX_REFERENCE_DISPATCH=go`, spawns the sidecar on
`127.0.0.1:4040`, and waits for its health route before serving.

`node scripts/build-self-hosted.mjs` passed for commit
`49e4ba711de0f3514ffbd897aeaca4dae43f0a44`. Image
`sha256:d5ada2273a1f71bec2c5efd5f46e4c48f3944a365d90cc64c8588b5de2fa4682`,
tag `vaultix:49e4ba711de0f3514ffbd897aeaca4dae43f0a44`. Receipt
`.cache/self-hosted-build-4qPCdv/result.json`. The sidecar listened on
`127.0.0.1:4040` and its health route returned 200 before the API served
traffic. Passed steps include Dragonfly and Redis smoke, encrypted recovery,
tenant isolation (including authorized, foreign, and unauthenticated reference
routes), the proxy boundary, and admission on both caches. No registry push.
This receipt does not include a later documentation commit.

`node scripts/test-cli-headless.mjs sha256:d5ada2273a1f71bec2c5efd5f46e4c48f3944a365d90cc64c8588b5de2fa4682 /workspace/.cache/cli-build-4D6STq/linux-amd64/vaultix` passed 17 checks, including token login, machine-identity login, and MCP reference reads without values. Evidence `/workspace/.cache/cli-headless-8eGmQR`. The CLI binary was built before this server revision; the server under test is the image above.

## Served-behavior parity, 2026-11-09

The native project and reference budgets match the TypeScript routes. Each route sets `config.rateLimit.max` to 60 and `timeWindow` to one minute in `vaultix-router.ts`. `@fastify/rate-limit` gives that route its own counter. Production keys the counter with `req.realIp` (`globalRateLimiterCfg` in `rateLimiter.ts`). `fastifyIp` sets `realIp` from `req.ip`, which is the socket address unless `TRUSTED_PROXY_CIDRS` names the proxy. The key is not the actor and not the organization. The router test "allows 60 project reads per client IP and keeps reference reads on a separate IP budget" passed: the 60th project read from one address succeeded, a second actor at that address was rejected, another address was allowed, and a reference read at the exhausted address was still allowed. The native limiter uses the same 60 and the client IP, with separate project and reference counters. Public requests still pass the TypeScript limiter first, so the served budget is not a new limit.

The TypeScript reference read calls `createAuditLog`, which calls `pushToLog`. That function swallows stream and plan-lookup failures and still returns. A plan with no retention days stores nothing and does not fail the read (`audit-log-queue.ts`, tests "drops when audit log retention is 0/unset", "never throws when streamAdd fails", and "never throws when a resolution lookup fails"). The native read does the same when enqueue fails: the page is returned and the failure is logged. That is the request contract, not a weaker read. The native worker still returns an error and writes nothing when the retention plan is missing, so delivery retries instead of acknowledging a record with no policy. Zero days still stores nothing.

The public ingress builds a new header set. A caller `X-Vaultix-Dispatch` value is not copied. The MCP tool path sets that header to `mcp` itself. The dispatch test sends `mcp` on the HTTP read and `forged` on the MCP call; the native listener sees no dispatch header for HTTP and `mcp` for the tool call. The sidecar process binds `127.0.0.1:4040`. A non-loopback peer that presents the header is still counted by the native limiter.

`TestReference_MetadataOnlyDifferential` passed against image `sha256:d5ada2273a1f71bec2c5efd5f46e4c48f3944a365d90cc64c8588b5de2fa4682` twice. With `VAULTIX_REFERENCE_DISPATCH=go` it passed in 26.760s. With `VAULTIX_REFERENCE_DISPATCH=typescript` it passed in 25.746s. The integration harness replaces the image environment, so the second run is the unset code path on that same image. No product runtime change followed these passes, so the image was not rebuilt.

## Secret read order and rebuilt image, 2026-11-09

`getSecretByName` now rejects a found secret's value read before decryption. The change is in `secret-v2-bridge-service.ts` at the `viewSecretValue` check. A describe-only caller receives `ForbiddenReadSecretError` and the decryptor is not called. A caller with `readValue` still receives the decrypted value. `viewSecretValue: false` still decrypts, then masks a shared value, because existing access-list and personal reads depend on that order. A missing local secret can still resolve an import; `fnSecretsV2FromImports` decrypts describable imported secrets before its own value check because the source scope can differ from the local path. That import order was not changed.

`node scripts/build-self-hosted.mjs` passed for commit `baf60b152ff0e6d0259066c4389ab5aee86c0ac2`. Image `sha256:e4f03076410060c63ec0b5d431c7d693dd86cf5c969ee3ad76c3cd6856889257`, tag `vaultix:baf60b152ff0e6d0259066c4389ab5aee86c0ac2`. Receipt `.cache/self-hosted-build-7dWnaK/result.json`. Passed steps include Dragonfly and Redis smoke, encrypted recovery, tenant isolation, the proxy boundary, and admission on both caches. No registry push.

`node scripts/test-cli-headless.mjs sha256:e4f03076410060c63ec0b5d431c7d693dd86cf5c969ee3ad76c3cd6856889257 /workspace/.cache/cli-build-4D6STq/linux-amd64/vaultix` passed 17 checks. Evidence `/workspace/.cache/cli-headless-4Cy8qm`. The CLI binary was built before this server revision.

`TestReference_MetadataOnlyDifferential` passed against that image with `VAULTIX_REFERENCE_DISPATCH=go` in 28.649s and with `VAULTIX_REFERENCE_DISPATCH=typescript` in 27.838s.
