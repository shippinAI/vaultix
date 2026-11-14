# 0122 — Completion plan

Status: active, written 2026-11-11. Vaultix is pre-release ([0118](0118-pre-release.md)). This is
not a release plan. "Done" means it works in the real app, is proven by the checks named here, and
is on `main`.

Counts below were read from the code on branch `align-shippin` at `8e99945d`.

## Rules for every stage

1. **Finished means seen working.** Each stage ends in the real image, on the preview, with the
   owner able to click it. A passing unit test alone is not done.
2. **Proof before push.** `node scripts/build-self-hosted.mjs --capabilities` passes on the exact
   commit, plus the stage's own checks. Failures get diagnosed, not retried until green.
3. **No unchecked bulk edits.** A replace across the tree is a scripted change that is compiled and
   whose diff is classified before it is committed. Lockfiles and checksums are never in scope.
4. **APIs change directly.** When an API changes, every caller (UI, CLI, MCP tools, scripts,
   tests, docs) moves in the same change and the old route is deleted. No aliases, shims or legacy
   paths. The capability-surface baseline is updated in that same commit, on purpose. Stored data is
   different: accounts, secrets, keys and history must survive every upgrade.
5. **No claims ahead of evidence.** Anything missing stays listed as missing, in the docs and in
   what the product tells an AI (`vaultix.auth.options.get`, `vaultix.warp.list`).

## Stage 1 — Land the current work

Table rename, MCP warp points, `ee` to `shippin`, license removal. Everything from `ee` reached
`shippin` except the license code itself: 769 of 779 TypeScript files and 10 of 17 Go files, where
the 10 and 7 not carried over are exactly the license packages and routes.

Done when:
- The full build passes on the final commit.
- `scripts/test-server-lifecycle.mjs` passes end to end across the rename, **including rollback**,
  which it has not reached yet.
- `scripts/test-server-migration.mjs` passes (failure paths of a changed migration set).
- `main` is fast-forwarded and a clean checkout of `main` builds.
- The preview on 8290 runs the new image. The `vaultix-dev` stack on 8200 is left alone.

## Stage 2 — Finish removing licensing

The system is gone; its leftovers are not. Every check below always passes today, so removing them
changes no behavior.

| Leftover | Count |
| --- | --- |
| Backend plan gates (`if (!plan.x)`) | 175 |
| `getPlan` calls, to become a plain features read | 204 |
| Frontend `upgradePlan` popup state | 184 |
| Frontend `subscription` feature checks | 203 |
| "Enterprise" badges | 8 |
| `docs/*.md` / `platform/engine/docs` pages mentioning licensing | 10 / 67 |

Also in this stage: the dead root `db/` copy (788 files, nothing references it), and the 27 files
still naming `shippinAI/vaultix` after the move to `vaultix-cloud`, including image labels the
upgrade code checks.

Done when: no license, tier, paywall or upgrade wording remains outside third-party notices and
frozen migrations, and every feature is visibly on with no plan check in its path.

## Stage 3 — Sign-in: the built-in shippin.ai door, other doors, and AI sessions

Today: Admin → Authentication already switches instance-wide sign-in methods (email, Google,
GitHub, GitLab, SAML, OIDC, LDAP). Google sign-in works only once a GCP OAuth client is configured,
through settings or Admin → Environment, which stores it encrypted. First-owner setup turns on
email only, on every deployment. The deployment's cloud flag is fixed off. shippin.ai (Nomen) is
used only by the CLI's terminal login; the website has no shippin.ai sign-in.

How it should work:

- **One codebase.** vaultix.cloud is this build plus deployment configuration, never a fork or a
  private copy of the code. A deployment profile chosen at install (`cloud` or `self-hosted`)
  decides the defaults; code does not branch on who runs it.
- **shippin.ai is the built-in door, not the only one.** "Continue with shippin.ai" through Nomen
  is the door Vaultix ships, backed by Google so getting in is one click. It is an instance-level
  sign-in method in Admin → Authentication beside the others. Accounts link explicitly, never by
  matching email ([0074](0074-built-in-and-federated-identity.md)). On vaultix.cloud the Google
  sign-in goes through it, so vaultix.cloud holds no Google credentials.
- **Other doors stay open.** Identity providers connected in the admin panel (OIDC, SAML, LDAP,
  GitHub, GitLab and the rest), and shippin.tech once it can connect.
