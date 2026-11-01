# Embedded Vaultix interactions in AI clients

Vaultix's in-app Clyffy drawer already uses the protected MCP project and secret
reference actions. It includes contextual help and guided dialogs. It is not an
embedded app inside an external AI client. The server also supports explicitly
negotiated MCP Apps resources for authenticated clients. A standalone React
reference browser shares the application's controls and validated catalog; it
does not embed the application viewport. Actual AI-client acceptance remains open.

The [interaction system](0024-interaction-and-teaching-system.md) and
[native migration](0027-native-stack-and-ai-migration.md) remain authoritative.
The implementation preserves authentication and the existing source actions.
Neither a protocol fixture nor a working local image establishes host compatibility.

## Connection lifecycle

`vaultix mcp` and `vaultixl mcp` retain the HTTP connection's negotiated protocol
version and optional session identifier in memory. They continue to reread the
selected credential on every request. Renewed or replaced credentials reach the
server immediately; a transport session never grants access by itself.

Only a matching successful initialization response can establish connection
context. Session identifiers must be visible ASCII and at most 1,024 bytes.
Duplicate, empty, oversized or invalid headers fail initialization. Ordinary
responses cannot replace the session identifier. The negotiated protocol version
must be a valid date before it can become an HTTP header. Transport context is
never written to configuration, credential files or MCP stdout.

A session-specific HTTP 404 clears the connection and requires a new initialize
request. Reconnect Vaultix in the AI client to start that handshake. The CLI does
not replay the failed action or forward subsequent actions until initialization
succeeds. Changing the API base also requires a new handshake; old context is
never forwarded to another instance. A failed replacement handshake cannot fall
back to the previous session.

The existing stateless server remains supported, including callers that do not
initialize. Its initialization response supplies a protocol version but no
session identifier. Logout, expired credentials, server authorization failures,
request/response bounds and redirect rejection continue to apply. This is a JSON
HTTP adapter; it does not claim arbitrary SSE-server interoperability.

The lifecycle follows the [MCP HTTP transport specification, 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports).
Local HTTP/stdio fixtures check fresh authentication, isolation, malformed
initialization, expiry, explicit recovery and stateless compatibility. Packaged
CLI acceptance must also pass against the actual standalone Vaultix image.

## Server and view contract

Clients opt in with `capabilities.extensions["io.modelcontextprotocol/ui"]`
and the `text/html;profile=mcp-app` MIME type during initialization. Only an
authenticated actor with the reference service and a verified packaged resource
receives the extension and a session identifier. Anonymous, text-only and
API-only installations retain their existing tools and text responses.

The existing cache holds protocol context under a hash of authentication mode,
actor type/ID, organization and authentication method. It stores no credentials.
Issuance is atomic and limited to eight sessions per binding per one-hour window;
sessions expire after four hours without sliding renewal. Session and quota keys
share a Redis Cluster hash slot. Dragonfly and Redis tests do not establish live
ElastiCache or Redis Cluster deployment acceptance. Every request still passes
current authentication, and every source action re-evaluates existing permissions.
Cache failures return a safe 503; issuance exhaustion returns 429 with Retry-After.

Missing, expired or differently bound sessions return HTTP 404. Incorrect protocol
headers return 400. Domain denial inside a valid session returns a tool error,
preserving the session and preventing an accidental reconnect/replay. Auth failures
remain HTTP 401. DELETE retires the current caller's session across replicas;
clients that do not send DELETE rely on the fixed expiry.

The frontend build produces one HTML resource under `dist/mcp-apps/`, copied into
the standalone image with the other frontend assets. Its manifest pins bytes,
SHA-256 and the exact `ui://vaultix/references/v1/<digest>.html` URI. The server
loads only fixed deployment-owned paths and refuses an inconsistent artifact.
Resource metadata allows no external network, fonts, frames or other domains.
The view has no browser authentication or direct API client. Host-proxied tool
calls use the same catalog and project/reference services as the application.

The bridge pins the parent window and origin, bounds messages to 8 MiB and pending
calls to eight, and times out requests/initial tool input after 15 seconds. It
accepts complete bounded scope inputs as form suggestions; users explicitly run
the reference action. Partial streamed input is ignored. Host layout hints are
bounded; host-supplied CSS, fonts, HTML and URLs are never injected. Cancellation
and teardown remove listeners, reject pending calls and clear cached data.
Unsupported hosts receive recovery guidance. This is a bounded implementation
of the stable Apps protocol, not a claim of every optional extension feature.

Shared controls provide keyboard tooltips, contextual guided dialogs, focus
restoration, loading/denial/empty feedback, reference filtering and clipboard
fallback. The embedded path works in an opaque sandbox without form permissions.
Repeating a reference query explicitly rechecks access and hides cached results
while checking or after denial. Guides never execute actions or attest success.

## Acceptance obligations

1. **Server negotiation.** Verify preservation of the client's `io.modelcontextprotocol/ui`
   capability across requests. Use the existing shared cache for bounded,
   expiring transport context; bind it to the authenticated actor and organization.
   Every action must still pass current authentication and authorization. Test
   cross-actor/tenant reuse, revoked access, expiry, cache outage and multiple
   server replicas. Public catalog clients and clients without UI support retain
   their text workflow. Do not advertise an extension before its resources exist.
2. **Owned resource and native view.** Verify the predeclared, versioned `ui://`
   resource using `text/html;profile=mcp-app`. Link only the existing authorized
   project/reference tools through `_meta.ui.resourceUri`. Bundle a native React
   view with contextual help, loading/error/empty states and accessible dialogs.
   Use an exact resource allowlist, no arbitrary URLs/files, no external network
   domains, no provider credentials and no secret values. Keep meaningful text
   results available to clients that cannot display the view.
3. **Bridge lifecycle.** Verify initialization with the host, validated tool inputs/results,
   invoke the existing source actions through the host, and clear state at
   teardown. Bound messages and discard stale responses after context changes.
   Teaching completion must remain distinct from service success. The host owns
   iframe isolation and CSP enforcement; the view must not embed the whole
   product or read the parent's credentials.
4. **Consumer proof.** Exercise real project/reference actions through the
   packaged CLI, server and sandboxed view. Test keyboard focus/cancel, narrow
   layout, reduced motion, denial, lost connection and recovery. Keep protocol
   fixture evidence separate from a real compatible AI-client session and manual
   assistive-technology review. Codex subscription sign-in does not itself prove
   that a particular Codex client can render MCP Apps.

The resource and bridge contract follows the [stable MCP Apps specification,
2026-01-26](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx).
`scripts/test-mcp-app.mjs` operates the built resource in an independent opaque
sandbox with strict CSP. `scripts/test-mcp-app-image.mjs <image> <linux-cli>`
exercises the packaged CLI, two actual server replicas and shared cache/store,
then operates the returned resource against real source actions. Backend route,
resource-integrity and disposable-cache tests cover negotiation and failure paths.
Their exact artifact receipts belong to the local journal. They do not replace
the actual host and manual assistive-technology gates. Real host selection and
acceptance remain open; whole-UI accessibility, capability parity and public-cloud
readiness remain separate obligations.
