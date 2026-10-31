# Native CLI domain selection and capability delivery

2026-10-30. The owner's required command is
`vaultixl login --domain=https://vaultix.cloud`. `vaultixl` and `vaultix` are
supported names for the same native Go executable. Neither invokes a vendor
program. No `--infisical` option is accepted or required.

## Implemented boundary

The existing `cmd/vaultix` and `internal/cli` implementation now accepts
`login --domain=<instance>`. `--api` remains compatible. Explicit flags must
select the same normalized URL; conflicting or empty values fail before reading
credentials or contacting the service. HTTPS is required except literal loopback
HTTP. Embedded credentials, query parameters and fragments are rejected without
reflecting them in diagnostics. Fresh installs use `https://vaultix.cloud`;
existing saved instances remain selected unless the operator changes them.

Login still verifies the protected projects action before saving a credential
bound to that instance. This change preserves token-on-stdin, universal machine
login, device login, renewal locking, revocation handling and reference-only MCP.
The two command names share the same existing configuration and credential store.
They are not separate profiles. A failed domain conflict or rejected credential
must not replace a working saved login.

`node scripts/build-cli.mjs` builds committed LF source archives into native
Linux/amd64 and Windows/amd64 artifacts under `.cache/cli-build-*`. The receipt
records revision, source archive hash, toolchain and binary hashes. Both names
contain identical bytes. No registry, hosted Actions, global installation or
download wrapper is required. This does not establish support for other targets.

Windows uses Credential Manager. The POSIX data-key file fallback now refuses
Windows before creating a key; the previous implementation created a key once
and rejected subsequent reads because Windows mode bits cannot establish POSIX
privacy. Encryption round-trip and wrong-key denial run on both platforms;
the actual POSIX mode assertion runs on Linux. Windows keyring acceptance and
ACL review remain distinct from mocked keyring tests.

## Exact hosted login is still a release gate

The no-flags terminal implementation currently selects Nomen device authorization.
That is a gap against the owner's [dual identity decision](0074-built-in-and-federated-identity.md),
which requires built-in Vaultix login and optional federation. Native built-in
device authorization and instance-advertised method selection still need
implementation and acceptance; the domain flag alone does not supply them.
The current Nomen profile requires a registered public client. The hosted service
does not yet implement the external access-token verification and durable
issuer/subject mapping specified in [0070](0070-nomen-authority-contract.md).
Domain parsing, a public health response or a fixture issuer cannot close this
gap. Do not advertise this packet as completed hosted interactive login.

For built-in login, complete IDENTITY-01..06 in 0074. For the optional Nomen
profile, complete AUTH-03/04 native verifier, account binding, organization selection and
source-action authorization; configure the public client, intended audience and
resource-server introspection credentials; then pass AUTH-05 with real human
approval, protected project access, refresh and issuer revocation. Keep account
linking authenticated, explicit and audited. Never infer linkage from email.
Existing browser login remains available to the web application. Its old CLI
loopback handoff lacks the binding needed for adoption as the new default; do not
reuse its bare-token callback as an expedient authentication substitute.

Read-only checks of the public `/api/status`, `/api/v1/vaultix/connections` and
`/api/v1/vaultix/product` on this date returned HTTP 200. The public metadata
explicitly described hosted Nomen sign-in and enterprise parity as in progress.
This is reachability/status evidence, not an authenticated hosted workflow.

## CLI capability reconciliation

The root native dispatcher was read in full. Retained documentation under
`core/docs/cli/commands` describes a broader CLI than that dispatcher implements.
Those pages are source requirements, not evidence that the commands work. The
[current first-party command index](https://infisical.com/docs/cli/reference),
reviewed on 2026-10-30, also includes command families absent from the native
dispatcher. No snapshot repository was fetched or cloned for this comparison.

| Capability family | Native CLI state | Required acceptance before claiming equivalence |
| --- | --- | --- |
| Domain selection and native naming | Implemented in this packet | Both actual binaries, protected login, denial, saved binding and compatibility |
| Person/device sign-in | Protocol and renewal implementation; hosted identity integration open | AUTH-03 through AUTH-05, organization/MFA policy and real issuer evidence |
| Machine sign-in | Universal auth and supplied access tokens | Preserve current real-image checks; map each other workload auth method separately |
| Project/environment selection | Explicit `init` configuration | Accessible project selection, multiple memberships, invalid scope and revoked access |
| Local secret editing and delivery | `pull`, `push`, `set`, `rm`, `ls`, `run`, `hook`, `daemon` | Full lifecycle/conflict/offline matrix; these commands are not blanket secret-management parity |
| AI integration | Metadata-only `mcp`, configuration and protected status | Keep shared source catalog, tenant checks, value exclusion and issuer revocation |
| Account/profile switching and credential-store management | One saved account; logout; no profile/user/vault command family | Authenticated selection, isolated account state, migration and failure recovery |
| Export formats, bulk remote secret operations and scanning | No corresponding native dispatcher families | Independently authored workflows and permissions; preserve target-only value delivery, no values through AI |
| Dynamic leases, certificates, SSH, PAM and KMIP | No native dispatcher families | Per-protocol/provider lifecycle, denial, expiry, audit and recovery evidence |
| Agents, proxies, gateway/relay and bootstrap | No equivalent native command families | Clarify source ownership and Auth/Secrets scope; request authorization before Mesh work |
| Enterprise platform features | Existing engine surface retained; complete acceptance still open | Follow the canonical capability catalog and per-provider matrices; UI/API presence is not proof |

This is a command-family gap review, not an exhaustive flag/provider parity
specification. The canonical product requirements remain
[the capability catalog](capabilities/README.md), the native migration queue
and preserved API/UI baseline. Features being included for free does not change
authorization or prove that their implementation is complete.

## Verification method

Run root Go tests on Windows and with the race detector on Linux, build both
native executable names, then run `scripts/test-cli-headless.mjs` against the
canonical standalone image. The real-image workflow provisions disposable
accounts/projects and checks protected login, domain conflicts, both executable
names, old `--api` scripts, metadata-only MCP, server revocation, renewal locking,
rejected renewal and logout. Device approval in that harness uses a labelled
fixture issuer; tokens are still authorized by the real disposable application.

Build `core/Dockerfile.standalone-vaultix` through the local self-hosted builder
and retain its application, cache, tenant, recovery and admission receipts.
No live credentials or operator data belong in these tests. Record exact
candidate/image/CLI identities separately before publication. This packet does
not establish the full requested hosted login or all-feature parity.
