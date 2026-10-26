# Vaultix DevSCIF workspace and API

The native entry point is `core/frontend`, served by the standalone core image.
The 2026-10-26 workspace adds a flat, outlined visual system, a reference browser
with per-page name search and name-only copying, and authored AI connection
choices. Shared Card/Button primitives and semantic CSS tokens also apply to
existing authenticated views. Those views still need workflow-by-workflow
migration and real-issuer browser acceptance.

## API identity and contract

Existing `/api/v1` through `/api/v4` routes remain the core service API. Their
authorization and data store are unchanged. Responses from registered API routes
identify the product with `X-Vaultix-Product: Vaultix` and the software policy
with `X-Vaultix-Feature-Policy: included`. The latter is not an authorization grant.

`/api/docs` is the Vaultix API reference; `/api/docs/json` is its OpenAPI document.
Its server is relative to the current instance. Native actions appear under the
Vaultix tag; secret-reference query parameters come from the same authored input
schema as MCP. Compatibility routes that return values are for trusted application
clients and must not be exposed as AI tools.

| Native endpoint under `/api/v1/vaultix` | Behavior |
| --- | --- |
| `GET /product` | Product, included policy, parity status, cache choices and API/MCP paths |
| `GET /catalog` | Authored concepts and source actions |
| `GET /configure` | Authored setup steps |
| `GET /connections` | Three authored choices: local Codex subscription sign-in, an existing Codex provider setup, or another Streamable HTTP MCP client |
| `GET /ai/instructions` | Clyffy instructions and boundaries |
| `GET /projects` | Authorized project/environment metadata |
| `GET /secret-references` | Authorized names/versions/timestamps for a project, environment and folder; paginated, no values |
| `POST /mcp` | Public guidance plus the same authenticated project/reference actions |

The connection document has schema version `vaultix.connections.v1`, source
`catalog`, the fixed instance-relative MCP path, an access-status explanation and
three `configure-step` options. The browser rejects unsupported schema versions,
component types, duplicate/missing options and external MCP paths. Connection
configuration never contains provider credentials or secret values.

Public guidance accepts no parameters. Reference reads require a core JWT or
machine identity with organization context, then existing permissions. Delegated
OAuth is not accepted by these native actions until scope intersection is proven.
Expected errors include a plain `error` string; inaccessible resources are hidden.

## AI setup boundary

Codex subscription sign-in happens in the user's local Codex client using
`codex login`. Existing API accounts, gateways and local model providers remain
configured in that client. Vaultix supplies MCP tools; it does not exchange or
collect ChatGPT sessions. The UI copies an MCP entry or URL, not a replacement
configuration file. See [the packaged AI instructions](../core/ai/README.md).

Public guidance works without a Vaultix session. Hosted Nomen client registration,
token exchange and tenant mapping remain release gates. This connection guide
does not establish hosted sign-in or target-process injection readiness.

## Verification

`scripts/test-native-ui.mjs` checks the built UI against the real authored catalog,
with fixture authentication/action responses. It covers connection switching and
clipboard output, reference filtering/name copying, empty and denied states,
metadata-only rendering, desktop/mobile overflow and unknown-component rejection.
It saves screenshots for visual review. It does not prove real Nomen sign-in.

The Swagger integration test verifies identity, same-instance routing, exposed
native actions and required reference query parameters without executing actions.
`scripts/smoke-image.sh` checks those API docs and identity headers in the actual
standalone image, alongside startup, migrations, UI, MCP, queues and restart.

GitHub's checks job reserves a 6 GiB Node heap for the production frontend build.
The prior run exhausted Node's default heap before the image jobs could start.
Browser checks use Ubuntu 24.04: the moving `ubuntu-latest` label selected 26.04,
which the pinned Playwright 1.60.0 dependency does not support.
Publication still depends on image smoke tests and Linux unit/database suites.
See [the capability ledger](0018-hosted-capability-proof.md) for remaining release
gates; neither this UI update nor included features establishes enterprise parity.
