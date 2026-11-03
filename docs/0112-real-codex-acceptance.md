# Testing Vaultix with the installed Codex client

Use the same standalone image for the application and AI integration. Build it on
owned infrastructure with `node scripts/build-self-hosted.mjs`, then use the
[native instance installer or upgrade command](0109-native-install-and-upgrade.md).
The build receipt identifies the exact image. Source publication alone does not
upgrade a running server.

## Connect your testing instance

Create the owner account, organization and a project through the application.
Create a machine identity with access to the intended project and configure its
token or universal authentication in Vaultix. In your own terminal, use the native
CLI's explicit authentication mode:

```sh
vaultix login --domain https://vaultix.example.com --token
vaultix auth status
vaultix mcp config
```

Enter the credential only at the terminal prompt. The CLI verifies protected
access before saving it. Keep the printed MCP configuration alongside your
existing Codex configuration; it contains no credential. Sign in to Codex using
its own supported sign-in flow. Vaultix does not receive that sign-in.

Reconnect Codex and ask it to list authorized Vaultix projects, then list secret
references for a chosen project and environment. Reference tools return names,
versions and timestamps. Values, ciphertext and comments must stay out of model
input and output. MCP does not expose secret-changing or injection tools.

Plain browser-based `vaultix login` still depends on the unfinished Nomen public
client integration. Built-in browser/device CLI login is not accepted yet. Use
the explicit token/universal modes above for this testing path. Local account
creation and browser sign-in remain separate from this CLI limitation.

## Repeatable real-client check

`scripts/test-codex-client.mjs` launches an installed, signed-in Codex CLI against
a disposable Vaultix instance. It does not read or copy Codex authentication
files, edit client configuration, or authenticate against an operator deployment.
It uses the client's configured authentication and consumes its normal usage
allowance. This is an explicit local check, not an automatic cloud workflow.

Provide a local JSON input file with these fields:

| Field | Value |
| --- | --- |
| `image` | Exact accepted standalone `sha256:` image ID |
| `cli` | Path to the accepted Linux/amd64 native executable |
| `cliSha256` | Executable SHA-256 from its accepted CLI build receipt |
| `codex` | Optional path to the installed Codex executable |

```sh
node scripts/test-codex-client.mjs /path/to/client-inputs.json
```

The harness creates a PostgreSQL/Dragonfly instance, account, project and machine
identity on a private Docker network. The Linux CLI stores its disposable
credential inside that container. The actual host Codex process starts
`docker exec -i … vaultix mcp`; no credential is supplied in the process arguments
or model environment. An empty temporary workspace and invocation-local settings
disable unrelated integrations and shell access without changing user settings.

Acceptance requires actual MCP tool events containing the independently
provisioned project and reference. Merely receiving a successful model answer
does not pass. A random secret value/comment canary and fixture credentials are
checked against client output before evidence is saved. After server-side token
revocation, both the CLI and a fresh required-MCP Codex connection must fail;
protected fixture metadata must not appear. Owned fixture containers, network
and temporary workspace are removed on completion or caught failure. Abrupt
termination of the harness itself can leave resources requiring inspection.

Results are saved under `.cache/codex-client-*`, with the latest result linked by
`.cache/actual-codex-client.json`. Hidden reasoning events are excluded from saved
client output. This is real-client evidence against disposable data, not a test of
production enrollment, Google/Nomen federation, graphical MCP rendering, manual
accessibility or complete enterprise parity.

## Protocol compatibility

Core MCP accepts an optional object-valued request `_meta` independently of
method arguments. Metadata does not become authorization, resource selectors or
action input. Unknown cursors remain invalid for the complete, unpaginated tool
and resource catalogs. Secret-reference result pagination is a separate contract.
Malformed metadata and unknown action fields fail without echoing their contents.

This follows the [MCP 2025-11-25 metadata contract](https://modelcontextprotocol.io/specification/2025-11-25/basic/index#meta).
It does not claim support for a newer protocol merely because a client supplies
metadata for it. Service and HTTP route tests cover discovery, embedded resource
reads and attempts to impersonate an authenticated caller through metadata.
