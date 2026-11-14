# AI personas, specialists and machine loops

Accepted direction, 2026-11-11. Extends [0123](0123-signal-fabric.md) (signals, receipts, hosted
agent) and [0009](0009-clyffy-specialist-boundary.md) (a general Clyffy hands off to specialists).
Order of work: [0122](0122-completion-plan.md).

In the owner's words: every capability is managed in the panel; Vaultix ships default personas and
dedicated specialists, a mixture of experts tailored to the app and to security, with canonical
names in code, files and folders; an optional local endpoint and machine loops let other apps
connect to save and use variables; a sensitive value only ever exists in the browser at the moment
a person submits it; and a person's own AI (their API key or subscription) works together with the
instance's AI.

## What exists today (checked 2026-11-11)

| Area | State |
| --- | --- |
| AI providers | Built: Admin > AI Assistant; Go store with keys under the root key; five adapters (Anthropic direct, Bedrock, Vertex, OpenAI, OpenAI-compatible); recorded connection tests. Proven on the image with a stand-in model; no real provider run yet. |
| Personas, specialists | Built: defaults in `platform/engine/ai/personas`, overrides and custom personas in `vx_ai_personas`, routing by mention, page or Clyffy, each persona on its domains' warp points, read-only. The guard does not act yet; there is nothing to approve. |
| Domain tools | Warp points: one MCP per domain at `/api/vx/v1/<domain>/mcp`; 8 live, 7 planned. |
| Values leaving the server | Native core has no inject or redeem. The CLI reads values through `GET /api/v3/secrets/raw`. Only the optional panel has inject/redeem. |
| A person entering a value for someone else | Secret requests (`services/secret-sharing`): the value is stored encrypted under the root key, outside any project, and can be revealed repeatedly. |
| Local endpoint | None. `vaultix daemon` is an outbound sync loop; `vaultix mcp` is stdio only. |
| A person's own AI | `vaultix mcp` over stdio with the saved sign-in; names and references only. Riding the person's session (device flow) is built in Go but off and has no approval page. |

### Wrong in the existing code

1. Fixed: the panel's MCP returned the inject redeem handle to the model. It now refuses any action
   that hands out a handle.
2. Fixed: the panel's `vaultix.store-key` took the secret value as an MCP argument. The MCP now
   refuses any action with a secret input; it runs in the UI only.
3. Partly fixed: the panel's redeem route is unauthenticated by design and recorded no actor; it
   now records who presented the handle. Binding the handle to an identity is step 3 below.
4. Open: the CLI's `pull` and `run` read values with a GET, against "GET is metadata only".
   Step 3 below.
5. Fixed: the hosted agent's instructions came from one hard-coded prompt; they now come from
   personas, and its tools from warp points.

## Personas and specialists

**Canonical layout.** Default personas ship in the image as files:

```text
platform/engine/ai/personas/
  clyffy/PERSONA.md          router: greets, works out the domain, hands off visibly
  secrets/PERSONA.md         specialist: secrets, connect
  access/PERSONA.md          specialist: auth, identity, access, governance
  operate/PERSONA.md         specialist: workspace, operate, experience
  security/PERSONA.md        guard: reviews every proposed change and handoff for risk
```

Each `PERSONA.md` has front matter and a body of instructions:

```yaml
id: vaultix.persona.secrets        # pattern from 0115: vaultix.persona.<slug>
name: Secrets specialist
role: specialist                   # router | specialist | guard
domains: [secrets, connect]        # canonical domains from docs/interaction/workflows.json
tier: standard                     # fast | standard | deep: a hint for which model to use
```

Specialists for pki, kms, pam, detect and the other planned domains are added as each warp point
goes live, under the same names.

**Rules.**

- A persona never grants anything. Its tools are the person's own, from its domains' warp points,
  through the same permissions and audit as the UI. A persona can only narrow them.
- The answer always says which persona answered, and every handoff is visible (0009).
- No persona is ever given a value, a redeem handle or a credential.

**Mixture of experts.** For each message:

1. Route deterministically when possible: an explicit mention ("@secrets"), then the domain of the
   page the person is on (from their signals).
2. Otherwise the router persona picks one specialist from the enabled list, with a constrained
   answer, on a fast model.
3. The specialist answers with its domains' warp-point tools only.
4. Any proposed change or value request passes the security guard first: fixed policy checks, then
   the guard persona's risk note, shown to the person beside the approval.

## Managed in the panel

> Being rewritten to one schema with guided setup, Hugging Face and Custom connections:
> [0126](0126-ai-configuration-schema.md). Where the two differ, 0126 wins.

Admin → AI, one place for the instance:

- **Providers**: add, test (a real call, with the result kept as the receipt), activate, remove.
  Keys are encrypted under the instance root key and never shown again.
