# 0012 — A2UI viewport, native MCP, authored configure

**Status:** accepted (2026-08-29)
**Owner:** AngryVibes LLC. **Host:** shippin.ai. **Product:** Vaultix.
**Depends on:** 0011 (owned engine), 0009 (source API), 0002 (lesson ladder)
**Grant:** native MCP + layman A2UI paths are in-scope.

## 1. The break

Vaultix UI is not leftover product chrome with a coat of paint. It is
not a model inventing a dashboard. The **catalog is the weights**.
A2UI is the only draw path. MCP tools are the **same buttons** a human
presses in the viewport.

```text
operator or Clyffy
        │  same JSON / same MCP tool
        ▼
  Vaultix instance
        │
        ├─ catalog match?  → A2UI (source: catalog)
        ├─ configure path  → A2UI steps authored in code
        └─ source.act      → vaultix_* engine (metadata only)
```

Frontier AI runs only with a recorded reason (`no-catalog-entry` or
`operator-asked-ai`). The `ml` valve exists on the type and is never
returned. That is how ML gets a stable context without spending tokens
on “what is a box?”

## 2. Surfaces

| Surface | Route | What it is |
| --- | --- | --- |
| Knowledge catalog | `GET /api/v1/vaultix/catalog` | Glossary / Did You Know / drops |
| Runtime answer | `POST /api/v1/vaultix/runtime/answer` | `Decide` — pure |
| Viewport document | `GET /api/v1/vaultix/viewport` | Open UI input, not pixels |
| Configure ladder | `GET /api/v1/vaultix/configure` | Authored how-to |
| Viewport page | `GET /viewport/` | Fail-closed A2UI renderer |
| MCP | `POST /api/v1/vaultix/mcp` | JSON-RPC tools |

A2UI is pinned **v0.9.1**. Allowed components: `glossary`, `did-you-know`,
`knowledge-drop`, `configure-step`, `action-button`, `narration`, `stamp`,
`next-hint`. Unknown ids refuse to render.

## 3. Configure path (show the user)

Authored order, not a prompt:

1. What a box is
2. Make the box (`vaultix.make-box`)
3. Keys are not chat
4. Put a key in the box (`vaultix.store-key`)
5. The workspace asks Vaultix (`vaultix.inject`)

Clyffy walks this with `vaultix.configure.show`. The human walks it on
`/viewport/`. Same steps.

## 4. MCP tools

`vaultix.runtime.answer`, `vaultix.viewport.get`,
`vaultix.configure.show`, `vaultix.source.manifest`,
`vaultix.source.act`.

`source.act` requires PIN step-up on HTTP. It never echoes a secret
value. Stdio `vaultix mcp` is catalog-first (teaching without a store).
The product MCP is the HTTP endpoint on the instance.

## 5. Must not

- Let a model mint catalog entries at runtime.
- Claim `source: catalog` for model output.
- Render a component outside the allow-list.
- Put values in A2UI, MCP content, or viewport documents.
- Wrap leftover UI as the viewport.
