# Vaultix

Shippin's secrets engine. This tree pins Infisical **v0.162.19** (MIT, `core/`) and runs it as Vaultix. Production at secrets.shippin.cloud is still Infisical **v0.166.8**; this checkout does not contain 0.163–0.166. The upgrade catalog stops at v0.162.18 (2026-08-07). There is no upstream git remote and no sync workflow. Do not fetch Infisical to close that gap (`docs/0015-frozen-no-connection.md`).

API paths and environment variable names that Infisical CLIs and SDKs already send are unchanged. The user-visible product name is Vaultix.

## What changed versus Infisical

- Images are `ghcr.io/shippinai/vaultix` and `ghcr.io/shippinai/vaultix-panel`. Compose builds `core/Dockerfile.standalone-vaultix`. Do not point compose at `infisical/infisical`.
- Phone-home defaults are off: `TELEMETRY_ENABLED` defaults false, PostHog key and host default empty, `ANNOUNCEMENTS_ENABLED` defaults false, `DISABLE_UPDATE_CHECK` defaults true. Update checks run only when `VAULTIX_UPDATE_CHECK_URL` is an http(s) URL. `LICENSE_SERVER_URL` stays empty and `LICENSE_SERVER_V2_MODE` stays `off`.
- Postgres `application_name` and the OTEL service name are `vaultix-core`. The runtime image heap is `--max-old-space-size=768`.
- `DB_TABLE_PREFIX` lets many Vaultix processes share one Postgres database.
- The knex migrations table is `vaultix_migrations` (prefixed when a prefix is set).

Still coupled, on purpose:

- `core/backend/src/ee/` stays under the Infisical Enterprise license. See below.
- The gateway Helm chart and the standalone chart's optional bootstrap job still reference `infisical/cli`. Auto-bootstrap is off. Vaultix does not publish a CLI image; do not point that job at the server image.
- `core/docker-compose.dev.yml` can pull `ghcr.io/infisical/backend-fips-toolchain` as a dev FIPS build cache. It is not the runtime image.
- The Go module path remains `github.com/infisical/api`. The `cmd/infisical` path stays so the existing Docker build keeps working. Neither is a customer-facing name.

## Enterprise (`ee/`) license

`core/LICENSE` is MIT and excludes every `ee/` directory. The enterprise notice is `core/backend/src/ee/LICENSE.md` (Infisical Inc, production use requires an Infisical enterprise subscription). A previous edit had replaced that notice with Vaultix wording; it is restored. This change does not delete, relicense, or rewrite `ee/` code.

The server imports `ee/` to boot: license-plan fallback, audit log, and the permission service. About 67 service packages live under `core/backend/src/ee/services/` (SAML, SCIM, LDAP, OIDC add-on, access approval, secret approval, secret rotation, dynamic secrets, audit streams, PIT, gateway, HSM, KMIP, PAM, PKI extras, trusted IP, rate limit, honey tokens, insights, sub-org, and others). The Go sidecar has matching `internal/ee` packages (external KMS, HSM, license, rate limit).

Options:

1. Keep `ee/` in the tree, leave the license server off, and treat enterprise features as gated. That is Infisical's self-host model. Production use of those features needs an Infisical enterprise subscription. Vaultix community behavior stays on the MIT side plus the panel valves in `docs/0013-license-and-membership.md`.
2. Stop shipping `ee/` and reimplement the boot-critical modules (permissions, license fallback, audit) under the MIT tree. That is a large rewrite and is not done here.
3. Obtain a commercial Infisical license that covers this fork. Not assumed.

## `DB_TABLE_PREFIX`

Set it on the process. Empty (the default) keeps today's table names, so an existing database upgrades in place onto `vaultix_migrations`.

```bash
DB_TABLE_PREFIX=acme   # physical prefix acme_
```

Rules:

- Empty, or a lowercase stem of at most 11 characters (`a-z`, `0-9`, `_`), starting with a letter. A trailing `_` is optional and means the same prefix (`acme` and `acme_` are identical).
- The prefix is fixed for the life of that tenant's tables. Changing it does not rename existing tables.
- Two tenants are two processes with the same `DB_CONNECTION_URI` and different prefixes. Paid or founder tenants omit the prefix and use their own database.
- Names longer than 63 bytes become `prefix + truncated name + _ + 8 hex chars of sha256`. The same input always maps to the same name.

