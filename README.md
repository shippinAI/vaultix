# Vaultix

**Owner:** AngryVibes LLC. **Host:** shippin.ai. **Stamp:** A SHIPPIN.AI SERVICE.

Vaultix **is** Infisical’s MIT core, forked and renamed. Pin `v0.162.19`
in `core/`. Remotes off. Customer chrome says Vaultix. We do not run the
vendor image and we do not replace the engine with a toy store.

| Piece | What it is |
| --- | --- |
| `core/` | The secrets product (renamed Infisical) |
| `db/` | Owned schema (rebranded overlay) |
| `panel/` | Shippin overlay (PIN, lessons, Clyffy, instance manager) |
| `branding/` | Wordmark, mark, favicon |

## GitHub Container Registry

Repo: **[shippinAI/vaultix](https://github.com/shippinAI/vaultix)** (private), same org as Nomen.

| Image | What |
| --- | --- |
| `ghcr.io/shippinai/vaultix` | Engine (standalone `core/Dockerfile.standalone-vaultix`) |
| `ghcr.io/shippinai/vaultix-panel` | Overlay |

Workflow: **Actions → GHCR**. `GITHUB_TOKEN` + `packages: write`. Org Actions
packages write: https://github.com/organizations/shippinAI/settings/actions

After the first successful GHCR run:

```bash
export VAULTIX_ENGINE_IMAGE=ghcr.io/shippinai/vaultix:latest
export VAULTIX_PANEL_IMAGE=ghcr.io/shippinai/vaultix-panel:latest
export VAULTIX_PULL=1
# copy compose/self.env.example or hosted.env.example → compose/vaultix.env
bash scripts/up.sh
```

Publish this tree to GitHub (admin of shippinAI): `bash scripts/publish-github.sh`

## Run

**Yourself:** `compose/self.env.example` → `vaultix.env`, `scripts/up.sh`  
**Your users:** `compose/hosted.env.example`, `{label}.vaultix.shippin.cloud`

Engine: `http://127.0.0.1:8200` (`GET /api/status`) — first operator `/admin/signup`  
Overlay: `http://127.0.0.1:8201/viewport/` · manager `/manager/`

Native without containers: `scripts/run-core.sh` + Vite on 3000. Do not treat
`panel/internal/vault` as the product.

Law: [docs/0011-owned-engine.md](docs/0011-owned-engine.md).
License: [docs/0013-license-and-membership.md](docs/0013-license-and-membership.md).
SKUs: [docs/0014-skus-and-manager.md](docs/0014-skus-and-manager.md).
