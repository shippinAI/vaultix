# Platform services, release alerts and graceful upgrades

Owner direction: 2026-11-02. Status: researched implementation proposal, not
shipped orchestration. Extends [delivery](0075-usable-secrets-and-update-delivery.md),
its [implementation register](delivery/implementation.md) and
[acceptance matrix](delivery/acceptance.md). Auth and Secrets remain in scope.

## Product and operational boundaries

Use the same Vaultix engine and included software capabilities for individuals,
small businesses, hosted customers and DevSCIF deployments. Shippin supplies the
operations/control layer; DevSCIF adds deployment policies, governance workflows,
evidence and support profiles. These are operational profiles of a shared product,
not a fork or a second secrets store. Identity remains built-in plus federation.

The native Server Console gains **Platform Services**. The optional old panel
must not become a mandatory product gateway. Its instance registry is discovery
data, not authority to control a host. A separate, narrowly authorized host agent
executes approved operations and survives application replacement. It must not
depend on the application being healthy to report or recover an interrupted upgrade.
No Nomen/Zuul runtimes or Mesh provisioning are introduced by this plan.

## Source-grounded starting point

Inspected at source `aa461823`, with unrelated shared-tree edits preserved.

| Existing owner | Behavior now | Required addition |
| --- | --- | --- |
| `internal/release/{release,notice}.go` | Stable GitHub release metadata, explicit check, daily cached notices on selected human terminal commands; development builds do not compare as releases | Verified installable artifacts, compatibility-aware notices and an explicit installer |
| `contracts/vaultix.updates.v1.json` | Strict stable-only status schema | Preserve v1; separately version extended channel/compatibility and operation contracts |
| `core/backend/src/services/update-check/update-check-queue.ts` | Boot/weekly checks, cached reads, explicit refresh, managed/disabled/development states | Configurable bounded cadence with jitter, durable notifications, managed deployment notices |
| `panel/internal/manager/manager.go`, `panel/internal/httpapi/manager_api.go` | Lists/registers named instances | Authenticated host enrollment, scoped authority and real lifecycle execution |
| `core/backend/src/main.ts` | Signal handlers close server, queues and database | Single coordinated bounded drain, measured shutdown and interrupted-job recovery |
| `core/backend/src/server/routes/index.ts`, `plugins/go-sidecar.ts` | Worker/event cleanup and sidecar termination hooks | Prove ordering, child exit, in-flight requests, long-lived streams and job acknowledgement |
| `core/standalone-entrypoint.sh`, `compose/vaultix.yml` | `exec node`, backend init, health check, persistent volumes | Explicit grace budget, readiness/draining semantics and resumable upgrade control |
| Existing local builders and delivery U01-U04 | Verified committed-source builds and planned signed installation | Publish/retrieve identical accepted artifacts and prove old-to-new upgrade on an owned server |

On 2026-11-02 the owned GitHub latest-release API returned HTTP 404. A source push
is not a downloadable stable release. The last local image is a development
revision, not an advertised coordinated SemVer release. Release availability
must stay honest when disconnected, disabled, unpublished or unsupported.

## One release record, different audiences

Build on owned infrastructure. Bind engine, CLI and optional host-agent versions
to one release manifest, immutable source revision, artifact hashes, target
platforms, API compatibility, schema upgrade range, minimum updater version,
migration class, rollback conditions and support/end-of-support information.
Components may later version independently; use an explicit compatibility matrix
instead of assuming matching version strings are sufficient.

Publish tested CLI packages, image archives and/or OCI digests, source, release
notes, SBOM and provenance. Stage a candidate, download it as a fresh consumer,
verify and rehearse it, then promote identical bytes. Publishing a tag with no
usable artifacts must not generate an install prompt. GitHub can host initial
assets without Actions; an owned HTTPS mirror/OCI registry can serve the same
verified bytes later. Store image ID, OCI manifest digest and archive hash as
distinct identifiers. Never use mutable `latest` as the approved selection.

Continue the pinned signing-key and independent verification work in delivery
U01. For the durable distribution service, evaluate a maintained TUF client and
repository implementation before automatic installation. TUF supplies expiring,
versioned trust metadata and key rotation; a signed JSON document by itself is
not equivalent protection. Persist trusted monotonic state. An explicit operational
rollback selects an older authorized artifact through fresh trusted metadata; it
must not disable replay/expiry verification. Offline bundles carry trust updates,
signatures and expiry status, with a documented operator renewal path.

| Consumer | Notice and action |
| --- | --- |
| Hosted user | Relevant release notes, scheduled maintenance and completion; only request a refresh when their loaded UI build is stale, preserving drafts. They do not install server software. |
| Hosted operator | Fleet rollout view, target/channel/ring, compatibility, approvals, failure and recovery. |
| Self-hosted instance operator | Persistent update badge/inbox with current/target versions, last successful check, severity, compatibility and **Review update**. Approve now or schedule a maintenance window. |
| Self-hosted ordinary user | Relevant service-maintenance notice; installation controls remain instance-operator-only. |
| CLI user | Preserve explicit `vaultix update check`, bounded cached stderr notices and opt-out; no stdout/MCP/JSON contamination or network dependency for secret delivery. Installation is explicit and honors package-manager ownership. |
| Offline deployment | Import verified metadata/artifacts through an approved path; show last verification and stale/expired status, not a false current result. |