What is prefixed:

- Every knex statement on the app, migrator, and audit-log clients (schema builder, ORM, raw SQL), including the migrations table `vaultix_migrations` and its lock table.
- Index, constraint, trigger, and sequence names, including names like `idx_*` that do not start with the table name.
- The shared trigger function `on_update_timestamp` (a shared function would let `DROP FUNCTION ... CASCADE` hit every tenant).
- The sanitized schema name `analytics`.
- `CLICKHOUSE_AUDIT_LOG_TABLE_NAME` (ClickHouse is not SQL-rewritten; only the configured table name is prefixed).
- The Go sidecar, when it is enabled, using the same table list (`core/backend-go/internal/database/pg/prefix/physical-tables.json`).

Left as written:

- Column names (`usersId`, `projectId`), secret keys, and ciphertext.
- String literals in ordinary inserts and updates. Catalog lookups (`pg_indexes`, `pg_class`, `pg_trigger`, `information_schema`, and the other catalog relations the rewriter knows) have their name literals rewritten.
- Dynamic-secret and customer SQL connections. Those knex clients stay the stock `pg` driver.
- `pg_advisory_xact_lock` ids. Tenants in one database serialize on the same migration locks. That does not leak rows. Simultaneous tenant migrations can wait on each other.
- Postgres roles, the `public` schema, and the optional `pgboss` schema name.

Knex compiles `??` to quoted identifiers before the prefixer runs, and it sends `hasTable` / `hasColumn` names as bound values. Both paths are covered. An unprefixed deployment never enters the rewriter.

## Free-tier shared database

One Postgres database. One Vaultix container per tenant. Same connection string, different `DB_TABLE_PREFIX`. Migrations run at process start, or with the prefix exported:

```bash
DB_TABLE_PREFIX=acme DB_CONNECTION_URI=postgres://vaultix:secret@postgres:5432/vaultix \
  npm run migration:latest-dev
```

For a container around 1GB:

| Setting | Free-tier shared | Dedicated |
| --- | --- | --- |
| `NODE_OPTIONS` | `--max-old-space-size=768` (image default) | raise toward 1536+ |
| `DB_POOL_MIN` | `0` | `0` |
| `DB_POOL_MAX` | `2` | `10` (code default) |
| `DB_REPLICA_POOL_MAX` | `2` | `10` |
| `AUDIT_LOGS_DB_POOL_MAX` | `2` | `10` |

The CLI knexfile pool (min 2, max 10) is separate and only applies to `migration:*` commands. Size Postgres `max_connections` for `tenants × (DB_POOL_MAX + replica pools + audit pool) + headroom`. The Go sidecar reads `DB_POOL_MIN` / `DB_POOL_MAX` and, for replicas, `DB_REPLICA_POOL_*` (falling back to the primary pool size). It is off unless `GO_SIDECAR_SPAWN_ENABLED=true`.

## Build and tag

Pin: `0.162.19`.

```bash
# Smaller GHCR image (no Oracle client, no Go sidecar). This is what .github/workflows/ghcr.yml publishes.
docker build -f core/Dockerfile.ghcr \
  --build-arg VAULTIX_PLATFORM_VERSION=0.162.19 \
  -t ghcr.io/shippinai/vaultix:0.162.19 \
  -t ghcr.io/shippinai/vaultix:latest \
  core

# Full standalone image, including the Go sidecar build.
docker build -f core/Dockerfile.standalone-vaultix \
  --build-arg VAULTIX_PLATFORM_VERSION=0.162.19 \
  -t ghcr.io/shippinai/vaultix:0.162.19 \
  core
```

`Dockerfile.ghcr` is the CI image. `Dockerfile.standalone-vaultix` is what `compose/vaultix.yml` builds. Tags from `.github/workflows/ghcr.yml` on `main` and `v*` tags: `:sha`, `:0.162.19`, `:latest` for the engine, and `:sha`, `:latest` for `ghcr.io/shippinai/vaultix-panel`.

Overlay health: `GET /api/v1/vaultix/health`. Engine status: `GET /api/status` on port 8200.
