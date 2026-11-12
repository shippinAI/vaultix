# The signal fabric, outcome receipts and the rehearsal demo

Accepted direction, 2026-11-11. This comes before the commercial control plane: Vaultix
must teach and help while it is used, with the owner able to see it working, before
shippin.ai hosts it for others. It builds on [0024](0024-interaction-and-teaching-system.md)
(teaching), [0114](0114-domain-scripted-ui-standard.md) (domain UI actions) and
[0120](0120-mcpl-framework.md) (MCPL). Order of work: [0122](0122-completion-plan.md).

## What is true today

Checked in code on 2026-11-11:

- UI actions carry `data-vaultix-action`, `-scope` and `-target` attributes
  (`platform/engine/frontend/src/components/vaultix/action-trigger.ts`). Only tests read them.
- Lesson state is local to the page (`guidance-state.ts`) and sends nothing.
  `POST /api/v1/vaultix/learning-context` exists and nothing calls it.
- "Clyffy" in the signed-in app is a scripted reference browser. Nothing in the app calls
  a model. A2UI message streams exist only in the optional Go panel, which the standalone
  image does not include.
- There is no demo account. The dev seeds (`platform/engine/backend/src/db/seeds/`) never run in the
  image, and the landing page rehearsal is an in-browser fake.

## The fabric

In the owner's words: "Signals that trigger over the user experience a myriad of passive
visuals that are easily cleared by escape as well as not overwhelming the user with
additional UI to say more or less or none of these types and thumbs up thumbs down in a
clear grouped context … triggers functions hooks that canonical and think of it as our
AGENTS.md for establishing a framework that any dev can adopt and implement custom AI
guided not just onboarding but scripted events for all UI actions and inputs that can be
absorbed by AI. Only sensitive information needs to be handled by the handoff … the
secret gets saved and the variable is only discussed in the chat or name/label."

What that means in Vaultix:

1. **Every UI action and input emits a signal.** A signal names a catalog action
   (domain, action, scope, target), the step it belongs to and its outcome. The catalog
   is the existing one (`docs/interaction/workflows.json`,
   `contracts/vaultix.ui-actions.v1.schema.json`); a signal for an action not in the
   catalog is refused, not invented.
2. **Signals never carry values.** An input bound to a secret emits its name or label
   only. The value goes straight to the store through the handoff, and the AI discusses
   the name. This is the existing rule (AGENTS.md: references, never values).
3. **Passive visuals.** Signals may show hints, tips and next steps that never block the
   page, close with Escape, and are grouped by domain so they read as one context.
4. **The user sets the volume.** Per person: more, less or none, per signal type. The
   setting persists with the account.
5. **Thumbs up and down,** on each group of hints, recorded against the catalog action so
   lessons can be improved.
6. **One canonical framework.** A published contract plus the frontend hooks and
   functions that emit and consume signals, documented so any developer can add an
   action to the catalog and get signals, hints, receipts and AI awareness for free. It
   is to the UI what AGENTS.md is to agents.
7. **AI absorbs the stream.** The chat agent and the teaching system subscribe to the
   signed-in user's signals and answer with catalog-checked A2UI rendered in the core
   app. Signals reach only that user's own agent session, with that user's permissions.

## Outcome receipts

Every serious action (create, change, delete, approve, import, rotate, invite, and the
rest of the catalog's write actions) ends in a toast or a dialog built from the server's
answer, and nothing else:

- **Never mocked, never optimistic, no fallback.** The UI shows pass only after the
  server returns success with a receipt (the audit event or operation it recorded).
- **A failure shows why,** using the plain `error` string every expected API failure
  already carries.
- **Visual variants** by domain and by action group, so a secrets change, an access
  change and an operations change look different at a glance.

## The rehearsal demo

In the owner's words: "spins up a full read only experience that allows the user to have
writes but it never uses the database it just goes through all the true motions … they
cannot be mocked or fallback; they fail, they show why; if they pass they show pass; it
can never be faked."

Design:

- A visitor starts a demo session. Each request goes through the real routes, permission
  checks, validation, policy and encryption, inside a database transaction that is always
  rolled back. Nothing reaches the store.
- The result is the real result: a denial is a real denial, a validation error is real,
  and a pass carries a receipt marked as a rehearsal.
- Because the write is rolled back, what the visitor created is held in a per-session
  overlay that expires with the session. It holds names and metadata, never secret
  values, and is isolated from real tenants.
- The demo starts from a seeded sample organization (projects, environments, an import
  source, lessons), so the whole experience can be walked: import, approve, reference,
  invite, rotate.

Open: how far the overlay reaches. Services that call outside systems (syncs, rotations,
dynamic secrets, email) stop at the outbound boundary and report what they would have
sent; that boundary is shown, not hidden.

## The chat agent

The owner wants a hosted chat agent inside vaultix.cloud while their own model setup is
built. It sees signals and references, never values, and acts only through the MCP source
actions with the signed-in user's permissions (AGENTS.md: no second API for models).

- One provider adapter, configured per instance: the model endpoint and key live in the
  instance's encrypted settings, never in a repository or chat.
- Two wire formats cover the options: the Anthropic Messages API (Claude directly, or
  through AWS Bedrock or Google Vertex) and the OpenAI-compatible chat API (OpenAI, or a
  self-hosted open-weights model on owned hardware through vLLM or Ollama). Moving from a
  hosted service to owned hardware is a settings change, not a code change.
- The AGENTS.md rule that Clyffy uses the user's local Codex sign-in changes when the
  owner picks the hosted provider. Local clients through `vaultix mcp` keep working.

## Done when

On the canonical image, in the browser:

- Using the app emits signals for catalog actions, and none carry a value (a canary
  secret is checked for absence in every signal, hint, receipt and agent message).
- Hints appear, close with Escape, follow the more/less/none setting and record thumbs.
- Every write action in the catalog ends in a server-backed receipt; a forced denial
  and a forced validation failure each show their reason.
- A demo visitor walks import, approve and reference end to end; the store is unchanged
  afterwards (row counts and an encrypted-row digest match before and after).
- The hosted agent answers from the user's signals, renders A2UI in the core app, and is
  refused anything the user's permissions refuse.
