# Visual depth and loading acceptance

Vaultix.cloud uses owned vector artwork, clear typography, compact controls and
deliberate depth. DevSCIF.com uses the same foundations with suite-specific
workflows. This is an in-place evolution of the existing application. The real
authentication and project application remain the entry point.

## Source and ownership

`core/frontend/src/index.css` owns semantic surfaces, colors and elevation.
Shared primitives own control states. Authentication owns its layout and
`AuthVaultIllustration.tsx` composition. Tailwind/Vite generate CSS and JavaScript
during the frontend build; generated files are never edited to change appearance.
The illustration draws offset planes with existing semantic colors. It adds no
image request, animation runtime, SVG filter, font, embedded bitmap or external
resource. Decorative art has no keyboard target and is hidden from assistive
technology. Form labels, errors and actions remain real HTML.

Use depth to distinguish planes and floating controls. Keep dense tables and
routine cards calm. Fixed artwork aspect ratios prevent layout shifts. Keep
the form usable at short desktop heights and narrow widths; desktop secondary
content scrolls independently. Existing focus, authorization and form behavior
are preserved. Review actual consumers before converting other shared controls.

## Loading infrastructure

The SVG product loader remains synchronous and small. The optional animated-icon
player is a separate module, loaded with [React lazy](https://react.dev/reference/react/lazy)
inside a local [Suspense boundary](https://react.dev/reference/react/Suspense).
Its existing local WASM URL is configured inside that module. Form and navigation
content do not wait for the decorative player. Animated icon props, callbacks,
hover behavior and children remain supported. No new runtime dependency is added.

The first attempt to change Rollup's [explicit manual chunk behavior](https://rollupjs.org/configuration-options/#output-onlyexplicitmanualchunks)
failed browser startup and was removed. The next checkpoint traces the actual
emitted graph: React, shared helpers and Node polyfills had been absorbed by the
chart group. They now have a shared `ui-runtime` group. D3 primitives, also used
by permission graphs, stay together in their own group. Recharts/Victory retain
their group, which depends on these foundations without reverse imports.
The login browser check forbids downloading that renderer; the certificate
dashboard acceptance verifies it loads when needed. Login still includes other
feature dependencies and is not fully optimized.

PAM tab values now live in a metadata-only module. Previously route search
validation imported them from the rendered access-management page, which pulled
its identity-form and role-schema dependencies into startup. The values and
validation defaults are unchanged. Real-image checks cover all three tab links,
invalid-tab fallback, keyboard tab selection and refresh.

`scripts/check-ui-loading.mjs` measures three fresh browser contexts against the
built login UI. Instance configuration and anonymous-token responses are explicit
fixtures. It records requested assets, decoded/encoded/transfer bytes, browser
version, errors, typing readiness and a screenshot under `.cache/loading-proof-*`.
The static server is local and uncompressed, without CPU/network throttling.
These numbers measure requested payload and local behavior, not a hosted SLA.
Cold login must not request the chart renderer, optional player or WASM. Decoded
payload limits are 3.1 MB JavaScript and 3.65 MB total assets; illustration markup
is below 6 KB.
These initial limits prevent losing this improvement and must tighten as the
remaining dependency graph is improved. CI runs the check before
publishing and retains its evidence. `--baseline` records the previous build
without enforcing the new loading budget.

`scripts/build-ui-report.mjs` runs the existing Vite production build and writes
emitted chunk membership, static/dynamic imports, byte counts and the static entry
dependency closure under `.cache/bundle-proof-*`. It uses the official
[Rollup module and output metadata](https://rollupjs.org/plugin-development/).
The check rejects Recharts, DotLottie, Lexical or the PAM access page in that closure,
even if chunk names change. Source import edges include tree-shaken modules;
they are discovery evidence, not proof that every connected module executes.
Gzip sizes are estimates. CI runs TypeScript checking first, builds once with
this reporter, then runs the browser checks and retains both reports.

## Methodical next work

1. Trace the remaining login dependency graph and split feature-owned imports;
   retain crypto, validation, provider and authorization behavior.
2. Establish per-workflow payload and interaction baselines for secrets, approvals,
   PKI, PAM, KMS and administrative screens before changing their composition.
3. Measure hosted compression, cache headers, CDN behavior, constrained networks
   and CPU separately. Versioned assets can be cached aggressively; authenticated
   data and HTML require their own cache policies.
4. Apply contextual help, accessible dialogs and catalog-backed teaching while
   recording success, denial and recovery evidence for each actual workflow.
5. Add responsive raster derivatives only where a photographic source requires
   them. Owned UI vectors remain code/source assets; do not add a runtime image
   service for small geometric illustrations.

The entire UI is not converted by this checkpoint. Whole-tree authorship,
manual assistive-technology review, full capability parity and the native stack
migration keep their existing acceptance gates.

## Measured checkpoint, 2026-10-27

Baseline `.cache/loading-proof-vAvw9r/result.json` requested 4,565,309 decoded
asset bytes, including 4,037,254 JavaScript bytes. The candidate in
`.cache/loading-proof-Ss8GJr/result.json` requested 4,134,494 asset bytes,
including 3,606,170 JavaScript bytes: 430,815 fewer total bytes (9.44%). All three
cold contexts had the same payload and zero browser errors. Local typing-ready
times varied; they are not used as a release threshold or hosted speed claim.

Desktop, 1280-by-600 short-desktop and 320-pixel mobile screenshots were reviewed.
The illustration is hidden on mobile and the form remains available without
horizontal document overflow. All 18 existing fixture UI/accessibility states
passed in `.cache/ui-proof-UKNPvQ`; no detected axe violations. Real identity,
all workflows and manual assistive-technology acceptance remain separate.

The canonical image also passed real authentication/application acceptance in
`.cache/app-image-proof-Z5u5Cp/result.json`, plus both Dragonfly and Redis smoke
tests. Image identity and precise scope are recorded in
[the capability evidence ledger](0018-hosted-capability-proof.md).

## Dependency-boundary checkpoint, 2026-10-27

`.cache/bundle-proof-YDXub6/summary.json` records an emitted static entry closure
of 2,678,001 JavaScript bytes, with no Recharts, DotLottie or PAM access page.
The browser additionally loads login route code: all three cold runs in
`.cache/loading-proof-O2Nme5/result.json` requested 3,144,178 JavaScript bytes and
3,672,502 total decoded asset bytes. That is 461,992 fewer total bytes (11.17%)
than the preceding checkpoint, with zero browser errors. Shared groups add two
requests; the byte reduction is not a claim of proportional latency improvement.
The 18 fixture UI/accessibility states passed in `.cache/ui-proof-waxuug`.

At this checkpoint eager dependencies included permission-graph primitives, editor code,
and broad component exports. Their source edges are now inspectable in the report,
but removing those edges requires consumer-by-consumer review. Source graph
discovery does not mark these modules authored or prove they can be deleted.

Canonical-image evidence is `.cache/app-image-proof-HsMMTW`: real login and PAM
route checks are in `result.json`; deliberate nonempty chart rendering and
keyboard filter navigation are in the separate `chart-rendering.json`.
The chart check waits for full-size, stable SVG path geometry before capturing
the screenshot, with a bounded wait. Mounted sectors alone were insufficient:
the first visual review caught the entrance animation before it settled.

## Editor isolation and certificate cards, 2026-10-27

Consumer searches found no application use of the optional Lexical editor.
Its direct feature entry remains available; the general v2 barrel no longer
re-exports its node classes. The emitted startup gate now rejects Lexical too.
`.cache/bundle-proof-0TPEKz/summary.json` records 2,542,268 static-entry JavaScript
bytes and no forbidden modules. All three cold contexts in
`.cache/loading-proof-sDIHXZ/result.json` request 3,008,310 JavaScript bytes and
3,536,677 total asset bytes, with zero browser errors. This removes 135,825 total
bytes (3.70%) from the preceding checkpoint. Limits tighten to 3.1 MB JavaScript
and 3.65 MB total. Local uncompressed measurements remain separate from hosted
performance. Permission-graph and broad-export dependencies still need review.

The existing certificate distribution and expiration cards now share feature-owned
rendering: complete labels, named regions, matching semantic chart/row colors,
44-pixel filter targets and visible keyboard focus. SVG rings have no entrance
animation. Readable rows provide every value and filter action outside the chart;
unknown algorithms and CAs without IDs are noninteractive data. Existing expiry
buckets and inventory filters remain intact. The execution and acceptance record
is [0029](0029-ui-workflow-execution.md).
