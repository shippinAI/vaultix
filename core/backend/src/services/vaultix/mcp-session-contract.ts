// Anonymous guidance stays stateless. A session exists only after an
// authenticated client negotiates the Vaultix app resource.
export const anonymousMcpSessionRule = "Anonymous guidance does not create an MCP session.";

export const authenticatedAppSessionRule =
  "An authenticated client that negotiates the Vaultix app receives an Mcp-Session-Id bound to that actor and organization.";
