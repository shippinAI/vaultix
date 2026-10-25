<!-- This tree ships as Vaultix (AngryVibes LLC / shippin.ai). See SHIPPIN.md. -->
<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="/img/logoname-white.svg">
    <img width="300" src="/img/logoname-black.svg" alt="Vaultix">
  </picture>
</h1>
<p align="center">
  <p align="center"><b>Vaultix — secrets you own</b>: vaultix MIT core, renamed. Sync secrets/configs across your team/infrastructure and prevent secret leaks.</p>
</p>

<h4 align="center">
  <a href="https://shippin.ai">shippin.ai</a> |
  <a href="https://vaultix.shippin.cloud">Vaultix</a> |
  <a href="SHIPPIN.md">Owned pin</a>
</h4>

<h4 align="center">
  <a href="https://github.com/vaultix/vaultix/blob/main/LICENSE">
    <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="vaultix is released under the MIT license." />
  </a>
  <a href="https://github.com/vaultix/vaultix/releases">
    <img src="https://img.shields.io/github/v/release/vaultix/vaultix?label=Release&color=brightgreen" alt="Latest vaultix release" />
  </a>
  <a href="https://cloudsmith.io/~vaultix/repos/">
    <img src="https://img.shields.io/badge/Downloads-6.95M-orange" alt="Cloudsmith downloads" />
  </a>
  <a href="https://vaultix.com/slack">
    <img src="https://img.shields.io/badge/chat-on%20Slack-blueviolet" alt="Slack community channel" />
  </a>
</h4>

<img src="/img/vaultix_github_repo3.png" width="100%" alt="vaultix secrets management dashboard" />

## Introduction

