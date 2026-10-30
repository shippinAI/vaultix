# DevSCIF services and the Vaultix governance experience

Direction checkpoint, 2026-10-30. The owner asks for faithful product evolution:
useful tooltips, notifications and popup dialogs, with DevSCIF functionality and
services inside the existing application. This advances [0049](0049-capability-product-plan.md)
and [0069](0069-execution-goal.md); it does not replace their dependency gates.
AUTH-03/04 remain the native identity and source-action implementation queue.

## Product commitment

Vaultix.cloud and DevSCIF.com share the engine, encrypted store, authorization
and included software capabilities. DevSCIF adds controlled deployment profiles
and an operator experience built from real services. A renamed screen, a readiness
score or a feature gallery cannot establish those services or their acceptance.

Keep the current authentication and project application as the entry. Group work
by user intent and retain organization/project/environment context. Introduce
DevSCIF navigation only with usable workflows and permission-aware destinations.
The optional choice between governance, AI operations and deployment as the first
workspace emphasis remains open; governance is the working recommendation because
the application already has access, policy and audit services to author in place.

| Service area | Existing foundation to review and author | Required next behavior and evidence |
| --- | --- | --- |
| Identity and access safeguards | Organization MFA, session length, roles, members, groups, machine identities, SSO | Guided changes with consequences and recovery; actual permission denial, factor enrollment/sign-in and revocation; Nomen mapping from AUTH-03/04 |
| Approval and controlled execution | Existing secret/access/certificate approval workflows | Named actor and scope, proposed change, decision and execution receipt; expired/revoked authority, conflicts, duplicate delivery and rollback |
| Evidence and investigation | Existing audit logs, streams and service events | Follow an actual change to its durable audit record; filters, export/stream failure recovery, retention and tenant separation; no sensitive values in teaching/events |
| AI operations | Clyffy, the shared source-action/MCP catalog, protected local sign-in and secret references | Explicit proposal/approval/execute/observe states; no values in model processes; broker target, scope, expiry, replay and revocation proof |
| Deployment and resilience | Owned builds, cache alternatives, encrypted backup/restore and cloud gates | Measured isolation, egress, custody, recovery, upgrades and operational limits for a selected deployment profile |
| Hardware and regulated profiles | KMS/HSM/KMIP, PKI and PAM capabilities | Explicit hardware/provider/control profile and accepted evidence; never infer certification or government readiness from the UI |

For every workflow, ship the following together:

- Persistent instructions for essential decisions; short, focusable contextual help
  for unfamiliar terms. Touch users get the same information without hovering.
- Review dialogs for consequential changes with explicit scope, before/after
  values, useful cancellation and keyboard focus return. Routine navigation does
  not require dismissing a modal.
- Service-backed pending/success/failure feedback. Notifications identify the
  action and resource, preserve safe drafts and never echo secret values. A lesson
  finishing is not an operation succeeding.
- Actual loading, empty, denied, stale, failed and recovery states. No decorative
  counters or assumed healthy status. Display unverified provider/profile gates
  separately from live service state.
- Lightweight vector controls, semantic surfaces and restrained depth; optional
  media loads on demand. Reduced motion preserves meaning. Verify real workflows
  at narrow widths and by keyboard, then track manual assistive-technology review.

Catalog-backed teaching and A2UI events remain governed by [0024](0024-interaction-and-teaching-system.md).
New UI copy does not establish a new action protocol, durable audit event or remote
agent driver. Existing services retain authority until complete native use cases
replace them under the migration gates.

## First authored control: organization MFA

The existing `OrgGenericAuthSection.tsx` applied toggles and method selections
immediately. It gated the toggle using `edit:sso`, left the method selector
without that gate and retained a paid-upgrade modal. The actual organization
update service requires `edit:settings`. The enclosing Security tab still requires
`read:sso`. Vaultix's included feature service supplies software availability;
permissions and SMTP prerequisites are independent.

The revised control retains the existing route, API, methods and store:

1. Show the saved required/optional state and configured method, separately from
   proposed changes. Explain personal versus organization MFA and each method.
2. Associate the switch and selector with visible labels and descriptions. Make
   supplemental help keyboard/touch reachable and hoverable.
3. Keep editing local until Review MFA Change and Apply MFA Change. Show the
   organization and old/new settings; closing the review keeps the draft. Reset
   explicitly discards it. Switching organizations remounts the draft boundary.
4. Disable editing according to the server's `edit:settings` requirement. Send
   only changed fields: sending `enforceMfa` unnecessarily would invoke the
   server's SMTP prerequisite even for a method-only edit.
5. Allow a pending review to close without implying cancellation of its request.
   Prevent duplicate submissions. Show success only after the service response.
   Preserve failed drafts; the existing global mutation handler reports the error
   once. An ambiguous connection failure requires checking saved state.
6. Refuse a draft when a refreshed server state differs from its original values.
   This is an observed-staleness guard, not compare-and-swap concurrency control:
   the existing API has no policy revision precondition. Atomic policy editing
   remains a service-level requirement for the broader governance work.

This packet does not change MFA backend enforcement, factor enrollment, token
revocation or Nomen sessions. No new database, security certification or separate
DevSCIF service is claimed. Session-length and other security controls retain their
existing workflows and need their own full review.

## Verification contract

Test the packaged application against disposable data: edit/cancel without writes,
actual method persistence and reload, actual missing-SMTP rejection, unauthorized
API access, and separately labelled injected outage, pending and read-only states.
Verify one request per confirmation, retained drafts, one error notification,
named controls, keyboard focus, tooltip dismissal/hover, 320px reflow, reduced
motion and selected axe rules. Keep the existing image, application, isolation and
recovery gates; never lower the surface baseline.

The interaction design follows the W3C [modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/),
[status message guidance](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html)
and [hover/focus guidance](https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html),
checked 2026-10-30. Automated findings are scoped to exercised states. Real
screen-reader acceptance, live SMTP/factor enrollment, other governance workflows,
provider profiles and complete DevSCIF acceptance remain open.
