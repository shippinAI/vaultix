# vaultix

Local, encrypted, two-way copy of your Vaultix secrets (Vaultix = Shippin's secrets service at
https://secrets.shippin.cloud, Infisical-compatible API), plus `vaultix run` to hand them to programs and AI agents.

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
