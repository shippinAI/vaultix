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

1. **Historical migrations are frozen.** They keep creating the inherited names, read
   from a snapshot `LegacyTableName`, so a fresh database and an upgraded one follow
   the same path. A migration's past behavior never changes.
2. **One rename migration** moves every table that still has its inherited name to
   its `vx_` name with `ALTER TABLE … RENAME`. It is idempotent and transactional.
   Rows, columns, indexes, foreign keys and triggers move with the table; constraint
   and index names keep their old spelling for now.
3. **One source of names per language.** TypeScript uses the generated `TableName`
   values. Go uses generated constants. SQL text in both is rewritten to the new names,
   and a guard fails the build if an inherited table name appears in SQL again.
4. **Upgrade path.** The rename is a changed migration set, so
   `vaultix server upgrade` rehearses it on a restored copy of the live database,
   with no network, before touching the live one ([0109](0109-native-install-and-upgrade.md)).
5. **Acceptance.** The full canonical build, the Go and backend capability suites
   (`node scripts/build-self-hosted.mjs --capabilities`) and the server-migration
   rehearsal against a store created before the rename.

Things to check during execution, before claiming the rename complete: partitioned
audit-log tables and their partition maintenance, database functions or triggers whose
bodies name a table, raw SQL in scripts and tests, and the knex migration table itself.

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
