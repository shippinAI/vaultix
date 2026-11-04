# Domain-owned scripted UI actions

Owner: AngryVibes LLC. Product: Vaultix.cloud. Suite: DevSCIF.com.
Decision date: 2026-11-03. Grounding revision: `cec940d53ac39886bc5036efc4adfc5c01556779`.
Integration base: `ffd3e5d14ca03a157f061392252bb41d917205a3`, including the existing
early-access request/review workflow and migration-aware server upgrades.
Status: **executable design contract and partial source map; remote execution not enabled**.

Vaultix will expose authored, domain-specific commands that move the real UI through
the same handlers used by people. AI chooses a named action or bounded workflow,
supplies metadata, and receives a concise outcome. The application handles control
readiness, rendering, progress and recovery. Users see the action, can take over,
and can repeat the workflow themselves. This is the execution standard for the
in-place port, alongside [0076](0076-recorded-workflows-and-visible-assist.md).

## What exists and what this packet changes

`ReferenceWorkspace` already shares project/environment/folder/load handlers between
human controls and five local commands. Reset is an inline `execute` switch branch;
it is not a separately extracted handler. `ReferenceTeaching` sequences commands,
waits for a completed read, pauses when hidden and supports local takeover.
`PublicRehearsal` uses an explicitly labeled sample client. These are useful existing
implementations to extend, not evidence of a connected AI driving a tenant session.

The existing MCP adapter exposes authorized source actions, not UI dispatch. It
advertises `listChanged: false` and rejects parameters on its complete `tools/list`.
DOM `data-vaultix-action` attributes in other local work are locator metadata; they
do not establish typed bindings, authorization or completion receipts.

This packet adds the canonical [schema](../contracts/vaultix.ui-actions.v1.schema.json),
[workflow ledger](interaction/workflows.json), offline validation and a portable
[contributor skill](../.agents/skills/domain-ui-actions/SKILL.md). Sixteen entries map
five existing local commands and eleven planned registrations. Two bounded reference
script templates are planned. All 15 domain boundaries are named; most remain
unreviewed. No remote-ready entry is allowed by this schema revision.

Schema/source joins catch drift, not whole-product authorship. In particular, a
source anchor check only finds a name in a file; a reviewer must trace its behavior.
Runtime TypeScript/Go representations, core-catalog integration and real-image
binding acceptance remain UI-01/UI-03 work. This packet does not close those gates.

## Research and the limits of its support

Primary sources consulted 2026-11-03:

