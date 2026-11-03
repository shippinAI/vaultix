# Vaultix capability register

This register lists all **86 product requirements in 13 groups** from the canonical Vaultix capability catalog. It is generated from [catalog.mjs](catalog.mjs), not a separate feature definition.

Software capabilities are included with Vaultix. Permissions, tenant policies, provider configuration and operational limits still apply. A feature being present in source or enabled by the included-feature policy does not establish production acceptance.

For identity methods, existing implementation owners and the remaining public CLI flow, see [Vaultix identity execution](../0113-vaultix-identity-execution.md).

The [API surface register](generated/surface-map.tsv) lists the preserved route/operation baseline. The [source register](generated/source-map.tsv) maps the source inventory. Neither inventory is a substitute for reviewing or testing each implementation.

The scope below includes existing capabilities and planned additions. Each row retains its current implementation and acceptance state; this is not a claim that every listed requirement is delivered. Provider-specific operations and edge cases require their own verification.

## Groups

| Group | Requirements | Purpose |
| --- | ---: | --- |
| Workspace | 5 | Projects, environments and a clear starting point |
| Secrets | 11 | Store, change, deliver and recover application configuration |
| Identity & access | 10 | People, workloads, roles and approval boundaries |
| Lifecycle automation | 6 | Rotation, leases and reliable background work |
| Connections & sync | 5 | Connect existing infrastructure without duplicating secrets |
| Certificates & signing | 6 | Certificate and software trust lifecycles |
| Keys & hardware trust | 5 | Encryption keys, external custody and recovery |
| Privileged access | 5 | Temporary resource access and accountable sessions |
| Detection & posture | 4 | Find exposures and prioritize remediation |
| Clyffy & AI workspace | 10 | Reference-only context and controlled execution |
| Audit & governance | 5 | Explain who did what, under which authority |
| Instance operations | 8 | Build, deploy, recover and scale on owned infrastructure |
| Guidance & accessibility | 6 | Progressive disclosure, usable controls and fast loading |

## Workspace

| ID | Vaultix capability | Implementation | Acceptance |
| --- | --- | --- | --- |
| W01 | Instance setup & application entry | Existing / review required | Not accepted end to end |
| W02 | Projects & environment lifecycle | Scoped evidence | Not accepted end to end |
| W03 | Folders, tags & resource metadata | Existing / review required | Not accepted end to end |
| W04 | Organization & suborganization scope | Existing / review required | Not accepted end to end |
| W05 | Project templates & migration | Existing / review required | Not accepted end to end |

## Secrets

| ID | Vaultix capability | Implementation | Acceptance |
| --- | --- | --- | --- |
| S01 | Create, edit & batch commit | Scoped evidence | Not accepted end to end |
| S02 | References & dependency navigation | Scoped evidence | Not accepted end to end |
| S03 | Imports & inheritance precedence | Known semantic gap | Not accepted end to end |
| S04 | Personal overrides & branch configurations | Existing / review required | Not accepted end to end |
| S05 | Versions, commits & point-in-time restore | Existing / review required | Not accepted end to end |
| S06 | Validation rules & typed configuration | Existing / review required | Not accepted end to end |
| S07 | Secret generation & clipboard lifecycle | Scoped evidence | Not accepted end to end |
| S08 | Sharing & secret requests | Existing / review required | Not accepted end to end |
| S09 | CLI, SDK & infrastructure-as-code coverage | Existing / review required | Not accepted end to end |
| S10 | Application injection & offline policy | Known semantic gap | Not accepted end to end |
| S11 | Encrypted storage & key continuity | Existing / review required | Not accepted end to end |

## Identity & access

| ID | Vaultix capability | Implementation | Acceptance |
| --- | --- | --- | --- |
| I01 | Nomen sign-in & session ownership | Known semantic gap | Not accepted end to end |
| I02 | SSO, federation & directory integration | Existing / review required | Not accepted end to end |
| I03 | MFA, passkeys & account recovery | Existing / review required | Not accepted end to end |
| I04 | Machine identities & authentication methods | Existing / review required | Not accepted end to end |
| I05 | Roles, permissions & temporary privileges | Existing / review required | Not accepted end to end |
| I06 | Groups, SCIM & membership lifecycle | Existing / review required | Not accepted end to end |
| I07 | Access requests & temporary grants | Existing / review required | Not accepted end to end |
| I08 | Change approvals & policy composition | Known semantic gap | Not accepted end to end |
| I09 | Trusted networks & access conditions | Existing / review required | Not accepted end to end |
| I10 | OAuth clients & delegated access | Existing / review required | Not accepted end to end |

## Lifecycle automation

| ID | Vaultix capability | Implementation | Acceptance |
| --- | --- | --- | --- |
| A01 | Scheduled secret rotation | Existing / review required | Not accepted end to end |
| A02 | Dynamic credentials & leases | Existing / review required | Not accepted end to end |
| A03 | Jobs, retries & idempotency | Scoped evidence | Not accepted end to end |
| A04 | Reminders, alerts & notifications | Existing / review required | Not accepted end to end |
| A05 | Replication & multi-destination consistency | Existing / review required | Not accepted end to end |
| A06 | Workflow schedules & change windows | Planned | Not accepted end to end |

## Connections & sync

| ID | Vaultix capability | Implementation | Acceptance |
| --- | --- | --- | --- |
| C01 | Provider connections & credential custody | Existing / review required | Not accepted end to end |
| C02 | Secret synchronization | Existing / review required | Not accepted end to end |
| C03 | Webhooks & event subscriptions | Existing / review required | Not accepted end to end |
| C04 | Existing gateways, relays & proxies | Existing / review required | Not accepted end to end |
| C05 | Repository & CI connections | Existing / review required | Not accepted end to end |

