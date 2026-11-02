# Native CLI installation and activation

`vaultix update install` installs the compiled Vaultix CLI in a dedicated managed
directory. It can consume a local signed bundle or acquire an exact public version
through [the native downloader](0110-verified-release-download.md). No downloaded
shell script, credential-store migration or automatic PATH edit is involved.

The current activation implementation is Linux/amd64 on a local filesystem that
supports `renameat2(RENAME_EXCHANGE)` and permits executable files. Windows executable builds and acquisition
remain available, but Windows installation/self-update is **not implemented**.
U03/U05 in [delivery acceptance](delivery/acceptance.md) remain open for Windows.

## First installation

Build the bootstrap CLI from committed source using `node scripts/build-cli.mjs`,
or obtain a separately verified bootstrap executable. Provision release trust
independently. A release example is not evidence of a published version.

Choose a new directory under an existing trusted parent without group/other write
permission. For example, after creating your private local application directory:

```sh
vaultix update install --directory "$HOME/.local/share/vaultix-cli" \
  --bundle /path/to/verified-release --trust /path/to/release-trust.json

# Alternatively, when that signed public release actually exists:
vaultix update install --directory "$HOME/.local/share/vaultix-cli" \
  --version 0.1.0 --trust /path/to/release-trust.json
```

The command returns JSON containing `binDirectory`. Add that **current directory**
to your shell PATH using your normal shell configuration. It contains two identical
native executable files, `vaultix` and `vaultixl`. It contains no retired-product
command, forwarding script, symlink launcher or alternate secrets engine.

First installation verifies complete signed bundle bytes, selects the Linux pair,
copies and rehashes both executables, validates ELF architecture, and executes the
verified candidate's bounded `version --json` command with no inherited credentials.
Version, source revision and platform must match the signed release. The staged
generation and its files are synchronized before the complete root is published
without replacing any existing directory.

## Updating and inspecting

```sh
vaultix update install --directory "$HOME/.local/share/vaultix-cli" \
  --bundle /path/to/new-verified-release
vaultix update status --directory "$HOME/.local/share/vaultix-cli" --json
```

The installed trust is pinned; supplying a different trust file does not silently
rotate it. Preview selection requires `--preview`. Update selection must advance
both release sequence and semantic version; a same-manifest retry is unchanged.
Downgrades and conflicting metadata are refused. Package-manager or other
unrecognized directories are not adopted or overwritten.

A process-scoped filesystem lock excludes concurrent installers. An update stages
a complete generation under the same managed root, checks all bytes and freshness,
then exchanges `current/` with that directory in one kernel operation. The
executables and accepted checkpoint move together. Existing processes can finish
using their previously mapped executable. New launches through `current/` use the
selected generation. The old generation remains at the returned
`previousDirectory`; it is not silently deleted or automatically reactivated.

After process interruption, `update status` verifies the complete current pair
against its stored signed release, pinned trust and accepted checkpoint. A retry
either applies the still-pending release or reports the already-accepted release
unchanged. Unpublished staging directories can remain after a killed process.
No cleanup command deletes them automatically. A filesystem synchronization error
after activation is reported as an uncertain durable outcome: inspect status
before retrying. Process-kill evidence is not a power-loss durability certification.

Distribution metadata must be fresh at installation. An already accepted CLI does
not stop working when that metadata later expires; status checks its signature and
validity at the recorded acceptance time. Managed files and their parent paths
must remain under trusted operator control. Local metadata is not a defense against
an administrator able to replace both binaries and trust.

## Remaining delivery work and verification

Native tests exercise trust, byte integrity, path/link refusal, cancellation, locks,
expiry, downgrade and checkpoint consistency. `scripts/test-cli-install.mjs`
installs real Linux executables in an isolated native Docker volume, verifies both
names, keeps a proven old executable mapped, updates through the installed CLI,
kills actual installers, checks old/new generations and retries, exercises actual
filesystem exhaustion and a non-executable mount, and compares
credential/config files byte for byte. Test manifests use a public test key and
fixture release versions. They are not public-publisher acceptance.

Windows investigation tested `FileRenameInfoEx` with POSIX replacement flags against
a running executable and received access denied. A sequence that renames each
existing executable away can expose missing or mixed commands, so that sequence
is not shipped. Windows package activation is under investigation; actual signed
package installation, deferred activation, interruption, both native entry points
and existing Credential Manager/configuration compatibility remain required.

Public signed releases, production trust/key custody, coordinated stable promotion,
actual operator server rehearsal and manual acceptance also remain open. Native
instance install/adopt/upgrade is separately owned by [0109](0109-native-install-and-upgrade.md).

Research: [Linux rename semantics](https://man7.org/linux/man-pages/man2/rename.2.html),
[Windows rename information](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/ns-ntifs-_file_rename_information),
and [MSIX update activation options](https://learn.microsoft.com/en-us/windows/msix/desktop/managing-your-msix-deployment-update).
