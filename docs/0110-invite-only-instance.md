# Invite-only instance access

Accepted direction, 2026-11-02. This defines what closed signup means on one
Vaultix instance, so an operator can share that instance with invited users. It
does not satisfy CLOUD-01 in [0054](0054-public-cloud-service.md) or add public
enrollment. Early-access requests are in [0112](0112-early-access-requests.md). The
inherited TypeScript auth service remains the active writer; this is not a native
identity migration.

## Behavior

Closed signup means `allowSignUp` is false. Self-hosted first-owner setup already
sets this ([0050](0050-organization-first-setup.md)). On a closed instance:

- **Invited users can still join.** The invite link verifies the user and account
  completion adds no second organization.
- **Only instance administrators create organizations.** `POST /api/v2/organizations`
  and account completion deny everyone else with a plain invite-only error. The
  administrator console keeps its existing creation path. Open signup is unchanged.
- **A user with no organization gets an explanation.** The application shows the
  invite-only state and a sign-out action after one denied request, instead of a
  create form that cannot succeed.
- **`/api/status` reports `inviteOnlySignup: true`.** It previously reported the
  opposite value.

## Mail without SMTP

Outside development, unconfigured mail is not sent and its log entry holds only
the template name and recipient count. Bodies carry invite links and reset tokens,
and some subject lines carry confirmation codes, so neither is logged.

Invitations still work without SMTP because the inviter receives a link to share.
Password reset and emailed confirmation codes do not: an instance serving people
needs SMTP for account recovery. Local development keeps full terminal output.

## Telemetry

Telemetry is off unless the operator sets `TELEMETRY_ENABLED=true` and their own
`POSTHOG_PROJECT_API_KEY`. No analytics key is built in or served to browsers. The
update check still reads this project's own releases and has its own setting.

## Verification

The canonical image test `scripts/test-tenant-isolation.mjs` follows a real invite
without SMTP: link, verification and account completion. It confirms the mail log
entry exists without the invite token, invitee organization creation is denied,
the administrator can still create one, and browsers receive no analytics key.
`scripts/test-invite-only-access.mjs` opens a real invite link in a browser and
confirms the user lands in the inviting organization without creating one. It then
signs in as that user after removal and checks the explanation, accessibility scan
and keyboard sign-out.

## Remaining limits

- No invite codes exist. Requests to join are reviewed by an administrator
  ([0112](0112-early-access-requests.md)).
- CLOUD-01 stays open: real issuer and session acceptance, enrollment abuse controls
  and recovery are not established here.
- The onboarding organization step shows the same denial as an error message; it is
  reached only by a user with no organization who opens that page directly.
- Members of existing closed instances lose self-service organization creation.
  An administrator creates organizations for them, or the operator reopens signup.
