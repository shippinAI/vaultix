# 0013 — Vaultix license and shippin.ai membership

**Status:** accepted (2026-08-29)
**Owner:** AngryVibes LLC
**Host:** shippin.ai (alias shippin.cloud)
**Product:** Vaultix
**Stamp:** A SHIPPIN.AI SERVICE

Enterprise features are **ours**. They open with a Vaultix grant, not a
leftover vendor license server and not an env flag alone.

## 1. Who bills, who is the member

| Field | Value |
| --- | --- |
| Legal owner | AngryVibes LLC |
| Cloud | shippin.ai / shippin.cloud |
| Identity | Nomen (who the operator is) |
| Entitlement | This Vaultix instance (`GET /api/v1/vaultix/license`) |

Nomen does not store `nomen_vault_*`. Membership is “this Nomen principal
is a shippin.ai member.” Vaultix reads the grant; it does not become the
IdP.

## 2. Tiers

| Tier | How it activates | What it is |
| --- | --- | --- |
| **community** | Default. Included with Shippin. | Core: boxes, sealed secrets, inject, PIN, catalog, configure, MCP. Unlimited. No meters. |
| **membership** | `VAULTIX_LICENSE_TIER=membership` and/or a shippin.ai member subject | Hosted extras: audit stream, IP allowlist, rate cap, rotate, sync |
| **enterprise** | `VAULTIX_LICENSE_TIER=enterprise` or `VAULTIX_LICENSE_FILE` | Membership plus approval gate, access policy, optional meter, team, secrets health |

Env flags (`VAULTIX_APPROVAL_GATE=true`, …) still **ask** to open a
valve. The grant must **allow** it. Ask without grant → valve stays
closed. That is the activation rule.

No leftover `LICENSE_SERVER_URL`. No phone-home.

## 3. What is community vs what waits

Community is the product a vibe coder needs: one box per app, inject
not paste, Clyffy teaches in the viewport.

Enterprise is not leftover `ee/`. It is the valves and later surfaces
in doc 0003 / 0010, licensed here:

| Feature | Requires |
| --- | --- |
| approval-gate, access-policy, meter, team, health-scan | enterprise |
| audit-stream, ip-allowlist, rate-cap, rotate, sync | membership |
| core / catalog / configure / mcp | community |

A licensed feature that is not built yet still **shows as licensed**
and stays closed until the surface exists. Do not fake the UI.

## 4. Operator config

```
VAULTIX_LICENSE_TIER=community|membership|enterprise
VAULTIX_LICENSE_SUBJECT=   # shippin.ai member / tenant id
VAULTIX_LICENSE_FILE=      # optional JSON {tier,subject}
```

`GET /api/v1/vaultix/license` and `GET /api/v1/vaultix/trust` stamp
AngryVibes LLC. `GET /api/v1/vaultix/capabilities` lists each valve
with `licensed` and `requires`.
