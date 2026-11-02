# Verified native release acquisition

`vaultix update download` retrieves an explicitly selected public release through
the compiled Go client. It feeds the existing signed-bundle verifier and native
instance lifecycle; it does not install a CLI executable, execute a downloaded
script, modify an instance or advance an installation's accepted checkpoint.

This implements the acquisition dependency in delivery U02/U03. Production key
custody, signed public publication, Windows installation and running-executable
replacement, and public-release acceptance remain required work.
The Linux native installer is now specified in [0111](0111-native-cli-installation.md);
Windows installation and public publication remain open. An example version below
is not a claim that that release is published.

## Download, review and apply

Create an operator-owned parent directory on a filesystem with sufficient free
space. The selected bundle directory must not exist. Provision release trust
independently using the existing `vaultix.release-trust.v1` contract; never adopt
a key supplied by the same download being verified.

```sh
vaultix update download --version 0.1.0 \
  --directory /srv/vaultix-releases/0.1.0 \
  --trust /etc/vaultix/release-trust.json

vaultix update verify --bundle /srv/vaultix-releases/0.1.0 \
  --trust /etc/vaultix/release-trust.json

vaultix server upgrade --directory /srv/vaultix-instance \
  --bundle /srv/vaultix-releases/0.1.0 \
  --trust /etc/vaultix/release-trust.json --plan
```

The existing instance must first be installed or explicitly adopted as described
in [0109](0109-native-install-and-upgrade.md). Applying the saved operation remains
an explicit action with that lifecycle's configuration, recovery and migration
guards. Local `--from-build` delivery remains available without public releases.

Use `--preview` only with an explicit prerelease version such as `0.1.0-rc.1`.
There is no implicit `latest` selection. Version input omits the `v` tag prefix;
the selected GitHub tag, listing channel and signed manifest must agree exactly.
Draft, missing and incomplete releases fail. Normal update notices and the v1
status API retain their existing behavior; a notice is not install authorization.

If an accepted release checkpoint is available, supply `--checkpoint FILE` to
reject older or conflicting metadata before downloading artifact bodies. Without
it, this is first-use verification, not proof against earlier accepted releases.
The JSON result returns the verified checkpoint with `installed: false` and
`priorCheckpointSupplied`; downloading does not overwrite the supplied file.
The instance installation owner independently retains and checks its checkpoint.

Progress goes to stderr. `--json` suppresses progress; stdout contains one result
matching `contracts/vaultix.release-download.v1.json`. Failure exits nonzero with
no successful result. No Vaultix access token, cookie or tenant information is
used for release lookup or transfer. The command leaves login configuration and
credential stores unchanged. Standard explicit HTTPS proxy configuration can
route requests; it does not relax server certificate or redirect validation.

## Acquisition and filesystem boundaries

- The release API is fixed to `shippinAI/vaultix`; it cannot redirect. Each asset's
  initial URL must match that repository, exact tag and validated artifact name.
- Asset redirects permit HTTPS on GitHub's release CDN hosts, with at most three
  hops. Userinfo, explicit ports, fragments, foreign hosts and GitHub path changes
  are refused. Redirect requests rebuild headers without credentials or cookies.
- Metadata is bounded before parsing. All required manifest artifacts must have
  matching uploaded asset records. Artifact bodies stream with exact signed sizes
  and SHA-256 checks; bundles are capped at 64 GiB total, with the manifest's 32 GiB
  per-artifact limit. API lookup has a 30-second deadline, individual transfers
  15 minutes and the command one hour. Archives are stored as signed bytes and
  never extracted by this command.
- Files are written and synced in a unique sibling staging directory. The existing
  signed-artifact verifier reads the resulting files again, and signature freshness
  is rechecked immediately before publication. Paths cannot traverse symlinks.
- Linux uses `RENAME_NOREPLACE` and directory fsync. Windows uses `MoveFileEx`
  without replacement or cross-volume copying. A competing destination, including
  an empty directory, is preserved. The parent must be trusted; POSIX staging/file
  modes are 0700/0600, while Windows inherits the parent's ACL. Windows power-loss
  guarantees are not inferred from POSIX behavior or successful process tests.

On normal transfer failure or cancellation, the newly created staging directory
is removed. Process termination can leave an unpublished `.vaultix-download-*`
directory; it is never selected as an accepted bundle or resumed implicitly.
Retry into a new destination. Existing bundles and executables are never removed.
If publication succeeded but final directory synchronization reported an error,
the destination can exist despite a failed command: inspect and run `update verify`
before using it. Do not delete a previously accepted bundle merely to retry.

Signed bytes establish artifact identity, not build quality, schema compatibility,
SBOM completeness, compliance certification or successful deployment. The
[Linux native installer](0111-native-cli-installation.md) consumes this verifier
and handles both commands, managed-directory ownership and process interruption.
Windows installation and running-file behavior remain separate required work.

## Evidence and next delivery gates

Native tests exercise signed bytes, exact version/channel, expiry/replay, invalid
and incomplete listings, limits, cancellation, concurrent publication and target
preservation. Existing independent Node/Go signature vectors remain required.
`scripts/test-release-download.mjs` runs the actual Linux CLI through a controlled
TLS endpoint and redirect proxy, verifies output with the independent Node
consumer, injects transfer/authority failures, interrupts a live process and checks
that credentials and accepted artifacts remain unchanged. The test also checks
the JSON result against its canonical schema.

The TLS endpoint and public signing test vector are fixtures. They do not establish
real publisher identity, publicly downloadable assets or stable-channel promotion.
The protected local PR verifier binds this check to its exact packaged CLI, records
the receipt and requires cleanup before publishing success. Development runs remain
explicitly labelled and cannot satisfy the committed-source gate.

Continue U02 publication and U03 Windows installation, then rehearse U04 against the
operator's actual server topology. The broader Auth, Secrets, UI, cloud and DevSCIF
requirements remain in their existing plans.

Research: [GitHub asset download semantics](https://docs.github.com/en/rest/releases/assets),
[published releases and tag selection](https://docs.github.com/en/rest/releases/releases),
[Go HTTP client policy](https://pkg.go.dev/net/http), and
[Go filesystem semantics](https://pkg.go.dev/os).
