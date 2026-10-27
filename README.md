# Vaultix

**Secrets you own. Built for Secrets and AI.**

Vaultix is developed in place in `core/`: the secrets engine, its UI, and its
API ship together in `ghcr.io/shippinai/vaultix`. Owner: AngryVibes LLC.
Host: shippin.ai.

**Vaultix.cloud** is the primary product; **DevSCIF.com** is the enterprise and
government-tailored suite. Every existing product-code module is subject to
the [methodical authorship review](docs/0021-product-authorship-review.md).
These destinations and the review program do not establish hosted readiness
or government certification.

The [native React/Go/Rust migration plan](docs/0027-native-stack-and-ai-migration.md)
defines domain ownership, AI-managed lifecycle boundaries, migration order and
rollback gates. The [module map](docs/migration/README.md) tracks source coverage
without counting discovery as completed rewriting.

Software capabilities are included for self-hosted and hosted instances.
Membership is not a feature paywall. Permissions, approval policies, and
operational controls still apply. Full enterprise parity and the complete
native UI migration are **in progress**, not release claims.

## Run your instance

The first release target is **hosted Vaultix operated by shippin.ai**.
See [hosted capability verification](docs/0018-hosted-capability-proof.md).

1. Copy `compose/hosted.env.example` to `compose/vaultix.env` for the hosted
   deployment. The self-hosted alternative is `compose/self.env.example`.
2. Set your public URL, database password, encryption key, and authentication
   secret. Preserve existing encryption keys when upgrading.
3. Run `bash scripts/up.sh`.
4. Open **http://127.0.0.1:8200/**. Health: `GET /api/status`.

The root opens the full application: first-instance setup when needed, login
for signed-out users, and the project dashboard for signed-in users. Optional
Clyffy setup/reference help is at `/help` and in the application Help menu.

The default stack builds `core/Dockerfile.standalone-vaultix` and runs
PostgreSQL plus **Dragonfly**. Redis and AWS ElastiCache can be configured
explicitly; see [cache deployment](docs/0017-cache-deployment.md). Cache
settings use `VAULTIX_CACHE_*`; existing `REDIS_*` configuration remains
compatible. The legacy panel is an optional Compose profile, not the product
entry point or a replacement secrets store.

Native development uses `scripts/run-core.sh` and
`cd core/frontend && npm run dev`. Start the configured database/cache first.
The standalone image and backend install use npm 10.9.0 because newer npm
rejects a missing optional ARM package in the pinned QUIC dependency.

## Clyffy and Codex

Clyffy is Vaultix's secrets specialist. Connect your local Codex client to
`/api/v1/vaultix/mcp` using your own ChatGPT sign-in. Your plan limits apply;
Vaultix does not collect that session or an OpenAI API key.

The native MCP teaches setup through the same authored catalog and configure
steps used by the UI. Authenticated clients can list projects and secret
references through the same actions as the native reference browser. Values
and mutations are excluded. Hosted Nomen client sign-in is still a release gate.
See [AI setup and specialist instructions](core/ai/README.md), also included
in the image at `/backend/ai`.

Secret values belong in the authenticated vault UI and the target application
process. Clyffy receives references only. Never inject secrets into the AI
process itself or paste values into a prompt.

## API and migration

- [Native core API](contracts/vaultix.core.v1.json): product identity, catalog,
  configure steps, specialist instructions, and authenticated project/reference
  actions shared by the UI and MCP.
- [Migration and release gates](docs/0016-native-vaultix.md): what is implemented,
  what remains inherited, and the evidence required for enterprise parity.
- [Legacy panel contract](contracts/shippin.vaultix.panel.v1.json): compatibility
  reference, not the new core contract.

Legacy engine routes remain available for existing clients during the migration.
They are not a metadata-only AI API. Nomen issuer/session integration still needs
end-to-end verification. Mesh work does not belong in this checkout.

## Local CLI

The Go CLI provides an encrypted local copy and application-process injection:

```sh
go build -o vaultix ./cmd/vaultix
printf '%s\n' "$TOKEN" | vaultix login
vaultix init --project t-<tenant-uuid> --env dev --path /
vaultix pull
printf 'value' | vaultix set API_KEY
vaultix push
vaultix run -- npm run dev
```

Login credentials and data keys use the OS keyring. Headless hosts use a
restricted key file and `VAULTIX_TOKEN_FILE`. Local entries use AES-256-GCM.
Resolve sync conflicts explicitly; the daemon does not silently overwrite them.

## Checks

```sh
go test ./...
(cd panel && go test ./...)
bash scripts/check-owned.sh
(cd core/frontend && npm run build)
docker build -f core/Dockerfile.standalone-vaultix -t vaultix:smoke core
bash scripts/smoke-image.sh vaultix:smoke dragonfly
bash scripts/smoke-image.sh vaultix:smoke redis
docker build --target backend-build -f core/Dockerfile.standalone-vaultix -t vaultix:verify-backend core
node scripts/test-unit-core.mjs
node scripts/test-core.mjs dragonfly
node scripts/test-core.mjs redis
```

A passing unit suite does not establish a working deployment. Before release,
complete the image/database/cache smoke test and the workflow acceptance gates
in the migration document. No snapshot fetches, clones, or remote connections.
