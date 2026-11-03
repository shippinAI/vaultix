# Early-access requests

Accepted direction, 2026-11-02. People can ask to join an invite-only instance from
the public landing page, and an instance administrator reviews those requests in the
admin console. This builds on [0110](0110-invite-only-instance.md). It is not public
enrollment and does not satisfy CLOUD-01 in [0054](0054-public-cloud-service.md):
nobody gets an account by asking.

## Behavior

The administrator turns the form on at `/admin/early-access`. It is off by default,
because a self-hosted instance should not start collecting contact details from the
internet unless its operator chose to. While it is off, the landing page has no form
and `POST /api/v1/early-access/requests` is refused.

While it is on, the landing page shows the form. It asks for an email address and,
optionally, a name, organization and note. The landing page reads
`GET /api/v1/early-access/status` without waiting on it and without any session, so
the [public route](0107-public-experience-and-recorded-workflow.md) still does not
depend on session or configuration APIs. If the read fails, the page has no form.

The administrator can then:

- **Invite** a pending or declined request. This creates a new organization with the
  requester as its admin, then emails the invitation. Without working SMTP, the
  administrator gets the invitation link once, to share themselves. Listing requests
  never returns a link.
- **Decline** a pending request. The requester is not told.
- **Delete** any request, which removes the personal data.

Inviting into an existing organization is not offered. The administrator is not made
a member of the new organization.

## Abuse and privacy

The form is unauthenticated and on the public internet, so:

- Nothing is ever emailed on submission. The form cannot be aimed at someone else's
  inbox, and the only mail it can lead to follows an administrator's decision.
- A repeat address gets the same answer and changes nothing, so the form does not
  reveal who has asked and cannot reopen a decision.
- Submissions are limited per address, body size is bounded, disposable addresses are
  refused, unknown fields are refused and a hidden field catches simple bots. There is
  no CAPTCHA. Once 10,000 requests are pending, new ones are refused.
- Submitted text is stored as text and rendered as text.
- IP addresses are not stored.

Instance administrators can read requests. Organization admins cannot. The operator is
the data controller for what the form collects. Vaultix does not ship a privacy policy
or a retention schedule; requests stay until an administrator deletes them.

## Why TypeScript

[0027](0027-native-stack-and-ai-migration.md) targets Go domain services, but this
slice is in the TypeScript backend. The image does not route public traffic to Go, and
the sidecar is off by default. Approval also depends on organization creation, invite
tokens and mail, all of which are still in TypeScript. A Go version would split one
decision across two runtimes and two transactions. It moves when those domains do.
New validation is plain TypeScript with no new Zod. The table schema follows the
generated convention every table uses.

## Schema and upgrades

`20261102120000_vaultix-early-access-requests` adds the
`vaultix_early_access_requests` table and `super_admin.earlyAccessRequestsEnabled`.
Both are additive. Down refuses while requests exist, so a binary rollback cannot
erase them.

**`vaultix server upgrade` refuses this change.** It deliberately rejects any changed
migration set ([0109](0109-native-install-and-upgrade.md)), and this slice does not
change that. An instance on an earlier image reaches this one in one of two ways:

- A fresh `vaultix server install`.
- The manual path in [pr-delivery](pr-delivery.md): keep a recoverable backup, set the
  new image and let canonical startup apply the migration.

`scripts/test-early-access-migration.mjs CANDIDATE PREVIOUS` rehearses that manual
path on disposable state. It proves an existing store migrates and keeps its secrets,
the previous image still runs on the migrated store, and restarting the candidate keeps
requests. It does not replace the lifecycle command's own checkpoint and restore steps.

The lifecycle acceptance in the merge gate needs a baseline image with the same
migration set, so an earlier baseline fails there by design.

## Verification

`scripts/test-early-access.mjs` runs in the canonical image application test. It uses a
real browser and real services to cover the closed default, the administrator opening
the form, validation, submission, keyboard focus, 320-pixel reflow and automated
accessibility checks. It then covers duplicates, the hidden field, inert markup, the
invitation link through to the requester landing in their organization, single-winner
concurrent invites, denial for anonymous users and organization admins, decline,
delete, closing the form and rate limiting.

## Remaining limits

- Real SMTP delivery of the invitation was not tested. The email and failed-delivery
  branches have unit tests only.
- No notification tells an administrator that a request arrived.
- The existing Add Organization dialog still gives no link when SMTP is off.
- Automated scans are not manual screen-reader acceptance
  ([0022](0022-accessibility-acceptance.md)).
- CLOUD-01 stays open, including enrollment abuse controls at public scale.
