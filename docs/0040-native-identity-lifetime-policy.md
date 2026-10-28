# Native identity lifetime policy

Status: scoped implementation and local image acceptance verified, 2026-10-27.
Workstream: AUTH-01, following [0039](0039-native-scoped-revocation.md).

## Existing contract

The TypeScript issuer uses `MAX_MACHINE_IDENTITY_TOKEN_AGE`, defaulting to 90
days, for per-issuance expiry, revocation-marker retention and use-counter expiry.
Historical identity JWTs without `exp` are accepted only through a deployment-
anchored grace window: `LEGACY_IDENTITY_ACCESS_TOKEN_EXPIRATION_ENFORCED_AT`
(default 2026-05-04 UTC) plus the configured maximum age. The boundary is strict:
deny after the deadline, not at it. Tokens with `exp` retain normal JWT expiry
validation. The policy is not in the runtime configuration override allow-list.

The preceding Go implementation had neither configurable policy field. Its
recovered use counter expired after a fixed 30 days, and its JWT parser permitted
a missing expiry without an identity-specific grace check. Both differences
were reproduced before changing production Go code.

## Reproduced differences

`.cache/go-proof-n9Sajh/result.json` records the unchanged Go baseline against
the canonical 0039 image. The actual API-issued zero-budget credential had
7,776,000 seconds of counter retention; native recovery supplied 2,592,000.
Recovery consumed a use correctly, isolating retention from the previously
repaired concurrency behavior. The signed historical-format fixture was denied
through HTTP but accepted through both native validation entry points after
the default grace deadline. Its expiring control worked through both paths.

The separate unchanged-config snapshot `vaultix:lifetime-config-before` accepted
all nine invalid lifetime/date cases in
`.cache/lifetime-config-baseline.jsonl`. This is configuration-boundary evidence,
not an exploit against an operator deployment. Baseline images were never rolled
into the development stack.

## Authored policy and compatibility

Native `config.IdentityTokenPolicy` owns a validated, immutable maximum age and
deployment-anchored legacy deadline. Authentication requires an explicit policy
dependency; its zero value cannot enable a default or unlimited lifetime.
Both identity entry points apply the same missing-expiry check. Expiring JWTs
still pass through signature and expiry validation. Cache recovery uses the
configured maximum age while preserving conditional initialization and one
decrement per accepted request. This does not make cache-loss accounting durable.

The duration grammar follows the installed issuer's `ms` parser: one unit,
case-insensitive aliases, decimal quantities, unitless milliseconds and flooring
to whole seconds. Empty/trimmed configuration retains the 90-day default.
Both processes now reject non-finite, non-positive, sub-second and overflowing
lifetimes. The upper bound is 9,223,372,036 seconds, the whole-second range of
Go's cache duration representation. Previously accepted invalid settings are
deliberately rejected at startup; they must be corrected before deployment.

The existing issuer retains JavaScript Date coercion. Its launcher forwards the
resolved date as `unix-ms:<integer>` and the age as whole seconds, preventing
different locale/timezone interpretations or launcher overrides from splitting
authentication policy. The full JavaScript date range is preserved. Standalone
Go also accepts an ISO calendar date (UTC) or ISO timestamp with explicit timezone;
other human-readable dates must be normalized when deploying Go independently.
The default remains 2026-05-04 UTC. Deadline comparison retains millisecond
precision and the issuer's strict-after rule. No operator clock is modified.

The real auth fixture supplies a two-hour maximum and an enforcement anchor one
day before fixture startup to both the packaged issuer and Go config. This
replaces the baseline's calendar-dependent precondition. Exact deadline cases
use an explicit test instant; these are boundary tests, not elapsed-time waits.

## Plan and dependency boundaries

1. Issue a limited-use credential through the real universal-auth API. Measure
   its actual cache TTL, delete only its isolated fixture counter, validate it
   through Go and compare retention. Verify that recovery still consumes one use.
2. Separately create a signed historical-format fixture backed by a real token
   row. An expiring control must work through HTTP and Go; an expiry-free payload
   must honor the issuer's elapsed grace. Label these as fixtures, not actual
   historical credentials or newly issued expiry-free tokens.
3. Define and test explicit duration/date configuration semantics, including
   default/empty/trimmed values, supported units, precision, invalid values and
   overflow. Trace existing date coercion before choosing native compatibility;
   do not silently substitute a different date or lifetime.
4. Pass validated policy into native authentication independently of the Node
   launcher. Apply the same retention to recovery and grace to both identity
   validation entry points. Preserve signature/expiry, legacy row constraints,
   membership, IP, scoped revocation and concurrent use-budget behavior.
5. Exercise a non-default policy through the real image/cache fixture and exact
   deadline cases with an explicit test clock. Invalid security policy must fail
   startup clearly. Never alter operator clocks, credentials or cache keys.
6. Run relevant TypeScript and Go checks, both cache integrations and the
   canonical standalone image/browser gates. Record failures and exact evidence,
   then commit and push before proceeding to the next authentication gate.

The complete native config/loader/service wiring, TypeScript environment schema
and its duration/trim helpers were read during 0039. Further findings there
(cloud derivation, integration aliases, inherited cookie default, publication
script and supervision) remain separate investigations. Other authoritative
reads, minimal core claims, legacy tenant binding, Nomen ownership, external
topology and complete native cutover are not implied by this packet.

## Verification evidence

Auth candidate built from `core/Dockerfile.standalone-vaultix`:
`sha256:51f087cc19778a5e5b76dd7d2ce1cbbaade5a864ccca9205794eb0552599da90`.
Native integration/runtime snapshot:
`sha256:bbcc622d3067ca2645fd0d23b2116fc95f48d6a512ed739d15bbf7120c4ef320`.
The unchanged Go baseline was
`sha256:a644c53b16e4e836d055699b0b3f1a48c0ca0bb7b0f4302d303ae3e620f22cfc`
against the 0039 image. The invalid-config baseline snapshot was
`sha256:fa3ca359494744afb311aea69b74df6319c4c9506855326703daec4070e86c5b`.

