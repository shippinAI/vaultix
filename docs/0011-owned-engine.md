# 0011 — Vaultix is Infisical, renamed, owned

**Status:** accepted (2026-08-29)
**Owner:** AngryVibes LLC. **Host:** shippin.ai. **Product:** Vaultix.

Vaultix is **not** a five-table toy and **not** a wrapper around the
vendor image. It is the Infisical MIT core (pin **v0.162.19**), forked
into `core/`, remotes off, customer chrome **Vaultix**.

Same move as Tradere’s mail core: we run **our** tree.

## 1. What is what

| Piece | Role |
| --- | --- |
| `core/` | The secrets engine. Infisical MIT core, renamed. UI title Vaultix. `keySource` vaultix. License server empty. |
| `db/` | Owned schema overlay (already rebranded). Copied into `core/backend/src/db`. |
| `panel/` | Shippin overlay: PIN, lessons, Clyffy, manager. Talks to core via `internal/core/wire.go`. |
| `ee/` in core | Their paid tree. Ships only with a valid Infisical license key. |

## 2. Rebrand that must hold

- Frontend `<title>Vaultix</title>`, favicon, wordmark
- `_vaultix-verification.<domain>`
- `LICENSE_SERVER_URL` default empty, v2 mode `off`
- Compose image built from `core/Dockerfile.standalone-vaultix`, never `infisical/infisical:`
- GHCR: `ghcr.io/shippinai/vaultix` and `ghcr.io/shippinai/vaultix-panel`
- git remotes on `core/` none

## 3. Deploy

`compose/vaultix.yml`: backend (core) + redis + postgres + panel.

Admin of the engine is on port **8200** (API) and **3000** (Vite UI in
native/dev). Shippin overlay is **8201**.

Native without Docker: `scripts/run-core.sh` after `run/core.env`.
Frontend: `cd core/frontend && npx vite --host 127.0.0.1 --port 3000`
(proxies `/api` to 8200). First operator: `/admin/signup`.
