# 0003 — Enterprise gaps Vaultix refills (ours)

**Status:** living ledger (2026-08-29)
**Owner:** AngryVibes LLC. **Host:** shippin.ai. **Product:** Vaultix.
**Rule:** leftover `ee/` features run only with a valid Infisical license
key, and the license check is never patched. Without that license, we refill
gaps as Vaultix modules behind `shippin.vaultix.panel.v1`. Activation is a **Vaultix
license / shippin.ai membership** (doc 0013), not a leftover license
server and not an env flag alone.

Identity is **Nomen**. Mesh is **Zuul**. Certs stay step-ca / Caddy.

## Gap ledger

| Gap they keep / charge for | Why a vibe coder needs it | Vaultix refill (ours) | Phase |
|----------------------------|---------------------------|------------------------|-------|
| White-label / product name | Must say Vaultix (AngryVibes LLC / shippin.ai) | Trust stamp + panel chrome | now |
| SAML / SSO enforcement | One login with the rest of Shippin | Nomen OIDC | next |
| SCIM / LDAP | Seat join/leave without a human | Nomen directory (Tessera authored into Nomen) → Vaultix box membership | later |
| Approval workflows / access requests | “Can I use the prod OpenAI key?” | Shippin panel approval on `vaultix.secret.inject` | later |
| Secret rotation as a product | Keys die; apps must not | Inject handle + rotate lesson + our rotator, not their `ee` rotator | next |
| Dynamic secrets (DB creds that expire) | Real workspaces, not pasted URLs | Our short-lived inject tickets | later |
| Point-in-time recovery | They deleted the wrong key | `pg_dump` + encryption-key escrow + tested restore | now |
| Audit export / SIEM stream | Teach “who saw this key” | Our audit log on the panel contract | next |
| Custom roles | Tenant admin vs builder vs CI | Nomen roles / scopes | later |
| IP allowlists / gateways | Phone mesh + workspace only | Zuul + Caddy, not their gateway product | next |
| HSM / KMIP | Not a Lovable lesson | Out of scope until an estate asks | parked |
| Cloud identity caps (5 seats / 3 projects) | Their SaaS meter | Self-host MIT: no such meter. Do not re-introduce it | now (do not copy) |
| PAM / cert manager as extra SKUs | Upsell | Not Vaultix. Certs stay step-ca / Caddy | parked |

## What we refuse

- Shipping `ee/` and calling it free Vaultix  
- Re-implementing SAML when Nomen already is the IdP
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

## Upstream `ee/` (licensed separately by Infisical)

Checked out on the host at `/opt/vaultix/upstream/infisical` (`v0.162.19`). LICENSE still carves out any `ee/` tree. Actual modules under `backend/src/ee/services/` (and a smaller Go set under `backend-go/internal/ee/`):

SAML, SCIM, LDAP, OIDC add-on, license, access-approval, secret-approval, secret-rotation-v2, dynamic-secret, audit-log-stream, pit (point-in-time), gateway/gateway-v2, hsm, kmip, pam-*, pki-*, trusted-ip, rate-limit, honey-token, insights, sub-org.

Those are leftover product holes. Vaultix refills them with Nomen + this
panel + Zuul + our backup, or run that folder under a valid Infisical
license key. Activation:
doc 0013.
