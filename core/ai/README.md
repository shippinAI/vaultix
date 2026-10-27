# Vaultix for AI coding tools

Clyffy is Vaultix's secrets specialist. Its guidance runs in your own Codex
client. Sign in with ChatGPT through `codex login`; your subscription's limits
apply. Vaultix does not receive your ChatGPT session or an OpenAI API key.

Add your instance to the Codex configuration:

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

The connection above provides public guidance. Nomen client sign-in/token exchange
for the hosted specialist is still being integrated. Never paste a Vaultix token
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
