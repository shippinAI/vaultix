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
  administrator gets the invitation link once, to share themselves. It lasts 72 hours.
  Listing requests never returns a link.
- **Send a new invitation** on an invited request that has not been accepted. This
  replaces the outstanding link and emails the new one or shows it once. The old link
  stops working, apart from a sign-up already started from it, which can finish for up
  to 15 minutes.
- **Decline** a pending request. The requester is not told.
- **Delete** any request. After an invite, the address stays on the user and membership
  that the invitation created, because those are the account rather than the request.
- **Delete all matching** pending or declined requests, narrowed by search. This is how
  to recover from a flood. The filter and count are fixed when the dialog opens, and the
  button is off until a changed filter has loaded. A matching request that arrives while
  the dialog is open goes too, and the result reports the number actually deleted.

Inviting into an existing organization is not offered, and neither is inviting an address
that already has an account or a pending invitation in another organization. An
invitation's token belongs to the user, so whoever completes that account could enter
those organizations too, and an outsider chooses the address a request names. Once that
person has accepted, an administrator can add them from Resource Overview, which gives no
link. The administrator is not made a member of the new organization.

Without SMTP, outside development mode, Resend in Resource Overview refuses, because
rotating the token without mail would only cancel a link someone already shared.

## Abuse and privacy

The form is unauthenticated and on the public internet, so:

- Nothing is ever emailed on submission. The form cannot be aimed at someone else's
  inbox, and the only mail it can lead to follows an administrator's decision.
- A repeat address gets the same answer and changes nothing, so the form does not
  reveal who has asked and cannot reopen a decision.
- Addresses are not verified, because nothing is mailed. Anyone can submit someone else's
  address, which grants nothing because the invitation goes to that mailbox, but the
  details on a request may not come from its owner. Whoever submits first sets those
  details, and the real owner is told their request was received.
- Submissions are limited to 5 a minute per client, counting an IPv6 client by its /64.
  Behind a reverse proxy, set `TRUSTED_PROXY_CIDRS`, or every visitor counts as one
  client. The route takes JSON only, so with `SITE_URL` set, as `vaultix server` always
  does, a page on another site cannot make its visitors' browsers submit. Body size is bounded, disposable addresses are refused, unknown fields
  are refused and a hidden field catches simple bots. There is no CAPTCHA.
- Once 10,000 requests are pending, new ones are refused for everyone. A single client
  can reach that in about 33 hours, and more quickly with more addresses, so this bounds
  the store rather than keeping the form available. Closing the form and **Delete all
  matching** recover from it.
- An address must be plain ASCII in the form the existing organization route accepts.
  Other fields refuse control characters and directional overrides.
- Submitted text is stored as text and rendered as text.
- IP addresses are not in the requests table. Request logs hold them as they do for every
  route, and an administrator's search term appears in the logged URL.

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
generated convention every table uses. Its name rule repeats the one the existing
organization route applies, rather than calling that route's Zod schema.

## Schema and upgrades

`20261102120000_vaultix-early-access-requests` adds the
`vaultix_early_access_requests` table and `super_admin.earlyAccessRequestsEnabled`.
Both are additive. Down refuses while requests exist, so a binary rollback cannot
erase them.

`vaultix server upgrade` takes this as a changed migration set: it rehearses the
migration on a restored copy, applies it and verifies the result before the new
application starts ([0109](0109-native-install-and-upgrade.md)). `vaultix server
rollback` restores the checkpoint rather than running the down migration, so it needs
`--discard-writes`, and requests submitted since the upgrade leave the live store and
stay in the retained database. A deployment the CLI does not manage can use the manual
path in [pr-delivery](pr-delivery.md).

The merge gate's lifecycle acceptance upgrades an earlier baseline to this image through
that path, and its report names the migration it applied.
`scripts/test-early-access-migration.mjs CANDIDATE PREVIOUS` tests the schema change
itself on disposable state. It proves an existing store migrates and keeps its secrets,
the previous image still runs on the migrated store, and restarting the candidate keeps
requests.

## Verification

`scripts/test-early-access.mjs` runs in the canonical image application test. It uses a
real browser and real services to cover the closed default, the administrator opening
the form, validation, submission, keyboard focus, 320-pixel reflow and automated
accessibility checks. It then covers duplicates, the hidden field, inert markup, the
invitation link through to the requester landing in their organization, single-winner
concurrent invites, refusing an address invited elsewhere, a replacement link, denial
for anonymous users and organization admins, decline, delete, bulk delete, hostile
addresses, form-encoded posts, closing the form and rate limiting.

## Remaining limits

- Real SMTP delivery of the invitation was not tested. The email and failed-delivery
  branches have unit tests only.
- A link that reaches someone other than the mailbox owner gives them that address's
  account, and any organization that later invites the address is then theirs to enter by
  signing in, with no link and no time limit. The console says to send a link to that
  address only. To cancel an unused link, remove the person from the new organization.
  **Send a new invitation** also replaces it, unless the address has since been invited
  elsewhere, when it refuses.
- The check for another organization runs when an invitation is issued, so it does not
  cover an invitation from elsewhere that arrives later.
- A filled queue is not rate limited across clients, and the cap is not load tested.
- No notification tells an administrator that a request arrived.
- The existing Add Organization dialog still gives no link when SMTP is off.
- The shared danger color measures 4.41:1 on the card surface, under the 4.5:1 that small
  text needs. This form uses a lighter mix. Other forms on cards still use the shared color.
- Automated scans are not manual screen-reader acceptance
  ([0022](0022-accessibility-acceptance.md)).
- CLOUD-01 stays open, including enrollment abuse controls at public scale.