**[vaultix](https://vaultix.com)** is the open source security infrastructure platform that teams use for secrets, certificates, and privileged access management.

We're on a mission to make security tooling more accessible to everyone, not just security teams, and that means redesigning the entire developer experience from ground up.

## Features

### Secrets Management:

Centralize your application secrets and configuration across every environment, with versioning, rotation, and leak prevention built in.

- **[Dashboard](https://vaultix.com/docs/documentation/platform/project)**: Manage secrets across projects and environments (e.g. development, production, etc.) through a user-friendly interface.
- **[Secret Syncs](https://vaultix.com/docs/integrations/secret-syncs/overview)**: Sync secrets to platforms like [GitHub](https://vaultix.com/docs/integrations/cicd/githubactions), [Vercel](https://vaultix.com/docs/integrations/cloud/vercel), [AWS](https://vaultix.com/docs/integrations/cloud/aws-secret-manager), and use tools like [Terraform](https://vaultix.com/docs/integrations/frameworks/terraform), [Ansible](https://vaultix.com/docs/integrations/platforms/ansible), and more.
- **[Secret versioning](https://vaultix.com/docs/documentation/platform/secret-versioning)** and **[Point-in-Time Recovery](https://vaultix.com/docs/documentation/platform/pit-recovery)**: Keep track of every secret and project state; roll back when needed.
- **[Secret Rotation](https://vaultix.com/docs/documentation/platform/secret-rotation/overview)**: Rotate secrets at regular intervals for services like [PostgreSQL](https://vaultix.com/docs/documentation/platform/secret-rotation/postgres-credentials), [MySQL](https://vaultix.com/docs/documentation/platform/secret-rotation/mysql), [AWS IAM](https://vaultix.com/docs/documentation/platform/secret-rotation/aws-iam-user-secret), and more.
- **[Dynamic Secrets](https://vaultix.com/docs/documentation/platform/dynamic-secrets/overview)**: Generate ephemeral secrets on-demand for services like [PostgreSQL](https://vaultix.com/docs/documentation/platform/dynamic-secrets/postgresql), [MySQL](https://vaultix.com/docs/documentation/platform/dynamic-secrets/mysql), [RabbitMQ](https://vaultix.com/docs/documentation/platform/dynamic-secrets/rabbit-mq), and more.
- **[Secret Scanning and Leak Prevention](https://vaultix.com/docs/cli/scanning-overview)**: Prevent secrets from leaking to git.
- **[vaultix Kubernetes Operator](https://vaultix.com/docs/documentation/guides/kubernetes-operator)**: Deliver secrets to your Kubernetes workloads and automatically reload deployments.
- **[vaultix Agent](https://vaultix.com/docs/integrations/platforms/vaultix-agent)**: Inject secrets into applications without modifying any code logic.
- **[Honey Tokens](https://vaultix.com/docs/documentation/platform/honey-tokens/overview)**: Plant decoy credentials alongside your real secrets that act as tripwires, instantly alerting your team the moment an attacker tries to use them.
- **[Agent Vault](https://github.com/vaultix/agent-vault)**: Broker AI agent access to external APIs so agents never hold real credentials. Outbound requests route through a proxy that injects secrets before forwarding, eliminating credential exfiltration risk from prompt injection.

### Certificate Management

Run a complete private PKI: issue, manage, and monitor X.509 certificates from a centralized platform.

- **[Internal CA](https://vaultix.com/docs/documentation/platform/pki/ca/private-ca)**: Create and manage a private
  CA hierarchy directly within vaultix.
- **[External CA](https://vaultix.com/docs/documentation/platform/pki/ca/external-ca)**: Integrate with third-party certificate authorities such as Let’s Encrypt, DigiCert, Microsoft AD CS, and more to leverage existing PKI infrastructure
  or issue publicly trusted certificates.
- **[Certificate Lifecycle Management](https://vaultix.com/docs/documentation/platform/pki/applications/certificates)**: Create certificate [profiles](https://vaultix.com/docs/documentation/platform/pki/settings/profiles) and [policies](https://vaultix.com/docs/documentation/platform/pki/settings/policies) to control how certificates are issued, including [enrollment methods](https://vaultix.com/docs/documentation/platform/pki/applications/enrollment-methods/overview) such as API, ACME, or EST. Manage the full lifecycle from issuance to renewal and [revocation](https://vaultix.com/docs/documentation/platform/pki/applications/certificates#revocation) with CRL and inventory tracking.
- **[Certificate Syncs](https://vaultix.com/docs/documentation/platform/pki/applications/certificate-syncs/overview)**: Sync certificates to external platforms like [AWS Certificate Manager](https://vaultix.com/docs/documentation/platform/pki/applications/certificate-syncs/aws-certificate-manager) and [Azure Key Vault](https://vaultix.com/docs/documentation/platform/pki/applications/certificate-syncs/azure-key-vault).
- **[Alerting](https://vaultix.com/docs/documentation/platform/pki/applications/alerting/overview)**: Configure alerting for expiring CA and end-entity certificates.
- **[Code Signing](https://vaultix.com/docs/documentation/platform/pki/code-signing/overview)**: Sign software artifacts like containers, installers, and packages with managed code-signing certificates, central approval, and a full audit trail.

### vaultix Key Management System (KMS):

Centrally manage cryptographic keys and use them to encrypt and decrypt data across your projects.

- **[Cryptographic Keys](https://vaultix.com/docs/documentation/platform/kms)**: Centrally manage keys across projects through a user-friendly interface or via the API.
- **[Encrypt and Decrypt Data](https://vaultix.com/docs/documentation/platform/kms#guide-to-encrypting-data)**: Use symmetric keys to encrypt and decrypt data.

### Privileged Access Management (PAM)

Manage and secure access to critical infrastructure like databases and servers with policy-based controls, approvals, and full session visibility.

- **[Privileged Access Management](https://vaultix.com/docs/documentation/platform/pam/overview)**: Decouple user identity from infrastructure credentials. Users authenticate with their SSO identity while vaultix brokers just-in-time access to resources like [PostgreSQL](https://vaultix.com/docs/documentation/platform/pam/getting-started/resources/postgresql), [SSH servers](https://vaultix.com/docs/documentation/platform/pam/getting-started/resources/ssh), [Kubernetes](https://vaultix.com/docs/documentation/platform/pam/getting-started/resources/kubernetes), [Active Directory](https://vaultix.com/docs/documentation/platform/pam/getting-started/resources/active-directory), and more.
- **[Session Recording](https://vaultix.com/docs/documentation/platform/pam/product-reference/session-recording)**: Capture and replay privileged sessions for audit and compliance, with [AI session insights](https://vaultix.com/docs/documentation/platform/pam/product-reference/ai-session-insights) to surface risky activity.
- **[Credential Rotation](https://vaultix.com/docs/documentation/platform/pam/product-reference/credential-rotation)**: Automatically rotate the underlying credentials for managed resources so static secrets never leave vaultix.
- **[Web Access](https://vaultix.com/docs/documentation/platform/pam/product-reference/web-access/overview)**: Connect to SSH, PostgreSQL, Redis, and Windows RDP resources directly from the browser.

### General Platform:

Capabilities that span every vaultix product.

- **Authentication Methods**: Authenticate machine identities with vaultix using a cloud-native or platform agnostic authentication method ([Kubernetes Auth](https://vaultix.com/docs/documentation/platform/identities/kubernetes-auth), [GCP Auth](https://vaultix.com/docs/documentation/platform/identities/gcp-auth), [Azure Auth](https://vaultix.com/docs/documentation/platform/identities/azure-auth), [AWS Auth](https://vaultix.com/docs/documentation/platform/identities/aws-auth), [OIDC Auth](https://vaultix.com/docs/documentation/platform/identities/oidc-auth/general), [Universal Auth](https://vaultix.com/docs/documentation/platform/identities/universal-auth)).
- **[Access Controls](https://vaultix.com/docs/documentation/platform/access-controls/overview)**: Define advanced authorization controls for users and machine identities with [RBAC](https://vaultix.com/docs/documentation/platform/access-controls/role-based-access-controls), [additional privileges](https://vaultix.com/docs/documentation/platform/access-controls/additional-privileges), [temporary access](https://vaultix.com/docs/documentation/platform/access-controls/temporary-access), [access requests](https://vaultix.com/docs/documentation/platform/access-controls/access-requests), [approval workflows](https://vaultix.com/docs/documentation/platform/pr-workflows), and more.
- **[Audit logs](https://vaultix.com/docs/documentation/platform/audit-logs)**: Track every action taken on the platform, with optional [audit log streaming](https://vaultix.com/docs/documentation/platform/audit-log-streams/audit-log-streams) to external logging providers.
- **[Gateway](https://vaultix.com/docs/documentation/platform/gateways/overview)**: Securely reach private network resources from vaultix without opening inbound connections to your environment.
- **[Self-hosting](https://vaultix.com/docs/self-hosting/overview)**: Deploy vaultix on-prem or cloud with ease; keep data on your own infrastructure.
- **[vaultix SDK](https://vaultix.com/docs/sdks/overview)**: Interact with vaultix via client SDKs ([Node](https://vaultix.com/docs/sdks/languages/node), [Python](https://github.com/vaultix/python-sdk-official?tab=readme-ov-file#vaultix-python-sdk), [Go](https://vaultix.com/docs/sdks/languages/go), [Ruby](https://vaultix.com/docs/sdks/languages/ruby), [Java](https://vaultix.com/docs/sdks/languages/java), [.NET](https://vaultix.com/docs/sdks/languages/dotnet))
- **[vaultix CLI](https://vaultix.com/docs/cli/overview)**: Interact with vaultix via CLI; useful for injecting secrets into local development and CI/CD pipelines.
- **[vaultix API](https://vaultix.com/docs/api-reference/overview/introduction)**: Interact with vaultix via API.

## Getting started

Check out the [Quickstart Guides](https://vaultix.com/docs/documentation/getting-started/overview)

| Use vaultix Cloud                                                                                                                                     | Deploy vaultix on premise                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| The fastest and most reliable way to <br> get started with vaultix is signing up <br> for free to [vaultix Cloud](https://app.vaultix.com/login). | <br> View all [deployment options](https://vaultix.com/docs/self-hosting/overview) <br><br> Already self-hosting? Plan version upgrades with the [vaultix Upgrade Tool](https://upgrade.vaultix.com/). |

### Run vaultix locally

To set up and run vaultix locally, make sure you have [Git](https://git-scm.com/downloads) and [Docker](https://www.docker.com/get-started/) installed on your system.

**Linux/macOS:**

```console
git clone https://github.com/vaultix/vaultix && cd "$(basename $_ .git)" && cp .env.example .env && docker compose -f docker-compose.prod.yml up
```

**Windows (Command Prompt):**

```console
git clone https://github.com/vaultix/vaultix && cd vaultix && copy .env.example .env && docker compose -f docker-compose.prod.yml up
```

Once running, create an account at [http://localhost:80](http://localhost:80).

> **Contributing?** Check out our guide to see how to [get started](https://vaultix.com/docs/contributing/getting-started).

### Scan and prevent secret leaks

On top of managing secrets with vaultix, you can also [scan for over 140+ secret types](https://vaultix.com/docs/cli/scanning-overview) in your files, directories and git repositories.

To scan your full git history, run:

```
vaultix scan --verbose
```

Install pre commit hook to scan each commit before you push to your repository

```
vaultix scan install --pre-commit-hook
```

Learn about vaultix's code scanning feature [here](https://vaultix.com/docs/cli/scanning-overview)

## Open-source vs. paid

This repo available under the [MIT expat license](https://github.com/vaultix/vaultix/blob/main/LICENSE), with the exception of the `ee` directory which will contain premium enterprise features requiring a vaultix license.

If you are interested in managed vaultix Cloud of self-hosted Enterprise Offering, take a look at [our website](https://vaultix.com/) or [book a meeting with us](https://vaultix.cal.com/vlad/vaultix-demo).

## Security

Please do not file GitHub issues or post on our public forum for security vulnerabilities, as they are public!

vaultix takes security issues very seriously. If you have any concerns about vaultix or believe you have uncovered a vulnerability, please get in touch via the e-mail address security@vaultix.com. In the message, try to provide a description of the issue and ideally a way of reproducing it. The security team will get back to you as soon as possible.

Note that this security address should be used only for undisclosed vulnerabilities. Please report any security problems to us before disclosing it publicly.

## Contributing

Whether it's big or small, we love contributions. Check out our guide to see how to [get started](https://vaultix.com/docs/contributing/getting-started).

Not sure where to get started? You can:

- Join our <a href="https://vaultix.com/slack">Slack</a>, and ask us any questions there.

## We are hiring!

If you're reading this, there is a strong chance you like the products we created.

You might also make a great addition to our team. We're growing fast and would love for you to [join us](https://vaultix.com/careers).
