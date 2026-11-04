# Vaultix releases and update availability

The application and native `vaultix` / `vaultixl` CLI share the release-status
contract in `contracts/vaultix.updates.v1.json`. This document describes the
implementation and its acceptance gates; a source commit does not establish a
published stable release or complete MCP Apps support.

[Verified PR delivery](pr-delivery.md) documents the local merge gate, server
pull/build path and the new `vaultix update verify` signed-bundle consumer.
Verification is implemented separately from installation and production trust
provisioning. The [Platform Services plan](0108-platform-services-and-upgrades.md)
retains the remaining graceful-upgrade and fleet acceptance gates.

## Build identity and release channel

Both local build commands derive their version from one exact `vMAJOR.MINOR.PATCH`
Git tag on the committed revision. SemVer prerelease/build suffixes are supported;
ambiguous version tags fail the build. Untagged source gets `dev-<revision>`.
The standalone frontend, server environment and image label receive the same
version. CLI binaries carry version and source revision through linker metadata.
The existing Linux/amd64 and Windows/amd64 build matrix, aliases, source archive
hash and toolchain receipts remain intact. No global install or hosted runner is
required.

## Verification and retained gaps

The canonical standalone build runs `scripts/test-updates-clyffy-workflow.mjs`
inside the existing disposable application workflow. It checks actual build
metadata, denied anonymous access, keyboard tooltips/dialogs, narrow reflow,
scrollable information, nested guidance and a persisted secret reference through
MCP. Secret-value canaries must be absent from the response and UI. Missing-folder
denial must clear stale results and allow recovery. Release-available, network
failure and untrusted-link cases are explicitly browser fixtures; they do not
prove that a release was published. Full-page accessibility scans retain their
failures and require source fixes rather than exclusions. Real screen-reader and
embedded-host review remain open.

Local CLI delivery retains source archives and binary checksums for both command
names on Linux and Windows. The existing packaged CLI proof exercises login,
MCP protocol output and reference-only permissions against the standalone image.
Public release assets, signatures and an artifact manifest are still separate
delivery work. The owned GitHub repository was confirmed public with no releases
on 2026-10-31; version checks must not invent an available release.

An exact source tag identifies a build; it does not publish an update. Discovery
uses only `https://api.github.com/repos/shippinAI/vaultix/releases/latest`.
Accept only published, non-draft, non-prerelease metadata with a valid stable
SemVer tag. Prerelease ordering is preserved; build metadata does not affect
precedence. Construct release links under the owned repository instead of
trusting a returned URL. Redirects, oversized/malformed responses and request
timeouts do not become a successful check.

The stable channel is a coordinated CLI/application release. Before publishing
one, build and exercise both artifacts from the same tag, retain their source
and digest receipts, publish installation/upgrade notes and checksums, and verify
the published assets. Existing local builders produce artifacts; they do not
upload releases. Signed distribution, automatic binary replacement, additional
platform execution and a published artifact manifest remain separate gates.
Do not advertise source pushes as installed or downloadable releases.

## Owner publication command

`scripts/publish-release.mjs` now owns draft/upload/publish effects on the public
`shippinAI/vaultix` repository. It consumes an **already signed** bundle and the
six retained receipts from the local PR verifier. It does not create a signing
key, grant trust, manufacture a bundle/SBOM, or turn fixture tests into evidence
of a real public download.

Tag the reviewed candidate locally **before** running the PR verifier so its
image and CLI carry the intended version. After that exact candidate has passed
and merged, push that same tag. Do not retag different bytes or use a receipt from
a previous unversioned build. Run the publisher from a clean checkout of the
tagged candidate; it checks both local/remote tag identities and ancestry in main.

Keep an input JSON file locally, for example:

```json
{
  "bundle": "/srv/releases/vaultix-0.1.0-alpha.1",
  "trust": "/srv/release-owner/public-trust.json",
  "acceptance": "/srv/build/.cache/pr-verification-EXACT/result.json",
  "notes": "/srv/releases/notes.md"
}
```

An optional `checkpoint` points to the previously accepted canonical release
checkpoint. The trust file contains public keys provisioned independently of the
bundle. Neither trust, local receipts nor private configuration becomes a release
asset. Supply the prepared image archive, native executables, source archive,
SBOM and detached signature described in the manifest contract. Build receipts
bind the image identity and executable hashes; source/SBOM generation and review
remain producer obligations. A signature alone does not establish their contents.

