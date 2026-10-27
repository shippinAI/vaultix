# UI workflow execution plan

Continue Vaultix.cloud in the existing application, with DevSCIF tailoring on
the same foundations. This plan advances the broader migration in [0027](0027-native-stack-and-ai-migration.md).
It does not replace the domain, identity or capability acceptance gates.

## Current slice: startup isolation and certificate distribution cards

| Step | Change | Acceptance |
| --- | --- | --- |
| 1. Read and trace | Inspect the editor export, its callers and bundle membership; inspect certificate distribution/expiration rendering and inventory filters | Identify actual consumers and retained contracts before edits |
| 2. Isolate startup | Remove the unused editor re-export from the general v2 barrel; keep its direct feature entry and implementation | Typecheck all consumers; reject editor runtime in emitted startup graph; compare cold login payload |
| 3. Author the workflow | Consolidate distribution/expiration card rendering in its existing feature; full labels, semantic surfaces, stable vector rings, visible keyboard focus and usable targets | Preserve all existing filter mappings, counts, empty states, pointer and keyboard navigation; avoid enabled no-op actions |
| 4. Prove the result | Test nonempty/empty/long-label cards, narrow layout, reduced motion and scoped axe rules; retain real application checks | Explicit fixture report separate from real sign-in/project navigation and provider acceptance |
| 5. Deliver | Build the canonical standalone image; run Dragonfly/Redis checks; reconcile source hashes and maps; commit, push and update local dev | Record image identity, exact evidence and remaining gaps |

Authored sources remain in `core/frontend`; generated routes and bundles are
produced by the normal build. The certificate feature owns its composition;
shared v3 primitives own control styling. No new runtime, separate viewport,
secret store or dependency is needed for this slice.

## Subsequent sequence

1. Review permission-graph and broad component-export dependencies still present
   at startup; preserve their real authorization and graph workflows.
2. Author secrets project/environment and edit/import workflows with explicit
   pending, denied, empty, failure and recovery behavior, keeping values outside
   AI, teaching and telemetry.
3. Apply the same workflow method to approvals/rotation, identity/access, PKI,
   PAM, KMS, audit and administration. Record each provider prerequisite.
4. Execute the React/Go/Rust and source-action migration gates in 0027. UI changes
   do not establish Nomen integration, AI injection safety or enterprise parity.

Do not raise loading limits to hide a regression. Do not count a discovered file,
a renamed label or an included feature flag as an authored and verified workflow.

## Acceptance findings

The first image run reproduced `label-content-name-mismatch` in every filter
button: its accessible name reordered the visible percentage and count. The
candidate was stopped. Reordering the explicit label still failed because the
adjacent visual spans have no separating DOM text. The authored button now takes
its accessible name directly from its visible content; an associated description
provides the filter purpose. Failing reports are
`.cache/app-image-proof-XV7XcG/chart-accessibility.json` and
`.cache/app-image-proof-AvSZtd/chart-accessibility.json`; no rule was suppressed.

The card reader deliberately keeps unknown algorithms and authorities without
IDs as readable data. Previously these rendered enabled buttons with no action.
Expiry aggregation and all existing filter keys remain unchanged, including
the inherited `< 7 days` label for the seven-day filter. A semantic change to
bucket boundaries requires coordinated backend and inventory acceptance.

The narrow check initially sampled before the responsive sidebar finished its
layout update. Captured dimensions subsequently show 292-pixel card interiors
inside a 294-pixel content row, without overflow. The check now polls for fit
with a five-second bound; it does not accept persistent overflow. Narrow card
screenshots are separate from the surrounding dashboard screenshot. The inherited
dashboard title still truncates at 390 pixels and needs a broader header/layout
review; this slice does not establish whole-dashboard mobile acceptance.

Filter checks also account for the installed router's JSON quoting of numeric
strings: the seven-day string is serialized with quotes. The application filter
contract stays unchanged; testing only the raw unquoted URL value was incorrect.

## Executed checkpoint

Steps 1–4 are implemented and verified. Step 5 delivered source commit `bacd41b`
to `main` and the verified image to the local development instance: port 8200
and its status endpoint return 200, the container is healthy, and the source
UI on port 3000 returns 200. Registry publication remains subject to CI. Evidence:

| Check | Result |
| --- | --- |
| Consumers and production build | TypeScript and scoped ESLint pass; direct optional editor module retained |
| Startup boundary | `.cache/bundle-proof-0TPEKz`: no Lexical, Recharts, DotLottie or PAM access page in static entry closure |
| Cold login | `.cache/loading-proof-sDIHXZ`: 3,008,310 JavaScript / 3,536,677 total decoded bytes in each of three runs; zero browser errors |
| Existing fixture UI | `.cache/ui-proof-2H8lXl`: 18 states pass, zero detected axe violations |
| Real packaged application | `.cache/app-image-proof-0o57wZ/result.json`: real sign-in, project creation, navigation, PAM tabs and anonymous denial pass |
| Card fixture acceptance | Same directory, `chart-rendering.json`, `chart-accessibility.json`, `chart-layout.json` and screenshots: six keyboard filters, full-size static rings, long labels, narrow cards, 44px targets, visible focus and empty states pass; three scoped axe states have zero violations/incomplete findings |
| Image and cache | `vaultix:cards-verify`, ID `sha256:d955e77eca1e829ec1d732e74afe9c33a8c0ed226e92c3e65a26df9064860e68`; Dragonfly and Redis smoke suites pass |
| Preserved surface | 273 UI routes and 2,290 documented API operations retained; this is not proof of every capability's behavior |

Review records are scoped to the authored files and exact Git blobs. Manual
assistive-technology review, whole-dashboard reflow, provider acceptance and the
larger native stack/AI migration remain open under their existing gates.

## CI fixture follow-up

The preceding commit's [image run](https://github.com/shippinAI/vaultix/actions/runs/40555665733)
failed at disposable admin signup with HTTP 422. Its generated credential was not
logged, so that response alone does not establish which validation rule failed.
Review found a reproducible flaw: an unconstrained random hexadecimal password
can contain four repeated characters, which the existing password policy rejects.
The fixture now separates random byte pairs, retaining 192 bits of randomness
and staying within the length limit while preventing that run. Product policy
and authentication are unchanged. Registry publication still requires a passing
GitHub image pipeline.

The revised fixture passes real signup/sign-in and the full application, recovery
and card checks in `.cache/app-image-proof-ok1eZZ`; Dragonfly smoke/restart also
passes in `.cache/cards-smoke-final.log`. Generator boundary inputs (all-zero and
all-255 bytes) plus 10,000 random samples satisfy length/repetition constraints
without printing any generated credential.
