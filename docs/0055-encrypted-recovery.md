# Encrypted database recovery acceptance

This is the first executable part of CLOUD-03 in
[0054](0054-public-cloud-service.md). The same standalone Vaultix application
must recover an existing encrypted store with its recovery key, preserve access
checks, and refuse to start when that key is unavailable or incorrect.

## Run the rehearsal

Build the canonical committed image, then run:

```sh
node scripts/test-encrypted-recovery.mjs vaultix:<full-source-commit>
```

The default `scripts/build-self-hosted.mjs` sequence now requires this rehearsal
after its application and cache checks. It uses the verified immutable image ID.
The runner requires local `postgres:16.6-alpine` and
`docker.dragonflydb.io/dragonflydb/dragonfly:v1.34.2` images. It never pulls images,
accepts an operator database/dump/URL, or reads the operator environment file.

Each run creates an internal Docker network, separate source and target databases,
separate Dragonfly instances, and disposable application containers. HTTP requests
execute within those containers: no port is published and there is no outbound
network route. Generated credentials, recovery keys, secret values and the logical
archive remain in the runner's memory. Docker necessarily receives fixture runtime
credentials; access to the Docker daemon remains privileged. Cleanup removes only
containers created by this invocation, their anonymous volumes, and its network.
The result receipt records cleanup failure rather than silently reporting success.

The runner creates an owner, organization, project and synthetic secret through
the real application API. It verifies decryption before backup and checks that the
uncompressed custom-format archive does not contain the planted plaintext value.
After the dump it commits another secret, then stops the source app and cache.
An intentionally truncated restore must fail without leaving partial tables.
Restoring the intact archive into the empty target must reproduce exact encrypted
rows and exclude the later write. Missing and wrong software keys must fail
startup for a recognized key-related reason without changing the encrypted rows.
The correct key must permit a fresh login, redacted metadata, authorized decryption,
and another encrypted write. Anonymous reads and repeated instance bootstrap must
remain denied.

This characterization uses the existing authenticated compatibility value endpoint
only inside the synthetic test process. No value or token is returned to an AI tool,
terminal output or result receipt. It does not authorize adding value reads to MCP
or changing the reference-only AI boundary. A fixture owner is not a public tenant
and its access check does not establish cross-tenant isolation.

## Recovery scope and remaining work

The receipt is `.cache/encrypted-recovery-*/result.json`. It contains the image ID,
revision, archive size/digest, checks, cleanup outcome and local phase durations.
The archive is not retained. This small fixture uses bounded in-memory buffers;
it is acceptance tooling, not a production backup transport or capacity benchmark.
The recovery duration includes the deliberate bad-key tests and is not an RTO.
The post-backup write demonstrates a snapshot boundary, not an accepted RPO.

This test exercises a software-key logical backup with PostgreSQL 16 and the same
application version. CLOUD-03 remains open for WAL/PITR, encrypted off-site archive
storage, key custody/escrow and rotation, representative data volumes, external
KMS/HSM profiles, cross-version/failed-upgrade rollback and measured recovery
objectives. Queue contents and pending provider effects are a separate CLOUD-04
reconciliation requirement; a restored database cannot certify them.

PostgreSQL's [pg_dump documentation](https://www.postgresql.org/docs/16/app-pgdump.html)
describes consistent logical snapshots and the limits of a single-database dump.
The [pg_restore documentation](https://www.postgresql.org/docs/16/app-pgrestore.html)
defines the custom archive restore and single-transaction failure behavior used
here. Neither is WAL point-in-time recovery, and neither encrypts the entire
archive. The data model also contains metadata: encryption of selected columns
does not make a database backup safe to publish.

The older `scripts/backup.sh` is not the implementation tested here. It targets
the historical panel connection variable and names a historical encryption key.
It has no atomic publication or restore acceptance and must not be represented as
the public-service backup solution. The current core software wrapping-key paths
are `ENCRYPTION_KEY` and `ROOT_ENCRYPTION_KEY`; this packet tests the former only.
Preserve the configured key and its encoding, not just the database. Production
backup tooling and key procedures require their own authored implementation.
