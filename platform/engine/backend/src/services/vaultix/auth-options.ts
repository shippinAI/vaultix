// What vaultix.auth.options.get tells an AI client about signing in (docs/0120). It describes the
// three ways an AI can act in Vaultix and states plainly which are available today. Commands are
// the real `vaultix` CLI; lifetimes are the server and CLI defaults. Keep it in step with
// internal/cli/auth_cmds.go, internal/cli/session.go and platform/engine/backend-go/internal/config.

export const getVaultixAuthOptions = () => ({
  schemaVersion: "vaultix.auth.options.v1",
  rule: "Credentials never go through chat, tool arguments or tool results. The human types them into the Vaultix UI, the CLI's stdin or the AI host's secret store. The one exception is the one-time first-owner setup code (docs/0118).",
  choose:
    "Unattended agent, CI or server: machine identity. A shell or container where a person already holds a token: headless CLI. An AI working for a person who is at the keyboard: the user's session, once it is available.",
  options: [
    {
      id: "machine-identity",
      title: "Machine identity",
      for: "Unattended agents, CI jobs and servers",
      status: "available",
      steps: [
        "An organization admin creates a machine identity and grants it only the projects and roles the agent needs.",
        "The admin adds Universal Auth to it and creates a client secret in the Vaultix UI. The secret is shown once; the admin puts it in the agent host's secret store.",
        "On the agent host: vaultix login --universal, then the client ID and the client secret on stdin, one per line.",
        "Check with vaultix auth status, then add the fragment printed by vaultix mcp config to the MCP client."
      ],
      lifetime:
        "Each access token lasts the identity's token TTL (30 days unless the admin sets it). The CLI signs in again with the stored pair before a token expires.",
      revoke: "Delete the client secret or the identity in the Vaultix UI."
    },
    {
      id: "headless-cli",
      title: "Headless CLI with an access token",
      for: "A shell or container where a person already holds an access token",
      status: "available",
      steps: [
        "vaultix login --token reads one access token on stdin and checks it with the instance before saving it.",
        "On a POSIX host without a keyring, add --credential-file with a path in a private directory.",
        "VAULTIX_TOKEN or VAULTIX_TOKEN_FILE override the saved sign-in for a single process. Unset both before vaultix login.",
        "Check with vaultix auth status, then add the fragment printed by vaultix mcp config. vaultix mcp reads the saved credential itself; never paste the token into the client configuration."
      ],
      lifetime: "As long as the token is valid. The CLI does not renew a pasted token.",
      revoke: "Revoke the token in the Vaultix UI where it was issued. vaultix logout only removes it from this host."
    },
    {
      id: "user-session",
      title: "Ride the signed-in user's session",
      for: "An AI acting for a person who approves it once in the browser",
      status: "not-available",
      target:
        "The person approves the AI in their browser and the AI works under their permissions for at least the next 60 minutes, without seeing their password, MFA or session cookie.",
      built: [
        "Device authorization and delegated access in the Vaultix Go service, off by default: VAULTIX_DEVICE_ACCESS_ENABLED and VAULTIX_DEVICE_AUTHORIZATION_ENABLED.",
        "Delegated access lasts VAULTIX_DEVICE_ACCESS_TTL_SECONDS: 3600 (60 minutes) by default, 1 to 86400 allowed."
      ],
      missing: [
        "The browser page where the person reviews and approves the request.",
        "vaultix login support for the Vaultix device flow.",
        "MCP admission for delegated sessions; MCP accepts user and machine identity tokens today.",
        "Renewal of a delegated session by the CLI."
      ],
      meanwhile:
        "If the instance federates with Nomen, vaultix login --sso (the default on a terminal) runs Nomen's device-code sign-in and renews with its refresh token. Otherwise use a machine identity."
    }
  ]
});