Proposed connected check cadence: six hours with jitter and conditional requests;
retain a daily CLI cache. Hosted operators can receive faster release/advisory
events. These are defaults to measure, not delivery SLAs or mandatory phone-home.
No vault credentials, tenant inventories or secret values accompany release checks.
Deduplicate notices by release/advisory, deployment and audience; record read/dismiss
state. Email/webhooks are optional configured channels, with retries and delivery
receipts, not a prerequisite for the UI notification. Compatibility and security
advisories need explicit policy, not an inference that every higher SemVer is safe.

Working recommendation, awaiting owner preference: notify automatically and require
an authorized operator to approve/schedule installation. Automatic verified patches
can be an explicit opt-in policy after recovery gates pass. Do not infer approval
from a notification, a timer, or an AI proposal.

## Platform Services experience and authority

Group the console into **Overview, Updates, Services, Backups & Recovery,
Maintenance, Activity**. Show actual version/digest, readiness, active work,
dependencies, capacity and last backup/restore verification. Distinguish app,
workers and agent from PostgreSQL and Dragonfly/Redis/ElastiCache. Managed external
dependencies are observed, not restarted as local containers. Database/cache
version upgrades are separate approved operations with their own compatibility
and recovery evidence.

The review dialog shows exact target, release, affected services, expected outage,
backup and schema requirements, permission scope, recovery class and window with
timezone. Progress is a durable service state, visible after reconnect; it is not
an optimistic animation. Surface meaningful errors and a precise recovery action.
Tooltips explain unfamiliar terms, essential instructions remain visible, and
dialogs retain keyboard focus, reduced-motion behavior and screen-reader status.

Use the existing source-action/MCP catalog for plan, inspect, approve, schedule,
cancel-before-cutover and recovery actions. AI receives the same authorization
and audited state transitions as a person. A2UI can demonstrate and propose these
actions; tutorial completion never authorizes host operations. No arbitrary shell,
compose text, executable paths or registry URLs supplied by a browser/model.

Instance/fleet operator authority is separate from organization/project membership.
Bind approval to actor, enrolled target, manifest digest, configuration fingerprint,
policy revision, expiry and operation ID. Recheck at execution; reject replay,
revocation, changed plans, cross-target/tenant requests and concurrent operations.
Support step-up authentication and optional separation of proposer/approver.

The public app must not receive the Docker socket or host administrator credentials.
Use a paired local socket with OS access control, or mutually authenticated agent
transport with pinned enrollment and explicit host scope. The host executor allows
only registered services, verified artifacts and bounded operations. Its durable
journal contains no secret values. Retain a restricted local recovery path for
application outages. Agent self-upgrades need a separate supervisor/rollback path.
The native Go instance lifecycle in [0109](0109-native-install-and-upgrade.md)
supersedes the planned Node upgrade command in delivery U03. The console and CLI
must use this same operation owner; do not introduce independent upgrade state machines.

## Upgrade lifecycle

Persist transitions with idempotency keys, a per-target exclusive lock/lease and
fencing token, heartbeat, bounded deadlines and reconcile-on-restart behavior:

1. **Discover and plan:** validate release trust, compatibility, capacity, current
   health and selected topology. Bind current config/schema/artifact and scope.
2. **Stage:** download while the old app is serving; verify signature, hash, size,
   platform and archive safety before loading/pulling the approved digest.
3. **Approve and schedule:** revalidate authority and unchanged plan at the window.
   Notify affected users and preserve safe drafts. Cancellation is explicit and
   only offered where it can be honored.
4. **Recovery checkpoint:** capture encrypted backup plus key/config recovery
   references, verify backup integrity and require a sufficiently recent restore
   rehearsal under policy. Keep recovery material outside the host being replaced.
5. **Drain:** remove the instance from new traffic; stop new job claims/scheduling;
   finish or safely requeue active work; close long-lived streams with reconnect
   behavior. Fence mutating work as required. For a restore-required migration,
   quiesce writes and take the final consistent recovery point before migration.
6. **Migrate and replace:** one migration leader; use expand/contract compatibility
   for mixed-version deployments. Send SIGTERM, await bounded shutdown/child exit,
   then replace only selected application services. Keep store volumes and keys.
7. **Validate before traffic:** schema/readiness/dependencies plus scoped protected
   auth, existing secret access and denial checks. Use isolated canaries; never
   emit customer values. Rejoin traffic only after acceptance gates pass.
8. **Observe and complete:** monitor a defined error/latency/queue window, confirm
   running digest/version, publish outcome and retain the recovery checkpoint.
9. **Recover on failure:** retry only idempotent transitions. Roll back the image
   only if schema/data compatibility permits. Otherwise remain in controlled
   maintenance for explicit restore/forward repair; quantify lost-write risk.

