# Verified pull requests and server testing

Vaultix source delivery uses GitHub PRs with the required
`vaultix/verified-source` status. Verification runs explicitly on trusted owned
infrastructure. The existing hosted workflows remain manual-only; this does not
register a runner or start paid Actions on push/PR events.

## Merge policy

Repository auto-merge must be enabled. Protect `main` with an up-to-date base,
required local verification, pull requests, resolved review conversations, no
force pushes/deletion and enforcement for administrators. A one-person owner
can use zero required *other-person* approvals while retaining the PR and test
gate. Organizational separation of duties can tighten this policy later.

On an explicitly reviewed, clean branch in the owned repository, open a PR into
`main`, then run:

```sh
node scripts/verify-pull-request.mjs PR_NUMBER sha256:LINUX_GO_TEST_IMAGE_ID
```

The final argument identifies a locally available Linux Go toolchain image used
for the existing race/integration acceptance. Use an image compatible with the
repository's `go.mod`; a mutable image tag is not accepted. The local verifier
also needs the prerequisites in [self-hosted builds](0048-self-hosted-builds.md),
the root Go toolchain, pinned `.ai` test dependencies and authenticated `gh` with
repository/status access. Do not put tokens in command arguments or test logs.

The command checks live protection, head/base and repository ownership; publishes
pending; enables GitHub auto-merge for that exact head; runs delivery-boundary
checks, the canonical standalone build, runtime checks, native CLI builds and
packaged CLI acceptance; rechecks source/head/base/artifact identities; and only
then reports success. GitHub performs the merge when its requirements are met.
Failed checks report failure. A changed head/base needs renewed verification.
Confirm the actual merged result; a successful API call is not itself proof of
a merge or production deployment.

This is **automatic merging after explicitly started local verification**, not
an unattended PR worker. Never run unreviewed fork code on the operator's persistent
host. The driver refuses forks, drafts and conflicts and does not fetch/check out
remote code. Review the local candidate and scripts before running them. Local
receipts are trusted-operator evidence, not tamper-proof remote attestations.
Users with repository write credentials can publish statuses; a separately
credentialed verifier/GitHub App and isolated disposable execution are required
before accepting untrusted contributors or claiming stronger issuer separation.

Old draft PRs are not enrolled automatically. Their old successful checks are
not proof against current `main`. Reconcile direction, source and conflicts first.
Do not use administrative merge overrides to bypass the required status.

## Pull and test on an existing server

Keep the current operator env file, keys, Compose project identity and data
volumes. Do not copy an example env file over an existing installation.

```sh
git status --short
git pull --ff-only origin main
node scripts/build-self-hosted.mjs --check
node scripts/build-self-hosted.mjs
```

Resolve local edits before pulling; never reset them to obtain a clean build.
The build requires committed clean source and reports its exact source revision,
image ID and `.cache/self-hosted-build-*/result.json` receipt. It runs disposable
tests and does not modify the operator's running instance. Successful source
pull/build is distinct from updating the deployed application.

For the existing manual deployment path, first retain a recoverable backup and
check the successful receipt. Persist its `imageId` as `VAULTIX_ENGINE_IMAGE` in
the **existing** `compose/vaultix.env`, then apply that configuration explicitly:

```sh
docker compose --env-file compose/vaultix.env -f compose/vaultix.yml up -d --no-build
```

Use the existing project/configuration if your installation overrides these
paths or the project name. The current `scripts/up.sh` selects `--no-build` only
when `VAULTIX_ENGINE_IMAGE` is also exported in the calling shell; setting it only
in the env file does not select that branch. Do not use `VAULTIX_PULL=1` for a
locally built image. Verify the running revision, health, existing login and secret access.
Keep the prior image and matching backup/key recovery information. Do not assume
an old image is safe against a changed database schema.

The durable review/schedule/drain/upgrade/recovery controller remains a separate
packet in [Platform Services](0108-platform-services-and-upgrades.md). This PR
gate neither installs software nor establishes zero-downtime upgrades.

## Signed bundle verification

`vaultix update verify --bundle DIRECTORY --trust FILE [--checkpoint FILE]`
verifies the release manifest, detached Ed25519 signature, operator-provisioned
trust, freshness, optional previous sequence/digest, artifact completeness and
actual artifact bytes. Its JSON result states `installed: false`. The independent
Node consumer is `node scripts/verify-release-bundle.mjs DIRECTORY TRUST_FILE
[PREVIOUS_CHECKPOINT]`. Neither command creates keys, trusts a key delivered with
the bundle, downloads software, modifies credentials or replaces executables.

Canonical contracts are `vaultix.release-manifest.v1.json`,
`vaultix.release-signature.v1.json`, `vaultix.release-trust.v1.json` and
`vaultix.release-checkpoint.v1.json` under `contracts/`. Metadata uses sorted keys,
two-space indentation, UTF-8 and a final LF. Signatures cover those exact bytes.
Public key IDs are SHA-256 of Ed25519 SPKI DER, encoded as lowercase hex; DER and
signatures use canonical base64. Do not reuse the public RFC test key in deployment.

The verifier requires the Linux/amd64 engine, both native command names for
Linux/amd64 and Windows/amd64, one source archive and one SBOM. CLI names on each
platform must have identical hashes and sizes. It verifies byte identity, not
SBOM completeness, executable behavior, archive extraction safety or database
compatibility execution. Those remain publication/installer acceptance gates.

The returned checkpoint must be retained durably by a future installation owner.
Without a previous checkpoint, verification explicitly reports first-use scope;
it does not claim protection against previously accepted release replay. No
automatic key rotation, unattended installer, TUF conformance or government
cryptographic validation is claimed. Signed publication still requires selected
production key custody and accepted artifacts from the same versioned source.

## Primary references

- [GitHub auto-merge](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/automatically-merging-a-pull-request)
- [Commit status API](https://docs.github.com/en/rest/commits/statuses)
- [Self-hosted execution security](https://docs.github.com/en/actions/reference/security/secure-use)
- [Ed25519 reference vectors](https://www.rfc-editor.org/rfc/rfc8032)