- **Username and password are earned, on vaultix.cloud.** They are not offered at first. They
  become available once a third party is connected through the panel, or once shippin.tech is set
  up to connect. Self-hosted instances keep built-in email and password from the start, since they
  must work without Nomen.
- **Defaults by profile.** Cloud: shippin.ai (Google) on, username and password off until earned.
  Self-hosted: email and password on; shippin.ai and Google off until configured.
  is refused on the server, not only hidden. Organizations can narrow further under their own
  security settings but never turn on what the instance turned off.
- **Secrets never sit in a repository.** OAuth client secrets go in the instance's encrypted
  settings or the deployment's secret store. A private shippin operations repository may hold
  deployment configuration and references; anything secret in it is encrypted (for example SOPS
  with age keys kept outside git). The bootstrap secrets of vaultix.cloud itself (database
  password, encryption key) live outside that instance.
- **AI sessions.** The Go service has the device flow (off by default, 60-minute access). Still
  needed: the browser page where a person approves an AI, `vaultix login` support for it, MCP
  admission for delegated sessions, CLI renewal, then turning it on.
- **Account recovery works without email.** The forgot-password email needs a mail server
  (`SMTP_HOST` and the other `SMTP_*` settings on the host). Without one, an instance administrator
  uses Admin → Resource overview → Users → Create Password Reset Link
  (`POST /api/vx/v1/access/users/{userId}/password-reset-links`). The link carries the same one-use,
  24-hour token the email would, opens the same reset page, and replaces any earlier link. Issuing
  one is recorded in the person's organization audit log (`issue-password-reset-link`, origin
  `administrator` or `host`). When nobody can sign in, the host operator runs
  `vaultix server owner-reset-link` (docs/0109, Owner recovery). Built 2026-11-13 with unit and Go
  tests; `scripts/test-password-reset-image.mjs` proves both paths and the audit entries on the
  packaged image as a canonical build step.

Needed outside this repository: Google configured as an upstream provider in Nomen, and
vaultix.cloud registered there as a client. Nomen is a sibling tree and is not edited from here.

Done when, on the image: with the cloud profile, a new person signs in with Google through
shippin.ai and lands in their organization; username and password stay unavailable until a third
party is connected, then work; the operator turns Google off and the button disappears
and the server refuses it; the self-hosted profile is unaffected; an AI rides a person's approved
session for at least 60 minutes with denial, expiry and revocation proven; and
`vaultix.auth.options.get` reports exactly what is available.

## Stage 4 — MCP warp points and AI-driven UI

Eight warp points are live and pass route tests. Missing:

- An image test with a real MCP client against the warp points (none exists).
- `vaultix mcp` support for choosing a warp point, and `vaultix mcp config` output for it.
- The MCPL workbench showing the warp points and their live status.
- A published contract for `/api/vx/v1/<domain>/mcp`.
- The tools that predate warp points leave the main MCP for their warp points (rule 4); the main
  MCP keeps discovery and sign-in options only.
- **Triggers an AI can drive.** The UI has 16 named actions (5 local, 11 planned) and 2 planned
  scripts; 12 of 15 domains are unreviewed; the backend exposes no `vaultix.ui.*` command. Build per
  [0114](0114-domain-scripted-ui-standard.md): registered commands, the paired view, receipts.
- First real tools on the 7 planned warp points, each on an existing handler.

Done when: a named AI client connects to a warp point on the image, signs in, and moves the real UI
while the person watches, with denial and takeover proven.

## Stage 4b — The signal fabric, outcome receipts, the rehearsal demo and the hosted agent

Specified in [0123](0123-signal-fabric.md) and [0124](0124-ai-personas-and-machine-loops.md).
This comes before the commercial control plane.

Done on 2026-11-11, proven on the image with a stand-in model
(`scripts/test-assistant-image.mjs`):

- Admin > AI Assistant manages providers (Anthropic, Bedrock, Vertex, OpenAI, OpenAI-compatible)
  with encrypted keys and recorded connection tests.
- Personas: defaults in `platform/engine/ai/personas`, administrator overrides and custom specialists.
- Routing by mention, page or Clyffy; each persona uses its domains' warp points, read-only, as
  the person.
