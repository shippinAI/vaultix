# Vaultix for AI coding tools

Clyffy is Vaultix's secrets specialist. Its guidance runs in your own Codex
client. Sign in with ChatGPT through `codex login`; your subscription's limits
apply. Vaultix does not receive your ChatGPT session or an OpenAI API key.

Vaultix authorization is separate from your model sign-in. With a Vaultix CLI
credential that can access this instance, run these commands in your own terminal:

```sh
vaultix auth status
vaultix mcp config
```

Add the printed fragment to your existing Codex configuration, then reconnect.
The fragment launches `vaultix mcp` over stdio and identifies your local Vaultix
configuration directory. It contains no token. The CLI loads credentials locally
and calls the same core MCP endpoint as the native client; it never reads the
local secret-value store. Other clients with stdio support can launch the same
command. Do not launch it through `vaultix run`.

If you have not signed in, use `vaultix login --api <instance>` in your terminal.
Nomen browser approval requires a configured issuer and public CLI client ID;
live Nomen-to-Vaultix mapping is still a release gate. Machine identities and
existing compatible access tokens have explicit `--universal` and `--token`
stdin modes. Never obtain those credentials through chat or MCP arguments.

For public guidance without CLI authentication, add your instance directly:

```toml
[mcp_servers.vaultix]
url = "https://vaultix.example.com/api/v1/vaultix/mcp"
```

For a local instance, use `http://127.0.0.1:8200/api/v1/vaultix/mcp`.
Reconnect Codex, then ask: "Read the Vaultix specialist instructions and help
me connect my app."

The native core MCP supplies five public guidance tools:

- `vaultix.catalog.get`: the same concepts displayed by the UI.
- `vaultix.configure.show`: the same authored setup steps displayed by the UI.
- `vaultix.specialist.instructions`: Clyffy's operating instructions.
- `vaultix.connections.get`: authored setup choices for subscriptions and existing AI clients.
- `vaultix.guidance.get`: the same reference and connection lessons used by native contextual help.

Use **Guide Me** or a field's help button for interactive lessons in the UI.
The lessons can explain and focus controls; they do not execute secret operations.
Clyffy can read this content, but remote control of the native guide is not implemented.

In the Vaultix UI, open **Connect Clyffy** and choose **Codex subscription**,
**My Codex setup**, or **Another AI client**. The second option preserves your
existing API account, model gateway or local-provider configuration. Add the
Vaultix MCP entry to your existing configuration; do not replace that file.
Other clients need Streamable HTTP MCP support. Model/tool compatibility
depends on that client and provider. Vaultix does not host a subscription
credential exchange or collect provider keys in this setup flow.

These public guidance tools accept no arguments or credentials. An authenticated
Vaultix client also has `vaultix.projects.list` and `vaultix.secrets.references`.
They use the same actions as Browse Secret References in the native UI, enforce
existing organization/project permissions, and audit reference reads. References
contain names and versions, never values, ciphertext, comments, or custom metadata.
Only shared secrets in the selected folder are listed. Follow `nextOffset` until
null; a permission-filtered page can be empty.

The direct HTTP connection above provides public guidance. The CLI stdio path
requires protected access and exposes authorized reference tools. Expired or
revoked credentials fail with a sign-in instruction; Nomen automatic renewal and
hosted token exchange remain incomplete. Never paste a Vaultix token
or Codex credentials into chat or tool arguments to work around missing sign-in.
Secret-changing tools and injection redemption are not exposed to MCP.

The optional specialist skill is in `clyffy/SKILL.md`. The image carries this
directory at `/backend/ai`; the running core also exposes its specialist
instructions at `GET /api/v1/vaultix/ai/instructions`.

Keep secret values out of prompts, terminal output, tool arguments, screenshots,
and AI process environments. Inject secrets into the application being built,
not into Codex or another assistant process.

References: [Codex authentication](https://developers.openai.com/codex/auth),
[Codex MCP configuration](https://developers.openai.com/codex/mcp).
