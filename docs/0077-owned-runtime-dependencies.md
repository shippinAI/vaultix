# Vaultix runtime dependency ownership

The application ships from `core/Dockerfile.standalone-vaultix`. It contains the
Vaultix React application, backend, Go service and a native gateway transport in
one image. There is no second application or legacy product image in this change.

## Source changes

The three misleading npm aliases for analytics, LDAP and QUIC are removed.
Analytics views and grants are authored in `backend/src/db/analytics-views.ts`:
the existing YAML column allowlist and transaction remain authoritative. SQL
identifiers are validated and quoted; no expressions or wildcard columns enter
the generated SQL.

LDAP consumers use the directly named `ldapts` 9.2.0 dependency. Vaultix owns the
LDIF change parser, principal resolution and connection lifecycle. Configuration,
group searches, dynamic credentials, rotation, app connections and AD discovery
now use its promise API. Binary password/GUID data and ordered operations remain
binary. Failed binds and completed operations close their owned connections.

`backend/scripts/patch-ldapts.mjs` explicitly patches the published client's
omission of RFC 4511 LDAPResult referrals. It preserves code 10, matched DN and
the server's referral URLs, without forwarding credentials automatically. It
checks the package identity, exact version and pristine/patched content hashes
for both runtime distributions. This is a disclosed third-party compatibility
patch, not a renamed Vaultix library. An upgrade must review and remove the patch
once the upstream release supplies equivalent behavior. Source maps from the
package do not incorporate the runtime patch. Existing application referral
trust policy remains in its consumers; this change does not certify all AD
forest arrangements or remediate the existing last-two-domain-label policy.

QUIC uses the directly named `github.com/quic-go/quic-go` dependency in the
Vaultix Go module. `cmd/vaultix-transport` owns TLS peer verification, the existing
`vaultix-gateway` ALPN, PING and FORWARD commands, loopback listeners and stream
cleanup. Its private stdin carries per-operation configuration; certificates and
keys are not arguments, environment variables or logs. Closing the owning
operation closes the transport. The helper is a protocol component, not a Go
proxy presented as a completed business-domain migration.

The existing v1 BoringSSL peer requires classical X25519/P-256 ClientHello groups;
the interoperability test exposed fragmented hybrid handshake failures. TLS 1.3,
CA validation, expiry, host/IP and exact organization/gateway identity checks
remain required. Migration to hybrid groups needs peer acceptance first.

The frontend imports `class-variance-authority` by its published name. The former
`cva` package alias is removed without changing component styles or behavior.
Normal third-party dependencies retain their real names and attribution.

## Build and verification

- `node scripts/test-owned-dependencies.mjs`: product manifests reject npm
  aliases; lockfiles and installed graphs reject the former product dependency.
  Negative fixtures prove the guard rejects concealed and nested dependencies.
  Published utility dependencies may themselves use CJS compatibility package
  names; they are not renamed Vaultix product implementations.
- `node scripts/test-owned-analytics.mjs`: all 77 configured views run against
  PostgreSQL; grants deny writes, base-table reads and excluded canary columns.
- `node scripts/test-owned-ldap.mjs`: independent TLS/BER peer tests real bind,
  paging, referrals, binary changes, denial, timeout, recovery and cleanup. It
  also exercises the real configuration and group-search consumers, silencing
  only their logger. These are protocol fixtures, not a deployed AD acceptance.
- `node scripts/test-owned-quic.mjs`: real Node-to-Go-to-QUIC interoperability
  with an independently maintained MatrixAI peer; tenant, identity, CA, SAN,
  purpose and expiry denials; fragmented ping, concurrent forwarding and cleanup.
  The separately named MatrixAI test fixture is not a product dependency.
- `node scripts/test-owned-quic-linux.mjs`: repeats the actual wire checks in
  Linux x64 with networking disabled except loopback. It uses the locally built
  `vaultix:verify-backend` test stage, rejects a mismatched backend lockfile and
  archives the exact committed transport source. Linux ARM64 remains compile-only.
- `node scripts/build-self-hosted.mjs`: clean committed source, canonical image,
  real browser application workflows, both caches, encrypted recovery and tenant
  boundaries. `node scripts/check-owned-dependency-image.mjs` binds these gates
  to the current revision and inspects the actual image dependency graph and
  native executable. A prior image's receipt cannot satisfy this check.

Local development builds the transport with `npm run build:transport` in
`core/backend`; `npm run dev` and `scripts/run-core.sh` include that step. Go must
match `backend-go/go.mod`. Container builds compile the native helper in their Go
stage; operators do not install a separate service. Local builds and verification
do not require GitHub Actions or a registry.

Older split backend development recipes receive the Go source through the
explicit local `vaultix-native` build context. Their Compose files configure it
as `./backend-go`; a direct build from `core/backend` must supply
`--build-context vaultix-native=../backend-go`. Each recipe copies the LDAP patch
before npm installation and packages the native transport. The legacy reduced
GHCR recipe also includes it, but remains outside the supported standalone release
path. These wiring checks are not full acceptance of every historical development
profile, external toolchain image or FIPS compliance. The obsolete fabricated
CLI installer endpoint has been removed from the older backend recipes.

This change does not establish whole-tree independent authorship, every enterprise
capability, live external-provider parity, cloud readiness or the remaining UI
work. Existing third-party notices remain visible. The formerly vendored Go
authorization module is absorbed by [Vaultix policy](0078-vaultix-policy-ownership.md).
The broader migration and recorded-workflow plans remain
open. Operator data and encryption keys must be preserved during image updates;
the build verifier does not deploy or replace the existing operator database.
