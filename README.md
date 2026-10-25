# vaultix

Local, encrypted, two-way copy of your Vaultix secrets (Vaultix = Shippin's secrets service at
https://secrets.shippin.cloud,, plus `vaultix run` to hand them to programs and AI agents.

```sh
go build -o vaultix ./cmd/vaultix
printf '%s\n' "$TOKEN" | vaultix login             # PAT / access token on stdin (never argv)
printf '%s\n%s\n' "$ID" "$SECRET" | vaultix login --universal   # machine identity
vaultix init --project t-<tenant-uuid> --env dev --path /
vaultix pull                      # server -> local
printf 'value' | vaultix set API_KEY   # staged locally (* in `vaultix ls`)
vaultix push                      # two-way; keys missing on the server are created
vaultix run -- claude             # pull, then run with the secrets in the environment
vaultix hook bash >> ~/.bashrc    # pull before each new shell
vaultix daemon --every 5m         # background two-way sync; conflicts left for you
```

- **Store:** AES-256-GCM per scope under `~/.config/vaultix` (0600 / dir 0700). The data key and the login live in the OS
  keyring; headless hosts use `--key-file` (must be 0600) and `VAULTIX_TOKEN_FILE`.
- **Conflicts:** every local entry remembers the server version it came from. A key changed on both sides prompts
  (`--on-conflict local|remote` to decide up front; the daemon never resolves silently).
- **Not yet:** browser device login (planned via the console, see VAULTIX-PLAN.md), signed releases, desktop/VS Code surfaces.

Tests: `go test ./...` (sync rules, encrypted store, API client against a fake server). Live-tested on Gold
2026-10-19 8:19 PM PDT: init, pull, set, push (auto-create), fresh pull, run, rm, push (delete), fresh pull = 0 keys.

---

## Vaultix engine and overlay (merged from origin/main 1da705e)

# Vaultix

**Owner:** AngryVibes LLC. **Host:** shippin.ai. **Stamp:** A SHIPPIN.AI SERVICE.

in `core/`. Remotes off. Customer chrome says Vaultix. We do not run the
vendor image and we do not replace the engine with a toy store.

| Piece | What it is |
| --- | --- |
| `core/` | The secrets product (renamed vaultix) |
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
