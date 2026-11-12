# platform/shippin/

Commercial cloud code for the hosted Vaultix service. Empty on purpose until the first
domain is specified.

Layout: one folder per domain, each holding everything that domain needs (API, service, store,
UI, MCP tools, tests, README). Planned domains, none built:

- `tenants/` customer sign-up and the customer-to-instance record
- `fleet/` provision, upgrade, back up and retire customer instances
- `billing/`
- `quotas/`
- `backups/` scheduled off-site export to customer-chosen storage

Rules:

- Depends on `platform/engine/` through its published contracts in `contracts/`. Never the reverse.
- Holds no secret values and is not a second vault ([0054](../../docs/0054-public-cloud-service.md)).
- Tenancy decision (owner, 2026-11-12): each customer gets their own instance. The ADR that
  replaces the shared-deployment paragraph of 0054 is not written yet.
