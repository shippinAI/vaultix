# Vaultix.cloud and DevSCIF.com authorship review

Accepted direction, 2026-10-26. Owner: AngryVibes LLC; operator: shippin.ai.

**Vaultix.cloud** is the primary secrets and AI product. **DevSCIF.com** is the
enterprise and government-tailored suite. These are product destinations, not
a claim that either hosted deployment or government controls are already live.
Software capabilities remain included. Suite tailoring must not restore paid
security entitlements or weaken permissions, approvals or tenant isolation.

## Scope and standard

Every existing product-code module must be read and deliberately authored for
Vaultix. This includes inherited `core/` and `ee/` code, APIs, frontend flows,
database schema/migrations, Go services, the CLI, optional panel, integrations,
tests, deployment/configuration and operational scripts. A rename, an enabled
feature flag or a passing inherited test is not evidence of complete authorship.

Preserve third-party notices and component provenance. Review vendored code and
generated inputs for their role and risks; do not relabel dependencies as newly
authored Vaultix code or hand-edit generated outputs. `leftover/` remains an
archive, never a source host to contact or a runtime to wrap.

Read the complete relevant file, then trace its callers, data, authorization,
failure behavior and external dependencies. For each module record:

1. Its Vaultix responsibility and the files read at their exact content hashes.
2. A retain/modify/replace/remove/investigate decision with reasons.
3. The authored behavior and migration/compatibility consequences.
4. Authorization, tenant isolation, secret-value boundaries and audit effects.
5. Positive, denied, empty and failure evidence; actual provider prerequisites.
6. Remaining inherited behavior and unresolved deployment/release gates.

Retaining reviewed, correct logic is a deliberate decision. Wholesale text
replacement and blanket deletion are not this review process.

## Evidence accounting

`scripts/audit-codebase.mjs` inventories tracked and non-ignored new files.
`docs/code-audit/inventory.tsv` records paths, Git content hashes, file kinds and
review state. Discovery and hashing do **not** count as reading or reviewing.

Explicit records belong in `docs/code-audit/reviews.json`, with `path`, `blob`,
`status`, `decision`, `scope` and nonempty `evidence`. States are `unread`,
`reviewed`, `authored`, and `verified`. Changed reviewed content becomes `stale`;
missing files are flagged. A verified file only means the recorded scope was
verified. It cannot establish that its entire module, provider or suite is ready.
No files are automatically marked reviewed from existing tests or Git history.

```sh
node scripts/audit-codebase.mjs --write
node scripts/audit-codebase.mjs --check
```

The initial inventory starts unread; only explicitly reconciled file reviews
advance from that state. Existing scoped test evidence is
in [0018](0018-hosted-capability-proof.md). Historical implementation work must
be reconciled with this file-level review standard before receiving a review
record; the initial inventory is not a claim that the whole tree was read.

## Review sequence

| Area | Required outcome |
| --- | --- |
| Product identity and configuration | Central Vaultix.cloud/DevSCIF.com vocabulary; classify links, deployment defaults and callbacks before migrating domains. Keep instance URLs configurable. |
| Auth, tenancy and permissions | Nomen OIDC/session ownership; issuer/audience/subject mapping; tenant isolation; revocation and denial evidence. No copied identity runtime. |
| Store and secrets lifecycle | Existing encrypted store, safe migration paths, versions/rollback, metadata-only GET, target-process-only inject redemption. |
| Source actions and Clyffy | Catalog-authored UI/MCP actions, shared authorization, explicit execution history, reference-only model boundary, local Codex sign-in and own-provider setups. |
| Native UI and quality of life | Authored end-to-end workflows; crisp flat vector system; keyboard/mobile behavior; useful loading, empty, denied and recovery states. |
| Enterprise/government tailoring | Define deployment/control requirements, operator separation, audit/export, retention and recovery expectations with evidence per profile. No invented certification or compliance status. |
| Providers and security services | Per-provider rotation, leases, sync, PKI, PAM, KMS/HSM, scanning and recovery tests. Record unavailable hardware/services rather than claiming parity. |
| Runtime and delivery | Canonical standalone image, Dragonfly default, explicit Redis/ElastiCache alternatives, deployment/restore/failover evidence and reproducible CI. |

DevSCIF requirements must be explicit before implementing a control profile.
The domain name does not establish a security boundary, certification, authority
to operate, disconnected operation or suitability for classified information.
Those capabilities require their own design, deployment constraints and proof.

This work stays within Auth (Nomen) → Secrets (Vaultix). Mesh remains out of scope
until explicitly authorized. Neither product destination creates a second store.