- **Models**: each provider has a standard model and optional fast and deep models. A persona runs
  on its tier's model (Clyffy routes on the fast one), or on a model ID pinned on the persona.
  "Load models" asks the provider which models the saved key can use (Anthropic and OpenAI model
  lists, Bedrock inference profiles and foundation models, Vertex Model Garden, a compatible
  server's `/models`); any ID the provider accepts can still be typed. The connection test calls
  every configured model, and each answer names the model it ran on.
- **Personas and specialists**: the defaults are listed and can be edited, given their own provider
  and model, disabled, or reset to the shipped text; they cannot be deleted. Administrators add
  custom personas and specialists under the same rules.
- **Routing**: which specialist answers for each domain, and the router's model.
- **Try it**: send a sample question through routing and see which persona answered, which tools
  ran and the receipt.

Storage: `vx_ai_providers` and `vx_ai_personas`, both with a nullable `orgId` so organizations can
later bring their own provider and personas without a schema change. Instance rows come first.

## Memories

Short notes the assistant reads before it answers, in `vx_ai_memories`:

- **Instance memories** are written by instance administrators (Admin → AI Assistant) and apply to
  everyone, such as naming conventions or change rules.
- **Personal memories** belong to one person, who adds, edits and forgets them from the assistant
  panel. Nobody else sees them, administrators included.
- A memory can apply to every persona or to one. At most 100 of each kind, 1,000 characters each.
- **Never a value.** Text shaped like a credential (a known token format, a key block, a URL with a
  password, a long random string) is refused, with the advice to store it as a secret and remember
  its name.
- **Notes, not instructions.** The prompt frames memories as information that never changes the
  standing rules.
- **Suggestions save nothing.** A persona may call `propose_memory` when the person states
  something lasting. The suggestion appears under the answer with Remember and Dismiss, and is
  saved only when the person accepts it. `propose_memory` is not an MCP action and writes nothing,
  so the rule that models act only through the source actions still holds.

Routes: `GET/POST /api/vx/v1/ai/memories` and `PATCH/DELETE /api/vx/v1/ai/memories/{memoryId}` for
any signed-in person; another person's memory answers 404.

## Values only in the browser: value requests

The loop that lets an AI or an app get a value saved without ever seeing it:

1. The AI or app creates a **value request**: project, environment, path, variable name, purpose,
   and an expiry of at most an hour. It gets back the request ID and a link. No value.
2. The person opens the request (a handoff card in the chat, or the link). The browser submits the
   value straight to the secrets API with the person's own session and permission check.
3. The value is written into the project secret, encrypted with the project key. It is never stored
   in the request.
4. The requester sees the outcome only: fulfilled, with the secret name and version, or declined
   or expired.

This is `vaultix.secrets.values.request` on the secrets warp point, and the same route for apps.

## Using a value: native inject and redeem

A paired app or a `vaultix run` process gets values through a one-use, short-lived handle:
`POST /api/vx/v1/secrets/injections` names the variables and returns a handle bound to the caller's
identity; `POST /api/vx/v1/secrets/injections/{handle}/redeem` returns the values once, to that same
identity, and is audited with the actor. No MCP tool can create or redeem one. The CLI's `pull` and
`run` move to this and the GET path stops returning values (rule 4 of 0122: no compatibility
alias). The Rust delivery broker in [0027](0027-native-stack-and-ai-migration.md) later carries the
same handle over protected IPC.

## The optional local endpoint

`vaultix local serve`, off by default, listens on loopback only (a Unix socket, or a named pipe on
Windows). An app pairs once: it asks, the person approves in the browser, and the app gets a local
token limited to named projects and variables. Through it an app can list names, create value
requests, and receive values only by redeem. The endpoint never hands a value to an AI client.

## The person's own AI with the instance's AI

A person's main AI (Codex, Claude or another MCP client, on their own subscription or API key)
connects through `vaultix mcp`, and through the device flow once its approval page exists (0122
Stage 3). New tools let the two work together:

- `vaultix.ai.personas.list`: the instance's personas and specialists.
- `vaultix.ai.ask`: consult a specialist; the instance's provider answers with the person's
  permissions.
- `vaultix.secrets.values.request`: ask the person for a value through the browser.

## Order

1. Personas registry (files and `vx_ai_personas`), routing and the guard over warp points; Admin →
   AI with providers and personas; chat in the Clyffy panel; fixes 1–3 and 5 above. Done, with
   per-tier models, provider model lists and memories (2026-11-11).
2. Value requests with the handoff card and the MCP tool.
3. Native inject and redeem; the CLI moves off the GET (fix 4).
4. The local endpoint with app pairing.
5. `vaultix.ai.*` tools for the person's own AI, with the device flow.

Each step is proven on the image: a canary value is checked absent from every model request,
signal, tool result, chat message and log line, and a denied person is refused through every path.

## Open for the owner

| Decision | Needed before |
| --- | --- |
| Whether organizations on vaultix.cloud bring their own provider keys and personas, and any usage limits on the operator's provider | Opening the assistant to outside organizations |
| The default persona set and names above | Step 1 ships |
