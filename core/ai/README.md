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

The native core MCP supplies three public guidance tools:

- `vaultix.catalog.get`: the same concepts displayed by the UI.
- `vaultix.configure.show`: the same authored setup steps displayed by the UI.
- `vaultix.specialist.instructions`: Clyffy's operating instructions.

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
