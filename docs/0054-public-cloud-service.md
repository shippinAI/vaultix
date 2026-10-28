# Vaultix.cloud public service architecture and release gates

Accepted product direction, 2026-10-28. Vaultix.cloud is a public cloud service
built on the same engine offered for self-hosting. AngryVibes LLC operates the
service on owned infrastructure. Building locally and on bare metal avoids a
requirement for paid hosted runners; it does not reduce the service to a local
application. DevSCIF.com remains a separately specified deployment/control
profile, not a claim of government accreditation.

This decision extends 0027, 0048 and 0049. It establishes requirements, not an
implemented scalable platform or approval to expose the current instance online.
Source authorship, UI work and the Go/Rust migration continue in place. Each
accepted change must preserve current workflows and fit the service boundaries.

## Current evidence and limits

At source b9e77f46, `compose/vaultix.yml` runs one backend with loopback exposure,
one PostgreSQL service and an optional local Dragonfly service with periodic
snapshots. It is a useful development/operator pack, not a tested HA topology.
`core/backend/src/main.ts` initializes database connections, migrations, queue
services and the HTTP server in the application startup path. Worker enablement
and profiles already exist; they require an all-job ownership review before
claiming independently scalable API and worker roles. Database pool settings are
per process, so adding replicas requires an aggregate connection budget.

Real-image and browser tests establish selected functionality. They do not prove
capacity, public tenant onboarding, isolation under load, recovery objectives,
regional failover, or availability commitments. A snapshot schedule does not
establish an accepted queue/audit durability policy. The first-instance owner
flow creates an instance administrator: it is not a public tenant signup flow.

## Service boundaries

| Boundary | Required behavior |
| --- | --- |
| Public edge | TLS, trusted-proxy configuration, bounded request sizes/timeouts, origin validation, abuse protection and health-based routing. Databases, queues and administrative endpoints are not public entry points. |
| Identity | Nomen owns identity/session behavior. Validate issuer, audience, expiry and revocation. Public tenant enrollment never calls instance bootstrap or grants instance administration. Organization names and owner setup remain approachable; federation is an administrator-configured later step. |
| Tenant authority | Resolve actor and organization from authenticated authority. Verify access on every HTTP, CLI, MCP, worker, export and provider path; deny cross-tenant identifiers without existence disclosure. Cache keys, idempotency records, streams, artifacts and jobs must retain the same tenant boundary. |
| Application/API | Stateless request replicas with bounded work, cancellation, pagination and request deadlines. Authorization-changing reads use the required consistency; a read replica cannot silently weaken revocation or permissions. The native React application remains the real product entry. |
| Workers | Independently sized worker roles after all consumers, schedules and startup side effects are traced. Bound tenant/provider concurrency and backlog, fence scheduler ownership, retry idempotently and reconcile ambiguous provider results. No promise of exactly-once external execution. |
| Durable data | Preserve the existing encrypted PostgreSQL store and key format. Define authoritative state, audit/outbox durability, replica lag behavior, encrypted backups, key recovery, retention and restore procedures. No second vault or ad hoc dual writes. |
| Queue/cache | Dragonfly remains default; Redis and ElastiCache are explicit supported configurations with separate acceptance. Distinguish disposable caching from durable work/coordination. Do not treat every Redis-protocol deployment or failover mode as equivalent. |
| Service operations | Native provisioning, resource quotas, usage metadata, support/operator access and deletion/export lifecycle. The legacy panel is not the permanent service control plane. Control metadata cannot become a second secret-value store. |
| AI | UI, CLI and MCP use shared authorized domain actions. Clyffy receives references and redacted execution receipts. Codex credentials stay local. Target-only delivery requires the separate workload-bound broker acceptance. |

Initially preserve the existing organization-scoped model within one deployment;
prove its isolation before sharing it with public tenants. Do not introduce the
old unmerged table-prefix proposal as an isolation guarantee. If capacity or fault
containment later requires multiple deployment cells, specify tenant placement,
key custody, migration, rollback and one authoritative writer before partitioning.
Dedicated deployments use the same tested engine and explicit operational profiles.
No cross-region multi-writer design is assumed.

## Scale and reliability requirements

- Bound resource use per tenant, identity and expensive action, with service-wide
  ceilings and reserved operational capacity. Enforce limits server-side across
  replicas, expose usage and retry guidance in the UI, and preserve audit and
  approval controls when capacity is exhausted. Quotas concern operated resources,
  not paid software security-feature entitlements.
- Inventory every primary/read-replica/audit pool and connection per API process,
  Go sidecar, worker, migration and operator role. Sum their maxima against the
  database budget before adding replicas. Measure pool wait and transaction time;
  keep provider calls outside short database transactions.
- Define traffic/data profiles for metadata reads, authorized value delivery,
  imports, approvals, audit export, rotation, PKI and PAM. Measure p50/p95/p99,
  errors, queue age, memory, CPU, disk I/O and connection saturation at sustained,
  burst and soak loads. A busy tenant must not make unrelated tenants unusable.
  Version fixture sizes, hardware, configuration and receipts; no invented RPS
  capacity or SLA numbers before measurement.
