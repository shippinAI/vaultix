# Headless sign-in and locally authenticated AI connections

Follow-up: [0068 device session renewal](0068-device-session-renewal.md) adds
saved-session renewal and interruption recovery. The original evidence below
remains scoped to this packet; live Nomen integration remains unaccepted.

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

## Release-gate editor repair

The first canonical build at `90fe5bc7` passed the eight dedicated CLI checks,
but failed the existing packaged dashboard reference check. Evidence is retained
in `.cache/headless-ai-login/.cache/self-hosted-build-gKgluO/result.json` and
`.cache/headless-ai-login/.cache/app-image-proof-ogPdmu/failure.json`. The failure
removed the space before the public fixture's suffix. That image was not deployed.

The complete v2 reference wrapper and base textarea were read. Its old 10 ms
selection restoration could execute after a subsequent edit; it also restored
only the selection end in the suggestion path. Restoration now runs after the
controlled value commits, matches that value, and collapses both selection ends.
The focus animation-frame callback also refuses to overwrite a later edit or
caret change. The existing parser, permission checks, debounce gate and value
masking remain unchanged. No secret values enter diagnostics or AI tools.

The permanent packaged test now repeats pointer insertion six times, checks the
input before suggestion selection, preserves the closing brace and suffix space,
and verifies the next character lands at the collapsed caret. Existing keyboard,
Tab/Escape, narrow-layout and no-submission assertions remain. Final image
acceptance is required for this repair; other consumers of the shared editor
and the separate v3 wrapper still require their own workflow acceptance.

The final CLI transport additionally validates request IDs before forwarding:
only the core's bounded strings and safe integers are accepted. Malformed IDs
produce a null-ID protocol error; numeric spellings such as `1` and `1.0`
correlate correctly. Unicode string limits match the core's UTF-16 length rule,
and invalid UTF-8 frames are rejected. This CLI-only change leaves the accepted
standalone image's `core/` source unchanged. The CLI and engine have separate
committed-source artifact receipts.

## Accepted artifact evidence

Engine source: `def6d502025e5d41599cedf4244262b47d87b46a`.
Canonical standalone image: `sha256:a9fcdd51f8f4c4ba8b67856e480373189394ca747d04e64e56260ed802ec0a79`.
CLI source: `df5a4ebfb48729ddc0d28b73d0111b067b698495`. Its CLI-only protocol correction does not
change the accepted engine's core tree.

- All 16 canonical build/application gates passed:
  `.cache/headless-ai-login/.cache/self-hosted-build-3vAWhA/result.json`.
- 67 root Go unit/race checks passed, zero test failures/skips; vet passed.
  The command package has no tests. Receipt:
  `.cache/headless-ai-login/.cache/cli-unit-build.json` was the scratch receipt.
  That path was reused by the 0068 follow-up; its historical 67-check result
  is recorded here, while current scoped receipts are linked in 0068.
- Eight final committed CLI/image checks passed, with disposable cleanup:
  `.cache/headless-ai-login/.cache/cli-headless-Yr4WVu/result.json`.
- Real packaged application workflow passed, including the six repeated editor
  insertions and real role revocation/restoration. Fixture states remain labelled:
  `.cache/headless-ai-login/.cache/app-image-proof-xwQFHe/workflow-result.json`.
- Windows and Linux amd64 CLIs were built from a committed source archive:
  `.cache/headless-ai-login/.cache/cli-build-UDOCI4/result.json`.
  Linux SHA-256: `2b905af5385915a88ecae5a3ee704d36958ace283cd38f4f16977fd4ad00d14d`.
  Windows SHA-256: `fd960e982d208b0f1e48cb55d8472bedbacc01dac1ebdaf4f6560b31a271d5d5`.
  The generated Windows config fragment also parsed successfully as TOML.

An intermediate CLI integration run failed at fixture provisioning because its
random password could violate the existing repeated-character policy. The fixture
now separates random byte pairs, matching the established application tests; no
password policy was relaxed. Failed evidence is retained at
`.cache/headless-ai-login/.cache/cli-headless-YjNRQE/result.json`.

Public discovery at the operator's configured `https://id.shippin.cloud`
returned 200 and advertises the device authorization grant. The local application
configuration also contains a client-secret field; its public device-client grant
settings have not been verified. No client secret was printed, copied into model
configuration, or used. This discovery result does not prove CLI registration,
human browser approval, Nomen-to-Vaultix authority mapping, or session renewal.
Those gates remain open.

## Local deployment verification

The accepted standalone image was deployed to the existing local preview at
`http://127.0.0.1:8200/`. The initialized owner state, database and cache
containers, and the operator's uncommitted ignore rules were preserved.
Receipt: `.cache/headless-ai-login/.cache/deployment.json`.

A browser check confirmed the Vaultix login page, rejection of anonymous project
access (401), and the updated Connect Clyffy instructions for `vaultix auth status`
and `vaultix mcp config`. Receipt:
`.cache/headless-ai-login/.cache/browser.json`; screenshot:
`.cache/headless-ai-login/.cache/clyffy-connections.png`.
This preview check did not use the operator's account. Authenticated application
workflows were exercised in the separate disposable canonical-image checks above.
This is local deployment evidence, not public-cloud or live Nomen acceptance.