## Certificates & signing

| ID | Vaultix capability | Implementation | Acceptance |
| --- | --- | --- | --- |
| P01 | Certificate inventory & discovery | Existing / review required | Not accepted end to end |
| P02 | Authorities, policies & certificate requests | Existing / review required | Not accepted end to end |
| P03 | ACME, EST & SCEP enrollment | Existing / review required | Not accepted end to end |
| P04 | Renewal, revocation & distribution | Existing / review required | Not accepted end to end |
| P05 | Software signing & signer access | Existing / review required | Not accepted end to end |
| P06 | Templates, collections & applications | Existing / review required | Not accepted end to end |

## Keys & hardware trust

| ID | Vaultix capability | Implementation | Acceptance |
| --- | --- | --- | --- |
| K01 | Encryption keys & cryptographic operations | Existing / review required | Not accepted end to end |
| K02 | External KMS & customer-managed keys | Existing / review required | Not accepted end to end |
| K03 | HSM connectors & hardware custody | Existing / review required | Not accepted end to end |
| K04 | KMIP interoperability | Existing / review required | Not accepted end to end |
| K05 | Key recovery & emergency procedures | Existing / review required | Not accepted end to end |

## Privileged access

| ID | Vaultix capability | Implementation | Acceptance |
| --- | --- | --- | --- |
| R01 | Resources, accounts & discovery | Existing / review required | Not accepted end to end |
| R02 | Just-in-time sessions & approvals | Existing / review required | Not accepted end to end |
| R03 | Session recording & command policy | Existing / review required | Not accepted end to end |
| R04 | Account rotation & access templates | Existing / review required | Not accepted end to end |
| R05 | Web access & protocol isolation | Existing / review required | Not accepted end to end |

## Detection & posture

| ID | Vaultix capability | Implementation | Acceptance |
| --- | --- | --- | --- |
| D01 | Repository and source scanning | Existing / review required | Not accepted end to end |
| D02 | Honeytokens & detection delivery | Existing / review required | Not accepted end to end |
| D03 | Secret health & posture insights | Existing / review required | Not accepted end to end |
| D04 | Exposure remediation workflow | Planned | Not accepted end to end |

## Clyffy & AI workspace

| ID | Vaultix capability | Implementation | Acceptance |
| --- | --- | --- | --- |
| AI01 | Clyffy setup & local Codex sign-in | Scoped evidence | Not accepted end to end |
| AI02 | Project & secret-reference context | Scoped evidence | Not accepted end to end |
| AI03 | Plan, explain & preview a change | Planned | Not accepted end to end |
| AI04 | Approve, execute & reconcile | Planned | Not accepted end to end |
| AI05 | Workload-bound value delivery | Planned | Not accepted end to end |
| AI06 | Agent sessions & service access bundles | Planned | Not accepted end to end |
| AI07 | Execution timeline & emergency stop | Planned | Not accepted end to end |
| AI08 | Untrusted content & data-flow policy | Planned | Not accepted end to end |
| AI09 | Local models & organization provider policy | Planned | Not accepted end to end |
| AI10 | AI evaluation & evidence packs | Planned | Not accepted end to end |

## Audit & governance

| ID | Vaultix capability | Implementation | Acceptance |
| --- | --- | --- | --- |
| G01 | Audit search & actor attribution | Existing / review required | Not accepted end to end |
| G02 | Audit streaming & durable outbox | Existing / review required | Not accepted end to end |
| G03 | Retention, exports & access to evidence | Existing / review required | Not accepted end to end |
| G04 | DevSCIF control profiles | Planned | Not accepted end to end |
| G05 | Disconnected operation & update trust | Planned | Not accepted end to end |

## Instance operations

| ID | Vaultix capability | Implementation | Acceptance |
| --- | --- | --- | --- |
| O01 | Local builds, images & provenance | Scoped evidence | Not accepted end to end |
| O02 | Dragonfly, Redis & ElastiCache | Scoped evidence | Not accepted end to end |
| O03 | Backups, restore & disaster recovery | Planned | Not accepted end to end |
| O04 | Scale, limits & availability | Existing / review required | Not accepted end to end |
| O05 | Instance administration & upgrades | Existing / review required | Not accepted end to end |
| O06 | Telemetry, support & diagnostics | Existing / review required | Not accepted end to end |
| O07 | Hosted allowances & service previews | Decision pending | Not accepted end to end |
| O08 | Legacy capability reconciliation | Existing / review required | Not accepted end to end |

## Guidance & accessibility

| ID | Vaultix capability | Implementation | Acceptance |
| --- | --- | --- | --- |
| U01 | Task-oriented navigation & search | Planned | Not accepted end to end |
| U02 | Contextual help, dialogs & sheets | Scoped evidence | Not accepted end to end |
| U03 | Guided lessons & motion | Scoped evidence | Not accepted end to end |
| U04 | Whole-workflow accessibility | Existing / review required | Not accepted end to end |
| U05 | Vector artwork & loading budgets | Scoped evidence | Not accepted end to end |
| U06 | Safe previews & progressive disclosure | Planned | Not accepted end to end |

Regenerate with `node scripts/export-vaultix-capabilities.mjs --write`; verify with `--check`. The detailed outcomes and acceptance criteria remain in the canonical catalog.
