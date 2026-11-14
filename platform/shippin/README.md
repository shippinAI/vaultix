# platform/shippin/

Commercial cloud code for the hosted Vaultix service. Spec: [0125](../../docs/0125-hosted-control-panel.md).

Layout: one folder per domain, each holding everything that domain needs (API, service, store,
UI, MCP tools, tests, README).

- `fleet/` (built) the record of customer instances and their health, read through `internal/platform`
- `console/` + `cmd/vaultix-control/` (built) the private operator console: loopback only, operator key
- `backups/` scheduled off-site export to customer-chosen storage
- `quotas/` per-profile resource limits
- `tenants/` customer sign-up and the customer-to-instance record
- `billing/`

Rules:

- Depends on `platform/engine/` through its published contracts in `contracts/`. Never the reverse.
- Holds no secret values and is not a second vault ([0054](../../docs/0054-public-cloud-service.md)).
- Tenancy decision (owner, 2026-11-12): each customer gets their own instance
  ([0125](../../docs/0125-hosted-control-panel.md)).
- `go test ./platform/shippin/...` runs its tests.
