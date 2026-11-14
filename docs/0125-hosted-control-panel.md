# 0125 — Hosted instances and the private control panel

**Status:** accepted (2026-11-13). **Owner:** AngryVibes LLC.
**Replaces:** the shared-deployment paragraph of [0054](0054-public-cloud-service.md) ("Initially
preserve the existing organization-scoped model within one deployment …").

## Decision

1. **One instance per customer.** Each hosted customer gets their own Vaultix instance: their own
   database, keys, cache and application containers, at `{label}.vaultix.cloud`. There is no
   shared multi-tenant deployment for paying customers. Tenant isolation is the instance boundary,
   which the engine already proves (`scripts/test-tenant-isolation.mjs` covers organizations
   inside one instance; separate instances share nothing).
2. **The engine is the same everywhere.** A hosted instance runs the same verified image and is
   installed, upgraded, recovered and rolled back by the same `internal/platform` lifecycle as
   `vaultix server` ([0109](0109-native-install-and-upgrade.md)). Hosting adds operations around
   it, never a different product. Every feature is included in every hosting profile.
3. **The control panel is separate and private.** `vaultix-control`
   (`platform/shippin/cmd/vaultix-control`) is the operator console for the hosted service. It is
   not in the Vaultix image or the `vaultix` command, listens on loopback only, and is reached over
   SSH or a private tunnel. Every request needs the operator key kept in its control directory.
   It replaces the legacy `panel/` manager as the service control plane (0054 already said the
   legacy panel is not that).

## What "optimized hosting" means here

The offer is operated resources and care, not features:

| Profile | Meant for | Sizing (to measure, then publish) |
| --- | --- | --- |
| `starter` | one team trying Vaultix | small shared host, daily encrypted backup |
| `team` | a company's secrets in daily use | reserved CPU and memory, hourly backup, rehearsed upgrades |
| `dedicated` | regulated or high-volume use | its own host, customer-chosen backup storage, upgrade windows |

Profiles size CPU, memory, storage, backup frequency and support response. The numbers are not
published until measured on the production host (0054, Scale and reliability).

## Boundary

The control panel may:

- record which instance directory belongs to which customer label, customer and profile;
- read each instance's lifecycle state (ready, recovery needed, image) through `internal/platform`;
- later, run lifecycle operations the operator chooses (plan and apply upgrades, backups).

The control panel never:

- holds or shows secret values, encryption keys, recovery keys, setup codes or reset links;
- signs in to a customer instance or reads customer data;
- recovers a customer's owner on its own: owner recovery stays `vaultix server owner-reset-link`
  on the host, run only at the customer's request, and is recorded in that instance's audit log;
- becomes a dependency of the engine (`node scripts/test-platform-boundary.mjs`).

## Domains, in build order

All under `platform/shippin/`, one folder per domain.

| Domain | State | Next |
| --- | --- | --- |
| `fleet/` | **Built 2026-11-13**: enroll managed instances, read health. Unit tested. | Upgrade plan and apply across the fleet, one instance at a time, using the canonical build receipt. |
| `console/` + `cmd/vaultix-control/` | **Built 2026-11-13**: loopback-only console, operator key, fleet page and JSON API. Unit tested. | Show upgrade plans and backup age. |
| `backups/` | Not started | Scheduled encrypted export per instance to customer-chosen storage; restore rehearsal per 0109. |
| `quotas/` | Not started | Per-profile resource limits applied at install (Compose resource settings). |
| `tenants/` | Not started | Customer sign-up and the customer-to-instance record; needs the sign-up door (0122 Stage 3). |
| `billing/` | Not started | Needs the owner's payment provider decision. |

## Open owner decisions

| Decision | Needed before |
| --- | --- |
| Production host(s) for customer instances | Enrolling the first paying customer |
| Profile sizes and prices | Publishing the offer |
| Payment provider | `billing/` |
| Whether the console is reached over SSH only or also a private network (WireGuard, Tailscale) | More than one operator |

## Running it

```sh
go build -o vaultix-control ./platform/shippin/cmd/vaultix-control
./vaultix-control --control-directory /srv/vaultix-control      # listens on 127.0.0.1:8300
ssh -L 8300:127.0.0.1:8300 operator@host                         # from the operator's machine
```

On first start it creates `operator.key` in the control directory (readable only by the
operator). Sign in with that key; it is never printed. Enroll each instance directory that
`vaultix server install` or `adopt` manages.