```sh
node scripts/publish-release.mjs /srv/releases/publication.json --plan
node scripts/publish-release.mjs /srv/releases/publication.json --draft
node scripts/publish-release.mjs /srv/releases/publication.json --stage
# Verify public download/install and the owned-server upgrade before promotion.
node scripts/publish-release.mjs /srv/releases/publication.json --publish
```

The default is `--plan`, with no remote mutation. Draft mode uploads only the
signed artifact set and its manifest/signature. Stage mode publishes the complete
release with `make_latest=false`, making an explicit-version download available
without selecting it for stable update discovery. Stable `--publish` requires an
already staged public release and promotes those identical signed bytes to latest.
The operator must accept the actual download/install/server evidence between these
commands; the publication tests cannot supply that review. Publication rechecks local
inputs, the source tag, the reviewed notes and every uploaded asset's size/state
and GitHub SHA-256 digest. Matching complete draft uploads resume; unknown,
incomplete or conflicting assets require investigation. There is no clobber,
delete or tag-move path. A lost response can follow successful publication;
retrying first verifies the existing release instead of replacing it.

Each GitHub asset must be under 2 GiB, so measure the compressed image export
before signing. Prefer repository release immutability, with all assets present
in the draft before publication. The command does not enable that repository
setting or claim that it is enabled. See [GitHub release limits](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases)
and [immutable release publication](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases).

The signed manifest's channel/version determines GitHub's prerelease flag.
A preview must not be promoted by toggling that flag: the signature and downloader
would then disagree with the listing. Use a coordinated stable version for the
stage/test/promote path; its bytes stay unchanged. Stable publication refuses to move `latest` backward or
substitute another build-metadata suffix at equal SemVer precedence.

`node --test scripts/release-publication.test.mjs` exercises signed local files,
receipt binding, invalid inputs, interrupted uploads and publication denial with
a controlled GitHub adapter. It is part of the PR delivery boundary gate. Actual
owner-key custody, bundle production, public acquisition/installation and remote
server acceptance remain required before calling the public update path ready.

## User experience

`vaultix version [--json]` reports the CLI build without network access.
`vaultix update check [--json]` performs an explicit bounded release check.
Human-terminal login, initialization and authentication-status commands can show
a cached update notice on stderr. They use a daily cache, with a 1.5-second
budget; failures do not fail the original command. MCP, JSON output, secret
delivery and offline execution do not trigger notices. Set
`VAULTIX_DISABLE_UPDATE_CHECK=true` to disable CLI checks. Credentials and local
vault configuration are never sent to release discovery.

The application toolbar opens an accessible version/update dialog on desktop
and mobile. Its authenticated `GET /api/v1/vaultix/updates` reads cached metadata
without outbound network requests. `POST /api/v1/vaultix/updates/check` accepts
only `{}` and refreshes release metadata, with request limits, coalescing and a
one-minute cooldown. Neither endpoint installs software or changes deployment.
The existing weekly job and boot refresh use the same owner and cache. A new
cache namespace prevents old unverified release data from becoming a notice.

Statuses distinguish available/current from unknown, unavailable, unpublished,
development, disabled and operator-managed cloud deployments. Offline settings
remain authoritative. A failed check never says the instance is up to date.
The dialog links release notes and explains backup, verification and rollback
before operator-controlled upgrades.

## Clyffy interaction surface

The authenticated toolbar also opens a lazily loaded Clyffy workspace. Its
project/environment/folder controls call the existing catalog-authored MCP
reference tools with the current actor's permissions. Results contain reference
metadata only. Organization-specific query keys and remounting prevent stale
results from a previously selected organization appearing in the new workspace.
Guided lessons, contextual tooltips, status messages, denial/retry states and
focus restoration use the shared native components.

This is an in-application MCP consumer. It is not an AI inference session,
remote viewport driver, or embedded client app. A separate native MCP Apps resource
and host capability negotiation are now implemented as described in
[embedded interactions](mcp-embedded-apps.md); actual compatible AI-client
acceptance remains open. The [delivery plan](0075-usable-secrets-and-update-delivery.md)
tracks that review and stable distribution. The existing readonly tools do not gain secret-changing authority from
being displayed in a sheet. Whole-workflow conversion and real screen-reader
acceptance remain required.
