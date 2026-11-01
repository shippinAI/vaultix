# Delivery acceptance matrix

Companion to the [implementation specification](implementation.md) and
[parent delivery plan](../0075-usable-secrets-and-update-delivery.md).
Every case below is an obligation, **not a passing test result**. Stable case IDs
are referenced by the implementation task register. A case with several assertions
passes only when all assertions have evidence; split it into child cases if needed
without removing the parent obligation.

## Environments and independent oracles

- **Image:** exact packaged CLI and canonical standalone image on disposable real
  PostgreSQL/Dragonfly. Repeat cache-dependent behavior on Redis. Public requests
  enter the same frontdoor as users, not an unmounted handler or test-only issuer.
- **Boundary:** actual module/transport/OS boundary; fixtures are clearly labelled.
  These checks supplement image evidence, never replace it.
- **Client:** installed real AI client, recorded version/OS/transport. A simulated
  parent iframe or protocol script is not this environment.
- **Manual:** actual reviewer and AT/operator environment, with steps/findings and
  explicitly reviewed evidence. Programmatic DOM assertions are not screen-reader
  output or operator recovery acceptance.

The harness creates independent random secret canaries and fixtures. Target apps
compare a supplied value privately with an expected hash and output only success
or failure; they do not print values or hashes to model-visible output. Expected
permissions, versions, event counts and denial outcomes come from scenario data,
not the function under test. Capture only redacted metadata/screenshots of masked
states. Check both successful and rejected paths for canary/token leakage.

Keep an old accepted image/binary as a negative control for newly required behavior,
and use disposable source/artifact mutations for specific security guards. Preserve
failed runs. Never weaken a source constraint, baseline, timeout or assertion solely
because a test failed; investigate whether the implementation or fixture was wrong.

## Login and source actions

| Case | Environment | Independent expected outcome |
| --- | --- | --- |
| L01 | Image | Fresh CLI home, real built-in browser account and Nomen unavailable: plain login chooses selected instance, approval issues a dedicated session, protected projects succeeds, saved credential works after CLI restart. Empty authorized projects also succeeds. No client-secret/OAuth setup or token copy. |
| L02 | Image + boundary | Malformed/duplicate/oversized form fields, unsupported grant/profile and exhausted creation/IP/global capacity do not issue sessions. 429/backoff and 503 primary outage are distinct; after recovery a fresh legitimate request works. Two replicas share enforcement. |
| L03 | Image | Required MFA and root/selected-org method policy apply at approval and redemption. Account lock, factor removal or policy change between them prevents issuance; failed issuance leaves no usable session/event side effects. Built-in and permitted federated browser provenance are distinct. |
| L04 | Image | Two replicas race approval/poll/cancel/expiry. At most one usable session results, no consumed-code replay. Early polling yields pending/slow-down with increasing waits. Interrupted/uncertain redemption never causes automatic replay; fresh sign-in recovers. |
| L05 | Boundary + image | Discovery endpoint off-origin, redirect, malformed resource/base path or disabled profile fails without credential transmission or replacing old working settings. Explicit legacy token/machine/external flows retain behavior; no fallback after first-party denial. |
| L06 | Image/browser | Foreign origin, CSRF attempt, unscoped browser session, device token and assumed privilege cannot approve. No GET approves. Fragment/pending-state handling restores only fixed approval route; server logs contain no device/refresh/access code. |
| L07 | Image | Browser, machine and validated device actors receive equivalent authorized metadata and correctly bound session/actor/org identity. Direct/group/suborg/custom deny and tag/name/path rules match independent fixtures. Filtered empty pages retain correct nextOffset; no ciphertext, comment, value or custom metadata is selected/returned. |
| L08 | Image | Requests through public port reach selected Go owner, with identical accepted contract and one audit source. Go failure fails closed without TS fallback. Browser/device/workload/delegated profile confusion is rejected; client-supplied actor/proxy headers cannot grant authority. |
| L09 | Image/browser | No org, multiple orgs, pending invitation and enforced federation use existing organization flow; first owner establishes account/org without administering OAuth. Approval names the selected org and cannot reuse stale selection. Cancel/back/expired-code preserve safe navigation. |
| L10 | Image + OS | Concurrent CLI/MCP processes refresh once under credential lock. Crash before/after server rotation and during local save cannot replay a consumed refresh. Confirmed reuse revokes family; invalid forged generation does not revoke someone else's session. Fresh login recovers. |
| L11 | Image/client | Revocation, account deletion, membership/group/role/factor change affects next protected CLI/MCP action. Separate browser session remains independent. Online logout revokes dedicated session; unreachable revoke reports local-only logout honestly. Existing env-token override behavior persists. |
| L12 | Image + OS | Both native executable names and --api/domain compatibility work; forbidden vendor flag rejected. POSIX credential permissions and Windows actual Credential Manager pass independently. Config/storage failure preserves old credentials or leaves explicit recoverable state; no success printed before protected access/save. |

