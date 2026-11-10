# Deploying Vaultix: instructions for AI agents

> **Vaultix is pre-release software.** Do not treat an instance as production. Do not
> store production secrets or regulated data in it. The database layout, the API and the
> upgrade path are still changing, including planned breaking renames. There is no
> uptime commitment, no security certification and no hosted-readiness claim. If the
> person you are helping wants a production secrets manager today, say so plainly
> before you start.

This guide is for any AI agent (Claude, Codex, Copilot or another) that has been asked
to build, install, upgrade or check a self-hosted Vaultix instance. Follow it in order
and stop when a step fails. Report the failing command and its output; do not work
around a refusal.

## What you may and may not put in chat

During setup the owner may want to hand you something, or you may need to hand
something to the owner. Pre-release Vaultix has exactly **one** credential that is safe
to pass through a chat:

| Credential | Paste in chat? | Why |
| --- | --- | --- |
| **Setup code** (`VAULTIX_SETUP_CODE`, shown as `setupCode` by `vaultix server install` and `status`) | **Yes** | It only creates the first owner. That sign-up signs the owner in and closes setup, and from then on the code opens nothing. `vaultix server status` stops showing it at that moment. |
| Owner email address | Yes | Not a secret. |
| Owner password | **No** | The owner types it in the browser. Signing in does not reset it. |
| `ENCRYPTION_KEY`, `VAULTIX_ENC_KEY`, `recovery.key` | **Never** | They protect every stored value. Signing in never rotates them, and losing them makes the data unreadable. |
| `AUTH_SECRET`, `POSTGRES_PASSWORD`, anything else in `config/vaultix.env` | **Never** | Signing in never rotates them. |
| Bootstrap machine token (`POST /api/v1/admin/bootstrap`) | **No** | A real credential that lives until it expires or is revoked. |
| MFA codes and recovery codes | **No** | They are the owner's second factor. |
| Doppler tokens, Infisical machine identity secrets, other provider keys | **No** | The owner enters them in Organization › App Connections. Vaultix cannot rotate them. |
| Secret values | **Never** | Vaultix AI tools work with secret names and references only. |

If the owner pastes anything from the "No" or "Never" rows, tell them it is now exposed
and needs to be replaced at its source. Do not repeat it, store it or use it.

## Before you start

1. Confirm with the owner that this is a pre-release instance (see the notice above).
2. Read [`AGENTS.md`](AGENTS.md). Its **Ask** and **Never** lists apply to you. In
   particular: never fetch, clone or connect to a snapshot host; never point Compose at
   a leftover product image; never delete data volumes.
3. Prerequisites on the build host: Git, Bash (Git for Windows Bash on Windows), tar,
   ripgrep, curl, OpenSSL, Node 22 or newer, Go 1.27.3, and a Linux/amd64 Docker
   engine with Compose v2. The frontend build uses an 8 GiB Node heap.

## 1. Build and verify the image

From a clean, committed checkout of `main`:

```sh
cd core/e2e && npm ci && npx playwright install chromium && cd ../..
node scripts/build-self-hosted.mjs --check
node scripts/build-self-hosted.mjs
```

The full run takes 30 to 70 minutes. It must end with `Verified sha256:…` and print the
evidence path, `.cache/self-hosted-build-*/result.json`. That file is the build
receipt. If any stage fails, stop and report the stage name and its log. Never install
an image that has no passing receipt.

## 2. Build the command-line tool

```sh
node scripts/build-cli.mjs
```

The receipt under `.cache/cli-build-*` lists the Linux/amd64 and Windows/amd64
binaries with their SHA-256 hashes. `vaultix` and `vaultixl` are the same program.

## 3. Install the instance

Choose a private directory the owner controls and the public HTTPS origin:

```sh
vaultix server install --directory /srv/vaultix-instance \
  --project vaultix --site-url https://vaultix.example.com \
  --from-build /path/to/.cache/self-hosted-build-XXXX/result.json
```

- The installer generates the encryption key, auth secret, database password,
  recovery key and setup code into `/srv/vaultix-instance/config/`, readable only by
  the owner. Leave them there. Never print or copy them.
- The application listens on loopback port 8200 (`--port` to change it). Put the
  owner's TLS reverse proxy in front of it for remote access.
- `--site-url` must be HTTPS, or HTTP on `127.0.0.1` or `localhost` for local use.
- To bring an existing Compose deployment under management, use `vaultix server adopt`
  as described in [docs/0109](docs/0109-native-install-and-upgrade.md), not `install`.

The JSON result includes `setupCode` and `setupUrl` while the instance has no owner.

## 4. Create the first owner

Give the owner the `setupUrl` and the `setupCode`. You may paste the setup code in chat;
see the table above. The owner opens the link, names the organization and creates
their account with their own email and password, entering the setup code. Do not
create the owner account yourself.

Then confirm:

```sh
vaultix server status --directory /srv/vaultix-instance
```

`ready` must be `true`, and `setupCode` must be absent. If a setup code still shows, the
owner account does not exist yet.

New instances start invite-only with email and password sign-in. The owner can enable
federation, early-access requests and public signup later in settings
([invite-only](docs/0110-invite-only-instance.md),
[early access](docs/0112-early-access-requests.md)).

## 5. Upgrade, recover, roll back

```sh
vaultix server upgrade --directory /srv/vaultix-instance --from-build NEW_RECEIPT --plan
vaultix server upgrade --directory /srv/vaultix-instance --apply OPERATION_ID
vaultix server recover  --directory /srv/vaultix-instance
vaultix server rollback --directory /srv/vaultix-instance
```

Upgrades keep the data volumes. A changed migration set is rehearsed on a restored copy
of the database, with no network, before the live database is touched. Rollback may
need `--discard-writes`; ask the owner before using it, because it discards writes
made since the checkpoint. Details: [docs/0109](docs/0109-native-install-and-upgrade.md).

## 6. Hand-off checklist

Report to the owner:

- the instance directory, site URL and loopback port
- the image ID and build receipt path you installed
- `vaultix server status` output, without any key material
- that the owner should keep an offline copy of `config/recovery.key` and
  `config/vaultix.env` somewhere only they control
- that this is a pre-release instance

## Where to read more

| Topic | Document |
| --- | --- |
| Pre-release rules | [docs/0118-pre-release.md](docs/0118-pre-release.md) |
| Install, upgrade, recovery and rollback | [docs/0109](docs/0109-native-install-and-upgrade.md) |
| Self-hosted build and verification | [docs/0048](docs/0048-self-hosted-builds.md) |
| Built-in and federated identity | [docs/0074](docs/0074-built-in-and-federated-identity.md) |
| Importing from Doppler or Infisical | [docs/0117](docs/0117-provider-import.md) |
| AI assistant (Clyffy) and MCP | [core/ai/README.md](core/ai/README.md) |
