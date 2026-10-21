# 0014 — Two SKUs, one instance manager

**Status:** accepted (2026-08-29)
**Owner:** AngryVibes LLC. **Host:** shippin.ai. **Product:** Vaultix.

You run Vaultix **for yourself** or **for users**. Same engine image
(`ghcr.io/shippinai/vaultix`) plus overlay (`ghcr.io/shippinai/vaultix-panel`).
Secrets live in `core/`. License (doc 0013) is orthogonal: community /
membership / enterprise.

## 1. SKUs (where the box lives)

| SKU | Host | Who operates |
| --- | --- | --- |
| **self** | their hostname (`vaultix.workshop.example`) | Them. They set origin, Nomen issuer, keys. |
| **hosted** | `{label}.vaultix.shippin.cloud` | AngryVibes / shippin.ai. They never set DNS or IdP. |

Hub:

```text
vaultix.shippin.cloud                 ← product hub / manager
vaultix.workshop.example              ← self instance they deploy
workshop.vaultix.shippin.cloud        ← hosted instance
```

`{label}` is `^[a-z][a-z0-9-]{0,30}[a-z0-9]$`. Naming an instance does
**not** provision a VM.

## 2. Deploy pack

From this repo:

- `compose/vaultix.yml`
- `compose/self.env.example` → `compose/vaultix.env` (you)
- `compose/hosted.env.example` → `compose/vaultix.env` (your users)
- `scripts/up.sh`

Env: `VAULTIX_SKU`, `VAULTIX_LABEL`, `VAULTIX_PUBLIC_HOST`,
`VAULTIX_LICENSE_TIER`, `VAULTIX_ENC_KEY`, `VAULTIX_DATABASE_URL`.

## 3. Manager (enterprise panel starts here)

- `GET /api/v1/vaultix/instance` — this box
- `GET /api/v1/vaultix/manager/instances` — named boxes
- `POST /api/v1/vaultix/manager/instances` — name a box
- `GET /manager/` — branded shell

Secrets stay on `/viewport/`. The manager does not become a second vault.

## 4. Must not

- Wrap leftover product compose.
- Phone home for a license.
- Merge Nomen or Zuul tables into this instance.
