# Native instance install and upgrade

Vaultix's compiled Go CLI owns the single-instance lifecycle in
`internal/platform`. `vaultix server` selects artifacts, records an immutable
operation, reconciles Docker resources, verifies recovery and applies the chosen
image. Docker Compose is its deployment driver. It does not execute a downloaded
shell installer, call a second secrets engine or replace the application store.

This implements a bounded part of [Platform Services](0108-platform-services-and-upgrades.md)
and [delivery acceptance](delivery/acceptance.md). It does not prove that an
arbitrary migration preserves meaning, and it does not cover fleet rolling upgrades,
the in-app service panel or release publication. Linux/amd64 Docker with Compose v2
and sufficient space for a full encrypted dump plus a temporary restored database
are prerequisites. A rollback that restores also needs room for a second copy of
the database in the live volume. The operator must have Docker access. The control
directory and its parent path must be trusted.

## First installation

Build committed source on owned infrastructure using
`node scripts/build-self-hosted.mjs` and `node scripts/build-cli.mjs`. The latter
reports the native Linux and Windows executable locations. Run the Linux binary
on the Docker host; no GitHub Actions or registry is required. Install its binary
in an operator-owned executable directory using the host's ordinary file tools.

```sh
vaultix server install --directory /srv/vaultix-instance \
  --project vaultix --site-url https://vaultix.example.com \
  --from-build /path/to/self-hosted-build/result.json
vaultix server status --directory /srv/vaultix-instance
```

The command creates private configuration and random application/database keys,
starts PostgreSQL and Dragonfly, and starts the exact accepted application image.
The HTTP port is loopback-only (8200 by default; `--port` selects another port).
Configure the existing TLS reverse proxy to that address. Owner account and
organization creation continue through Vaultix's normal first-run application
flow; there is no published default password or early OAuth administration step.

An existing private env file may be supplied with `--env-file`, including an
external Redis/ElastiCache setup. This implementation embeds the canonical Compose
definition and preserves its existing cache profile and application configuration.
The real lifecycle acceptance currently exercises Dragonfly. The standalone
canonical acceptance separately exercises Redis; that is not lifecycle acceptance
of a real external ElastiCache deployment.

## Existing deployments

Do not run `install` against an existing store. Enroll a supported existing
Compose deployment explicitly, supplying its **actual** project, origin, loopback
port and private env file:

```sh
vaultix server adopt --directory /srv/vaultix-instance \
  --project vaultix --site-url https://vaultix.example.com --port 8200 \
  --env-file /existing/vaultix/compose/vaultix.env
```

Adoption validates the current Vaultix image, credentials/store connection,
origin, cache configuration and supported network/port topology. It preserves the
running application, database, keys and named volume. A Portainer/Coolify-managed
or customized deployment needs its own reviewed adapter if it differs from this
layout. Do not make two controllers own the same deployment. The instance marker
and OS lock exclude another directory or concurrent process from taking ownership.

## Upgrade and recovery

```sh
vaultix server upgrade --directory /srv/vaultix-instance \
  --from-build /path/to/new-build/result.json --plan
vaultix server upgrade --directory /srv/vaultix-instance --apply OPERATION_ID
vaultix server status --directory /srv/vaultix-instance
# If the operation was interrupted:
vaultix server recover --directory /srv/vaultix-instance
# To return to the previous application (see Rollback):
vaultix server rollback --directory /srv/vaultix-instance
```

Without `--plan`, upgrade validates and applies in one invocation. A same-image,
unchanged-configuration upgrade leaves the running application in place. `--json`
omits progress diagnostics; stdout carries the structured result. Errors exit
nonzero, and status reports a pending operation separately from application health.

1. Validate the successful canonical receipt and actual immutable image identity,
   or verify a signed bundle and all artifact bytes with preprovisioned trust.
