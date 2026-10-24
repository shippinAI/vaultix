# 0003 — Enterprise gaps Vaultix refills (ours)

**Status:** living ledger (2026-08-29)
**Owner:** AngryVibes LLC. **Host:** shippin.ai. **Product:** Vaultix.
**Rule:** `ee/` stays in Vaultix. Shippin / AngryVibes LLC (dba
wiredFRONT) operates it under a waiver from Infisical. The waiver text
is not in the repo; the record is `NOTICE`. Infisical’s license files
stay intact. Do not strip `ee/` and do not clean-room rewrite it.
Shippin additions (panel, backup, portability, Nomen login, onboarding)
are what make the product different. Panel valves still open only with
a **Vaultix license / shippin.ai membership** (doc 0013), not a leftover
license server and not an env flag alone.

Identity is **Nomen**. Mesh is **Zuul**. Certs stay step-ca / Caddy.

## Gap ledger

| Gap they keep / charge for | Why a vibe coder needs it | What we do with it | Phase |
|----------------------------|---------------------------|------------------------|-------|
| White-label / product name | Must say Vaultix (AngryVibes LLC / shippin.ai) | Trust stamp + panel chrome | now |
| SAML / SSO enforcement | One login with the rest of Shippin | Keep ee SAML/OIDC. Nomen stays Shippin’s login. Do not add a second stack | next |
| SCIM / LDAP | Seat join/leave without a human | Keep ee SCIM/LDAP. Nomen directory still authors membership | later |
| Approval workflows / access requests | “Can I use the prod OpenAI key?” | Keep ee approvals. Panel gate on `vaultix.secret.inject` stays grant-closed | later |
| Secret rotation as a product | Keys die; apps must not | Keep the ee rotator. The inject lesson teaches it | next |
| Dynamic secrets (DB creds that expire) | Real workspaces, not pasted URLs | Keep ee leases. Short-lived inject tickets stay the vibe-coder path | later |
| Point-in-time recovery | They deleted the wrong key | Keep PIT. Our encrypted backup is the portable exit beside it | now |
| Audit export / SIEM stream | Teach “who saw this key” | Keep the ee stream. Panel audit stays on the contract | next |
| Custom roles | Tenant admin vs builder vs CI | Keep the ee permission service and extend it in place. Nomen names the person | later |
| IP allowlists / gateways | Phone mesh + workspace only | Keep ee gateway and trusted IP. Zuul + Caddy stay the Shippin mesh | next |
| HSM / KMIP | Not a Lovable lesson | Kept. Software root key stays the default until an estate asks for a wrap change | parked |
| Cloud identity caps (5 seats / 3 projects) | Their SaaS meter | Community stays unlimited. Do not turn the meter on | now |
| PAM / cert manager as extra SKUs | Upsell | Kept in the tree. Secrets stay what we lead with. Mesh certs stay step-ca / Caddy | parked |

## What we refuse

- Stripping `ee/`, relicensing it, or pasting the waiver text into the repo  
- Adding a second SAML stack beside the ee modules. Nomen stays Shippin’s login
- Opening leftover vendor license servers
- Putting secret **values** in the Shippin catalog GET  
- Teaching paste-into-Lovable as a workaround for a missing feature  

## First refill (this standup)

1. Run the Vaultix engine ourselves (`vaultix_*`, keys, TLS, backup).
2. Stamp AngryVibes LLC / shippin.ai on trust + license.
3. Daily `pg_dump` + key-file escrow instructions.
4. Community by default; membership/enterprise via doc 0013.
5. Leftover dumps stay in `leftover/` and are not run.

## Dormant capability valves (built pre-release, closed by default)

The gaps above that are panel request-flow toggles are **closed valves**
(`panel/internal/valves`, `internal/usage`, `internal/license`). Plumbing
exists so enabling them later is a grant, never a retrofit. Community
(default) stays unlimited and ungated. Membership/enterprise grants are
what activate the extras (doc 0013).

| Valve | Gap it covers | Env to open | Default |
|-------|---------------|-------------|---------|
| Plan meter | seat/project caps (anti-goal — option only) | `VAULTIX_METER_ENFORCE=true` | unlimited, unenforced |
| Approval gate | approval workflows / access requests | `VAULTIX_APPROVAL_GATE=true` | apply immediately |
| Access policy | per-path secret gating | `VAULTIX_ACCESS_POLICY_DENY=/prod,…` | allow all |
| Rate cap | per-user rate limiting | `VAULTIX_RATE_CAP_PER_MIN=N` | no cap |
| IP allowlist | IP allowlists / gateways | `VAULTIX_IP_ALLOWLIST=cidr,…` | all sources |
| Audit stream | audit export / SIEM stream | `VAULTIX_AUDIT_STREAM_URL=…` | local log only |

Discoverable at `GET /api/v1/vaultix/capabilities` (valve states) and
`GET /api/v1/vaultix/usage` (meter view). All tested: closed = no-op,
open = enforces.

## Upstream `ee/` we keep

`core/LICENSE` still carves `ee/` out of the MIT grant. The enterprise notice stays Infisical’s. Modules under `core/backend/src/ee/services/` (and the smaller Go set under `core/backend-go/internal/ee/`):

SAML, SCIM, LDAP, OIDC add-on, license, access-approval, secret-approval, secret-rotation-v2, dynamic-secret, audit-log-stream, pit (point-in-time), gateway/gateway-v2, hsm, kmip, pam-*, pki-*, trusted-ip, rate-limit, honey-token, insights, sub-org.

Those modules stay. We build on them. Nomen, this panel, Zuul, and our backup are the Shippin layer on top, not a replacement tree. Activation of panel valves: doc 0013. The waiver that covers operating `ee/` is recorded in `NOTICE`.
