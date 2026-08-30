# 0010 — Doppler → Vaultix capability gap ledger

**Status:** ledger (2026-08-20); engine claims below refer to leftover
schema-dump, not the live `vaultix_*` store (doc 0011).
**Owner:** AngryVibes LLC. **Host:** shippin.ai. **Product:** Vaultix.
Enterprise extras activate via license/membership (doc 0013).
**Sources:** operator's logged-in Doppler screenshots
(`docs/references/gaps-1..4.png`) + leftover schema-dump (not the runtime).

## Headline finding

**Engine parity is essentially already there.** Every capability Doppler
surfaces in these screens has backing tables in the forked Vaultix core. The
gap is **UX and one analysis feature**, not engine. This is doc 0008's thesis,
now proven table-by-table: we do not build a secrets engine, we build the
layman surface (and let Clyffy drive it).

## The ledger

| Doppler surface (screenshot) | Vaultix core — HAVE? (tables) | Gap | Build | Clyffy source-action | Pri |
|---|---|---|---|---|---|
| **Guided onboarding checklist**, % progress, "set up first project/integration, invite team, log in CLI" (gaps-1) | none — this is pure UX | **UX (the killer)** | Guided, progress-tracked onboarding **driven in the viewport by Clyffy** | `vaultix.onboard.*` — the lesson ladder as live runs | **P0** |
| Contextual **Pro Tips** ("Project Naming") (gaps-1) | n/a | UX | Inline plain-language guidance beside actions | narration already carries this | P1 |
| **Integrations / Syncs** — one-click sync to AWS/Azure/GCP… (gaps-2) | `app_connections` (2), `secret_syncs` (1) — **83 connection + 49 sync providers** already (endpoint inventory) | **UX** (engine present) | One-click "connect + sync" flow over the existing providers | `vaultix.sync.connect`, `vaultix.sync.enable` | **P0** |
| **Change Requests** (approve secret changes) (gaps-1 nav) | `secret_approval*` (10), `access_approval*` (6), `approval_request` | UX | Approve/request UI | `vaultix.change.request/approve` | P1 |
| **Compare** (diff configs/environments) (gaps-1 nav) | `secret_snapshot` (4), `secret_version` (4) | UX | Diff view over snapshots/versions | `vaultix.compare` | P1 |
| **Activity** (audit feed) (gaps-1 nav) | `audit_log*` (3) | UX | Readable, plain-language activity feed | `vaultix.activity` | P1 |
| **Secrets Health / Stale secrets** — masked secrets not updated in N time, dismiss, filter (gaps-3) | data exists (`updatedAt` on secrets) but **no analysis layer** | **Feature (real gap)** | Stale-secret detection + health dashboard | `vaultix.health.scan`, narrates risk in plain words | **P0** |
| **Tokens / Service Tokens / SA API Tokens** (gaps-1 nav, gaps-4) | `identity*` (24), `service_token` (1) | UX | Token issue/list UI | `vaultix.token.issue` | P2 |
| **Recurring Reminders** (gaps-4) | `reminders` (2) | UX | Reminder set UI | `vaultix.reminder.set` | P2 |
| **Rotated Secrets** (gaps-4, Doppler gates behind Team) | `secret_rotation*` (5) | UX | **One-click rotation** (Infisical's strength, made easy) | `vaultix.rotate` | P1 |
| **Webhooks** (gaps-4) | `webhooks` (1) | UX | Webhook config UI | `vaultix.webhook.add` | P2 |
| **Share Secret** (one-time) (gaps-1 nav) | `secret_sharing`/`shared_secrets` | UX | One-time share flow | `vaultix.share` | P2 |
| **Team / invite** (gaps-1) | org membership, `user_group`, members | UX | Invite + roles UI (Nomen principals, doc 0003) | `vaultix.team.invite` | P2 |
| Plan **usage meters** (gaps-4: 2/10 projects, 0/5 syncs…) | **capability built** (`internal/usage`), enforcement OFF by default | **Built as an OPTION** | The meter plumbing exists so it's a config flag (`VAULTIX_METER_ENFORCE`), never a retrofit — but the anti-goal (doc 0003) holds by default: unlimited + unenforced. `GET /api/v1/vaultix/usage` shows the view | — | — |
| **Refer Friend** (gaps-1 nav) | n/a | park | growth, not core | — | park |

## What this means for the build

**Two real feature gaps, everything else is UX:**
1. **Secrets Health / stale-secret analytics** (P0) — the one place Doppler
   has a capability our core doesn't surface. The `updatedAt` data is there;
   we build the detection + dashboard.
2. **Guided onboarding + one-click sync flows** (P0) — not engine gaps, but
   the UX that *is* Doppler's whole advantage. This is where Clyffy lives:
   the onboarding checklist and the sync setup are **Clyffy source-actions
   driven in the viewport** (doc 0009), so the layman watches it happen and
   learns.

Everything else (approvals, compare, activity, rotation, reminders, webhooks,
sharing, tokens, team) is **engine-present, UX-absent** — each becomes a
`source` action + a panel view, in priority order.

## Build backlog (prioritized)

- **P0** — Secrets Health dashboard + stale scan; guided onboarding (Clyffy
  viewport); one-click sync flow over existing providers.
- **P1** — one-click rotation; Change Requests; Compare; Activity feed;
  contextual pro-tips.
- **P2** — tokens, reminders, webhooks, share, team invite UIs.
- **Do not build** — usage meters/seat caps (anti-goal, doc 0003).

Each P0/P1 lands as: (a) the panel view, (b) the `source` action(s) with
plain label + narration so Clyffy drives it in-viewport, (c) tests. The
source-action framework (doc 0009, shipped) is the delivery vehicle.
