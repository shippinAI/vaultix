# Native instance install and upgrade

Vaultix's compiled Go CLI owns the single-instance lifecycle in
`internal/platform`. `vaultix server` selects artifacts, records an immutable
operation, reconciles Docker resources, verifies recovery and applies the chosen
image. Docker Compose is its deployment driver. It does not execute a downloaded
shell installer, call a second secrets engine or replace the application store.

This implements a bounded part of [Platform Services](0108-platform-services-and-upgrades.md)
and [delivery acceptance](delivery/acceptance.md). It does not complete arbitrary
database migrations, fleet rolling upgrades, the in-app service panel or release
publication. Linux/amd64 Docker with Compose v2 and sufficient space for a full
encrypted dump plus a temporary restored database are prerequisites. The operator
must have Docker access. The control directory and its parent path must be trusted.

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
```

Without `--plan`, upgrade validates and applies in one invocation. A same-image,
unchanged-configuration upgrade leaves the running application in place. `--json`
omits progress diagnostics; stdout carries the structured result. Errors exit
nonzero, and status reports a pending operation separately from application health.

1. Validate the successful canonical receipt and actual immutable image identity,
   or verify a signed bundle and all artifact bytes with preprovisioned trust.
2. Record the exact image, configuration fingerprint, Docker daemon, database,
   volume and cache identities. Refuse changed migration file sets before stopping
   the application. The initial implementation deliberately has no migration bypass.
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
6. Recheck checkpoint hashes, replace only the application with `--no-deps`, and
   verify its exact image and health plus unchanged database/cache identities.

Immutable `event-*.json` snapshots are fsynced before effects. Recovery reconciles
the saved phase and chosen artifact; it never silently selects a newer release.
Configuration drift blocks the operation. Restore the original reviewed bytes
before resuming. Recovery moves the saved operation forward; it does not overwrite
the live database or blindly roll back after a new application may have written.
An unrecoverable startup needs operator investigation with retained prior image,
checkpoint and keys. Changed migration sets need a separately rehearsed path.

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

## Evidence

`go test ./internal/platform ./cmd/vaultix` exercises file publication, OS locks,
state corruption, private configuration, receipt refusal and age interoperability.
`scripts/test-server-lifecycle.mjs` runs the Linux binary against two distinct
accepted real images and real PostgreSQL/Dragonfly. It exercises installation,
config drift, failed backup, concurrent processes, actual process death and
recovery, existing account/project/ciphertext/decryption, denied anonymous access,
new writes, no-outage same-image application and explicit adoption. Faults are
injected only in a disposable Docker CLI test driver, never in product code.
An additional delayed-initialization case rejects an early restore and proves
the native command waits for the normal PostgreSQL server. It reproduces the
Unix-socket readiness flaw in the initial lifecycle implementation.

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