2. Record the exact image, configuration fingerprint, Docker daemon, database,
   volume and cache identities. For a changed migration file set, apply the planning
   rules in [changed migration sets](#changed-migration-sets) before stopping the
   application. There is no bypass for them.
3. Send SIGTERM with a 90-second deadline. Require clean exit; forced shutdown
   does not authorize replacement. This is not proof that every background worker
   or externally managed writer has drained.
4. Stream `pg_dump` directly into age encryption. Encrypt the matching application
   environment separately. Never write a plaintext dump to disk.
5. Decrypt into a temporary PostgreSQL instance with no network, restore the full
   archive transactionally, compare migration count and a streamed fingerprint of
   encrypted secret rows, then remove that probe. This is a recovery rehearsal,
   not an assertion of semantic equivalence for every enterprise workflow.
   Readiness requires TCP on loopback: the official PostgreSQL image's temporary
   initialization server can answer Unix-socket probes before normal startup.
6. For a changed migration set, rehearse it on a restored copy and then apply it.
7. Recheck checkpoint hashes, replace only the application with `--no-deps`, and
   verify its exact image and health plus unchanged database/cache identities.

Immutable `event-*.json` snapshots are fsynced before effects. Recovery reconciles
the saved phase and chosen artifact; it never silently selects a newer release.
Configuration drift blocks the operation. Restore the original reviewed bytes
before resuming. Recovery moves the saved operation forward. It never overwrites
the live database or rolls back on its own after a new application may have
written; that takes the explicit `rollback` command below.

Keep the private instance directory and `config/recovery.key` in separate protected
backup storage. The recovery key is an age hybrid identity, independent of the
application encryption key. Database files end in `.database.age`; their matching
`.environment` files are also standard age ciphertext. The application env and
recovery key remain private plaintext configuration on the host. Losing both the
application keys and recoverable configuration loses access to the encrypted store.
No FIPS or government compliance certification is implied.

POSIX mode checks, fsync and directory synchronization are implemented. Windows
uses an OS file lock but inherits directory ACLs and does not claim identical
power-loss durability; the Linux path is the deployment acceptance target.

## Changed migration sets

A plan lists the migrations it will apply in `operation.migration.pending` and
changes nothing. The decision compares both images' migration files with the names
recorded in the store. These are refused before the application stops:

- A candidate that changes the bytes of a migration that already shipped.
- A store holding a migration the candidate does not include, which is a downgrade.
- A held migration lock, which needs investigation first.
- `AUDIT_LOGS_DB_CONNECTION_URI`, because the checkpoint covers one database.
- `GENERATE_SANITIZED_SCHEMA=true`, because startup then changes how migrations run.
- A setting containing a line break, which the one-off container cannot receive.
- A Windows-native CLI. The one-off container reads its settings from `/dev/stdin`, so
  run the Linux binary on the Docker host.

After the checkpoint, two phases run before the candidate application starts.

**Rehearsing.** The checkpoint is restored into a temporary PostgreSQL. The
candidate's own `knex migrate:latest` then runs against it with the real application
settings, in a container sharing that database's network namespace: loopback only,
no route to the live services. The result is read back from the database. Applied
names must equal the candidate's set, the lock must be free and the fingerprint of
`secrets_v2` ciphertext must be unchanged. A failure here, or running out of time,
has changed nothing live, so the previous application restarts automatically and the
command exits nonzero. Ctrl-C instead keeps the operation for `recover` or `rollback`.
A checkpoint that fails or runs out of time before this phase behaves like any failed
checkpoint: the application stays down until one of those two commands.

**Migrating.** The same command runs against the live database in a detached, named
container, and the same checks run before the application starts. If the CLI dies
the container keeps running, and recovery waits for it because removing a run in
progress can strand the migration lock. Knex commits a batch as one transaction
unless a migration in it opts out, as `CREATE INDEX CONCURRENTLY` must, and then each
commits alone, so a failure here can leave some applied. It stops with the application
down for the operator to choose: `recover` retries, `rollback` restores.

Migration output goes to `OPERATION-rehearsal-*.log` and `OPERATION-migrate-*.log`
in the private instance directory, including the output of an interrupted run, and
never to results or diagnostics, because it can quote SQL. The application then
starts, finds nothing pending and validates as usual.

## Rollback

`vaultix server rollback` targets the application recorded when the upgrade was
planned. It stays available after the upgrade finishes, until a later operation
replaces that record. A same-image upgrade counts as a later operation, and an
operation planned by an earlier CLI has no record to return to.

| Upgrade reached | What rollback does | Required |
| --- | --- | --- |
| `planned` | Cancels the saved operation with no Docker effects, including a same-image plan | |
| `stopping`, `snapshot`, `rehearsing` | Restarts the previous application | |
| `migrating` | Restores the checkpoint and restarts; the new application never ran | `--discard-writes` |
| `replacing`, `validating`, `ready` with a changed set | Restores, clears the local cache and restarts | `--discard-writes` |
| Any phase with an unchanged set | Replaces only the image; the database is not touched | |

A restore never overwrites the live database. It restores beside it as
`vaultix-restore-*`, checks the applied migrations and ciphertext fingerprint against
the checkpoint, then swaps both names in one transaction. The database it replaced
stays as `vaultix-replaced-*`, named in `operation.retainedDatabase`, until the
operator drops it, so a rollback taken in error can still be investigated. An
interrupted rollback resumes with `recover`. It does not repeat a committed swap, and
it keeps anything written after one. An application started by hand before the swap is
stopped again first, because the operator has already accepted the restore.

`--discard-writes` accepts that writes made since the checkpoint leave the live
store. Every restore asks for it. The new application's port is published as soon as it
starts, and before that an application started by hand can have written, even if it
has been stopped again. Clearing the local cache keeps entries about those writes from
being served, and it also discards queued background jobs. An external cache is not
cleared: the result says so, and the operator must clear it. Down migrations are never
run.

Rollback removes anything an interrupted attempt left behind, including a restored
copy of the store and a container holding real settings.

These refuse a rollback before anything is saved or stopped, so the application is
left as it is: a missing prior image, configuration drift, a database container with
another image or volume, a missing database or cache container, a running image that
is neither side of the upgrade, and, when a restore is needed, a changed or missing
checkpoint or recovery key. If one of these changes after a rollback has started, it
stops with the application down until that is put right, then `recover` continues.

Rollback follows a database or cache container recreated while an operation was
pending, because its ID can never come back and the data is in the named volume.
`recover` moving an upgrade forward does not: a fresh volume under the same name would
look identical, so it refuses and `rollback` is the way out. For the same reason a
rollback that does not restore must find the store's migration history in the recreated
container before it starts an application there.

To start a missing dependency, with `PROJECT`, `DIR` and `IMAGE` taken from the
operation, where `IMAGE` is an image ID without its `sha256:` prefix:

```sh
docker compose --project-name PROJECT --project-directory DIR/config \
  --env-file DIR/config/vaultix.env -f DIR/config/compose.yml \
  -f DIR/selection-IMAGE.json up -d --no-deps --no-build --wait db cache
```

**If no command can proceed.** A lost checkpoint file blocks both `recover` and
`rollback` when the operation depends on it, because neither continues without a way
back. A same-image operation or an installation has no rollback, so a recreated
dependency blocks it. The last resort leaves the journal behind:

1. Wait for any container labelled `vaultix.lifecycle.operation=OPERATION` to exit and
   remove it, because it can hold real settings.
2. Start the application from a known-good container, or with the command above
   naming `backend`.
3. Remove the `vaultix-owner-PROJECT` container, then `adopt` into a new directory.

The old directory stays as a record. The new one has no checkpoint from before the
failed upgrade, so back up the store first. Rollback does not check free space: a full
disk during a restore stops with the application down until space is freed, then
`recover` continues.

## Trust and distribution

`--from-build` trusts the local operator's accepted build receipt; it is not a
signed third-party attestation and does not enforce release chronology. Keep it
and the exact image under the same trusted ownership. Signed delivery instead uses:

```sh
vaultix server upgrade --directory /srv/vaultix-instance \
  --bundle /path/to/release-bundle --trust /path/to/preprovisioned-trust.json
```

Install accepts the same bundle arguments. Existing release verification checks
artifact digests, signature, expiry and replay checkpoint before Docker import.
The CLI does not generate a publisher key or trust a key received with the bundle.
Production key custody, signed stable publication, public binary downloads and
automatic update discovery remain separate release work. A verified source merge
does not mean a published release or an upgraded customer server.

The native `vaultix update download` acquisition command is described in
[0110](0110-verified-release-download.md). It retrieves a complete signed bundle
from an explicitly selected published release using independently provisioned
trust. This client capability is not evidence that a public release exists.

## Evidence

`go test ./internal/platform ./cmd/vaultix` exercises file publication, OS locks,
state corruption, private configuration, receipt refusal, age interoperability, the
migration planning rules, rollback eligibility and state written by the earlier CLI.
`scripts/test-server-lifecycle.mjs` runs the Linux binary against two distinct
accepted real images and real PostgreSQL/Dragonfly. It exercises installation,
config drift, failed backup, concurrent processes, actual process death and
recovery, existing account/project/ciphertext/decryption, denied anonymous access,
new writes, no-outage same-image application and explicit adoption. Faults are
injected only in a disposable Docker CLI test driver, never in product code.
An additional delayed-initialization case rejects an early restore and proves
the native command waits for the normal PostgreSQL server. It reproduces the
Unix-socket readiness flaw in the initial lifecycle implementation.

When the two images' migration sets differ, that test takes the changed-set path and
its report names the migrations applied.

`scripts/test-server-migration.mjs` drives the changed-set path with the same binary,
real PostgreSQL and Dragonfly, and images derived from the candidate that add
test-only migrations. It covers planning and cancelling, each refusal it can reach,
failing and ciphertext-rewriting rehearsals, a partial live migration, an application
that never becomes healthy, a completed upgrade with new writes, rollback from each
of those, Ctrl-C during rehearsal, and SIGKILL during rehearsal and live migration,
after a restore that was never swapped and just after the swap. It also covers
recreated dependencies, an application started by hand, the last resort above and a
fresh volume under the store's name. Its report records rollback time, which on this
small store says nothing about a large one. Running out of time is exercised by unit
test only, up to the first Docker effect of the restart.

Not exercised: a full disk, an external cache, an external audit database (refused,
unit tested), and an operator's production store. The rehearsal applies migrations
but does not boot the candidate application on the copy, so that failure appears at
validation, where rollback applies. The dump and rehearsal share the command's
30-minute limit, so a migration that cannot finish inside it cannot pass yet. The
ciphertext fingerprint covers `secrets_v2`, not every encrypted table. A migration that deliberately rewrites that ciphertext is
refused and needs its own reviewed path. New state fields are additive to the v1
contract, but an earlier CLI refuses a journal once this one has planned an upgrade in
it, even a finished one, so keep using this CLI from then on.

Local `.cache/lifecycle-inputs.json` supplies `baselineReceipt`, `candidateReceipt`,
`cli`, and an immutable `clientImage` with Docker CLI/Compose. `development: true`
labels worktree development runs; those are not committed release evidence. The
PR verifier binds its candidate image and CLI itself and rejects development proof.
Evidence does not establish whole-product parity or cloud readiness.

Research: [Compose service replacement](https://docs.docker.com/reference/cli/docker/compose/up/),
[bounded stop](https://docs.docker.com/reference/cli/docker/container/stop/),
[transactional PostgreSQL restore](https://www.postgresql.org/docs/16/app-pgrestore.html),
[age Go API](https://pkg.go.dev/filippo.io/age@v1.3.2), and
[TUF metadata roles](https://theupdateframework.io/docs/metadata/).
