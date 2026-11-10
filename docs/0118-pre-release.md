# 0118 — Pre-release

Status: in force from 2026-11-10 until the owner declares a release.

Vaultix is pre-release. Nobody, human or AI, treats an instance as production.

## What pre-release means

- **No production data.** Do not store production secrets, customer credentials or
  regulated data in a Vaultix instance.
- **Things will change.** The database layout, the HTTP API and the command line are
  being reshaped away from the inherited design. Planned changes include prefixed,
  grouped tables and a Vaultix API grouped by MCPL domain. Some changes break
  existing clients. `vaultix server upgrade` aims to carry data forward and rehearses
  every changed migration set on a restored copy, but pre-release does not promise it.
- **No commitments.** No uptime target, support response, security certification,
  compliance claim or hosted readiness. `vaultix.cloud` is not a production service yet.
- **Keep your own copy of the keys.** Keep an offline copy of the instance's
  `config/recovery.key` and `config/vaultix.env`. Without them the data cannot be read.

## Credentials in chat

Pre-release instances have one credential that may pass through an AI chat: the
first-owner **setup code** (`VAULTIX_SETUP_CODE`). `vaultix server install` generates it,
and both first-owner routes (`POST /api/v1/admin/signup` and `/bootstrap`) require it.
Creating the owner signs them in and initializes the instance; after that both routes
refuse every request, so the code is dead. `vaultix server status` shows the code only
while the running application still reports it as required.

Nothing else is reset by signing in. Encryption keys, the auth secret, database
passwords, the recovery key, passwords, MFA and recovery codes, machine tokens,
provider credentials and secret values never go into a chat.
[INSTALL-FOR-AI.md](../INSTALL-FOR-AI.md) has the full table.

An instance without a configured code (for example an older Compose install) keeps the
earlier behavior: the first visitor to reach it can create the owner. Set
`VAULTIX_SETUP_CODE` on any instance another person can reach.

## Evidence

- `scripts/test-setup-code.mjs` (stage `setup-code` of `build-self-hosted`): a packaged
  instance refuses signup and bootstrap without the code or with a wrong one and stays
  uninitialized; the right code creates and signs in the owner; afterwards the same
  code opens neither route and the config reports it as no longer required.
- `internal/platform` generates the code for fresh installs only (not `adopt` or
  `--env-file`), and reports it from `install` and `status` only while required.
