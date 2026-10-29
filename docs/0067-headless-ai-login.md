# Headless sign-in and locally authenticated AI connections

2026-10-29. Auth (Nomen) to Secrets only. Implementation packet for the root Go
CLI, not a new identity service or a replacement for native domain migration.

## Behavior and authority

Previously, token and device login accepted a successful public `/api/status`
response as authentication. Login now requires the existing protected
`GET /api/v1/vaultix/projects` action and its project-list response, including
an authorized empty list. User JWT and machine access tokens supported by that
action are supported; an arbitrary token, unscoped identity token, or a token
that works only on a legacy value endpoint cannot establish this AI connection.
The server remains responsible for actor/organization mapping and permissions.

The device flow discovers and matches the configured Nomen issuer, uses the
advertised device and token endpoints, prints a browser approval link/code, and
waits for approval. It follows the five-second default interval and permanent
slow-down increment, handles denial/expiry/cancellation, and rejects redirects,
non-success token responses, missing bearer tokens/lifetimes, malformed or
oversized responses, and unsafe URLs. HTTPS is required except literal loopback
HTTP for local development. Configured clients that relied on insecure remote
HTTP must use TLS. Error bodies are not echoed to the terminal.

New saved credentials are bound to their API instance; device credentials record
expiry. Older token storage and explicitly supplied environment/file overrides
remain readable for compatibility. Re-login upgrades old saved records. API URL
changes cannot redirect a newly bound credential. The existing config/keyring
model still supports one saved login per OS user, not multiple simultaneous
account profiles. No token is printed or embedded in generated MCP configuration.

On POSIX hosts, `login --credential-file /private/directory/credential.json`
uses an existing 0700 directory and 0600 regular file with atomic replacement.
Non-private paths and symlink files are refused. Windows retains Credential
Manager; POSIX mode bits are not treated as Windows ACL evidence. External
`VAULTIX_TOKEN` / `VAULTIX_TOKEN_FILE` overrides are read-only and must be unset
before saving a login. They remain the operator's responsibility. `logout`
removes the selected saved credential and reports active external overrides;
it does not claim to revoke a Nomen session or a machine identity at its issuer.

`auth status` performs protected metadata verification without loading values.
`mcp` supplies newline-delimited stdio, sending requests only to the existing
`/api/v1/vaultix/mcp` catalog. It has no independent tool catalog, permission
engine, or secret store. Credentials are re-read on each request, machine
credentials obtain scoped access through existing universal auth, and revoked
access is rejected by the server. Input/output sizes, request timeouts,
redirects and response envelopes are bounded/checked. This adapter targets the
current stateless JSON core endpoint, not arbitrary SSE MCP servers.

`mcp config` prints an additive Codex configuration fragment with an executable
path and `VAULTIX_HOME`. It never edits model/provider settings or reads Codex
credentials. Codex subscription authentication and Vaultix authorization stay
separate. The core catalog remains reference-only: no secret values, mutations,
injection, or remote UI driving are added.

## Acceptance and remaining work

Unit fixtures cover issuer matching, polling, slowdown, denial, expiry,
cancellation, redirects, malformed responses, protected login, private storage,
instance binding, local expiry, MCP framing/error identity and credential-free
configuration. Linux runs include the root Go module with race detection;
Windows covers protocol/client paths and refuses unsafe POSIX file fallback.

`scripts/test-cli-headless.mjs <image> <linux-cli>` provisions disposable
organizations, projects and identities through real APIs. It exercises invalid
login, protected login, stdio initialization/discovery/reference reads, sensitive
canary exclusion, server revocation, machine login, and local logout. The
standalone application and root CLI are separate artifacts; record both source
revision and image identity. The script never uses the owner's account/data.

Live Nomen issuer/public-client registration, accepted audience/subject mapping,
refresh token rotation, issuer revocation and a real remote browser approval
are still required. No live identity is inferred from an email or an unsigned
claim. Do not relax server authentication to make device tokens pass. Public
MCP OAuth discovery/registration and guided browser sign-in in an AI client
remain separate work. This packet does not claim effortless first-run hosted
login, automatic Nomen renewal, full OAuth MCP conformance, public-cloud
readiness, or complete native migration.

Protocol references: [OAuth device grant, RFC 8628](https://www.rfc-editor.org/rfc/rfc8628.html)
and [MCP stdio/HTTP transports](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports).
Codex stdio command/environment support was checked with the installed
`codex mcp add --help`; no user Codex settings were changed.
