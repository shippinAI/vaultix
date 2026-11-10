# 0119 — Vaultix schema and API namespaces

Status: decided 2026-11-10 by the owner; execution in progress. Supersedes the
"Encrypted store" row of [docs/plan/naming.md](plan/naming.md), which ruled out a
table prefix scheme, and its "do not mass-rename" rule for tables and the API.
Pre-release ([0118](0118-pre-release.md)) is what makes a breaking rename acceptable now.

Vaultix evolved from an inherited engine. Its tables and HTTP API still carry that
engine's names and layout. Both now move to Vaultix's own structure, grouped by the
same product domains the MCPL runtime uses.

## Tables: `vx_<group>_<entity>`

Every table gets the `vx_` prefix and a group. The rule set is
[`scripts/lib/table-namespaces.mjs`](../scripts/lib/table-namespaces.mjs); the
rendered map of all 300 tables is `docs/schema/table-namespaces.json`.

| Group | Holds |
| --- | --- |
| `auth` | People signing in: users, sessions, MFA, SSO configuration, API keys |
| `identity` | Machine identities and their authentication methods |
| `workspace` | Organizations, projects, environments, memberships, roles, groups |
| `secrets` | Secrets, folders, versions, snapshots, imports, tags, rotation, dynamic secrets |
| `policy` | Approval policies and requests, access requests, validation rules |
| `connect` | App connections, syncs, integrations, webhooks, migrations, proxied services |
| `net` | Gateways, relays, resource authentication |
| `pki` | Certificate authorities, certificates, profiles, enrollment, SSH certificates |
| `kms` | Key management, external KMS, HSM, KMIP |
| `pam` | Privileged access management |
| `scan` | Secret scanning |
| `ai` | AI and MCP servers, endpoints, activity |
| `operate` | Audit logs, notifications, alerts, queues, instance configuration |
| `public` | Pre-sign-in surfaces such as early-access requests |

Entity names drop the group stem they already carried (`secret_folders` becomes
`vx_secrets_folders`, `pki_signers` becomes `vx_pki_signers`). Where the inherited engine
kept an old and a new version of a table, the current one takes the plain name and the
old one is marked `legacy_` (`secrets_v2` becomes `vx_secrets_secrets`, `secrets`
becomes `vx_secrets_legacy_secrets`). Examples: `users` becomes `vx_auth_users`,
`auth_token_sessions` becomes `vx_auth_sessions`, `super_admin` becomes
`vx_operate_instance_config`, `vaultix_early_access_requests` becomes
`vx_public_early_access_requests`. No name collides and none exceeds PostgreSQL's 63
characters; the generator refuses either.

### How the rename is carried out

The real store was inventoried first (278 tables, 486 partitions, 9 functions whose bodies
name tables). That changed the plan: about 20 historical migrations call service and
data-access code, so freezing them on the inherited names would break fresh installs.

1. **One map, frozen as history.** `docs/schema/table-namespaces.json` (312 rows: the 300
   `TableName` entries and 12 tables that raw-SQL migrations create) records each inherited
   name and its `vx_` name. `node scripts/map-table-namespaces.mjs --check` proves the map
   follows the rules, `TableName` matches it, and the runtime list
   `core/backend/src/db/table-namespaces.ts` is current.
2. **Every migration uses the new names** through `TableName`, so a fresh database gets
   `vx_` tables from the start. Raw SQL inside migrations was rewritten to match. The 12
   raw-SQL tables are still created under their inherited names and renamed afterwards.
3. **An existing store moves first.** Every migration path (startup, both knexfiles, which
   `vaultix server upgrade` runs, and the e2e environment) uses
   `NamespacedMigrationSource`: knex's file list and order, with two steps in front of each
   migration. `renameLegacyTables` renames any `TableName` table still on its inherited
   name, in one transaction; it is idempotent and refuses if both an inherited and a `vx_`
   table exist. Partitions are renamed with their parent, and functions whose bodies name a
   renamed table are recreated with the new name. A store several migrations behind
   therefore upgrades the same way on every path.
   The other step keeps automatic index, unique and foreign-key names on the inherited
   table name (`table-namespace-index-names.ts`). PostgreSQL cuts identifiers at 63
   characters, and the longer `vx_` names made two constraints collide on a fresh store;
   with inherited names a fresh store gets exactly the constraint names an upgraded one
   keeps.
4. **The namespace migration** (`20261110120000_vx-table-namespaces`) then renames the raw
   tables, records the change in the migration set (so `vaultix server upgrade` rehearses
   it on a restored copy), and its `down` reverses everything.
5. **Columns keep their names.** Junction tables named their foreign-key columns after the
   tables they join (`secret_tagsId`, `secrets_v2Id`); those stay, through
   `core/backend/src/db/junction-columns.ts`, on fresh and upgraded stores alike.
   Automatically named primary keys (`<table>_pkey`) follow their table, so both stores have
   `vx_…_pkey`. The handful of indexes a migration names explicitly from `TableName` keep
   the spelling they were created with; nothing later refers to them by name.
6. **A guard keeps it that way.** `node scripts/check-table-namespaces.mjs` fails if an
   inherited table name appears in SQL or a database call in TypeScript, Go, scripts or the
   CLI. Both checks are canonical build stages.
7. **The upgrade tool reads either side.** `vaultix server`'s encrypted-row fingerprint
   finds `vx_secrets_secrets` or `secrets_v2`, so a checkpoint taken before the rename
   compares with the migrated copy after it.

### Rollback across the rename

An older binary cannot run on a renamed store. Rolling back across this change means
`vaultix server rollback` restores the pre-upgrade database from its checkpoint, which is
already the designed path for a changed migration set, and writes made after the upgrade
are lost (`--discard-writes`). The historical tests that run an older binary on an advanced
store (`verify-device-*-rollback`) and the per-migration upgrade tests pinned to older
images (`test-{device-grant,early-access,nomen-binding}-migration`) predate this and are
not valid across it.

### Acceptance

- The canonical build on a fresh store, with both namespace checks.
- `node scripts/build-self-hosted.mjs --capabilities`: Go integration and backend unit and
  integration suites against the renamed schema.
- `scripts/test-server-lifecycle.mjs` with a pre-rename baseline: install, upgrade across
  the rename (no table left on an inherited name, encrypted rows unchanged) and rollback.

## API: `/api/vx/v1/<domain>/…`

The Vaultix API gets its own root, grouped by the MCPL domains: `public`, `auth`,
`identity`, `workspace`, `secrets`, `policy`, `connect`, `ai` and `operate`, plus the
product areas `pki`, `kms`, `pam` and `scan`. One router per domain owns its routes,
its MCP tools and its catalog entries, so the UI, MCP and API use the same actions.

- New Vaultix routes go under `/api/vx/v1/<domain>/`. The provider import added in
  [0117](0117-provider-import.md) is the first to move:
  `/api/vx/v1/connect/imports/providers`, `…/:provider/review` and `…/:provider/import`.
- Inherited routes (`/api/v1`–`/api/v4`) and the earlier native prefix
  `/api/v1/vaultix/*` keep working until each domain's replacement exists and a test
  covers its existing clients. Then they become aliases and are removed later.
- Route and operation names stay Vaultix names; inherited brand tokens never enter
  them (AGENTS.md).
