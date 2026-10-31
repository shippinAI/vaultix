# Device security-event preparation

Current continuation: [domain dispatch](device-event-dispatch.md) is implemented
and under canonical verification. Background registration and public login remain
open. Earlier checkpoint evidence below retains its original scope.

This implements the recipient and preparation stages of
[device event delivery](device-event-delivery.md). It does not register the
dispatcher or activate public device authorization. Built-in Vaultix identity
and optional federation remain the shared-account product contract in
[0074](../0074-built-in-and-federated-identity.md).

## Source and recipients

`device-event-source.ts` validates the existing captured source. Unknown fields,
versions, mismatched tenant/subject identifiers and absent historical context
remain unresolved. Only the selected profile, organization, session-origin and
authentication-provenance fields enter prepared payloads. First/last names are
not needed by these notices and are not copied. This allowlist is not a detector
for arbitrary sensitive text embedded in a permitted profile field.

Session-origin IP, user agent and creation time stay under `sessionOrigin` in
audit metadata. They are never presented as the current request's IP or user
agent. The affected subject is explicit. Only issuance and successful rotation
are attributed to the authenticated subject; reuse, policy denial and revocation
use an unknown actor. Canonical deletion remains explicitly unattributed.

`device-event-recipient-dal.ts` resolves at most forty administrators per keyset
page on the primary database. Its organization/root binding, direct membership
denial, group ownership, pending membership and temporary-role checks govern
security-notice recipients; this does not change authentication permissions.
Sub-organization administrators require accepted active direct root membership.
Root organization group-only administrators remain supported. A user who is an
administrator in both scopes is routed once to the selected organization.

SSO-bypass administrators exclude the affected subject, who receives the separate
account notice. An accepted administrator without email still receives an in-app
notice. The resolver also supports a current eligibility/address recheck in a
caller-supplied transaction without acquiring a second connection. The dispatcher
must use that operation before delivery; it is not wired yet.

Pages reflect current primary policy when selected. They are not a historical,
organization-wide membership snapshot. Bounded results and a five-second query
timeout do not establish production capacity or query cost at large tenant sizes.

## Immutable preparation

`device-event-preparation.ts` prepares the first page's audit entry and subject
notices, plus up to forty other administrators when an issued session used SSO
bypass. The first page contains at most 83 deliveries; subsequent pages contain
at most 80. Existing fenced `preparePage` storage commits each page atomically,
and delivery cannot begin before all pages are prepared.

Each delivery saves its complete audit entry, notification content or rendered
email. Preparation uses the existing SMTP templates and prepared-mail contract.
Already-committed pages are never rendered again. A later page can reflect a
newer mail configuration, but it cannot change earlier content or recipients.
Subject email comes from the captured source, rather than a newer profile.
The dispatcher must compare saved and current addresses and must not reroute
delayed mail when an account's address changes.

The first page freezes audit expiry from the existing feature service's retention
(currently 365 days), notification delivery expiry at 90 days and email delivery
expiry at seven days after the event. These are delivery deadlines, not evidence
of delivery or permission to delete unresolved work. Existing settled-record
retention rules remain unchanged. SMTP disabled at preparation is explicit;
missing or unsupported email is not applicable. Neither prevents preparation of
the account's notification and audit.

Five separate audit actions describe issuance, rotation, reuse, revocation and
policy denial. They are present in backend types and the frontend search catalog.
The unknown-actor explanation no longer incorrectly equates unknown attribution
with an unauthenticated operation. This catalog work does not establish whole-page
accessibility or a complete guided audit experience.

## Verification and remaining activation gates

`scripts/verify-device-event-preparation.mjs IMAGE BACKEND_TEST_IMAGE` creates an
isolated PostgreSQL/cache/application stack, migrates it using the supplied
canonical image, runs real recipient/preparation cases with a one-connection
primary client and real mail rendering, then restarts the existing application.
It does not connect to the operator's database or send mail to real recipients.
Receipts identify local source hashes and both image identities. Copied test
source is not automatically proof that the supplied image packages that source;
release checks must compare it with the exact committed image archive.

The remaining worker must validate persisted destination payloads, recheck
recipient eligibility and email, dispatch through the existing destination owners,
coordinate aborts with leases and shutdown, register under worker profiles,
expose operational status/authorized repair and exercise bounded retention.
Restart, cache-loss, concurrency and complete image behavior remain activation
gates. Public HTTP, approval UI, token consumers and the CLI default remain open.

The original full lifecycle and delivery checks remain required. This preparation
packet is not a claim of delivered security events, live federation, public-cloud
readiness, complete migration or enterprise parity.

### Local preparation evidence

All 21 real PostgreSQL/renderer scenarios passed, followed by application restart.
Full backend/frontend type checking and changed-file lint passed. Initial fixture
typing and Windows line-ending lint failures were corrected without suppressing
rules. Receipts: `.cache/device-preparation-store-kERB9A/result.json`, `.cache/device-worker-typecheck.json`,
`.cache/device-worker-lint-fix.json` and `.cache/device-preparation-ui.json`.
Canonical image acceptance is recorded separately below.

### Canonical artifact evidence

Runtime source `9e1550035d6b3d97a888139c34004cb25ff4916b` produced
`sha256:5413f5df97941f68899ea42e9e53ad8bde1166b79bd2e5afec9aec1608ad8e96`. All sixteen canonical image gates passed.
The image passed four native audit checks. Its migrated disposable stores passed
all 21 recipient/preparation scenarios and all 16 existing destination scenarios,
including real SMTP cancellation/TLS, notification persistence and audit retries.
Tested source bytes were compared with the committed image archive.

Receipts: `.cache/self-hosted-build-oxUSXp/result.json`,
`.cache/device-preparation-store-8qDMtm/result.json`, `.cache/delivery-destination-store-cBw35P/result.json` and
`.cache/native-audit-image-l4eoGR/result.json`. Previous exact-content-bound Go/session and SMTP unit/mutation
evidence is retained as prior evidence, not described as newly executed.
The dispatcher and public headless login remain unimplemented.