- Use durable intent/outbox and idempotency where committed work crosses process
  or provider boundaries. Separate retryable failure, permanent denial and an
  uncertain remote result. Test process termination between commit, enqueue,
  provider call and acknowledgement. Cache recovery must not reset consumed
  identity budgets, erase revocation, or silently lose required audit events.
- Establish liveness, dependency-aware readiness, bounded graceful draining and
  migration ownership. Rehearse old/new application versions against compatible
  schema and jobs; test rollback and interrupted migration. One successful Docker
  build is not a zero-downtime upgrade test.
- Measure recovery point and recovery time from encrypted restore and failover
  rehearsals. Protect recovery keys separately and verify restored data under
  authorization. Keep backups in a separate failure domain with tested retention,
  access and restoration. Replication does not replace backups.
- Operate redacted metrics, traces, alerts, runbooks and incident ownership.
  Bound label cardinality; never use secret names/values or request bodies as
  metric labels. Track per-tenant usage through authorized metadata reporting,
  not unbounded tenant labels in every infrastructure metric.

PostgreSQL PITR combines a base backup with retained WAL; restoring only an
application volume is not that procedure. See the official
[PostgreSQL 16 recovery documentation](https://www.postgresql.org/docs/16/continuous-archiving.html).
BullMQ documents persistence, non-evicting queue storage, reconnect behavior and
shutdown testing in its [production guidance](https://docs.bullmq.io/guide/going-to-production),
and requires retry-safe job design in its
[idempotency guidance](https://docs.bullmq.io/patterns/idempotent-jobs).
These are inputs to our provider-specific acceptance, not proof of the currently
configured Dragonfly deployment or permission to assume Redis AOF settings apply
unchanged to it. Consult pinned-version behavior when implementing the packet.

## Public-release gates

All gates below are open. Prior scoped tests can be reused only for their recorded
claims; each public-service gate needs its own reproducible acceptance receipt.

| Gate | Required acceptance |
| --- | --- |
| CLOUD-01 identity and enrollment | Real issuer/session/logout; instance bootstrap unavailable to tenants; verified enrollment/invite/recovery; organization membership and role boundaries; abuse and enumeration denial. |
| CLOUD-02 isolation and fairness | Two or more independent tenants through reads, writes, imports, jobs, caches, exports and failures; unauthorized IDs denied; one tenant's saturation does not exhaust all service capacity. |
| CLOUD-03 encrypted recovery | Disposable encrypted store restored with keys; authorized metadata and decryption checks; missing/wrong-key denial; measured loss/recovery window and failed-upgrade rollback. |
| CLOUD-04 execution durability | Queue loss/restart, worker termination, duplicate delivery and provider timeout reconciled; required audit survives accepted failures; no duplicate irreversible effect or false success. |
| CLOUD-05 capacity and admission | Versioned workload/hardware matrix, sustained/burst/soak measurements, aggregate pool budget, bounded backlog and tested admission/limit behavior. Publish only demonstrated limits. |
| CLOUD-06 availability and upgrades | Multiple application replicas, dependency loss, failover, draining, scheduler fencing and rolling old/new compatibility; tested migration owner and restore-based disaster procedure. |
| CLOUD-07 public operations | TLS/proxy/domain configuration, restricted administration, monitoring/alerts, dependency/artifact integrity, support access audit, enrollment abuse controls and incident/restore runbooks exercised. |
| CLOUD-08 user lifecycle | Guided tenant setup, clear quota/error/recovery UI, export and deletion with retention behavior, accessible workflows and published service boundaries. Features remain included; authorization remains enforced. |

Sequence the next infrastructure packets as CLOUD-03 restore proof and CLOUD-01
identity/enrollment characterization, then CLOUD-02/04 isolation and durability,
CLOUD-05 measured capacity, and CLOUD-06/07/08 launch acceptance. Shared UI work
continues alongside these gates; it is not evidence that they have passed.

## Infrastructure facts still needed

Record each bare-metal server's CPU/RAM/storage, network, OS/architecture, location,
power/provider failure domain, existing workloads and operator access. Select
first-region service placement, off-site backup target and recovery objectives
before defining a topology. Three machines alone do not establish three independent
failure domains. WI/TX replication, DNS changes, public exposure and production
cutover require a concrete tested deployment plan; none is performed by this ADR.
Capacity targets, limits, support/SLA commitments and DevSCIF requirements remain
unapproved until selected and tested. These inputs do not block local restore,
isolation, contract or failure-testing work.

## Verification of this architecture packet

The canonical standalone image was built from a committed source archive at
`e47f1e89724d3699af9f0060b24df54dcbc1462c`. Resulting image:
`sha256:6c3523ce91691053ad8b6be773ecab11adb2f3d38c9fdb78dcd221af66bffecd`.
The identity check confirms Vaultix.cloud and the exact source revision. Its
runtime filesystem layers equal the tested `217aa3db` preview image, and `core/`
is unchanged. The local build receipt is
`.cache/public-cloud-plan/.cache/cloud-plan-proof/result.json` in the main checkout.
No runtime redeployment or operator data mutation was needed. The accompanying
plan/ledger clarification also changes no runtime source.

Inventory, migration and capability-map checks validate document/source mapping
consistency only. All CLOUD-01 through CLOUD-08 gates remain open; this image
build is not a load test, restore rehearsal, isolation test or HA acceptance.
