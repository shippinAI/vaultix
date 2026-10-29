# Assumed-privilege workflow

AUTH-01 / native React workflow. Implementation and acceptance in progress.

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

Canonical committed-image verification remains pending.
