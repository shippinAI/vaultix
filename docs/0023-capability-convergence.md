# Owned capability convergence

Accepted direction, 2026-10-26: Vaultix includes the software capabilities users
need from Infisical and Doppler, including enterprise capabilities. Implement
missing behavior in the owned core, API and UI. Permissions and operational
controls remain mandatory. An included feature flag proves no workflow parity.

## Public-source baseline

Reviewed [Infisical's public comparison](https://infisical.com/pricing) and
[Doppler's public comparison](https://www.doppler.com/pricing) on 2026-10-26.
The following is an initial capability-family backlog, not a claim to have
exhaustively specified every provider, hidden enterprise implementation or edge
case. Expand each family with primary product/API documentation and reproducible
behavior before declaring its specification complete. Commercial certification,
support and service-level promises do not become software features by copying a
plan label; hosting/support costs are separate from software inclusion.

| Public capability family | Source | Vaultix implementation/acceptance work |
| --- | --- | --- |
| References, imports, overrides, sharing, versions and recovery | Infisical | Existing secret/import services; verify precedence, version restore and revocation. Native references are scoped metadata only; native writes/inject remain open. |
| Rotation, temporary credentials and time-bound access | Infisical | Existing rotation/dynamic-secret/access services; test provider lifecycle, expiry, retries and cleanup. |
| Roles, SSO/MFA, LDAP, provisioning and groups | Infisical | Existing permissions/provisioning modules; map identity to Nomen and prove revocation and tenant boundaries. |
| Reviews, access requests and suborganizations | Infisical | Existing approval/sub-org services; author full request/review/apply UI and conflict/denial tests. |
| Audit retention/streaming, external keys, HSM and KMIP | Infisical | Existing audit/KMS modules; test durable redacted export, key recovery and real provider/hardware access. |
| Honeytokens and dedicated deployment | Infisical | Existing detection/runtime pieces; prove detection delivery, isolation and operational recovery. |
| CLI, tokens, typed values, references and personal configurations | Doppler | Review CLI and core secret schemas; specify validation, local override precedence and target-process injection without AI value exposure. |
| Inheritance, synchronization, integrations and webhooks | Doppler | Review import/sync/event services; define deterministic merge/conflict rules, connector scopes and retry/reconciliation behavior per provider. |
| Change policies, roles/groups, provisioning and trusted networks | Doppler | Existing approval/permission modules; verify lifecycle, network restrictions and native accessible administration. |
| Health analytics, proxied rotation, dynamic credentials and external keys | Doppler | Review scanning/insights/gateway/rotation/KMS services; establish metrics semantics and provider failure/recovery proof. |
| Terraform management, log forwarding, configurable retention/rates | Doppler | Inventory resource coverage and import/drift behavior; prove export durability and bounded operational policies without paid software gates. |
| On-prem/cloud deployment and AI tooling | Doppler | Canonical image, shared source actions/MCP, local Codex and own-provider setup; deployment topology and actual client auth acceptance remain open. |

This baseline also needs separate public-documentation coverage of certificate
management, privileged access and agent-specific product surfaces. Existing
PKI/PAM/scanning modules are tracked in [0018](0018-hosted-capability-proof.md);
their presence does not establish complete comparator coverage.

## Implementation method

1. Define the observable workflow, inputs, outputs, permissions, failure modes,
   recovery and migration expectations. Attach source links and observation date.
2. Read existing owned implementation and callers completely, recording hashes
   under [0021](0021-product-authorship-review.md). Preserve provenance/notices.
3. Implement missing behavior independently from public specifications and
   authorized interoperability observations. Record assumptions where behavior
   cannot be observed. Do not contact frozen snapshot hosts, obtain private
   source, bypass access controls or substitute vendor code for authored work.
4. Use the existing encrypted store and source-action/catalog boundary. Metadata
   GETs and model tools never disclose values; inject redemption is separately
   authorized. Keep product URLs instance-configurable and actions Vaultix-owned.
5. Prove positive, denied, cross-tenant, malformed, expired, concurrent and
   provider-outage behavior. Exercise the native UI against real services;
   satisfy [accessibility acceptance](0022-accessibility-acceptance.md).
6. Record actual tests, versions, image digest and unresolved provider prerequisites.
   Mark only that scoped workflow verified. Publish no blanket enterprise parity
   claim from entitlement tests or an initial capability inventory.

## Concrete starting points

Paths below are relative to `core/backend/src/`; they identify code to review,
not completed authorship or verification:

- `services/secret-v2-bridge/secret-v2-bridge-service.ts`
- `services/secret-import/secret-import-service.ts`
- `ee/services/access-approval-policy/access-approval-policy-service.ts`
- `ee/services/secret-approval-policy/secret-approval-policy-service.ts`
- `ee/services/dynamic-secret/dynamic-secret-service.ts`
- `ee/services/secret-rotation-v2/secret-rotation-v2-service.ts`
- `ee/services/audit-log-stream/audit-log-stream-service.ts`
- `ee/services/secret-scanning/secret-scanning-service.ts`

DevSCIF tailoring must identify actual control and deployment requirements and
their evidence. The suite name establishes neither certification nor suitability
for classified information. Software inclusion never weakens authorization.
