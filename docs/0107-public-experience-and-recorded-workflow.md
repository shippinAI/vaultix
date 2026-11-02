# Public experience and recorded application workflow

The owner's 2026-11-02 correction makes `/` the public Vaultix landing page.
This supersedes the root redirect in 0025, without replacing the authenticated
application. Open Vaultix enters `/login`: existing first-run setup, built-in
and federated authentication, organization selection, MFA and project guards
continue to own access. The public route does not wait for session/config APIs.

The landing uses owned vector artwork, semantic steel/mint tokens and responsive
cards. A dismissible contextual suggestion introduces the interactive experience
without stealing focus or opening a modal automatically. Help and video dialogs
trap keyboard focus and return it to the opener. Reduced-motion preferences
suppress the teaching cursor. The video is loaded on demand, with captions,
poster and a readable transcript; no player runtime or autoplay is required.

## One reference workspace

`ReferenceWorkspace` remains the reference UI in the application and MCP app.
`ReferenceTeaching` drives its existing selection/read handlers through five
scoped, allowlisted commands: project, environment, folder, load and reset.
Unknown actions, selectors, extra fields, wrong scopes and oversized values are
rejected. Selection validates available projects/environments; reads retain the
existing source-action authority. Commands do not expose secret values.

The authenticated Clyffy sheet uses real authorized actions. The public rehearsal
uses this same React workspace with explicitly labeled sample names. It is a
scripted demonstration, not a connected AI session. Pause, resume, replay and
human takeover are visible. Actual read completion controls success; teaching
progress alone never declares an operation successful. Backgrounding the tab
stops the script. There is no global click/eval API or alternate model API.
Remote paired AI control remains a separate acceptance gate under 0076.

## Real footage, reproducible edit

`scripts/record-vaultix-workflow.mjs IMAGE` creates disposable PostgreSQL,
Dragonfly and a canonical Vaultix backend. Its loopback-only HTTP binding allows
a local browser; the separate recording network is removed afterward. All
credentials stay in process memory. Login finishes before recording begins.
The script records real project creation and the Clyffy reference workflow,
verifies completion, hashes the frontend sources and records chapter times.
The temporary instance contains no customer data or secret values.

`core/media/render-recorded.mjs MANIFEST` validates provenance and unchanged
sources, trims pre-workflow frames, and renders the real recording through the
pinned Remotion composition. It produces H.264 video, JPEG poster, captions and
review frames. Published provenance records hashes and scope, not credentials
or local filesystem paths. The older illustrated composition is not described
as actual application footage.

## Verification and limits

The command test rejects malformed and out-of-scope messages. The public browser
test exercises actual controls, pause/resume, takeover, failed-read recovery,
keyboard dialogs/tooltips, 320px reflow, reduced motion, video decoding/seeking,
login navigation and automated accessibility. Its receipt binds source hashes.
Recording separately verifies the authenticated real-service workflow. Canonical
standalone-image tests retain setup, projects, secrets and authorization checks.

Automated checks and local visual inspection do not establish full manual
screen-reader acceptance, all-product accessibility, enterprise parity, remote
AI control or deployment to vaultix.cloud. Public server rollout requires the
actual operator deployment target and post-deployment verification.