| Source | Design implication | What it does not prove |
| --- | --- | --- |
| [MCP tools, 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/server/tools) | Named tools with input/output schemas and structured results fit typed domain commands. User visibility and control remain necessary. | Tool annotations are not authorization. This version is the existing adapter's upper negotiated version, not a claim of implementing the newest specification. |
| [A2UI actions](https://a2ui.org/concepts/actions/) and [architecture introduction](https://a2ui.org/introduction/what-is-a2ui/) | Trusted component catalogs, local functions and explicit action context fit native rendering and a small event vocabulary. | Rendering a component does not authorize driving a different browser tab. Do not automatically synchronize credential or secret form models. Current documentation shows 0.9.1 with a 1.0 candidate; pin and test the eventual adapter. |
| [Playwright actionability](https://playwright.dev/docs/actionability) | Preserve visible, stable, enabled, event-receiving targets and editable controls, plus observed outcome checks. | Replacing selector discovery must not remove readiness checks or introduce forced clicks. |
| [Code execution with MCP](https://www.anthropic.com/research/code-execution-with-mcp) | Progressive discovery and keeping intermediate state out of model context support the efficiency hypothesis. Authored finite scripts can apply those principles without arbitrary model-generated code. | Its reported savings belong to its example, not Vaultix. It does not prove this design's resource use or success rate. |
| [W3C SCXML](https://www.w3.org/TR/scxml/) | Explicit event/state transitions help make cancellation, completion and failure testable. | We are not adopting an XML interpreter or claiming SCXML conformance. |

The research supports the mechanism. **Vaultix token, latency and resource savings
remain unmeasured.** The browser still runs and renders the app. Expected savings
come from fewer model observation/decision round trips and smaller discovery/results.

## Domain and surface boundaries

Reuse the 13 IDs in `docs/capabilities/catalog.mjs`: workspace, secrets, access,
automation, connect, pki, kms, pam, detect, ai, governance, operate and experience.
Add public and auth for pre-session workflows. Auth owns establishing/recovering a
session; access owns authenticated identity, membership and permission administration.
These additions do not change the business capability catalog.

Domain ownership and execution surface are different. The same secrets reference
workflow can run on `public` with isolated samples or on `tenant` with authorized
real metadata. A public receipt cannot satisfy tenant acceptance. `auth` can explain
configured methods and navigate authored help. Passwords, MFA/recovery codes,
CAPTCHA, provider credentials and account-link consent stay local and human-only.
An early-access request is a mutation with abuse controls, not navigation or account
enrollment. The existing implementation is documented in [0112](0112-early-access-requests.md);
its semantic UI registration remains part of the public/access review.

IDs follow `vaultix.ui.<domain>.<workflow>.<action>`. Existing source IDs such as
`vaultix.secrets.references` remain the business authority. Existing local IDs such
as `reference.folder` are explicitly mapped to the new design IDs; this is a
versioned internal command mapping, not a second product binary or legacy-brand alias.
Register user intentions, help and review boundaries, not individual keystrokes.

## MCP discovery and execution shape

Extend the existing MCP/catalog implementation when the runtime is ready. Do not
create another model-only business API. A small discovery tool/resource supplies
domain summaries; detailed schemas are loaded for the chosen domain and workflow.
Use standard MCP pagination or resources where negotiated. **Do not add a `domain`
parameter to standard `tools/list`.** Domain selection belongs in a Vaultix-defined
discovery tool or resource. Change notifications require an implemented capability;
do not advertise them while the server says `listChanged: false`.

Proposed public tool namespaces are `vaultix.ui.public.*`, `vaultix.ui.auth.*` and
`vaultix.ui.<business-domain>.*`. Authentication-plane tools carry no credentials.
An authenticated endpoint may expose public guidance as well; never expose tenant
discovery through an anonymous route. Listing an action neither grants permission
nor proves the matching viewport is mounted.

Prefer a concrete, schema-bound workflow tool such as the proposed
`vaultix.ui.secrets.reference.walkthrough` over an unrestricted `run(args)` tool.
Its eventual input is a paired view plus project/environment/folder metadata; its
authored steps are project selection, environment selection, folder selection and
reference load. The templates in the ledger bind these parameters explicitly and
allow at most eight steps, no script recursion, expressions, arbitrary URLs,
selectors, HTML, JavaScript or nested tool calls. Every step still gets current
authorization/readiness checks. Cross-domain tasks compose separate domain calls.

Return invocation ID, state, operation receipt and viewport acknowledgement, with
bounded metadata only. Put detailed progress in the visible UI and authorized
operation status; return compact changes to the model. Where the MCP version/host
requires a text copy of structured results, include it and count it in benchmarks.
Do not cache private discovery or results across identities or tenants.

## Binding, execution and receipts

The experimental contract separates definitions, mounted binding descriptors,
invocations and receipts. JSON contains no function: authored React code resolves
the binding to a typed local handler. A definition digest detects a stale definition;
it is not a signature or a permission. Handler functions, authenticated identities,
confirmation tokens and server-derived policy never come from the model payload.

The offline validator demonstrates exact fields, versions, schema-specific inputs,
surface/tenant/resource matching, view generation, target, availability, digest,
30-second delivery lease and an 8 KiB invocation limit. It does **not** implement
sequence replay storage, session authentication, control pairing or a dispatcher.
The runtime must additionally enforce these in the existing source authority:

1. Pair an authenticated client with a human-selected visible tab and exact session,
   tenant, scope, catalog revision and generation. Start same-actor/same-tenant;
   machine identity cannot borrow a human browser's privileges. Effective authority
   intersects both sessions and method policy, including MFA assurance.
2. Validate the authored definition, payload, current binding and session lease.
   Recheck source permission before each dispatch. Resolve a unique authored
   control reference within the paired view; fail on hidden, disabled, covered,
   unmounted or stale targets. Never fall back to arbitrary document selectors.
3. Present intent. Await explicit human review when required, bound to the exact
   canonical change, actor, scope and expiry. Changed inputs invalidate review.
4. Call the same feature handler used by pointer/keyboard. Keep existing validation,
   pending guards, access requests, audit semantics and encrypted store.
5. Distinguish accepted intent, displayed progress, service completion, viewport
   acknowledgement and lesson completion. A successful service operation may have
   a disconnected viewport. An accepted local command is not a successful read.

Execution transitions: validated -> awaiting-human or running -> succeeded, failed
or unknown. Rejection happens before dispatch; cancellation before dispatch has no
effect. In-flight cancellation does not invent rollback. Unknown mutation outcomes
require source receipt reconciliation. Durable idempotency belongs atomically with
the source operation; browser deduplication cannot guarantee exactly-once effects.

Pause/takeover stops local dispatch immediately and revokes the server generation.
Already-dispatched operations reconcile. Reconnection, background tabs, logout,
scope change, unmount, permissions lost and cache failure invalidate or pause the
binding. Two replicas must share claim/revocation state with Dragonfly by default;
test Redis and ElastiCache separately. Follow 0076's bounded queues and lease tests.
MCP Apps capability negotiation is a separate boundary from controlling a browser tab.

## Port complete workflows in place

The faster path is to preserve correct existing logic and convert one complete
workflow at a time. Read its component, handlers, API, permission checks, store
effects and tests together. Rename owned product contracts and generated consumers
coherently; migrate persisted identifiers with tested compatibility, not blind text
replacement. Record what was reviewed, retained and rewritten. Discovery counts
and inherited passing tests never confer authorship or capability parity.

| Next packet | Concrete change | Required proof |
| --- | --- | --- |
| Domain standard (this packet) | Schema, partial ledger, validator, research and contributor instructions. | Negative schema/coverage fixtures and existing command compatibility. Remote availability stays empty. |
| Public/auth registration | Complete the existing landing/help/video/rehearsal controls and sign-in/setup/recovery method map; extract shared metadata handlers only where needed. | Real routes, keyboard/dialog focus, failure states, human-only fields excluded, public/sample isolation. No blanket “auth converted” from a login screenshot. |
| First cards + local bindings | Remake existing overview/project cards per 0076; retain five-product access/setup branches. Register reference retry/search/copy/pagination and shared help. | Baseline comparison; actual before/after; canonical image; loading, errors, keyboard, reflow, reduced motion and source-state checks. |
| Complete human identity path | Public device ingress, browser approval, normal CLI headless flow and consistent MCP session admission. | Real packaged CLI + browser, built-in identity without Nomen, separately configured provider acceptance, denial/expiry/revocation and tenant isolation. |
| Paired reference assistance | Existing MCP/source routing, native control session lifecycle, real React bindings and concise receipts. | Real named AI client + browser; two tabs/replicas; replay, takeover, loss and reconnection; independent service/UI outcome assertions. |
| First metadata mutation | Existing environment workflow and source service, exact human review and durable reconciliation. | Changed review rejection, duplicate/lost replies, permission loss, retained form state and persisted outcome. |
| Domain expansion | Complete the other ledger domains in dependency order with their existing handlers. | Per-workflow capability preservation, UI/source receipt mapping and manual accessibility review. No bulk promotion of unreviewed rows. |

Do not block local UI improvement on rewriting every service into Go first. A native
domain migration moves an entire accepted use case and its store/authorization,
as required by 0027. A Go relay alone cannot close migration. UI cards, actual-client
rendering, manual accessibility, provider wiring and cloud scale remain open gates.

## Benchmark before claiming “a fraction of the tokens”

Compare identical tasks and initial state on the same canonical image and model
version. Use both the configured browser MCP/Playwright route and semantic tools.
For each public rehearsal and real tenant reference task, run at least 20 paired
trials, randomize order, separate cold discovery from warm discovery, and include
invalid scope, missing permission, stale view and a recoverable service failure.
Both methods must reach the same independently observed service/UI outcome.

Record model-reported input/output/cached tokens, tool definitions/results including
duplicated text, observation count, calls, retries, task success, wall time, browser
and orchestrator CPU/RSS, network bytes and takeover delay. Keep p50/p95 plus raw
sample counts and failures; cost uses the actual client's accounting. Bytes divided
by four is not measured token usage. Separate authored teaching delays from execution
latency, and include setup/pairing costs in an end-to-end column.

The owner hypothesis is materially lower token/resource use. Predeclare a candidate
target of at most 25% of browser-route tokens for successful warm repeated workflows;
this is an evaluation target, **not a finding or release promise**. Never exclude
failures to improve the ratio. Publish all-task totals as well as successful-task
medians. Functional/authorization/accessibility regressions fail acceptance regardless
of savings. Small samples are a prototype comparison, not statistical equivalence
or proof of public-cloud capacity. Re-evaluate with other models/clients before
generalizing. No benchmark is recorded as completed in this packet.

## Reproduce the delivered checks

```sh
node --experimental-strip-types scripts/check-ui-action-standard.mjs
node --experimental-strip-types scripts/check-ui-action-standard.mjs --domain auth
node --experimental-strip-types --test scripts/ui-action-standard.test.mjs
node --experimental-strip-types scripts/test-reference-commands.mjs
```

Install the pinned `.ai` dependencies using the existing journal instructions if
needed. The checker is offline tooling, not an MCP server or a product runtime.
It joins the real command catalog and rejects a deliberately reduced ledger through
the actual CLI. None of these checks substitutes for packaged UI/client acceptance.
This packet changes no application image layers relative to its integration base
and does not claim new visible remote controls. Image verification still uses the
exact candidate and existing protected delivery checks.
