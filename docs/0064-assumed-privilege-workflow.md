# Assumed-privilege workflow

AUTH-01 / native React workflow. Scoped workflow accepted; full migration remains open.

## Work packet

Read the modal, banner, mutation hooks, v3 field/dialog/button primitives and
stories, current TypeScript grant service/router/injection plugin, and native
0063 prerequisite. Trace the identity/member entry points and full-page reload.
The application retains the existing encrypted store, API routes, permission
checks and audit owner. This is not a native HTTP cutover or Nomen acceptance.

- Associate the confirmation field, explain project scope and real action effects,
  prevent repeated keyboard submissions, and announce pending/recovery states.
- Keep a full-page reload after an authority change: it discards permission-bound
  query state. Do not replace it with a partial cache invalidation.
- Bound switch/exit requests; a lost or failed response does not prove the cookie
  stayed unchanged. Offer a reload to reconcile authority before retrying.
- Keep actor context and an explicit exit action usable at narrow widths. Test
  keyboard focus, long names, reduced motion and scoped automated accessibility.
- Make authenticated exit idempotent when the grant is absent/invalid. Clear the
  same /api cookie path as issuance. A valid grant for another project must not
  generate a false exit audit or clear that grant.
- Preserve valid-grant exit audit and real authorization. No audit event is
  fabricated for an absent/invalid grant. No new schema, credential or AI action.
- Characterize the old image, test real issuance/exit and denied/invalid cases,
  label held/error fixtures, build the canonical committed image and run packaged
  regression gates before merging and updating the local preview.

## Remaining boundaries

The shared hasProjectRole callback captures initial memberships; its consumers
across PKI, approvals and settings require a separate complete refresh review.
Nested assumption, delegated OAuth, Nomen, native API/audit ownership, external
providers, manual assistive technology and full public-cloud acceptance stay open.
No new catalog lesson is claimed: essential instructions belong in this workflow;
future teaching must use the existing validated catalog rather than UI-only events.

## Baseline characterization

Canonical source 8a0ec825, image
`sha256:6254154ac8021ab382e6598fd41f1efcacd219bc94c9fd052f3e853e650a28a5`:
real owner/project/identity creation and sign-in, followed by a held 503 fixture,
reproduce an unassociated input label and two POSTs from repeated Enter presses.
Authenticated exit without a grant returns 400. A malformed HttpOnly cookie set
explicitly at /api remains after real middleware rejection and page reload.
Receipt: `.cache/assumed-workflow/.cache/characterization.json` (local/ignored).
The initial harness needed to finish instance onboarding before opening the
identity page. A cookie fixture using URL-only defaults exercised the wrong path;
the corrected explicit-path run above is the relevant deletion baseline.

## Authored behavior and development evidence

The modal retains typed confirmation, guards the in-flight request synchronously,
announces status and keeps dismissal unavailable during the bounded request. It
restores focus through the originating menu's ARIA relationship to its persistent
trigger, since menu items unmount on selection. Labels stay at full contrast while
read-only. Both switch and exit use a 30-second transport timeout. On failure,
the UI requires a reload to reconcile the actual cookie/permission state before
another attempt; failure does not imply cancellation or rollback. Existing global
error notifications remain single, and all successful changes still fully reload.

The banner wraps long actor context, names the exit action and warns that actions
affect real resources. Authenticated exit with an absent or rejected grant clears
the /api cookie and succeeds without fabricating a target audit. A valid grant
for another project is refused before clearing/auditing. Valid exit records the
verified grant project; audit failure remains a failure response, which the UI
reconciles. Authorization and encrypted persistence remain unchanged.

Development proof mounts the rebuilt frontend plus the two compiled backend
modules read-only into the baseline image above. It is not a committed-image
receipt. The run passes in `.cache/assumed-workflow/.cache/development-workflow.json`;
its detailed checks and five scoped axe states are in
`.cache/assumed-workflow/.cache/assumed-privilege-workflow.json`. All five scans
have zero detected violations. Two desktop scans retain an incomplete contrast
finding caused by overlap; no rule is suppressed. Narrow/reduced-motion, active
banner and exit-recovery scans have no incomplete findings. Screenshots are
`assumed-confirmation-narrow.png` and `assumed-banner-narrow.png` in that directory.
This is not full dashboard reflow or manual screen-reader acceptance.

