# AGENTS.md — Vaultix

**Owner:** AngryVibes LLC. **Host:** shippin.ai. **Product:** Vaultix.

Vaultix is **Shippin secrets you own**. Stay in this tree. Sequence is
only **Auth (Nomen) → Secrets (this instance) → Mesh (Zuul)**.

This file is the agent router. Specs live in `docs/`. Humans start at
[`README.md`](README.md).

**Do not assume chat context.** Load the folder for the task.

## Always

-Build `Dockerfile.standalone-vaultix`.
- `leftover/` is notes and dumps. Do not grow it.
- No fetch, no clone, no connection to a snapshot host. `leftover/consider-upstream.sh` refuses (`docs/0015-frozen-no-connection.md`).
- Identity is Nomen OIDC. Cookie/session stay in Nomen.
- Clyffy manages secret **references**, never values in chat or A2UI.
- Catalog wins: `Decide` is pure. Frontier only with a recorded reason.
- Enterprise valves open only with a Vaultix license / shippin.ai membership (`docs/0013-license-and-membership.md`).
- MCP tools are the source actions + catalog. No second API for models.
- GET is metadata only. Values leave only on inject redeem.
- Expected API failures include a plain `error` string.

## Ask

- Starting mesh work from this checkout.
- Deleting uncommitted work, force-push, global tooling.
- Creating `nomen_vault_*` tables (forbidden here and in Nomen).

## Never

- Fetch, clone, or `git remote` a snapshot host.
- Point compose at a leftover product image.
- Wrap leftover UI as the viewport. A2UI catalog is the draw path.
- Apply `leftover/schema-dump` migrations as the store.
- Put leftover brand tokens in routes, capabilities, package names,
  env var names, audit actions, or compose services.
- Import Nomen/Zuul/Willandra runtimes.
- Add Zod to new product TypeScript.
- Claim leftover import, Doppler-class UX, or Nomen issuer wiring as
  live without tests.
- Open enterprise valves with an env flag when the grant is community.

## Load this for that

| Task | Read |
| --- | --- |
| Engine | `docs/0011-owned-engine.md` + `core/` |
| Estate / Nomen sibling | `nomen/Nomen/docs/product/estate.md` (sibling tree; do not edit it from here) |
| Public API | `contracts/shippin.vaultix.panel.v1.json` |
| Source API / Clyffy | `docs/0009-clyffy-specialist-boundary.md` |
| A2UI / MCP / configure | `docs/0012-a2ui-mcp-configure.md` + `panel/internal/runtime` |
| License / membership | `docs/0013-license-and-membership.md` + `panel/internal/license` |
| Self vs hosted + manager | `docs/0014-skus-and-manager.md` |
| Leftover dump | `leftover/README.md` |

## Commands

```bash
cd panel && go test ./...
scripts/check-owned.sh
# engine (native): scripts/run-core.sh
# UI (native):     cd core/frontend && npx vite --host 127.0.0.1 --port 3000
# compose: copy compose/self.env.example → compose/vaultix.env, then scripts/up.sh
# GHCR:    bash scripts/publish-github.sh
#          images ghcr.io/shippinai/vaultix and ghcr.io/shippinai/vaultix-panel
```

Engine: `GET http://127.0.0.1:8200/api/status` and UI `http://127.0.0.1:3000`.
Overlay stamp: `GET /api/v1/vaultix/trust`. Overlay health: `GET /api/v1/vaultix/health`.
