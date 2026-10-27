# Accessibility acceptance for the whole Vaultix UI

Accepted direction, 2026-10-26. Applies to Vaultix.cloud, self-hosted Vaultix and
the DevSCIF.com suite, including existing authenticated and enterprise screens.
Flat vector styling must support clear hierarchy, readable controls and visible
interaction states. Rebranding alone does not satisfy this requirement.

## Standard and scope

Target [WCAG 2.2 Level AA](https://www.w3.org/TR/WCAG22/), the W3C Recommendation
checked on 2026-10-26. [WCAG 3.0](https://www.w3.org/TR/wcag-3.0/) remains a Working
Draft; track its development without claiming conformance to an unfinished standard.

Review every route and reachable state, including dialogs, tables, menus,
notifications, provisioning, approvals, certificate/key workflows and settings.
Use `core/frontend/src/routes.ts`, page route modules and their callers to enumerate
flows; generated route discovery does not count as review. Track file review in
[0021](0021-product-authorship-review.md) and workflow evidence in
[0018](0018-hosted-capability-proof.md).

## Required acceptance

| Area | Required checks |
| --- | --- |
| Keyboard | All actions reachable; logical focus order; skip navigation works; no traps; menus/dialogs close and restore focus; dynamic view changes establish a useful focus position. |
| Semantics | Meaningful landmarks/headings; programmatic labels/descriptions; visible text included in accessible names; state and validation announcements; correct native control behavior. |
| Visibility | Text contrast 4.5:1 (3:1 for qualifying large text); relevant control boundaries/state indicators 3:1; visible focus not hidden by sticky content; information conveyed beyond color. |
| Scale | 200% text resizing, 400% browser zoom and 320 CSS-pixel reflow without lost actions/content; document legitimate two-dimensional content exceptions. |
| Input | WCAG 2.2 AA target size/spacing (24 CSS pixels, subject to its exceptions); prefer 44-pixel touch controls; alternatives to dragging; no redundant entry; paste/password-manager support. |
| Authentication | Accessible authentication and recovery through Nomen; labels and helpful errors; no cognitive puzzles without an accessible alternative; no separate Vaultix identity session. |
| Feedback | Loading, empty, denied, success and failure states; recovery preserves useful input; progress and clipboard feedback announced without repeated or secret-bearing narration. |
| Preferences | Reduced motion, forced colors/high contrast, text spacing, touch and screen magnification; no motion-only or hover-only essential information. |
| Assistive technology | Real NVDA with Edge/Firefox and VoiceOver with Safari on complete representative workflows, recording versions, steps, output and defects. DOM/axe checks are not a substitute. |

These are acceptance categories; the complete applicable WCAG criteria still apply.
Do not use this abbreviated checklist as a blanket conformance statement.

## Automated evidence

`scripts/test-native-ui.mjs` runs the built UI against the real authored catalog,
with fixture authentication and action responses. It records screenshots and
`accessibility.json` in `.cache/ui-proof-*`. The report includes axe engine version,
each scanned state, violations and incomplete results requiring manual review.
CI retains it on success or failure and fails for any detected violation in the
selected WCAG A/AA rules. No axe exclusions or rule suppressions are configured.

The initial scan reproduced a visible/accessible name mismatch in the wordmark
and reference copy controls, plus default v3 field-label contrast of 4.18:1 on the
reference form. Fixes move the tagline outside the home link, align copy labels,
and use the brighter semantic muted label color. Native view changes focus their
heading; skip navigation focuses main; AI radios expose descriptions; connection
copy reports success and its horizontal scroll region accepts keyboard focus.
The narrowly documented JSX lint exception on that region enables keyboard
scrolling; it does not disable an axe rule.

The sign-in review also replaces its gradient title with a semantic heading and
adds persistent labels to the email/password inputs. Autocomplete remains enabled;
keyboard checks exercise password visibility without submitting credentials.
This resolved the initial automated contrast result that required manual review
because the title used a gradient. It does not establish real Nomen authentication.

Configured social/SSO options exposed a second shared contrast failure: the
separator text used reduced opacity (4.05:1). It now uses the full muted color.
Permanent checks include email-only and federated sign-in layouts, keyboard
expansion of SSO choices and focus transfer to the first revealed option.

The automated scope is workspace, AI connection choices, reference denied/loaded
states and sign-in layout at desktop/mobile sizes, plus 320-pixel reflow checks.
Keyboard assertions cover skip activation, changed-view focus and native radio
arrow selection. Real authentication, all authenticated routes, browser zoom,
forced colors, text spacing, touch and real screen-reader acceptance remain open.
Zero automated violations means only that the scanned states passed those rules.

For each remaining flow record route, role/permissions, state, viewport/browser,
keyboard/AT steps, findings, fix and retest evidence. Shared-component fixes must
be checked in their consuming workflows before marking those workflows complete.