Six Fastify route/cookie unit cases pass in
`.cache/assumed-workflow/.cache/route-unit.json`, with stubbed auth/authority/audit
and the real router and cookie plugin. Frontend/backend type checks and scoped
lint pass. Development UI/backend builds pass with existing bundle warnings.
Real browser proofs include an API-created invited member target; no invitation
is delivered (disposable SMTP is absent), and no second-user sign-in is claimed.
Both successful responses and 503 responses after real server-side cookie changes
are exercised. HTTP /api cookie removal is proved; HTTPS transport and all
multi-product/group/table entry paths remain separate acceptance work.

Canonical committed-image verification is recorded below.


## Canonical image acceptance, 2026-10-29

Runtime/build source: `4379096142d4d61135902fef59f38884448d020c`.
Image: `sha256:b228ed4142c08edeb00408ae77622a191ef5aa4baf5253ac64b90c8f1b6bc3a1`.

- All 16 application/image gates pass:
  `.cache/assumed-workflow/.cache/self-hosted-build-Zkll40/result.json`.
- The complete real packaged browser suite, including the new six-group privilege
  workflow, passes in
  `.cache/assumed-workflow/.cache/app-image-proof-C4p4dE/workflow-result.json` and
  its `assumed-privilege-workflow.json`. Five scoped axe states have zero detected
  violations; the two desktop contrast incomplete findings remain explicit.
  Keyboard confirmation, focus return, 320-pixel layout, reduced motion, one
  pending POST, real identity/member grants, HTTP cookie cleanup, normal exit and
  reload reconciliation after committed operations with injected 503s are covered.
- Six focused Fastify route tests pass on the committed source:
  `.cache/assumed-workflow/.cache/route-unit.json`. These stub authority/audit and
  do not substitute for the real packaged browser/HTTP checks.
- Native/application grant interoperability passes 45 entries per cache, with
  zero failures, skips or setup diagnostics:
  `.cache/assumed-workflow/.cache/native-interop.json`. Go source is unchanged
  from `8a0ec825417efa7464be09323f74467d4f564906`; the exact previously built
  stage is `sha256:4495c4b5662fac6c2f3c7ea561369d8d4716469d3f9832f8801a8042c9c5f2c2`.
  These are targeted grant tests against the new image, not a new full-provider
  integration acceptance. The broader 0063 results keep their original scope.
- encrypted-recovery: 9 checks pass with successful cleanup:
  `.cache/assumed-workflow/.cache/encrypted-recovery-NWRnFa/result.json`.
- production-admission (redis): 4 checks pass with successful cleanup:
  `.cache/assumed-workflow/.cache/production-admission-lnwt9s/result.json`.
- production-admission (dragonfly): 4 checks pass with successful cleanup:
  `.cache/assumed-workflow/.cache/production-admission-WonsZc/result.json`.
- proxy-boundary: 4 checks pass with successful cleanup:
  `.cache/assumed-workflow/.cache/proxy-boundary-CcyZNC/result.json`.
- tenant-isolation: 11 checks pass with successful cleanup:
  `.cache/assumed-workflow/.cache/tenant-isolation-rcmmOJ/result.json`.

The baseline still contains 273 UI routes and 2,290 API operations. No production
Go forwarding, Nomen transition, new store or provider configuration is enabled.
The earlier Redis bootstrap timeout from 0061 remains an unresolved reliability
finding; this passing run does not diagnose it. HTTPS cookie transport, all other
product/group/table entry paths, real assistive technology, durable audit failure
recovery, native API ownership, provider acceptance and public-cloud capacity
remain separate gates. This packet does not establish whole-UI accessibility,
enterprise/government certification or full capability parity.

Reproduce the packaged checks with `node scripts/build-self-hosted.mjs` and the
focused route tests with the backend unit command targeting
`src/ee/routes/v1/assume-privilege-router.test.ts`. For native interoperability, run
`go test -race -tags integration -run '^TestAssumedAuthority_' ./tests/platform/permission`
in the verified Go stage against the canonical image, once for each cache.
