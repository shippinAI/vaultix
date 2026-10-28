# AGENTS.md — Vaultix

**Owner:** AngryVibes LLC. **Host:** shippin.ai. **Product:** Vaultix.

Vaultix is **Shippin secrets you own**. Stay in this tree. Sequence is
only **Auth (Nomen) → Secrets (this instance) → Mesh (Zuul)**.

This file is the agent router. Specs live in `docs/`. Humans start at
[`README.md`](README.md).

## Current direction (2026-10-25)

Public cloud target (2026-10-28): Vaultix.cloud is a true public cloud service
operated on owned infrastructure, with the same engine available for self-hosting.
Read `docs/0054-public-cloud-service.md`. Local builds are the delivery method,
not the production scale target. Tenant isolation, public enrollment, durability,
quotas, measured capacity, recovery and availability are explicit release gates.
Do not equate a working Compose instance or extra replicas with cloud readiness.

Self-hosted delivery priority (2026-10-28): build and verify on the owner's
bare-metal infrastructure without requiring GitHub Actions or GHCR. Read
`docs/0048-self-hosted-builds.md`. GitHub is source hosting; cloud workflows are
manual-only. Keep local previews visible and ask for UI/art direction when a
concrete design choice needs it. This supersedes the hosted-first release order
below, not capability, security or regression gates.

Native stack and AI lifecycle plan (2026-10-27): read
`docs/0027-native-stack-and-ai-migration.md` and `docs/migration/README.md`.
Target native React workflows, Go domain services and scoped Rust delivery/protocol
components. Move complete use cases and preserve the existing encrypted store;
a Go proxy over old business logic is not a completed migration. Generated maps
are discovery, never authorship. Follow the dependency and acceptance gates.

Application entry correction (2026-10-27): `/` enters the existing core
authentication/setup flow and authenticated project application. `/help` is
optional assistance, never the main product viewport. Read
`docs/0025-application-entry-and-artwork.md`. Verify real sign-in and dashboard
loading from the standalone image; fixture guide tests are not that evidence.

Product authorship direction (2026-10-26): **Vaultix.cloud** is the primary
product; **DevSCIF.com** is the enterprise and government-tailored suite.
Read `docs/0021-product-authorship-review.md`. Methodically read and author
every existing product-code module in place. Inventory is not review, and
passing inherited tests does not establish complete authorship or parity.

Capability preservation (2026-10-27): read `docs/0026-capability-preservation.md`.
Keep existing workflows and compatibility during authorship. The UI/API surface
baseline and real-image behavioral checks are release gates, not blanket parity
evidence. Never recapture a reduced baseline just to pass CI.

All-UI accessibility and capability convergence (2026-10-26): target WCAG 2.2 AA
across native and existing authenticated/enterprise workflows; read
`docs/0022-accessibility-acceptance.md`. Capture Infisical and Doppler capabilities,
including enterprise gaps, with independent implementation and acceptance evidence
under `docs/0023-capability-convergence.md`. Automated scans and public feature
inventories do not establish complete accessibility or enterprise parity.

Interaction direction (2026-10-26): rewrite existing workflows for scale and
guided learning, with contextual help, accessible dialogs, catalog-backed UI
events and reduced-motion support. Read `docs/0024-interaction-and-teaching-system.md`.
Teaching completion is not action success; remote Clyffy driving remains separate.

Release priority (2026-10-26): hosted Vaultix first. Update the code and prove
capabilities before offering it; record evidence and gaps in
`docs/0018-hosted-capability-proof.md`.

Read `docs/0016-native-vaultix.md` for the in-place core/UI/API migration.
Software features are included for every Vaultix deployment. This supersedes
the paid-tier rules in 0013. Permissions, approvals, and operational feature
switches still apply. Entitlement tests alone do not establish enterprise parity.
Dragonfly is the default cache; Redis and ElastiCache are explicit alternatives.
The native core UI/API is the product entry point. The panel is optional legacy
work, not a second secrets store. Clyffy uses the user's local Codex sign-in;
never collect their subscription credentials or inject values into the AI process.

**Do not assume chat context.** Load the folder for the task.

## Always

-Build `Dockerfile.standalone-vaultix`.
- `leftover/` is notes and dumps. Do not grow it.
- No fetch, no clone, no connection to a snapshot host. `leftover/consider-upstream.sh` refuses (`docs/0015-frozen-no-connection.md`).
- Identity is Nomen OIDC. Cookie/session stay in Nomen.
- Clyffy manages secret **references**, never values in chat or A2UI.
- Catalog wins: `Decide` is pure. Frontier only with a recorded reason.
- Vaultix software capabilities are included; feature availability and authorization are separate.
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
- Claim untested enterprise feature parity or bypass authorization because features are free.

## Load this for that

| Task | Read |
| --- | --- |
| Engine | `docs/0011-owned-engine.md` + `core/` |
| Whole-tree authorship / product domains | `docs/0021-product-authorship-review.md` + `docs/code-audit/` |
| Stack migration / AI-managed lifecycle | `docs/0027-native-stack-and-ai-migration.md` + `docs/migration/` |
| All-UI accessibility | `docs/0022-accessibility-acceptance.md` |
| Native interactions / guided teaching | `docs/0024-interaction-and-teaching-system.md` |
| Enterprise capability convergence | `docs/0023-capability-convergence.md` |
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
# verified local image: node scripts/build-self-hosted.mjs
# GitHub source only:   bash scripts/publish-github.sh
# optional GHCR builds require manual Actions dispatch
```

Engine: `GET http://127.0.0.1:8200/api/status` and UI `http://127.0.0.1:3000`.
Overlay stamp: `GET /api/v1/vaultix/trust`. Overlay health: `GET /api/v1/vaultix/health`.