SIGTERM handling exists today, but end-to-end graceful draining is unproven.
Set application deadlines below container `stop_grace_period`, with supervisor
and load-balancer budgets outside those deadlines. Choose values from measured
requests/jobs; merely increasing a timeout is not proof. Forced termination is
an observed failure with reconciliation, never a successful graceful shutdown.
Do not run `compose down`, delete volumes, prune the host or restart all services
for an ordinary application update.

Single-instance Compose has a declared maintenance interruption. Multi-replica
rollouts require spare capacity, routing/readiness, session/job compatibility,
fenced migration and shared-store recovery. Three servers do not automatically
provide high availability. Later Kubernetes adapters can use the same release
and operation contracts, without a separate product or fake zero-downtime claim.

## Delivery packets and proof

These extend existing U01-U04 and U01-U10 acceptance scenarios; they do not reset
or replace those gates. Each packet receives its own source-bound implementation
plan and complete affected-module review before code changes.

| Packet | Depends on | Output | Required proof before acceptance |
| --- | --- | --- | --- |
| OPS-01 | delivery U01/U02 | Trusted coordinated artifacts; stable/candidate publication and compatibility records | Fresh anonymous download; tampering, replay, expiry, unknown key/platform, incomplete release denied; independent signature vectors; identical promotion bytes |
| OPS-02 | OPS-01 | CLI/UI/hosted notices, stable v1 compatibility, versioned extended contracts | Real published release detected; offline/stale/failure distinct from current; scoped notice dedupe; no machine-output contamination; no install authority for tenant users |
| OPS-03 | Existing shutdown owners | Readiness/drain, worker fencing and explicit grace budgets | Real long request, active job, SSE/MCP reconnect, child termination and repeated signal; no acknowledged work lost; deadline/forced-kill recovery tested |
| OPS-04 | OPS-01, OPS-03, delivery U03/U04 | Go operation owner + host agent, Compose driver, plan/apply/recover | Kill controller at every transition; resume/reconcile; competing operators, stale lease, revoked approval, changed config, disk full, failed migration/health, rollback incompatibility; protected old-to-new workflow and restore on owned server |
| OPS-05 | OPS-02, OPS-04 | Native Platform Services UI, source-action/MCP catalog and visible teaching | Keyboard/mobile/manual assistive-technology journey; actual progress after reconnect; invalid/cross-target operations denied; no AI bypass; tutorial is distinct from execution |
| OPS-06 | OPS-04, OPS-05 and cloud gates | Fleet rings, staged rollout, policy, offline mirrors and DevSCIF profiles | Canary stops on failures, bounded fleet concurrency, regional/site failure recovery, signed evidence export, disconnected import/rotation, topology-specific measured availability |

The smallest complete release is verified artifacts, usable notifications and one
operator-approved single-instance upgrade/recovery journey. Do not ship an enabled
Install button backed only by a shell wrapper or a fixture success response.

## Growth from small business to DevSCIF

| Profile | Operational progression |
| --- | --- |
| Individual/small business | One instance, clear maintenance window, guided backup/update/recovery, included features and simple operator roles |
| Growing team/hosted service | Central fleet view, staging/canary rings, shared audit, quotas, monitoring and tested multi-replica operation |
| Enterprise | Delegated operations, separation of duties, policy-controlled maintenance, LTS/support policy, customer key custody and tested disaster recovery |
| Government/regulated DevSCIF | Defined system boundary and control profile, disconnected distribution, approved cryptographic modules where required, hardened deployment baseline, evidence retention/export and independent assessment |

Shared architecture is the recommendation; support periods, SLAs and government
requirements must be defined per deployment. A profile name, signature or choice
of algorithm does not establish FIPS validation, FedRAMP approval or SCIF suitability.
Commercial support/hosting can differ without removing included software features.

## Primary research and open decisions

Reviewed 2026-11-02:

- [Docker Compose service lifecycle](https://docs.docker.com/reference/compose-file/services/): stop signals and grace period before forced termination.
- [Docker daemon access](https://docs.docker.com/engine/security/protect-access/): socket/SSH/TLS authority boundary; motivates a scoped host executor.
- [Kubernetes pod lifecycle](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/): readiness and bounded termination inform a later adapter, not a current orchestration claim.
- [TUF specification](https://theupdateframework.github.io/specification/latest/), observed version 1.0.37: trust roles, expiry, version/replay protection and rotation; evaluate a maintained implementation.
- [Sigstore verification](https://docs.sigstore.dev/cosign/verifying/verify/): artifact signature verification is distinct from release freshness and application acceptance.
- [NIST CMVP](https://csrc.nist.gov/projects/cryptographic-module-validation-program) and [FedRAMP](https://www.fedramp.gov/): validation/assessment scopes must be established independently for a selected government deployment.

Pending: owner update-policy preference; first production target/topology and
backup/recovery location; signing custody and registry/mirror hostname; required
platforms; support/LTS policy; actual regulated deployment requirements. These do
not block contract and failure-model implementation. No host configuration, release
publication, signing key creation or runtime change is performed by this document.
