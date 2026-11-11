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
4. **No claims ahead of evidence.** Anything missing stays listed as missing, in the docs and in
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
| `docs/*.md` / `core/docs` pages mentioning licensing | 10 / 67 |

Also in this stage: the dead root `db/` copy (788 files, nothing references it), and the 27 files
still naming `shippinAI/vaultix` after the move to `vaultix-cloud`, including image labels the
upgrade code checks.

Done when: no license, tier, paywall or upgrade wording remains outside third-party notices and
frozen migrations, and every feature is visibly on with no plan check in its path.

## Stage 3 — AI sign-in, including riding the user's session

Machine identity and headless CLI work today. The user's session does not: the Go service has the
device flow (off by default, 60-minute access), but nothing else exists.

Build: the browser page where a person reviews and approves an AI, `vaultix login` support for the
Vaultix device flow, MCP admission for delegated sessions, CLI renewal, then turn it on.

Done when: a real CLI and browser complete it on the image; the session lasts at least 60 minutes;
denial, expiry and revocation all behave; another tenant's session is refused;
`vaultix.auth.options.get` says "available".

## Stage 4 — MCP warp points and AI-driven UI

Eight warp points are live and pass route tests. Missing:

- An image test with a real MCP client against the warp points (none exists).
- `vaultix mcp` support for choosing a warp point, and `vaultix mcp config` output for it.
- The MCPL workbench showing the warp points and their live status.
- A published contract for `/api/vx/v1/<domain>/mcp`.
- **Triggers an AI can drive.** The UI has 16 named actions (5 local, 11 planned) and 2 planned
  scripts; 12 of 15 domains are unreviewed; the backend exposes no `vaultix.ui.*` command. Build per
  [0114](0114-domain-scripted-ui-standard.md): registered commands, the paired view, receipts.
- First real tools on the 7 planned warp points, each on an existing handler.

Done when: a named AI client connects to a warp point on the image, signs in, and moves the real UI
while the person watches, with denial and takeover proven.

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

Provider import is on `main`. Walk the original list in the real app: Doppler and Infisical cards,
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
Go or Rust handler, the `/api/vx/v1` route, the UI and MCP moved onto it, the old path kept as an
alias until nothing uses it, and the existing behavior proven preserved. This is by far the largest
stage and gets a per-domain ledger of its own.

## Decisions only the owner can make

| Decision | Needed before |
| --- | --- |
| License: open source or BSL | Any public release; likely alongside the Nomen merge |
| Nomen merge: scope and which identity code survives | Stage 7's identity domain |
| Production host, SMTP, privacy notice | Inviting anyone (and restore branch protection first) |

The Nomen merge is a project of its own and needs its own plan. It is a sibling tree and is not
edited from here.
