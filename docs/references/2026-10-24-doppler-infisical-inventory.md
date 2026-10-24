# Doppler and Infisical: feature inventory (2026-10-24)

Reference for the parity section of [`docs/vaultix/ROADMAP.md`](../vaultix/ROADMAP.md). Gathered
2026-10-24 from each vendor's public docs, pricing pages, changelogs and source. Every row names its
source. Product tiers are as the vendors state them; nothing here is a claim about Vaultix.

Tier words: Doppler plans are Developer (free for 3 users), Team and Enterprise (Ent). Infisical Cloud
plans are Free, Pro, Advanced (Adv) and Enterprise; **SH-free** = their open-source self-hosted build,
**SH-paid** = self-hosted with a paid key.

Two changes since our roadmap was written: **Doppler On-prem** shipped in June 2026 (Enterprise only,
no public install docs), and **Infisical removed its standalone SSH product and its "Agent Sentinel"**
on 2026-08-03 (SSH certificates now live in PAM and an SSH dynamic secret). Infisical upstream is at
v0.167.2 (2026-10-23).

## 1. Secrets model

| Capability | Doppler | Infisical | Source |
| --- | --- | --- | --- |
| Hierarchy | Project → environment → config (root + branch configs) | Project → environment → nested folders; SH-free | [D](https://docs.doppler.com/docs/platform-limits) · [I](https://infisical.com/docs/documentation/platform/folder) |
| Branch / personal configs | Branch configs and personal configs, all plans | Personal overrides only; SH-free | [D](https://docs.doppler.com/docs/branch-configs) |
| Inheritance / imports | Up to 10 ordered parents, cross-project; Team+ | Imports from env or folder; cross-project sharing Pro / SH-paid | [D](https://docs.doppler.com/docs/config-inheritance) · [I](https://infisical.com/docs/documentation/platform/secret-reference) |
| References | `${KEY}`, cross-config, cross-project (paid) | `${env.folder.KEY}`; SH-free | same |
| Versioning, history redaction | Per-secret history; redact one or all past values | Per-secret versions; SH-free | [D](https://docs.doppler.com/docs/versioning) · [I](https://infisical.com/docs/documentation/platform/secret-versioning) |
| Point-in-time | Roll back single config-log entries | Commit-based folder rollback with diff; Pro+ / SH-paid | [I](https://infisical.com/docs/documentation/platform/pit-recovery) |
| Typed values, visibility | 18 enforced types; unmasked / masked / restricted | Validation rules on key and value | [D](https://docs.doppler.com/docs/secrets) · [I](https://infisical.com/docs/documentation/platform/secret-validation-rules) |
| Import | ENV/JSON/YAML upload, Universal Import | .env/.json/.yml/.csv, nested JSON → folders, Doppler and Vault migration | [D](https://docs.doppler.com/docs/universal-import-guide) · [I](https://infisical.com/docs/documentation/platform/external-migrations/overview) |
| Project templates | `doppler-template.yaml` | Ent / SH-paid | [I](https://infisical.com/docs/documentation/platform/project-templates) |

## 2. Access and identity

| Capability | Doppler | Infisical | Source |
| --- | --- | --- | --- |
| SSO | Google, GitHub; SAML Team+ | Google/GitHub/GitLab free; SAML + OIDC Pro+ / SH-paid; LDAP Ent | [I](https://infisical.com/docs/documentation/platform/sso/overview) |
| MFA, enforcement | Email, TOTP, security keys | 2FA all; enforcement Adv+ | [D](https://docs.doppler.com/docs/multi-factor-authentication) |
| SCIM, groups | Ent | Ent / SH-paid | [D](https://docs.doppler.com/docs/scim) · [I](https://infisical.com/docs/documentation/platform/scim/overview) |
| RBAC, custom roles | Team+; custom roles Ent | Built-in roles SH-free; custom roles Adv+ (docs disagree) | [I](https://infisical.com/docs/documentation/platform/access-controls/role-based-access-controls) |
| ABAC, temporary access, access requests | None | ABAC (tier not stated); temporary Adv+; access requests incl. break-glass Ent | [I](https://infisical.com/docs/documentation/platform/access-controls/access-requests) |
| Change requests / approvals | Team+, cross-project; policies Ent | Multi-step, bulk review, global policy, Slack/Teams; Ent | [D](https://docs.doppler.com/docs/change-requests) · [I](https://infisical.com/docs/documentation/platform/pr-workflows) |
| Machine identities | Service accounts Team+; OIDC for k8s, CI, AWS EC2 | Universal, k8s, AWS, GCP, Azure, OCI, JWT, OIDC, SPIFFE, TLS cert, LDAP; SH-free | [D](https://docs.doppler.com/docs/service-account-identities) · [I](https://infisical.com/docs/integrations/machine-authentication) |
| OAuth apps, token exchange | None | OAuth apps, RFC 8693 | [I](https://infisical.com/docs/_llms/platform.txt) |

## 3. Delivery to workloads

| Capability | Doppler | Infisical | Source |
| --- | --- | --- | --- |
| CLI | `doppler run`, file mount, templates, `--watch` restart, TUI | `infisical run`, export, leases, scan, agent, proxy | [D](https://docs.doppler.com/docs/cli) · [I](https://infisical.com/docs/cli/reference) |
| SDKs | Node, Python | Node, Python, Go, Java, .NET, PHP, Ruby, Rust, C++ | [I](https://infisical.com/docs/sdks/overview) |
| Agent, proxy, injector | None | Agent daemon, caching proxy, k8s injector | [I](https://infisical.com/docs/integrations/platforms/infisical-agent) |
| Kubernetes | Operator, ESO provider | Operator, CSI, injector, ESO, cert-manager, Helm | [I](https://infisical.com/docs/integrations/platforms/kubernetes/overview) |
| Syncs | ~24 targets | ~53 targets; SH-free unlimited | [D](https://docs.doppler.com/docs/integrations) · [I](https://infisical.com/docs/integrations/secret-syncs/overview) |
| Webhooks, events | Webhooks (5/50/1500) | Webhooks SH-free; SSE event subscriptions Ent | [I](https://infisical.com/docs/documentation/platform/event-subscriptions) |
| IaC | Terraform / OpenTofu | Terraform, Pulumi, Ansible, Packer, Backstage | [I](https://infisical.com/docs/integrations/frameworks/terraform) |

## 4. Dynamic secrets and rotation

| Capability | Doppler | Infisical | Source |
| --- | --- | --- | --- |
| Dynamic credentials | AWS IAM, Azure SP; Ent | ~20 databases plus AWS/GCP/Azure, k8s, GitHub, LDAP, OAuth2, TOTP, Tailscale, SSH certs; Adv+ | [D](https://docs.doppler.com/docs/dynamic-secrets) · [I](https://infisical.com/docs/documentation/platform/dynamic-secrets/overview) |
| Rotation | Team+; ~10 targets; on-prem rotation agents Ent | ~30 targets, private networks via gateway; Pro/Adv+ | [D](https://docs.doppler.com/docs/secrets-rotation) · [I](https://infisical.com/docs/documentation/platform/secret-rotation/overview) |

## 5. PKI, SSH, KMS, PAM

Doppler: none. Infisical: private and external CAs, ACME (SH-free: 1 CA, ACME, CRL), EST/SCEP/OCSP and
cert syncs (Ent), SSH certificates via PAM and an SSH dynamic secret, KMS with KMIP, PAM with session
recording. [PKI](https://infisical.com/docs/documentation/platform/pki/overview) ·
[KMS](https://infisical.com/docs/documentation/platform/kms/overview) ·
[PAM](https://infisical.com/docs/documentation/platform/pam/overview)

## 6. Security and compliance

| Capability | Doppler | Infisical | Source |
| --- | --- | --- | --- |
| Encryption | Server-side AES-GCM, per-workplace key in memory | Server-side AES-256-GCM key chain, root key env or HSM | [D](https://docs.doppler.com/docs/security-fact-sheet) · [I](https://infisical.com/docs/internals/security) |
| BYOK / HSM / FIPS | EKM (AWS, GCP) Ent | External KMS, HSM root, FIPS 140-3; Ent | [I](https://infisical.com/docs/documentation/platform/kms-configuration/overview) |
| Audit, streaming | 3 / 90 / custom days; streams Team+ / Ent | 30 / 90 / custom days; streams Ent | [D](https://docs.doppler.com/docs/workplace-logs) · [I](https://infisical.com/docs/documentation/platform/audit-logs) |
| IP allowlist | Per config, Team+ | Org-wide, Pro+ | [D](https://docs.doppler.com/docs/trusted-ips) |
| Secret scanning, honey tokens, health | Secret Health dashboard Ent | CLI scan + pre-commit (free), repo scanning, honey tokens, insights | [I](https://infisical.com/docs/documentation/platform/secret-scanning/overview) |

## 7. Developer experience and AI

| Capability | Doppler | Infisical | Source |
| --- | --- | --- | --- |
| Compare / bulk / value search | Compare page, mirror edits, value search | Overview across envs, bulk ops, value search Pro+ | [D](https://docs.doppler.com/docs/comparing-secrets) |
| Offline fallback | Encrypted fallback file with passphrase | CLI offline cache, caching proxy | [D](https://docs.doppler.com/docs/automatic-fallbacks) |
| Share links, secret requests | Doppler Share, free | Share links + reverse "secret requests" | [D](https://docs.doppler.com/docs/share-security) · [I](https://infisical.com/docs/documentation/platform/secret-sharing) |
| MCP server | `@dopplerhq/mcp-server` (experimental) | `@infisical/mcp` | [D](https://docs.doppler.com/docs/mcp) · [I](https://github.com/Infisical/infisical-mcp-server) |
| AI agents | Scoped expiring read-only tokens + MCP | Agent Vault: proxy attaches the credential so the agent never holds it (paid per request); Agent Proxy | [D](https://www.doppler.com/agents) · [I](https://infisical.com/docs/documentation/platform/agent-vault/overview) |

## 8. Operations

| Capability | Doppler | Infisical | Source |
| --- | --- | --- | --- |
| Self-hosting | On-prem, Ent only (Jun 2026) | Docker, Compose, Helm, Linux package, air-gapped; SH-free | [D](https://www.doppler.com/doppler-on-prem) · [I](https://infisical.com/docs/self-hosting/overview) |
| HA, backups, multi-region | SaaS only | HA references; you back up Postgres; replication Ent | [I](https://infisical.com/docs/self-hosting/guides/replication) |
| Rate limits | Per token per minute, plan-based | Cloud per IP; self-hosted none | [D](https://docs.doppler.com/docs/platform-limits) · [I](https://infisical.com/docs/api-reference/overview/rate-limits) |

Open points: Infisical's tier for custom roles and gateways differs between its own pages; tiers for
ABAC, OAuth apps, KMS operations and validation rules are not stated.
