# Native project and reference reads

READ-01. Work in progress; production ownership has not changed.

## Work packet and dependencies

Continue from the scoped authority/SSO/assumed-actor acceptance in 0061–0063.
The existing React reference UI and MCP actions share `vaultixReferenceService`.
Keep one implementation for both callers when ownership moves. Native services
must query the existing PostgreSQL store directly; forwarding to TypeScript does
not complete this migration. The working project/secrets deployment stays live.

Read the complete reference service, input contract and router; trace project
listing, folder resolution, reference-page SQL and the permission predicates.
The surrounding large project/folder/secret DAL files are only traced at the
relevant methods so far, not fully reviewed. Go project/environment services,
folder lookup entry, auth identity context and secret permission checker are
read as dependencies; this does not verify those whole workflows.

### Implementation sequence

1. Author a native reference service with mandatory authenticated context and
   project permission resolution. Preserve user/machine actors, assumed authority,
   legacy read/describe permissions, tag conditions and safe errors.
2. Query only shared reference identifiers, names, versions and timestamps.
   Personal overrides, comments, values/ciphertext, custom metadata and imports
   are absent from the current reference response; never call the value-reading
   secret service to implement metadata reads. Imported-reference convergence is
   a separate compatibility decision, not an implicit expansion of this API.
3. Preserve physical-row pagination before per-row permission filtering. An empty
   visible page may have `nextOffset`; clients must continue until null. Bound
   input and use parameterized SQL. Match existing UTC millisecond timestamps.
4. Author project/environment listing with direct and group membership semantics,
   active project/environment filters and deterministic ordering. Trace selected
   organization authority and assumed-actor behavior before replacing that path.
5. Add native HTTP/OpenAPI and shared action/MCP dispatch, origin/rate/error
   boundaries and audit ownership. Define rollout/rollback and retire the old
   domain only after equivalent UI/MCP and denial/failure tests pass.
6. Verify differential behavior against the canonical application, value canaries,
   query failures, cancellation, tenant/role revocation, pagination and stale
   replica cases. Build the committed standalone image; run native lint/race/
   integration and the preserved application gates before cutover.

## Data and authority decisions

Reference filtering uses secret tags as authorization inputs. Native reference
rows and tags will come from the primary database, alongside the existing native
primary-only permission resolver. Reading stale tag assignments from a replica
could make revoked conditional access appear valid. These separate statements
are not a serializable authorization snapshot; do not claim race-free revocation.
The native folder query resolves only the requested path rather than loading all
folders for an entire project. Existing encrypted formats and schema remain intact.

The current API admits JWT users and identity access tokens only. Unsupported
actors, absent selected organization, invalid bounded queries and missing authority
must refuse before metadata queries. Fine-grained filters remain mandatory even
after a subject-level describe check. Transport errors must mask unavailable and
forbidden resources consistently and keep a plain `error` string.

No native route forwarding, Nomen registration, new AI mutation or second secrets
store is enabled by this work packet. Public-cloud/provider/manual accessibility
and full capability parity remain under their existing acceptance gates.

## Domain implementation and discovered differences

`core/backend-go/internal/services/secretmanager/reference` now owns primary-only
project/environment metadata and bounded reference-page queries against the
existing tables. No TypeScript service is called by this implementation. It is
not wired to production routes yet; HTTP/MCP, audit ownership and final cutover
remain steps 5–6 above. Project creation remains outside this read slice.

Project discovery preserves direct/group membership, including visibility for a
member whose role is `no-access`; discovering a project never grants reference
access. It excludes other products and deleted projects/environments, returns
empty arrays, and deduplicates overlapping direct/group membership. Ties gain
stable project/environment ID ordering. Groups must belong to the selected
organization. This explicitly rejects corrupt cross-organization group links;
the older DAL does not check that invariant itself. Project listing retains the
existing unpaginated contract; this is not measured large-tenant capacity proof.
Organization-session enforcement and assumed-requester discovery still require
transport-level acceptance before cutover.

The first real differential found an array permission mismatch: the vendored Go
`$in` operator compares an entire tag slice with each candidate. The application's
CASL matcher compares its elements. Product-owned operator extensions now apply
element membership and negate the complete match for `$nin`, while retaining
scalar evaluation, compiled variable resolution and other rule conditions.
The vendored implementation and its provenance are unchanged. The regression
tests fail before the fix for a matching `$in` grant and `$nin` exclusion.
This is scoped operator compatibility, not full CASL equivalence: array `$eq`/
`$ne`, other operators and rule-order differences between the native deny-first
evaluator and CASL need broader comparison before route ownership changes.

The first reference differential failed on the conditional-tag case; its receipt
is `.cache/assumed-workflow/.cache/native-reference-dragonfly-before-membership-fix.json`.
After the fix all 17 then-existing checks passed. A later expanded run passed
33 checks and failed the value-only denial fixture, which incorrectly expected
HTTP 403. The existing Vaultix transport masks forbidden resources as HTTP 404.
The corrected test checks HTTP 404 alongside a native service-level 403 and no
page. The failed receipt remains `native-reference-dragonfly-denial-fixture.json`
in the same directory. No authorization behavior was relaxed.

The integration fixture's reference reader has column-level SELECT grants for
names, IDs, versions, timestamps and permission tags. A broad secret SELECT is
explicitly denied by PostgreSQL. Value, personal-value, comment and metadata
canaries are absent from responses; imported values are not read. Permission
resolution uses its separate normal primary connection. A replica accessor panics
if used. Real tag removal, unavailable metadata primary and cancellation are
exercised. Trusted service contexts are fixture inputs, not native HTTP auth proof.

Full development lint passes with integration tags, zero issues, and the existing
`exhaustruct` deprecation warning. A broad source-mounted unit run failed with a
Docker filesystem `cannot allocate memory` error during package enumeration;
its receipt is `.cache/assumed-workflow/.cache/reference-unit-development.log`.
The isolated snapshot run completed 724 passing checks and identified two failing
entries in one new variable-resolution fixture; integration-tagged vet passed.
That fixture incorrectly assumed recursive variable interpolation inside a vendor
array. It now supplies a direct variable containing the candidate list, matching
the vendor compilation contract. Product rule interpolation remains unchanged.
The failed receipt is `native-reference-unit-vet-variable-fixture.json` in the
same evidence directory. Committed-image acceptance remains pending.

The final development reference/project differential passes 35 checks with zero
failures/skips or setup diagnostics on Dragonfly:
`.cache/assumed-workflow/.cache/native-reference-dragonfly.json`. This uses the
previous canonical application image and mounted candidate Go source, not a new
committed artifact. Redis and full immutable native/application checks follow.
