# Native device access in resource consumers

This increment connects the native device-session owner to the existing Go API
authenticator and resource routes. It is under canonical image verification.
Both built-in Vaultix accounts and permitted federated methods use the same
account, session, tenant and permission owners. Method fixtures do not prove a
live external provider login.

## Authority and compatibility

Device access has its own `vaultix-device-access-v1` authentication mode. The
unsigned JWT media type selects a validator; it never grants authority. The
validator checks the dedicated signature, instance audience, expiry, canonical
device session and current primary account/organization/factor policy. Failure
does not fall back to browser-token validation. Actor profile hydration uses the
same transaction and database connection as those checks.

Resource routes must explicitly allow `DeviceAccessAuth`. Existing native v3/v4
secrets routes do so, while their original action permissions remain authoritative.
The reserved native project-creation endpoint still returns 501 and receives no
new device admission; the existing public project workflow remains TypeScript-owned.
Device credentials remain rejected by browser-only
account linking and device approval. Browser assumed-privilege cookies cannot
change a device actor. Browser, delegated OAuth, workload and service-token
profiles retain their own validators and route admission.

`VAULTIX_DEVICE_ACCESS_ENABLED` defaults to false. This temporary migration gate
does not enable public issuance, advertise a login profile or impose a feature
entitlement. `VAULTIX_DEVICE_ACCESS_TTL_SECONDS` defaults to 900 and accepts integer
seconds from 1 through 86400; malformed configuration fails startup. Enabled
instances require the same canonical `SITE_URL`, signing secret and lifetime as
the device issuer. The local preview keeps this gate disabled pending full flow
acceptance.

Invalid or revoked credentials produce a plain 401 error. Unavailable primary
authority produces a plain 503 error with no token or database diagnostics.
Validation uses one primary connection and bounded cancellation. Its account-row
locking is conservative; this is not evidence of measured cloud capacity.

## Verification boundaries

`device_api_consumer_test.go` exercises the real middleware, session owner and
PostgreSQL authority with one connection. Cases include built-in/OIDC/SAML method
provenance, changed actor profile, tenant mismatch, credential separation, current
account/membership/MFA/SSO/session restrictions, cancellation and concurrency.
The original session cases remain unchanged. Existing browser/workload/delegated
credential tests remain acceptance obligations.

`scripts/prove-device-api-image.mjs` runs the actual packaged native resource API
on disposable PostgreSQL and Dragonfly. A test-only Go fixture validates a real
built-in browser session, starts and approves a grant, waits for polling, and
redeems it through the real session owner. This fixture is not a public endpoint;
its credentials remain in harness memory. Image checks cover real native resource
access, tenant and account changes, primary outage/recovery, restart, the disabled
gate and canonical session deletion with an independent browser session.

The existing public TypeScript resource routes, native metadata/reference router,
MCP, discovery, accessible browser approval and `vaultixl login` integration remain
unfinished. The native v3/v4 secrets compatibility APIs are not the reference-only
AI catalog. No secrets-value delivery or metadata-only claim is inferred from
these authentication tests. Full event provenance, authorized operational repair,
provider-specific live acceptance and complete identity parity remain separate
obligations in [0074](../0074-built-in-and-federated-identity.md).
