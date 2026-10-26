# Hosted dependency triage

This tracks backend production packages for the hosted-first release. Audit
counts are affected package entries, not unique vulnerabilities. An image that
passes functional tests is not automatically approved for hosted production.

## Compatible update pass, 2026-10-26

Starting from commit `ad9d1b1`, targeted updates within the existing supported
version ranges address Fastify, Axios, database/network clients, XML parsing,
URI parsing, redirects, multipart handling, and other affected dependencies.
`@fastify/static` moves to 10.1.7, whose published compatibility table supports
Fastify 5. Its nested copy under the Swagger UI uses that same version. The
brace-expansion override targets only version 2 so consumers of other major
versions keep their existing API.

The audit changes from **72 entries (36 high, 31 moderate, 5 low)** to
**44 entries (10 high, 29 moderate, 5 low)**. Neither set contains a critical
finding after the earlier critical-fix pass. The remaining findings are open
release work; they have not been accepted as safe or suppressed.

Reproduce from `core/backend`:

```sh
npx --yes npm@10.9.0 ci --ignore-scripts --no-audit --no-fund
npm audit --omit=dev --json
```

Use the standalone Dockerfile and test runners in [0018](0018-hosted-capability-proof.md)
to install native modules and verify the actual Linux runtime. The local
`--ignore-scripts` install alone cannot run tests that require native RE2.

## Remaining high-severity groups

| Group | Affected package entries | Required work |
| --- | --- | --- |
| Certificate signature validation | node-forge, acme-client | Address the RSA PKCS#1 signature-verification advisory with a fixed dependency or an independently tested replacement. The audit's suggested ACME downgrade is not an approved fix. Verify malformed signatures and certificate/ACME workflows before closing. |
| Inherited schema validation | zod, botbuilder, botbuilder-core, botframework-connector, botframework-schema | Migrate existing consumers and schema conversion deliberately. A global Zod 4 override would change inherited APIs. Test oversized collections, JSON schema/OpenAPI generation and Teams workflows. New native Vaultix code continues to use bounded explicit validation. |
| SMTP | nodemailer | Evaluate the fixed 10.x release and verify message parsing, recipient handling, attachment access restrictions and transport isolation. Exercise actual delivery against an isolated SMTP fixture before provider acceptance. |
| Snowflake | snowflake-sdk, toml | Migrate the SDK to its fixed supported release; verify authentication, connection lifecycle, redacted logging and the dynamic-secret/rotation workflows against a disposable provider account. |

The audit report also contains 29 moderate and 5 low package entries. These
need review alongside the high-severity groups; this document is not a waiver.
Keep raw audit reports as CI artifacts. Do not downgrade providers or globally
override incompatible major versions merely to obtain a smaller audit count.

## Evidence boundary

Verified after this update: 1,838 unit tests passed (22 skipped); all 156
database tests passed on each of Dragonfly and Redis; type checking, lint,
browser checks and both standalone image smoke/restart runs passed. The image
checks include direct navigation to `/login` after the static-file plugin
update. The verified image ID is recorded in 0018.

Backend type checking, lint, the complete unit suite, both PostgreSQL/cache
runs and the rebuilt standalone image must pass for this update. Browser
checks use the real catalog and built UI with fixture authentication/action
responses. External provider acceptance and Nomen integration remain distinct
release gates. Record their status in 0018 rather than inferring it from the
dependency or entitlement tests.