- Go unit/race: 597 passing tests in `.cache/lifetime-go-unit-epoch.jsonl`;
  native lint reports zero issues in `.cache/lifetime-go-lint-epoch.log`.
- Real-image Go integration/race: 270 passing tests per cache, with eight
  external-KMS skips. Results are `.cache/go-proof-v1YQ0E/result.json`
  (Dragonfly) and `.cache/go-proof-1EOCPM/result.json` (Redis). No setup failure
  occurred in these final runs; the prior packet's unexplained Redis failure
  remains recorded separately.
- TypeScript unit: 1,892 passing tests and 22 existing skips in
  `.cache/unit-proof-vfJJjf/test-results.json`. Type checking and scoped lint
  pass in `.cache/lifetime-ts-types.log` and `.cache/lifetime-ts-lint-epoch.log`.
- TypeScript database workflows: 170 passing tests per cache in
  `.cache/core-proof-mfFwYc/test-results.json` and
  `.cache/core-proof-xwLoUg/test-results.json`.
- Actual packaged startup: all 18 invalid-config cases pass in
  `.cache/identity-policy-proof-oAErwy/result.json`. The new runnable
  `scripts/test-identity-policy-startup.mjs` runs each binary with networking
  disabled and retains only field-match/exit metadata, never raw logs.
  GHCR invokes the gate and uploads its result; YAML parsing passes locally.
  This is not evidence that the GitHub step has executed.

An intermediate lint run caught missing explicit constructor dependencies in
test fixtures and an unused TypeScript import; both were corrected before final
verification. Intermediate images were not installed. The issuer still owns
issuance/renewal; this packet does not turn on Go forwarding, shadowing or workers.

## Project readiness and upload controls

Visual review of the first browser proof (`.cache/app-image-proof-VZEV2P`)
showed that the project screenshot still contained the loading table. The old
heading/URL check did not establish completed overview loading. Acceptance now
requires the actual overview response for the created project, a rendered empty
state, a unique enabled create action and removal of the loading table.

That stronger gate failed against the auth candidate in
`.cache/app-image-proof-BDpR4J`: nested tooltip/button elements exposed two
`Add a New Secret` buttons. The existing SecretDropzone is authored in place:
Radix triggers use their actual button child, the upload input has an accessible
name and visible focus on its surface, and denied actions remain keyboard
focusable for explanatory tooltips while guarded handlers refuse activation.
The file parser, import callbacks and project permission evaluator are retained.

Visual inspection also rejected the first 320-pixel fixture screenshot despite
its document-width check passing: controls extended outside the card. Actions
now wrap in normal flow. The check requires each action rectangle to remain
inside the card, not just the document to avoid a scrollbar.

Six isolated component cases pass at 1440, 390 and 320 pixels in
`.cache/dropzone-proof-YuxurI` (final formatted sources; visual review also used
`.cache/dropzone-proof-0Gy0tJ`). They cover unique controls, named file input,
visible focus, keyboard ordering/activation, allowed paste, denied pointer and
keyboard activation, explanatory tooltip, reduced-motion layout and scoped axe
checks with no rule exclusions. Permission context and child import dialogs are
explicit fixtures; this is not real import or whole-application accessibility
evidence. Real CASL evaluation and production controls are used. Fixture setup
errors (missing exports/provider) were corrected separately from product defects.
Frontend type checking and scoped lint pass. The new fixture is included in
GHCR checks, with screenshots and reports retained; GitHub execution remains
unverified while the account job-start blocker persists.

## Final artifact identity

The final UI/auth image built from the canonical Dockerfile is
`sha256:70788497738195c1f4239ebb8867f2dadde786a19133133ecfdd7a18a81c397c`.
The integration suites above executed against the earlier `51f087c` auth image,
not this final image. Their backend evidence remains applicable by explicit
artifact comparison: all 90,368 regular backend files outside frontend-build
and the incremental TypeScript build cache are byte-identical, as is the image
runtime configuration. This includes the native executable, emitted issuer,
dependencies and entrypoint. The full manifest differed only at
`/backend/.cache/tsconfig.tsbuildinfo`; no application file differed.
`.cache/lifetime-runtime-artifact-comparison.json` records the image identities,
file count, comparison scope and matching digest. This is regular-file/config
comparison, not a claim about all filesystem metadata or new integration runs.

The changed frontend requires its own packaged workflow evidence. Earlier
skeleton screenshots are explicitly insufficient for the strengthened gate.

The final Dragonfly image gate passes in
`.cache/lifetime-final-image-dragonfly.log`. Real sign-in, project creation and
completed overview loading pass in `.cache/app-image-proof-zMKCF4`, with
`project-overview.json` recording the response/state assertions and the new
screenshot visually reviewed. Existing real navigation and separately labelled
recovery/environment fixtures also pass. API request-error evidence is
`.cache/api-error-proof-Nrooz4`. The source guard retains 273 UI routes and
2,290 documented API operations; this remains surface preservation, not complete
capability proof. Owned-source and migration-map tests pass.

The final Redis image gate also passes in
`.cache/lifetime-final-image-redis.log`, including queue and restart checks;
request-error evidence is `.cache/api-error-proof-3mCh1b`. No operator data was
used by these disposable checks. The accepted image is ready for the local dev
rollout. GitHub publication, Nomen registration, WI/TX topology, ElastiCache and
external providers remain unverified. This closes the lifetime-policy and scoped
upload-control packet, not AUTH-01 or the overall migration.
