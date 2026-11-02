# Vaultix policy ownership

Vaultix's Go authorization evaluator lives in
`core/backend-go/internal/vaultixpolicy`, within the application's own Go module.
Permission resolution, secret metadata/value checks, assumed privileges, built-in
roles and the integration tests import it directly. The former separately named
module and local replacement are removed. There is no second evaluator service
or forwarding layer.

## Behavior and compatibility

The existing stored role tuple format, action/subject identifiers, default roles,
field restrictions and explicit-deny precedence remain. Existing policy and
consumer tests move with the implementation; the same encrypted database remains
authoritative. No database migration or account reset is needed.

Policy construction now snapshots caller-owned conditions, fields, variables and
operator maps. Returned introspection records cannot mutate authority. Compilation
retains concurrency-safe lazy evaluation against the isolated snapshot. Missing
abilities deny access, and comparing collection values cannot panic through Go
interface equality.

Malformed logical conditions, unknown operators, unresolved variables (including
inside arrays), invalid packed tuple slots and incomplete action/subject rules are
rejected. Previously, malformed compound conditions or dropped tuple constraints
could become unconditional rules. Empty literal objects now require equality with
an empty object instead of matching every field value. Valid policy semantics are
retained; accepting malformed authority is deliberately not preserved.

If any persisted custom role cannot be decoded, project authority resolution
rejects the entire request. It cannot drop that role's denials while retaining
grants from other roles. Database-backed tests cover both user and machine
identity memberships, scoped deny precedence, malformed tuples and recovery
after the role is repaired.

JSON entry points enforce a default 1 MiB limit; `LoadOptions.MaxSize` can explicitly
set the byte limit for the JSON API. Expanded policies permit at most 16,384 rules.
Snapshots permit at most 64 traversal levels and 100,000 visited nodes per copied
value. Typed scalar values, string-keyed maps, arrays and slices are supported;
executable values, pointers and cyclic/deeper structures are rejected. Operator
functions are trusted application code, not user-provided executable policy.

## Source history

The package absorbs the previously checked-in evaluator and its regression cases.
Retained algorithms have the provenance recorded in the package's `PROVENANCE.md`
and original MIT `LICENSE`. The snapshot and validation changes are authored here.
This is maintained Vaultix product code with an explicit source history; neither
relocation nor renaming establishes independent origin. The canonical image ships
these notices under `/backend/notices/`.

## Acceptance

`node scripts/test-vaultix-policy.mjs` verifies the compiled dependency graph,
rejects the removed module/replacement, and runs race-enabled package and actual
consumer tests plus vet. New cases cover mutation before/after first use,
concurrent evaluation, malformed conditions, packed role validation, default deny
and recovery with a valid scoped policy.

`node scripts/build-self-hosted.mjs` builds the canonical application and runs its
real workflow, cache, encrypted recovery, tenant, proxy and admission checks.
`node scripts/test-vaultix-policy-image.mjs` then builds the exact committed Go
test stage and exercises native permission and secret services against real
PostgreSQL and the accepted image, with both Dragonfly and Redis. Selected
permission/secret tests must not skip. No external provider credential is needed
for those local boundaries.

These checks do not close the broader React/Go/Rust migration or replace live
provider and public-service acceptance. The current application runs its own
business logic; the remaining TypeScript domains remain implementation work in
this same product and store.

The collection comparison and JSON boundary review used the official
[Go comparison specification](https://go.dev/ref/spec#Comparison_operators) and
[encoding/json documentation](https://pkg.go.dev/encoding/json#Unmarshal), read on
2026-11-02 for the pinned Go 1.27.3 toolchain.
