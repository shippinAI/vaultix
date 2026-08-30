# 0004 — Panel flow, PIN step-up, and leftover source link

**Status:** partially superseded (2026-08-29). PIN / inject / metadata
rules still stand. Local secrets no longer live on leftover wire — see
[0011-owned-engine.md](0011-owned-engine.md). Link/import remains one-way
into `vaultix_*`.
**Owner:** AngryVibes LLC. **Host:** shippin.ai. **Product:** Vaultix.
Identity on the live path is **Nomen**, not a leftover IdP.
**Surface:** Shippin panel → `shippin.vaultix.panel.v1`

## 1. The flow

```text
Authentik login
      ↓
Shippin overview dashboard
      ↓  click Vaultix tile
Vaultix instance list            ← every deployed Vaultix this login can see
      ↓  pick an instance, enter PIN
Infrastructure Vaultix           ← elevated session, short-lived
```

- The instance list is **metadata only**: name, host, health, secret *count*,
  last backup. Never a secret value, never a secret name.
- The PIN gates the *infrastructure* view (the instance itself), not the
  overview. Overview is safe to leave open on a screen; the vault is not.

## 2. PIN is step-up, not a password

The PIN is never a credential on its own. Rules:

| Rule | Why |
|------|-----|
| PIN only works **inside** an authenticated Authentik session | A found PIN is worthless without the login |
| Verified server-side by the panel adapter, argon2id hash at rest | Never shipped to the browser, never in the catalog |
| Per-user PIN, scoped per instance | No shared "infra PIN" on a sticky note |
| 5 failures → lockout with backoff, audit event | Secret-adjacent surface, `auditRequired: true` |
| Success → elevated session, ~15 min TTL, then re-prompt | Walk-away safety |
| Reset = Authentik re-auth + email confirm, not "forgot PIN?" hint | The IdP is the recovery root, same as everywhere else in Shippin |

## 3. The Infisical link

Users arriving with an existing Infisical workspace can **link** it and import
into Vaultix. Policy for beta:

1. **Import is a one-way pull**, re-runnable. Projects, envs, secret names and
   values come across via the official export/API path — never via chat, never
   via paste.
2. **Vaultix becomes the working copy; Infisical stays their backup.** We tell
   users plainly: do not delete your Infisical workspace while Vaultix is in
   beta. Their old data sits where it is, under their account, as the fallback.
3. **No write-back mirror during beta.** Mirroring changes back to Infisical would
   require write-scoped tokens to the customer's Infisical account, which
   doubles the blast radius of any Vaultix compromise. Revisit at beta exit as
   a separate decision; default is to drop the link, not deepen it.
4. Link credentials (machine identity / service token, **read scope only**)
   are stored encrypted server-side and are never returned by any GET.
5. Unlink deletes our stored credential and stops scheduled re-imports.
   It never touches the Infisical side.

## 4. The nudge — what we say, exactly

Honesty rules first (these are load-bearing, per the beta waiver):

- We say Vaultix is **beta**, in those words.
- We recommend keeping Infisical linked **because** we are beta — that is the
  honest reason, and it is a good one.
- We sell Vaultix on what is true: included with Shippin, runs in your private
  cloud, no seat/project meters, keys injected instead of pasted.
- We make **no claims about Infisical's conduct, updates, or intentions.**
  Nothing negative about the upstream appears in product copy, docs, or
  lessons. If that ever changes it needs its own doc with evidence, not a
  banner.

Panel copy, beta:

> **Coming from Infisical?** Link your workspace and Vaultix will import your
> projects and secrets. Vaultix is included with your Shippin cloud and runs
> on your own infrastructure — no seat limits, and your keys get injected
> into workspaces instead of pasted into prompts.
>
> Vaultix is in beta. Keep your Infisical workspace as-is until we're out —
> it's your backup, and linking never changes or deletes anything on the
> Infisical side.

## 5. Squaring this with 0001/0002

0001 says customers "do not need to know Infisical exists" and 0002 keeps
Infisical out of the lesson path. That still holds for **fresh** Lovable-type
users: their guided path never mentions it. The link flow only surfaces for
users who *arrive* with Infisical — they already know it exists, and
pretending otherwise would break the honesty rule above. The migration copy
lives on the link screen only, not in lessons or the overview.

## 6. Contract changes

Added to `shippin.vaultix.panel.v1` (see contracts file):

| Route | Purpose |
|-------|---------|
| `GET /api/v1/vaultix/instances` | Instance list for the overview (metadata only) |
| `POST /api/v1/vaultix/session/pin` | Set/change PIN (change requires current PIN) |
| `POST /api/v1/vaultix/session/stepup` | Verify PIN, mint short-lived elevated session |
| `POST /api/v1/vaultix/link` | Link a migration source (`source: infisical` during beta); credential stored encrypted |
| `GET /api/v1/vaultix/link` | Link status — never the credential |
| `POST /api/v1/vaultix/import` | Run/re-run the one-way import |
| `DELETE /api/v1/vaultix/link` | Unlink; delete our stored credential |

New capabilities: `vaultix.instance.list`, `vaultix.session.stepup`,
`vaultix.link.manage`, `vaultix.link.import`.

Naming rule: the contract namespace is entirely Vaultix. "Infisical" appears
only as a `source` value in the link flow — never in a route, capability, or
package name.

## 7. Implementation (2026-08-18)

The adapter lives in [`panel/`](../panel/) — Go, loopback-only, deployed as
the `panel` service in `compose/vaultix.yml` (127.0.0.1:8201). Identity comes
from Authentik forward auth (`X-Authentik-Username`); Caddy owns TLS and the
auth hop. State is one JSON file: argon2id PIN hashes plus the AES-GCM-sealed
link credential (`VAULTIX_PANEL_ENC_KEY` — escrow it with the instance keys).
Elevated sessions are memory-only; a panel restart re-prompts the PIN.

Import speaks the core wire protocol on both sides (source → local, same
shape while the source is Infisical Cloud). Every upstream wire path is
quarantined in `panel/internal/core/wire.go` — the single swap point when
our fork rebrands its API surface; nothing else in the panel names the
upstream. Payload shapes are **verified against the pinned upstream source**
and the client targets the non-deprecated surface — see doc 0006 for the
findings (approval-union writes, hidden-value guard, batch imports) and the
live smoke runbook. Local writes use a machine identity
(`VAULTIX_LOCAL_CLIENT_ID/_SECRET`, bootstrap via
`scripts/bootstrap-identity.sh`); the source link identity is created
read-only on the source side.
