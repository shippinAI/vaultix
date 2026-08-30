# 0009 — Clyffy specialist boundary: the source API and the viewport-operator model

**Status:** design (2026-08-20)
**Owner:** AngryVibes LLC. **Host:** shippin.ai. **Product:** Vaultix.
**Principle:** Clyffy operates the **real UI, in the viewport, as if it were
the operator.** Nothing happens behind the scenes. The user learns passively
by watching the actual thing get done.

## 1. The model

Each estate boundary (Vaultix = secrets, Tradere = mail, Zuul = network…)
owns a **specialist Clyffy**. A general incoming Clyffy does not learn every
boundary — it **hands off** to the specialist, which knows that boundary's
UI, schema, and capabilities cold and takes over.

```text
Incoming (general) Clyffy
      │  recognizes: this is a secrets task
      ▼
Vaultix specialist Clyffy  ── drives ──▶  the real Vaultix panel UI
      │                                      (in the user's viewport)
      └── user watches every action, learns passively
```

The specialist doesn't call a hidden API and report success. It **clicks the
buttons the user would click**, visibly, narrating as it goes — the lesson
ladder (doc 0002) becomes live operation instead of pre-recorded video.

## 2. The "source API" — UI actions as first-class, drivable, observable

For Clyffy to operate the UI as the operator, every panel action must be a
**typed command** that can be issued by (a) a human click OR (b) the
specialist Clyffy — and when Clyffy issues it, it renders in the viewport
exactly as a human action would.

This is the source API: not a headless backend, but the **operable surface
of the UI**. Contract per boundary:

```
boundary: "vaultix"
actions:                         # every operator action, typed
  - id: vaultix.ui.project.create
    label: "Make a box for this app"     # plain language (doc 0002/0008)
    inputs: { name }
    renders: highlights the New Project control, fills it, submits, and
             shows the result — visibly, at human-watchable pace
  - id: vaultix.ui.secret.put
  - id: vaultix.ui.secret.inject       # shows the value flow to the devspace
  - id: vaultix.ui.rotate
state:                           # what the specialist can read to decide
  - the same metadata the panel shows (never secret values)
narration:                       # what Clyffy says while doing it
  - per action, one plain sentence the user reads as it happens
```

Requirements that make it viewport-first (not automation-behind-glass):
1. **Every action is observable.** No action exists that Clyffy can take
   that the user cannot see happen in the viewport.
2. **Human-watchable pace.** Actions animate at a speed a person can follow
   and learn from, not instant.
3. **Same surface, two drivers.** The human and the specialist Clyffy use
   the identical action set — Clyffy has no privileged hidden path.
4. **Narrated.** Each action carries the plain sentence Clyffy speaks, so
   watching teaches the concept (inject-not-paste, one-box-per-app…).
5. **Metadata-only reads.** The specialist reads what the panel shows —
   never secret values (the doc 0004 boundary holds for Clyffy too).

## 3. How it composes with what's built

- The Vaultix **panel contract** (`shippin.vaultix.panel.v1`) is the
  capability layer underneath; the source API is its **UI-action mirror** —
  each contract capability has a corresponding observable UI action.
- The **forked schema** (doc 0007) is what the specialist's actions
  ultimately write, once the backend fork runs it.
- The **layman UX backlog** (doc 0008) is what the specialist demonstrates:
  it drives the guided onboarding, the visible propagation, the one-click
  rotation — all in-viewport.
- Same pattern extends to Tradere (mail specialist drives the Tradere panel)
  and every future boundary: one specialist Clyffy per boundary, one source
  API per boundary, incoming Clyffy delegates.

## 4. Build order

1. **Done — source-API action set + driver** (`panel/internal/source/`).
   Typed actions with plain labels + narration + the lesson each teaches;
   `Driver.Execute` returns ordered, narrated, metadata-only Steps.
   Served at `GET /api/v1/vaultix/source/manifest`; executed at
   `POST /api/v1/vaultix/source/act` (elevated). Human and Clyffy use the
   same route; the `actor` is recorded and audited (`source.act.<actor>`).
   Tested: narration present, secret values never in a Step/response,
   actor recorded, failure observable.
2. **Done — viewport component** (`web/src/domain/vaultix/`).
   `SourceViewport.tsx` renders each action's Steps one at a time at a
   human-watchable pace (`STEP_DELAY_MS`), with an actor badge so a Clyffy
   run is never hidden. `sourceApi.ts` is the typed client (tested).
3. **Next — specialist-handoff protocol:** incoming Clyffy → "secrets
   boundary" → Vaultix specialist drives `SourceViewport` via the same
   `runner`. The seam exists (the `runner` prop); the handoff wiring is the
   remaining piece.
4. **Next — replace doc 0002 lesson videos** with live specialist runs
   (the narration + `teaches` field already carry the lesson).
5. **Next — generalize** so each boundary (Tradere, Zuul) declares its own
   source API the same way.
