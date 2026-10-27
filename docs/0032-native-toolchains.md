# Native toolchain migration: STACK-01

Status: local Go acceptance passed; committed CI and remaining STACK-01 work pending, 2026-10-27.

The compiler upgrade also requires golangci-lint 2.15.0. The previous 2.12.2
binary rejects Go 1.27; recompiling it with 1.27.3 still fails on export-data
version 5. The [upstream release](https://github.com/golangci/golangci-lint/releases/tag/v2.15.0)
supplies the compatible analyzer. The Makefile pins that release and its installer
instead of retrieving an installer from HEAD. The enabled analyzer set remains
unchanged; its `exhaustruct` deprecation is a future configuration migration.

This packet advances the foundation gate in [0027](0027-native-stack-and-ai-migration.md).
The root CLI, optional panel and existing Go backend currently select different
Go toolchains. Reconcile their owned module requirements, image builders and
CI selection to Go 1.27.3 before expanding the Go domain services.

The [official download manifest](https://go.dev/dl/?mode=json) identifies 1.27.3
as stable. The [release history](https://go.dev/doc/devel/release) records its
crypto/x509 security fixes. Verification of the actual compiler and built
binaries is required; changing a version string alone is not acceptance.

## Scope and boundaries

Read the three owned module files, the canonical standalone image, panel image,
Go development/FIPS-development and SoftHSM test images, CI workflows and backend
Go build/lint instructions. Retain dependency locks and the vendored gocasl
module's provenance and minimum language version. No API, encrypted-store,
authorization, job owner or identity/session migration occurs in this packet.

Use container/workspace toolchains without replacing global developer tooling.
Keep existing development hot reload, HSM library setup, non-root runtime and
standalone entrypoint. The FIPS development filename/environment is an existing
execution mode, not evidence of certification. Runtime base distributions and
the currently floating Air development-tool version require separate dependency
review; do not silently broaden this compiler change into their upgrade.

## Required evidence

1. Build root CLI, panel and sidecar with the selected compiler. Run their unit
   suites and the backend Go lint gate. Record failures and prerequisite gaps.
2. Exercise backend Go integration tests against disposable infrastructure;
   preserve provider/hardware distinctions and existing denial cases.
3. Build `core/Dockerfile.standalone-vaultix`, verify the embedded sidecar's Go
   version, then run the real application and both cache smoke/restart suites.
4. Build the optional panel and SoftHSM test images and verify their toolchains.
5. Retain the UI/API baseline, reconcile exact-content reviews/maps, commit/push
   and verify the committed pipeline before claiming publication.

STACK-01 also requires separate React 19 peer-compatibility and Rust toolchain/
MSRV inventories. This Go change does not complete those inventories or the
overall foundation gate. Domain implementation follows AUTH-01 and READ-01;
the existing TypeScript services are not replaced by a proxy in this packet.

## Integration infrastructure finding

The existing Go integration builder used a floating `vaultix/vaultix:latest`
image and ran it as root to patch compiled paid-feature flags. That cannot
establish behavior of the canonical Vaultix artifact. The authored fixture now
requires `VAULTIX_TEST_IMAGE`; the runner must inspect the local image and pass
its exact ID. Remove the feature patch method and its two callers, retaining all
custom-role/group/secret assertions against the real included policy. The image's
non-root user and entrypoint remain authoritative. Test caches use Dragonfly by
default, with `VAULTIX_TEST_CACHE_PROVIDER=redis` as an explicit alternative.

Provider credential fixtures remain disabled without their explicit credentials;
do not inherit operator secrets or connect to a snapshot host. A missing local
artifact or provider prerequisite is a failed/omitted gate, never permission to
substitute a foreign image. These fixture corrections are necessary to run the
existing Go acceptance tests against our code before domain migration.

The first real-image run found [bootstrap issuance](0033-bootstrap-identity-issuance.md)
creating an already unusable legacy credential. This is repaired through the
shared bounded issuer, not by loosening token validation. The new image runner
`scripts/test-go-core.mjs` pins both locally inspected image IDs and records only
test identities/outcomes; it excludes raw HTTP response diagnostics from CI
artifacts because fixture errors can contain credentials. Both cache providers
become pre-publication integration gates in GHCR.

The lint gate also found an unreachable remote-license client constructor and
background sync starter left behind by the included-feature policy. Their callers
are absent; remove those unused definitions/constants rather than restoring remote
entitlement calls. Retain the current compatibility methods and inherited license
tests for their own later review. Formatting changes only sort four existing
import groups; line-ending normalization produces no additional Git content edits.
These mechanical edits are not whole-module authorship or permission migration.

## Local acceptance

- Go 1.27.3 root command/library packages: 8 tests passed. The initial whole-tree
  Windows bind traversal was stopped; the explicit `./cmd/... ./internal/...`
  invocation covers all tracked root Go packages.
- Optional panel: 94 tests passed, 1 skipped with the complete parent checkout
  available. Mounting only the panel directory incorrectly omitted its contract
  and naming fixtures; that failed invocation is retained separately.
- Backend Go unit tests with race detection: 457 passed after removing unreachable
  license definitions. No inherited test assertions were removed.
- The panel and SoftHSM images build with 1.27.3; 10 SoftHSM tests passed with race
  detection. This tests a software PKCS#11 implementation, not physical hardware.
- Both full Go integration runs passed: **204 tests, 0 failures, 8 skips per
  cache**. Reports: `.cache/go-proof-QbLrCU/result.json` (Dragonfly) and
  `.cache/go-proof-mlYewa/result.json` (Redis). They cover the new bootstrap
  lifecycle plus retained auth, permission, KMS, project, rate-limit and secret
  assertions. Skipped provider tests are not acceptance evidence.
- Final immutable Go test image `sha256:755b2da35565b5226a848042be4d411b12020c5b336f1350ac819e98bcf18aaa`
  passes `make lint` with no issues (`.cache/go1273-lint-artifact.log`).
- Canonical image `sha256:24560020369fd738e0e4e3c59cc5debdc798f8baf7ab862db7e338b29bd6929d`
  (`vaultix:toolchain-verified`) passes smoke/queue/restart on both caches.
  `.cache/app-image-proof-u0p17O/workflow-result.json` records the complete real
  sign-in/dashboard/chart/environment run; fixture recovery cases remain labelled.
  Packaged login and narrow confirmation screenshots were visually reviewed.
- Extracted canonical sidecar and panel binary metadata both report `go1.27.3`.
  The panel image is `sha256:1bcae8954e985b403cf8b845028f6f370ea0738fdb616d22aa2eaa2549def390`.
- Ownership, exact-source inventory/map, map tests and capability-preservation
  checks pass. Baseline remains 273 UI routes and 2,290 API operations.

Logs are under `.cache/go1273-*` and `.cache/toolchain-*`. The first browser
invocation failed because the default Playwright browser was absent; the final
run explicitly used installed Chrome. Committed CI/publication remains a separate
gate. React/Rust inventory and the broader architecture migration remain open.

## Remaining findings

Review found `internal/keystore/memory.go` converts counters with `string(rune(n))`
while reading decimal strings. Correct this with numeric/expiry/limit parity tests
in AUTH-01 before using the in-memory fixture as evidence for repeated token-use
counting. Existing integration success does not prove that untested behavior.
The numeric fixture repair and its scoped real-cache contract evidence are now
tracked in [0035](0035-cache-counter-contract.md); production counter recovery
and renewal races found during that review remain separate work.

## Preceding development checkpoint

Commit `3d5909e92c3462a56c0c0e3f7355beb873772307` is pushed to `main`.
Its canonical environment/recovery image
`sha256:6f74b5d249a7f0098413fb4f6da27150a3011b34b488cb98b29854a8e10af739`
is healthy in `vaultix-dev-backend-1`; port 8200 status and source UI port 3000
return 200. The existing database volume is retained. GitHub image run
[40581174003](https://github.com/shippinAI/vaultix/actions/runs/40581174003)
was in progress when this packet started; that is not publication evidence.
