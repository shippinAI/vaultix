# JOURNAL

## 2026-08-30 — shippinAI/vaultix + GHCR

Repo https://github.com/shippinAI/vaultix (private), same org as Nomen.
Images: `ghcr.io/shippinai/vaultix` (engine) and
`ghcr.io/shippinai/vaultix-panel` (overlay). Workflow
`.github/workflows/ghcr.yml`. Engine Dockerfile labels Vaultix, leftover
CLI installer removed, telemetry off. Compose pulls those names.
`scripts/publish-github.sh` is the push. First operator still
`/admin/signup` on the live engine.


The engine is `core/` pin v0.162.19, remotes off. Customer chrome is
Vaultix (title, logos, support@shippin.ai, no 
`frontend/src`). License server empty / v2 off. Postgres database
`vaultix_engine` holds the tables that need to be vaultix schema (700+ tables), not the
five overlay tables. Native run: API `http://127.0.0.1:8200`, UI
`http://127.0.0.1:3000`. First operator: `/admin/signup`. Overlay
on `:8201` is PIN/lessons/Clyffy/manager only.

The product is `core/` at pin v0.162.19, remotes off, UI title Vaultix,
verification `_vaultix-verification`, license server off. Schema overlay
from `db/`. Compose builds `Dockerfile.standalone-vaultix`. The Go
overlay is PIN/lessons/Clyffy/manager only. Not a five-table replacement.


## 2026-08-29 — self / hosted + manager

Living product no longer carries leftover ADRs (moved to
`leftover/notes/`). Deploy pack: `compose/self.env.example` (you) and
`hosted.env.example` (your users). Manager API + `/manager/` is the
enterprise panel starting point. Naming an instance does not provision
a VM. Doc 0014.

## 2026-08-29 — public brand

Customer surfaces carry Vaultix wordmark, mark, favicon, og card
(`branding/`, served at `/viewport/` and `/favicon.svg`). Copy is
AngryVibes LLC / shippin.ai. Leftover vendor names are forbidden in
customer UI (`branding/strings.yaml`). Doppler PNGs in
`docs/references/` are competitor screenshots, not Vaultix art.

## 2026-08-29 — AngryVibes license / membership

Every living `.md` stamps **AngryVibes LLC / shippin.ai**. Enterprise
valves open only with a Vaultix grant (`panel/internal/license`,
`GET /api/v1/vaultix/license`, doc 0013). Community cannot hold
approvals even if the env flag is set. No leftover license server.
The grant transcription in `legal/` was not rewritten.

## 2026-08-29 — running

This checkout's `run/vaultix` binary is listening on `127.0.0.1:8201`.
Postgres database `vaultix` (role `vaultix`) holds `vaultix_boxes`,
`vaultix_secrets`, `vaultix_secret_versions`, `vaultix_injects`,
`vaultix_audit`. Health returns `product: vaultix`. Trust stamps
AngryVibes LLC / shippin.ai / Nomen. A box `first-app` and sealed
`API_KEY` were written through `/api/v1/vaultix/*`; GET stayed
metadata-only; inject redeem returned the value once. No leftover
container. `vaultix.shippin.cloud` is not this process.

## 2026-08-29 — A2UI / MCP / configure

Catalog-first runtime (`panel/internal/runtime`): Decide is pure, A2UI
v0.9.1, `ml` valve stays closed. Native MCP tools are the same buttons
as the viewport. Authored configure ladder at `GET /viewport/` and
`vaultix.configure.show`. Values still never in A2UI or MCP.

## 2026-08-29 — owned engine

Vaultix is the secrets store. `panel/internal/vault` owns `vaultix_*`
tables (AES-GCM). Compose runs this binary + Postgres. Identity prefers
Nomen bearer. Leftover schema dump and leftover product image are not
the runtime (`leftover/`). `go test ./...` in `panel/` green.