- Chat in the Clyffy panel fed by value-free action and page signals, with a canary check.

Still to build, each proven on the image before the next:

- Passive hints with more/less/none and thumbs.
- Server-backed receipts on every catalog write action.
- The rehearsal demo.
- A2UI answers rendered in the core app.
- The guard reviewing write actions once approvals exist.
- The rest of 0124 in its order.
- A run against a real provider with the owner's key.

## Stage 4c — Infisical and Doppler coverage, proven

Coverage checked on 2026-11-11 against [0023](0023-capability-convergence.md):

- **Missing entirely:** Terraform provider, Kubernetes operator, Doppler config inheritance, branch
  configs, typed secret values. SSH certificates were removed on purpose (20260729 migration).
- **Built with no test file:** secret sharing, webhooks, trusted IPs, sub-organizations,
  honeytokens, KMIP, insights, every secret-sync provider, cloud machine-identity sign-in
  (Kubernetes, AWS, GCP, Azure, OIDC, JWT).
- **Tested but never proven on the image:** dynamic secrets, rotation, approval and access-request
  review/apply, SCIM, audit streaming, external KMS, PKI issuance, PAM sessions, scanning, rollback.
- **Different behavior:** several matching change policies select one; Doppler requires all.

Each family gets a workflow proof on the image (positive, denied, cross-tenant, provider outage)
before it is called covered. Outside providers need the owner's accounts, entered in the UI.

## Stage 5 — Updates from the admin panel

None of this exists yet: no host agent, no update UI, `MAINTENANCE_MODE` is a static setting. The
web application cannot replace its own containers, so per
[0108](0108-platform-services-and-upgrades.md) (OPS-04/05) this needs a separate, narrowly
authorized host agent.

Build: the host agent, operator-only review and approval, a freeze across the app while it runs, a
progress screen that survives a reconnect, and status reporting over the `operate` warp point. MCP
reports progress; it never approves an update.

Done when: from the admin panel an operator starts a real update on the owner's server, everything
freezes and shows it running, and a killed or failed update recovers or rolls back.

## Stage 6 — Recheck the import and cards against the original asks

Provider import is on `main` but not on vaultix.cloud, which runs fa69fa36 (2026-11-04) until the
owner runs the upgrade. Then run it against a real Doppler workplace and a real Infisical server,
approve and merge the change request it opens, and add folder recursion and metadata. Walk the
original list in the real app: Doppler and Infisical cards,
tooltips, popup modals, policy-aware review, approve and import, live registry state, and no secret
values leaving the server. The AI-registered triggers part is delivered by Stage 4. Anything short
of the ask gets fixed here.

## Stage 7 — The Vaultix API and the Go/Rust port, one domain at a time

These are one job. Moving a route to `/api/vx/v1/<domain>` and porting it to Go or Rust touch the
same use case, and [0027](0027-native-stack-and-ai-migration.md) already says to move complete use
cases. Doing them separately would mean moving everything twice.

Today: 5 route definitions under `/api/vx/v1` against about 1,570 inherited, 5 frontend calls
against 1,146, and no module marked migrated across 9,782 mapped files.

Per domain, in dependency order (foundation, identity, authorization, secrets, then the rest): the
Go or Rust handler, the `/api/vx/v1` route, and every caller moved onto it in the same change, with
the old route deleted (rule 4). The behavior is proven on the new route, not kept on the old one. This is by far the largest
stage and gets a per-domain ledger of its own.

## Decisions only the owner can make

| Decision | Needed before |
| --- | --- |
| License: open source or BSL | Any public release; likely alongside the Nomen merge |
| Nomen merge: scope and which identity code survives | Stage 7's identity domain |
| The instance owner's recovery sign-in on vaultix.cloud while passwords are off, so an outage at Nomen or Google cannot lock the operator out | Stage 3 |
| Which provider and key vaultix.cloud's assistant uses (all kinds are managed in Admin > AI Assistant) | Turning the assistant on for vaultix.cloud |
| Which Infisical/Doppler gaps to build versus leave out (Terraform, Kubernetes operator, inheritance, typed values) | Stage 4c |
| Production host, SMTP, privacy notice | Inviting anyone (and restore branch protection first) |

The Nomen merge is a project of its own and needs its own plan. It is a sibling tree and is not
edited from here.
