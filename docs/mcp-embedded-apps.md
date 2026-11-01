# Embedded Vaultix interactions in AI clients

Vaultix's in-app Clyffy drawer already uses the protected MCP project and secret
reference actions. It includes contextual help and guided dialogs. It is not an
embedded app inside an external AI client. The server currently advertises tools
and returns text results; it does not yet advertise MCP Apps or serve UI resources.

The [interaction system](0024-interaction-and-teaching-system.md) and
[native migration](0027-native-stack-and-ai-migration.md) remain authoritative.
This packet covers the connection prerequisite for the external view. It does not
change authentication, add a second action API, or establish host compatibility.

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

## Remaining implementation and acceptance

1. **Server negotiation.** Preserve the client's `io.modelcontextprotocol/ui`
   capability across requests. Use the existing shared cache for bounded,
   expiring transport context; bind it to the authenticated actor and organization.
   Every action must still pass current authentication and authorization. Test
   cross-actor/tenant reuse, revoked access, expiry, cache outage and multiple
   server replicas. Public catalog clients and clients without UI support retain
   their text workflow. Do not advertise an extension before its resources exist.
2. **Owned resource and native view.** Add one predeclared, versioned `ui://`
   resource using `text/html;profile=mcp-app`. Link only the existing authorized
   project/reference tools through `_meta.ui.resourceUri`. Bundle a native React
   view with contextual help, loading/error/empty states and accessible dialogs.
   Use an exact resource allowlist, no arbitrary URLs/files, no external network
   domains, no provider credentials and no secret values. Keep meaningful text
   results available to clients that cannot display the view.
3. **Bridge lifecycle.** Initialize with the host, validate tool inputs/results,
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
Real host selection and acceptance remain open. None of the connection checks
establish completed embedded popups, whole-UI accessibility, capability parity or
public-cloud readiness.
