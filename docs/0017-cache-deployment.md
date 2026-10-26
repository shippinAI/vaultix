# Dragonfly, Redis, and ElastiCache

Vaultix uses PostgreSQL for its encrypted secrets store. The cache provides
queues, locks, rate-limit state, and coordination. Dragonfly is the default
local deployment; Redis protocol names in the client code describe the wire
protocol, not a requirement to run Redis itself.

Copy `compose/self.env.example` to `compose/vaultix.env`. The defaults start
Dragonfly on an internal network, without a host-published cache port:

```dotenv
COMPOSE_PROFILES=local-cache
VAULTIX_CACHE_PROVIDER=dragonfly
VAULTIX_CACHE_URL=redis://cache:6379
```

Run `bash scripts/up.sh`. Compose reads that same file for substitution and
container variables. The optional legacy panel requires the `panel` profile.
For native development, start your cache separately and point the URL to it;
without an endpoint Vaultix defaults to `redis://127.0.0.1:6379`.

## Redis

For a local Redis deployment, change `VAULTIX_CACHE_PROVIDER=redis`, retain the
local cache URL, then run:

```sh
docker compose --env-file compose/vaultix.env -f compose/vaultix.yml -f compose/cache-redis.yml up -d --build
```

For an external Redis server, remove `local-cache` from `COMPOSE_PROFILES`
(use an empty value if no profiles are wanted) and set `VAULTIX_CACHE_URL` to
its endpoint. Use `rediss://` for TLS. ACL credentials can be supplied as
`VAULTIX_CACHE_USERNAME` and `VAULTIX_CACHE_PASSWORD` without embedding them
in the URL. Never paste credentials into chat or pass them in process arguments.

## ElastiCache

For an ElastiCache replication group with cluster mode disabled:

```dotenv
COMPOSE_PROFILES=
VAULTIX_CACHE_PROVIDER=elasticache
VAULTIX_CACHE_URL=rediss://primary-endpoint.example.cache.amazonaws.com:6379
VAULTIX_CACHE_USERNAME=
VAULTIX_CACHE_PASSWORD=
```

Use the primary endpoint, not a read-replica endpoint: queues and locks write.
For cluster mode enabled, leave the URL empty and use the configuration endpoint:

```dotenv
VAULTIX_CACHE_URL=
VAULTIX_CACHE_CLUSTER_HOSTS=configuration-endpoint.example.cache.amazonaws.com:6379
VAULTIX_CACHE_TLS=true
```

The ElastiCache provider enables TLS and the client's hostname-preserving DNS
mode. Certificate verification remains enabled. VPC routing and security groups
must permit the application to reach the cluster. IAM token refresh and
ElastiCache Serverless have not been implemented or validated by this change.
Use password/ACL authentication with a provisioned replication group for this
configuration path. AWS integration and failover tests are still required.

## Sentinel and compatibility

Redis Sentinel uses `VAULTIX_CACHE_SENTINEL_HOSTS` (comma-separated host:port),
`VAULTIX_CACHE_SENTINEL_MASTER_NAME`, `VAULTIX_CACHE_SENTINEL_TLS`, and optional
Sentinel username/password. Data-node credentials remain separate. Choose one
topology: URL, cluster, or Sentinel. Conflicting configurations fail at startup.

Existing `REDIS_*` settings are accepted. Explicit Vaultix endpoint settings
replace the legacy endpoint selection; ambiguous legacy selections fail rather
than silently connecting to the wrong server. New setup uses `VAULTIX_CACHE_*`.
The standalone Node process forwards the resolved settings to its Go sidecar.

## Queues and migration

Dragonfly runs with `--default_lua_flags=allow-undeclared-keys` for BullMQ's
scripts. Existing queue names and prefixes are preserved. Cache eviction is
disabled. Switching queue prefixes without draining work can strand jobs; the
optimized hashtag mode is intentionally not enabled by this migration.

Snapshots run every five minutes; this is not zero-loss queue durability.
PostgreSQL backups alone do not restore pending cache jobs. Test recovery and
choose operational persistence/HA settings before production use.

For an existing Redis installation, stop producers, drain or explicitly
reconcile pending jobs, back up state, and add the cache settings above to your
existing environment file before switching. The old Redis volume is not
deleted or interpreted as a Dragonfly snapshot. Retain it for rollback, and
do not run `down -v`. Rotate/revoke work that was pending needs explicit review.

Implementation reference: [Dragonfly's BullMQ guidance](https://www.dragonflydb.io/docs/integrations/bullmq).