Native method fixtures are required for both identity families, but actual external
provider login, outage, refresh and issuer revocation need separate provider evidence.
Do not make unavailable Nomen registration a prerequisite for L01.

## Secret use and delivery

| Case | Environment | Independent expected outcome |
| --- | --- | --- |
| S01 | Image + OS | Identical project slug on two instances/tenants cannot reuse cache values. Cache identity binds instance/actor/org/project ID/env/path. Migration refuses ambiguous old caches and preserves original bytes until verified migration succeeds. |
| S02 | Image | After caching a valid scope, 401/403, missing/revoked scope, bad TLS or malformed server response prevents online process launch; no automatic stale-value fallback. Connectivity failure reports its distinct state and follows explicit policy. |
| S03 | Boundary + OS | Explicit offline use requires a valid prior scope record and bounded policy; invalid/expired/foreign cache denied. UI/CLI clearly reports offline authority limits. No claim of immediate server revocation while disconnected. |
| S04 | Image + actual child process | Real server secret reaches only the intended registered application's authorized delivery path. Child emits success without value; canary absent from MCP, AI transcript, parent logs, command args, generated configs and UI events. Human compatibility run tested separately from target-bound AI delivery. |
| S05 | Boundary + OS | Substituted executable, symlink/reparse swap, wrong peer/launch nonce, changed manifest or unauthorized target cannot redeem. Tests exercise actual platform handles/identity, not process-name allowlists. Scope of same-user/admin threat exclusions is explicit. |
| S06 | Image | Replay, expired delivery, cross-tenant redemption and revoked user/workload fail; transient store failure creates no reusable extra grant. Concurrent redemption admits only the intended single use, and recovery does not leak values. |
| S07 | Image | Existing create/edit/delete/version/restore/import behavior and approvals survive. Assert versions/conflict results and preserved ciphertext using independent expectations. Denied mutation changes no secret, version or approved request; concurrent writes do not silently overwrite. |
| S08 | Image/browser | Environment/folder/import precedence, pagination, empty/denied scopes and explicit conflicts remain understandable. Teaching/dialog completion does not mutate a secret or imply execution success. Restoration and subsequent target consumption are verified together. |

## Releases, installation and server recovery

| Case | Environment | Independent expected outcome |
| --- | --- | --- |
| U01 | Boundary | Independent Node/Go signature vectors agree. One-byte manifest/asset changes, missing/duplicate records, unknown schema/algorithm, malformed sizes/digests and conflicting alias hashes are rejected before installation. |
| U02 | Boundary | Untrusted key, unsigned key replacement, expired/replayed metadata and unsupported installer/schema range rejected. Authorized pinned-key rotation succeeds; downgrade requires explicit rollback with trusted artifact and compatible data plan. |
| U03 | Boundary + OS | Wrong platform/architecture, archive traversal, links outside destination, ambiguous binary names and unbounded decompression fail without altering install. Matching platform replaces both aliases with identical verified bytes. |
| U04 | Published assets + fresh consumer | Download staged candidate anonymously through bounded allowed redirects; verify exact source/version/hash/signature/image identity. Stable discovery ignores prerelease/draft/incomplete listing; after promotion it identifies the same accepted bytes. No Vaultix credential accompanies download. |
| U05 | OS | Interrupt download, verification, alias replacement and Windows running-file replacement. Relaunch yields either old verified installation or new verified pair, never mixed/unverified executable. Existing credential store remains intact. |
| U06 | Image | Upgrade an old populated instance using its original Compose identity/volumes/keys/env and persisted image selection. Current ciphertext, accounts and scopes remain usable; later restart selects the accepted image, not stale defaults. |
| U07 | Image | Concurrent upgrade lock, changed config after plan, full disk, failed migration, backend health failure and interrupted upgrade stop or resume predictably. No second empty store or unrelated container removal; failed protected smoke cannot mark accepted. |
| U08 | Image | Compatible prior binary rollback works against resulting schema/data. Incompatible path uses a separately rehearsed matching database/key restore, with measured recovery point and time. A health-only check cannot close recovery. |
| U09 | Image + owned server | After upgrade, use actual account login, CLI approval/project access, existing secret version and target consumption; revoke and confirm denial. Restart then repeat. Record target/hardware and artifact identity; preserve operator data. |
| U10 | Manual + fresh consumer | Operator reviews actual backup/cutover/recovery evidence and server result. Stable release promotion preserves bytes; installed older CLI/app show the true available release, and failed discovery never reports current. No untested platform/AI/cloud capability advertised. |

## Actual clients and accessibility

