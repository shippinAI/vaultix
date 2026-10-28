# Environment dashboard reference editor

Status: scoped packaged-browser and cache acceptance passed, 2026-10-28.

## Accepted image checkpoint

Image identity work is committed and pushed as
`7b01f20856ba311a3e410e2679b7dda73f8657e2`. Both canonical engine and optional panel
were rebuilt with that exact revision and passed the actual-image identity gate.
Canonical image
`sha256:05d94f9d66389f8267b7953c7f29e22c12f7d9abc15f76f45059f88eb7e5360c`
has identical filesystem layers and runtime configuration to the accepted local
0045 build, excluding only its revision label. It is healthy in the local backend;
the existing database/cache container IDs are unchanged. Integrated app/API on
8200 and Vite UI on 3000 return 200. Evidence:
`.cache/image-identity-committed-comparison.json`,
`.cache/image-identity-dev-rollout.json`, and source-push/build logs. This does not
establish GHCR publication, a WI/TX deployment or optional-panel runtime acceptance.

## Review and scope

Read the complete v2 `VaultixSecretInput` and its base `SecretInput`, and compare
the v3 reference wrapper. Existing consumers include dashboard create, detail,
list, environment comparison and overview edit/override rows. This packet verifies
the environment dashboard create consumer; the other consumers remain acceptance
work. Their caller discovery is not whole-file review credit.

The v2 wrapper keeps its deeper environment/folder prefix suggestions, including
metadata-only secret-name queries. Its first-level and cross-project input uses
the shared wizard. The v3 wrapper always uses the wizard. These paths must be
characterized before consolidating them; substituting component names is not
proof of equivalent behavior.

The source contains a Tab trap in deeper suggestions, including the no-match
case. A Popover trigger also puts button expansion attributes on a multiline
textbox, and generic suggestion labels hide the visible reference name. Controlled
popup state ignores dismissal. The baseline packaged image reproduced the invalid
`aria-expanded="true"` on the textarea and an unnamed reference dialog at
`.cache/app-image-proof-RmBMWl/dashboard-reference-semantics.json`; the acceptance
runner stopped at that assertion. The Tab defect is a source finding pending
the repaired behavioral check, not a separately recorded baseline browser result.

The first repaired-image run (`.cache/app-image-proof-TO44xH`) passed named
suggestion/keyboard insertion, then exposed a debounce race: an old suggestion
could be selected before the new input prefix had been parsed, overwriting its
surrounding text. While input and debounced suggestions differ, selection handlers
now refuse insertion, deeper buttons are disabled, the popup reports busy, and
the wizard's keyboard handler is disabled. Acceptance waits for a settled named
suggestion before testing pointer insertion. This preserves the debounce interval
and query behavior while closing the stale-selection window.

## Authored behavior and preservation

The existing editor stays in place. An anchor preserves positioning without
button semantics; the popup receives a name. Deeper suggestion buttons use their
visible name/type, native button activation and containment-based blur handling.
Arrow/Enter and pointer selection remain. Tab leaves deeper suggestions, including
no matches, and controlled dismissal closes the inner popup. Scrolling is immediate
and popup width is bounded by the viewport. Ref composition accepts null without
a TypeScript suppression and follows changes to the forwarded ref.

The existing parser, closing-brace/suffix handling, same/cross-project wizard,
permission checks on reference navigation, metadata-only suggestion requests and
masked-value base editor are retained. This UI change introduces no database,
encrypted-store, authorization, API or value-delivery change. No model receives
values. Real server authorization remains authoritative.

## Acceptance and remaining work

The permanent disposable-image test checks actual fixture-name suggestions,
keyboard insertion, pointer insertion within an existing reference, suffix
preservation, Tab escape from no matches, populated Shift+Tab exit, a 320-pixel
popup under reduced motion, Escape retaining the form, and cancel without POST.
It runs after the real create/recovery fixture and existing paste compatibility
test, before the remaining application suite. Public dummy input only; no operator
instance or secret values are inspected. CI retains its scoped reports.

Canonical image
`sha256:e3537984aa217faa6779e2a242bc566138b88c0cbe9996b41c7dc9ee10679b92`
builds and passes the full ordered packaged-browser suite at
`.cache/app-image-proof-2v6T9x`, plus Dragonfly API/MCP/queue/restart smoke checks
(`.cache/dashboard-reference-settled-smoke.log`).
Redis API/MCP/queue/restart smoke also passes (`.cache/dashboard-reference-redis.log`).
Existing 273 UI routes and
2,290 API operations remain present. Type checking runs in the canonical build;
targeted ESLint and the 11 paste-parser cases pass. A preceding green run at
`gUm05r` captured the mobile popup before its updated suggestion settled; the
final test now explicitly waits for a non-busy enabled named suggestion. The final
mobile screenshot was visually checked: the populated popup stays within 320px,
and the full reference name remains its accessible button name despite truncation.

This does not establish full dashboard accessibility or editor parity:
screen readers, wizard keyboard semantics, cross-project grants, deep folder
providers, read-only/import/edit-without-view, permission denial and all other
consumers remain separate acceptance work. The base editor's hidden highlighted
reference navigation also needs accessibility review before consolidation.
