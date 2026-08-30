# 0001 — Vaultix is the product

**Status:** partially superseded (2026-08-29). The **name** (Vaultix) stands.
The **runtime** is the owned engine — see
[0011-owned-engine.md](0011-owned-engine.md). License/membership:
[0013-license-and-membership.md](0013-license-and-membership.md).
**Owner:** AngryVibes LLC. **Host:** shippin.ai. **Product:** Vaultix.
**Public surface:** `vaultix.shippin.cloud`
**History below** names a leftover vendor we do not run.

## 1. Names

| Name | What it is | What it is not |
|------|------------|----------------|
| **Vaultix** | Shippin secrets product | Infisical, Vault, Warden |
| **Infisical Cloud** | Where operator secrets sit *today* | The customer brand |
| **Infisical `ee/`** | Their enterprise tree | Not in the free Vaultix image |

Same pattern as Zuul / NetBird: customers see Vaultix. Operators may say Infisical when talking to the upstream tree.

## 2. What we are allowed to do

Infisical’s public repo is MIT **with the exception of `ee/`**. We may use, copy, modify, brand, and self-host the MIT core. We do **not** ship `ee/` features (SAML/SCIM/HSM/rotation add-ons that sit behind their paid license) as “Vaultix included.”

If we need those later, that is a separate buy-or-build decision. It is not a reason to stall the free core.

## 3. What “fully have it” means

1. Self-hosted MIT core (app + Postgres + Redis) at `vaultix.shippin.cloud`
2. Authentik for login (no second IdP)
3. One-time export from Infisical Cloud → Vaultix (projects, envs, secret *names*; values via official export, not chat)
4. Shippin panel talks only to `shippin.vaultix.panel.v1` — no embedded Infisical chrome
5. DevForge / workspace inject secrets. Lovable / chat never store long-lived keys
6. Lessons that play while a Lovable-type user makes their first real project

Estate compose already exists as a starting point: `shippin-mesh/templates/compose/infisical.yml` (pinned `v0.154.6`, MIT). That file still says Infisical. New work is branded Vaultix.
