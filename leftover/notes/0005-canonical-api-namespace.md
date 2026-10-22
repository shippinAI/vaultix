# 0005 — Canonical API namespace: every endpoint is ours or refused

**Status:** partially superseded (2026-08-29). Naming canon
(`/api/v1/vaultix/`, `vaultix.*` capabilities) still stands. Phase B “adopt
leftover paths as the store” does **not** — see
[0011-owned-engine.md](0011-owned-engine.md).
**Owner:** AngryVibes LLC. **Host:** shippin.ai. **Product:** Vaultix.
**Schema:** [`schemas/shippin.vaultix.api.v1.json`](../schemas/shippin.vaultix.api.v1.json)
**Inventory:** [`schemas/upstream.core.v0.162.19.endpoints.tsv`](../schemas/upstream.core.v0.162.19.endpoints.tsv)

## 1. What we measured

The pinned core (`v0.162.19`) serves **2,281 operations across 1,453 paths**
(captured from the live instance's own OpenAPI at `/api/docs/json`, classified
against the upstream source tree — sparse scratchpad inspection only; the
`consider-upstream.sh` gate was not touched):

| Tree | Operations | Meaning |
|------|-----------:|---------|
| MIT core | 1,804 | Ours to use, brand, and front |
| `ee/` | 477 | Licensed separately (doc 0001/0003): runs only with a valid Infisical license key, otherwise refilled with Shippin modules |

Where the bulk sits: App Connections (666 ops, per-provider), Secret Syncs
(434), Secret Rotations (285, **ee**), PKI + cert-manager (~470, refused for
Vaultix — certs stay step-ca/Caddy). The product core a vibe coder touches —
secrets, folders, projects, identities — is only ~150 operations.

Every operation is one row in the inventory TSV, and **every row is
source-verified** (basis `source`): `scripts/api-inventory/classify.py`
resolves the upstream Fastify registration tree — nested prefix wrappers,
router maps with enum-valued segments, endpoint factories, curried and
aliased exports — and matches each spec operation to the file that defines
it. Zero unresolved rows at this pin. When the pin moves, regenerate per
`scripts/api-inventory/README.md`; the classifier refuses to guess, so a new
upstream registration pattern shows up as unresolved rows, not as silent
misclassification.

## 2. The rule (already enforced in code)

**One namespace is public: `/api/v1/vaultix/…`.** Everything else is wire
dialect, quarantined in `panel/internal/core/wire.go`. Upstream brand tokens
appear only as *data values* (link `source`, default source URL) — never in a
route, capability, package name, env var, audit action, or compose service.

Naming canon (machine-readable in the schema, checked by `go test`):

| Thing | Rule | Example |
|-------|------|---------|
| Public route | `/api/v1/vaultix/` + kebab-case segments, `{camelCase}` params | `/api/v1/vaultix/projects/{projectId}/secrets/{name}` |
| Capability | `vaultix.` dot-path, lowercase | `vaultix.link.import` |
| Audit action | dot-path, lowercase | `session.stepup` |
| Contract id | `shippin.vaultix.panel.vN` | v1 today |
| Panel package | `internal/<domain>`, domain from the schema | `internal/core`, `internal/pinauth` |

## 3. Domain dispositions (summary — schema is authoritative)

| Vaultix domain | Upstream surface | Disposition |
|----------------|------------------|-------------|
| `session`, `instances`, `link` | none — Vaultix-native | **live** |
| `secrets` | Secrets/Folders/Imports/Envs (`/api/v3|v4/secrets`, …) | **adopt — phase B** |
| `projects` | Projects/Workspace (`/api/v1|v2/workspace`) | **adopt — phase B** |
| `identities` | Identities + auth methods | **adopt-minimal — phase B** (universal auth only) |
| `org` | Organizations | adopt-minimal — phase C |
| `connections`, `syncs`, `sharing` | App Connections / Secret Syncs / Sharing | adopt-later — phase C (minus ee providers chef/oci/oracledb) |
| `integrations-legacy` | old Integrations API | **park** (upstream is deprecating it) |
| `pki` (~470 ops), `kms` | PKI/cert-manager, KMS/HSM | **refuse / park** — step-ca + Caddy own certs |
| `admin-instance` | `/admin`, announcements | operator-only, never in the contract |
| `ee-refused` (496 ops) | rotations, scanning, approvals, dynamic secrets, SSO/SCIM/LDAP/groups, gateways, PIT, audit streams, … | **refuse-ee** — refilled per doc 0003 (Authentik, Tessera, panel approvals, our rotator/inject, pg_dump+escrow, Zuul) |

**Mixed-tree groups.** Source verification shows several core-sounding
groups carry ee rows (Project Roles, Project Templates, Organization Roles,
Groups, some App Connection / Secret Sync providers). The disposition table
routes *domains*; the row-level ledger is the authority on any individual
endpoint. Phase B work items must check the ledger, and the alignment test
blocks `wire.go` from ever depending on an ee row.

## 4. Migration ladder

- **Phase A (done):** panel facade — contract v1, 13 routes, wire dialect
  quarantined.
- **Phase B (next):** facade grows domain-by-domain (`secrets`, `projects`,
  `identities`-minimal). Each domain addition = additive contract change +
  new constants in `wire.go` + rows referenced from the inventory. No
  breaking renames inside v1.
- **Phase C:** fork rebrand — our tree teaches the core to serve
  `/api/v1/vaultix/*` natively (route alias layer). `wire.go` flips to the
  native paths in one commit. Upstream-shaped paths stay behind a compat
  flag for the migration `link` client only.
- **Phase D:** upstream namespace off. CLI/SDK/docs speak Vaultix only.

Rebranding 2,281 paths by hand is not a plan; adopting ~150 that matter,
refusing 496 we must not ship, and parking ~1,100 provider/PKI operations
until an estate needs them — that is the plan.

## 5. Enforcement

`panel/alignment_test.go` fails the build when:

1. a contract route or capability violates the naming canon in the schema;
2. a `wire.go` path does not exist in the endpoint inventory as MIT-core
   (catches typos *and* accidental dependence on an `ee/` endpoint);
3. an upstream brand token appears in panel source or contracts outside the
   two data-value sites the schema allowlists.

The schema and inventory are inputs to the test — updating the pin or the
namespace means updating the schema files, and the test keeps code, contract,
and ADRs from drifting apart.
