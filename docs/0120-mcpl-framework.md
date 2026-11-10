# 0120 — MCPL: one action framework for people, the UI and AI

Status: in progress, started 2026-11-10. Builds on [0114](0114-domain-scripted-ui-standard.md)
(scripted UI actions), [0116](0116-domain-mesh-and-ui-workbench.md) (domain ownership) and
[0119](0119-schema-and-api-namespaces.md) (API and table namespaces). Pre-release rules
([0118](0118-pre-release.md)) apply.

MCPL is how Vaultix makes every product action usable the same way by a person in the UI, by
the HTTP API and by an AI client over MCP. It is not a second API for models. A tool an AI calls
runs the same service handler, permission check and audit as the button a person clicks.

## The pieces

| Piece | What it is | Where |
| --- | --- | --- |
| Domains | The 15 canonical interaction domains. One vocabulary for UI actions, MCP warp points and `/api/vx/v1/<domain>` routes. | `docs/interaction/workflows.json` |
| Source actions | The business authority: one handler per action, shared by HTTP, UI and MCP. | Existing services, e.g. `vaultix-shared.ts` (references), `external-migration-service.ts` (imports) |
| Catalog and guidance | Authored text the UI and MCP both read: catalog, configure steps, lessons, sign-in options. | `core/backend/src/services/vaultix/catalog.ts`, `auth-options.ts`, `guidance.ts` |
| Main MCP | Where every AI client starts: discovery, sign-in options and the tools that predate warp points. | `POST /api/v1/vaultix/mcp` |
| Warp points | One MCP per domain, listing and running only that domain's tools. | `POST /api/vx/v1/<domain>/mcp`, registry in `warp-points.ts` |
| UI actions | Named, scripted UI intentions (`vaultix.ui.<domain>.<workflow>.<action>`) that AI-guided walkthroughs and tests drive. | [0114](0114-domain-scripted-ui-standard.md), `action-trigger.ts`, `workflows.json` |
| Workbench | The admin page that shows each domain's actions with their live status. | `/admin/mcpl`, `mcpl-manifest.ts` |

## Domains

`public`, `auth`, `workspace`, `secrets`, `access`, `automation`, `connect`, `pki`, `kms`,
`pam`, `detect`, `ai`, `governance`, `operate`, `experience`. What each owns is in
[0116](0116-domain-mesh-and-ui-workbench.md#domain-ownership-and-designated-mcp-surfaces).

The same list, in the same order, is in the warp-point registry, the workbench manifest and
`workflows.json`. `scripts/warp-points.test.mjs` (a canonical build stage) fails if they differ, if a
UI action's ID and domain disagree, or if a `/api/vx/v1` router mounts under any other name.

Tables are grouped differently because they are storage, not product surface
([0119](0119-schema-and-api-namespaces.md)): for example `vx_identity_*` (machine identities) belongs
to the `access` domain and `vx_scan_*` to `detect`.

## Main MCP and warp points

An AI client is configured with one MCP, the main one. It calls `vaultix.warp.list` to see every
domain, whether its warp point is live, its endpoint on the same host, and its tools with their
access (`public` or `signed-in`). It calls `vaultix.auth.options.get` to learn how to sign in. To
work in a domain, the client connects to that warp point. Its `tools/list` then carries the full
schemas for that domain only, which keeps each tool list small and keeps cross-domain work
explicit, as 0114 requires.

Rules:

- **No `domain` parameter on `tools/list`** and no arbitrary URLs. The warp points are a fixed,
  reviewed registry; a planned one answers 404 with a plain error until it is live.
- **Signed-in tools** appear only to a signed-in client and run with that actor's own
  permissions: a Vaultix user (JWT) or machine identity. A denied or missing resource is the same
  tool error, so a warp point never reveals what exists in another tenant.
- **Warp points are stateless.** No MCP session and no app resource; the main MCP keeps the MCP
  Apps session.
- **Values never cross.** Results are names, IDs, counts and states. Credentials are never tool
  arguments or results. Mutations that need a person's approval (provider import, secret writes)
  stay in the UI until an authored approval flow exists for them.
- **The main MCP keeps the tools that predate warp points** (`vaultix.projects.list`,
  `vaultix.secrets.references` and the guidance tools), so existing client configurations keep
  working. Every new tool goes on its domain's warp point.

Live today:

| Warp point | Tools | Access |
| --- | --- | --- |
| public | `vaultix.catalog.get` | public |
| auth | `vaultix.auth.options.get` | public |
| workspace | `vaultix.projects.list` | signed-in |
| secrets | `vaultix.secrets.references` | signed-in |
| connect | `vaultix.connect.imports.providers` | signed-in |
| ai | `vaultix.connections.get`, `vaultix.specialist.instructions` | public |
| operate | `vaultix.operate.updates.status` | signed-in |
| experience | `vaultix.guidance.get`, `vaultix.configure.show`, `vaultix.learning.profile.get` | public |

Planned: `access`, `automation`, `pki`, `kms`, `pam`, `detect`, `governance`.

## Signing in an AI client

`vaultix.auth.options.get` gives the AI the three ways to act in Vaultix and states which are
available. The CLI commands it names are the real `vaultix` commands.

| Option | Status | How |
| --- | --- | --- |
| Machine identity | Available | Admin creates the identity and a Universal Auth client secret; on the host, `vaultix login --universal` with the pair on stdin. The CLI signs in again before each token expires. |
| Headless CLI | Available | `vaultix login --token` with the token on stdin (`--credential-file` on POSIX hosts without a keyring). Not renewed. |
| The user's session | Not available yet | Target: the person approves once in the browser and the AI keeps a delegated session for at least 60 minutes. |

For the user's session, Vaultix's Go service already issues device authorizations and delegated
access. Both are off by default (`VAULTIX_DEVICE_ACCESS_ENABLED`,
`VAULTIX_DEVICE_AUTHORIZATION_ENABLED`), and delegated access now lasts 60 minutes by default
(`VAULTIX_DEVICE_ACCESS_TTL_SECONDS`, 1 to 86400). Still missing: the browser approval page,
`vaultix login` support for the Vaultix device flow, MCP admission for delegated sessions, and CLI
renewal. Until then, an instance federated with Nomen can use `vaultix login --sso`.

The only credential that may pass through chat is the one-time first-owner setup code
([0118](0118-pre-release.md)).

## Adding a tool

1. Choose the domain that owns the action. If no domain fits, the action is probably two actions.
2. Name it `vaultix.<domain>.<entity>.<verb>`. Existing IDs keep their names.
3. Call the existing service handler. If the action has no handler yet, build the handler first,
   for HTTP and UI, then expose it. Never write MCP-only business logic.
4. Return metadata only, with a plain `error` string on expected failures.
5. Register it on the domain's warp point in `warp-points.ts` and implement its call in
   `vx/warp-point-router.ts`. A warp point with its first tool becomes live.
6. Test it: the route test (`warp-point-router.test.ts`) for listing, refusal before sign-in,
   denial as a tool error and argument validation; and the build's parity test.

## What comes next

- **Operate: updates from the admin panel.** An operator approves an update in the UI; the
  instance freezes writes, shows the update running and survives a reconnect. This needs the
  host agent and operation owner of [0108](0108-platform-services-and-upgrades.md) (OPS-04/05).
  The web application cannot replace its own containers. The MCP side will report progress
  (`vaultix.operate.*`) but never approve an update.
- **The user's session for AI clients**, as above, with a 60-minute floor.
- **Warp points for the planned domains**, each with its first real handler and tests.
- **Paired UI walkthroughs** over MCP (`vaultix.ui.*` commands with receipts), per 0114.