| Case | Environment | Independent expected outcome |
| --- | --- | --- |
| H01 | Image + client | Existing public tools and authenticated source actions preserve names/arguments/text/notification behavior. Real Codex session uses released CLI and protected reference actions. A fresh protocol/session handshake works without exposed credentials. |
| H02 | Image + rendering client | Host actually negotiates extension, retrieves pinned resource and renders native controls. Project selection, references, contextual tooltip and guide dialog work inside host; resource digest/CSP/network isolation enforced. Test fixture iframe remains separate evidence. |
| H03 | Client | Revocation, refresh, disconnect, session404/reinitialize, cancelled view and cross-org change remove stale references. Unsupported client retains useful text and clear limitation; no automatic replay of failed action. |
| H04 | Client | Codex subscription sign-in and own-provider setup tested independently with recorded versions. Hostile tool input cannot change actor, scope, approval or target or expose canaries. No subscription credentials collected by Vaultix. |
| A01 | Image/browser | Real login/approval/project/secret/update/MCP states pass keyboard order, visible labels, focus, submit errors, non-hover essential help and relevant axe checks. Missing labels or broken focus in isolated controls produce expected failures. |
| A02 | Browser + client + manual | Dialog open/close, nested guidance, Escape, error recovery and progress preserve/restore focus. NVDA and VoiceOver announce meaningful names/state/error/status without repeated secret-bearing narration. Record actual output/observations. |
| A03 | Browser + manual | 320px reflow, 200% text, 400% zoom, forced colors, text spacing, reduced motion and touch targets preserve content/actions. Native controls and charts have appropriate alternatives. No blanket claim from selected viewports. |
| A04 | Manual | Complete representative account/approval, project/secret use, update and MCP journeys on NVDA/Edge or Firefox plus VoiceOver/Safari. Findings include versions, role/state, expected/observed behavior and fixes/retests; unresolved applicable defects block that acceptance. |

## Enforcement and operations

| Case | Environment | Independent expected outcome |
| --- | --- | --- |
| G01 | Boundary | Parent requirements/checks cannot be silently weakened; source change, modified command or tampered artifact invalidates evidence. Missing/duplicate scenario, pending process, fixture labelled live or skipped outcome cannot pass the journey runner. |
| G02 | Boundary | Planning completion cannot finish product acceptance. An isolated mutation of critical approval/revocation/target/signature guard causes its named scenario to fail; unchanged control passes. Evidence records exact tested bytes. |
| G03 | Boundary + manual review | Existing journal evolves compatibly for explicitly reviewed evidence. Forged/unbound/stale/rejected reviews and post-review source changes cannot close a manual gate. A normal agent note or command receipt cannot impersonate acceptance. |
| G04 | Published release review | Every advertised journey/platform has matching source/artifact/scenario and required manual receipts. Parent still shows external provider, broader parity, cloud/DevSCIF gaps; no release checklist can erase them. |
| G05 | Source + boundary + canonical build | Current main compiles; branding tests accept actual Vaultix help and still reject retired public-brand tokens. Changed package aliases/checksums resolve to deliberately verified dependencies with truthful third-party provenance. Stale file reviews are explicitly reconciled after complete reads. Preserve the observed 85361217 compile/contradictory-assertion failures and prove targeted fixes; old-image success cannot attest new dependency bytes. |
| O01 | Image + recorded hardware | Predeclared old/new workload comparison measures latency, failures, memory and tenant fairness with fixed data/load. Login bursts and metadata pagination stay within bounded resources; thresholds cannot be selected after results. |
| O02 | Image | One-connection pool, database/cache outage, cancelled acquisition, multiple replicas and process shutdown do not deadlock/leak connections or duplicate session/audit work. Recovery resumes durable work; uncertain notifications remain uncertain. |
| O03 | Owned server + manual | Operators can observe auth/worker/upgrade health and safe failure categories without values, tokens or recipient leakage. Backup, restore, restart, key custody and notification-repair limits are documented; no blind replay of uncertain external side effects. |

## Receipt and promotion procedure

Record a case's plan/check ID, exact source snapshot, old/new image and CLI hashes,
OS/client/AT/runtime versions, fixture scope, actual steps, assertions, timestamps,
redacted artifact hashes and residual limitations. The active journal schema owns
record formats. Long build receipts must prove terminal completion and digest
binding before a short verification command references them.

The permanent acceptance entry point must expose which cases ran and reject
missing obligations. Until it exists and these cases run, they remain planned.
Never mark all cases green from the existing 16 canonical gates or 146 CLI tests.

For promotion: review scope and immutable source; run relevant unit/boundary
checks; run canonical artifact and complete journey against it; challenge key
guards independently; accept actual client/AT/server evidence; stage/download and
verify the release; rehearse upgrade/recovery; promote identical bytes; verify
fresh stable discovery and installation. Save the failure and next corrective task
at every unsuccessful gate. Preserve prior accepted artifacts and operator edits.
