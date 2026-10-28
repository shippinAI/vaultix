# Publish the committed Vaultix application

Status: implementation and local acceptance verified, 2026-10-27.
Workstream: delivery. Preceding checkpoint: [0040](0040-native-identity-lifetime-policy.md).

The previous publication script copied the checkout into a new repository,
excluded the canonical standalone Dockerfile (and a nonexistent FIPS filename),
created a new history and offered a force
push. It also changed global Git authentication and treated any repository lookup
failure as permission to create a repository. Those behaviors cannot publish the
reviewed application reliably. The old script was inspected, not executed.

## Contract

Publish the existing committed `main` from this checkout to its configured,
validated GitHub destination. Require a clean tree, the core standalone and optional panel Dockerfiles
and the GHCR workflow in the commit, and no tracked operator environment file.
Require the existing remote main to be a locally available ancestor. Refuse
unknown history, divergence and configuration ambiguity without fetching or
changing the repository. The final push must be an ordinary, explicit-SHA push;
the server remains responsible for rejecting races and protected-branch failures.

`--check` performs the same read-only local/history checks without pushing.
The default invocation and `--push` publish the checked commit. Neither mode
creates a repository, commits files, stages a second tree, changes global tooling,
fetches, force-pushes or reads ignored operator secret files. Successful source
publication does not establish successful Actions or container publication.

## Acceptance plan

Exercise the real script against disposable local Git histories with only its
GitHub network operations replaced by explicit fixtures. Cover clean preflight,
exact-commit push, dirty and detached states, wrong branch/destination, missing
Dockerfiles/workflow, tracked operator configuration, missing/unknown/divergent
remote history and push failure. Assert that failure never falls back to force,
fetch, repository creation, global auth setup or automatic commits. Preserve
fixture evidence separately from an actual source push or registry publication.

The canonical product image is unchanged by this tooling packet. Retain 0040's
image/browser evidence; build the canonical Dockerfile and record whether the
result still matches. Update the exact-blob review ledger and commit the script,
tests and delivery instructions before using the new publication path.

## Preceding rollout

Commit `73ab76b0c06eb90c88f714308b09f671cfa1ad80` was pushed normally to main.
The accepted 0040 image `70788497738195c1f4239ebb8867f2dadde786a19133133ecfdd7a18a81c397c`
is running in `vaultix-dev-backend-1`; its health is healthy and API port 8200
and source UI port 3000 return 200. Only the backend container was recreated;
the existing database and cache were retained.

GHCR run `40624307508` and owned run `40624307494` failed before executing any
steps. Their annotations report failed account payments or a spending limit;
this remains an external account prerequisite. The source push and local image
are verified, but no new GHCR publication is claimed. WI/TX target and Nomen
registration details remain outstanding.

## Authored behavior and verification

The existing script now publishes this checkout's exact reviewed commit. It
rejects dirty/detached/non-main states, mismatched or ambiguous origin settings,
URL rewrites, the removed force option, missing committed build inputs, tracked
operator configuration, unavailable remote main and non-ancestor history.
Preflight rechecks the checkout before pushing. The remote may still change
after inspection; an ordinary explicit-SHA push preserves the server's
non-fast-forward and branch-protection checks. No automatic retry is made.

All 23 runnable cases pass in `.cache/publication-proof-FoKjYh/result.json`.
The tests execute the actual shell script and actual Git repositories. Only
GitHub network calls are replaced: they target disposable local bare repositories,
so ancestry, object preservation and non-fast-forward rejection are real Git
behavior. The concurrent-remote case advances the fixture remote after preflight
and confirms the publication push fails without overwriting it. No test contacts
GitHub, modifies global Git configuration, or reads operator secrets. Fixture
traces and result JSON remain explicitly labelled.

Shell syntax, owned-source checks and workflow YAML parsing pass. GHCR now runs
the publication fixtures and uploads result metadata; its execution remains
unverified under the account blocker above. README documents preflight, explicit
source publication and the separate requirement to verify container publication.

The canonical rebuild succeeds as
`sha256:70e4d54a95ab2f44b9a714092be6d4a13b5456657f609d7cef6f77f594ae62df`.
Its complete ordered filesystem layers and runtime configuration match the
accepted 0040 image; `.cache/publication-artifact-comparison.json` records both
identities and equality. Build/attestation metadata changes the image identifier.
No product files changed, so the already verified and healthy 0040 development
container is retained. This tooling change does not resolve account billing,
Nomen registration, provider acceptance or WI/TX deployment prerequisites.

## Live preflight correction

The first live preflight after the tooling commit correctly refused to push,
but exposed an incorrect prerequisite in that commit: it required a standalone
FIPS Dockerfile that does not exist in this checkout. The earlier script's stale
exclusion and architecture notes were not evidence of an existing build input.
No history was changed by the failed check and no source push occurred.

The release prerequisites now match the actual GHCR builds: the core canonical
standalone Dockerfile, optional panel Dockerfile and GHCR workflow. Fixtures
copy those actual files instead of fabricating placeholder Dockerfiles, so a
nonexistent input cannot silently become a passing fixture. This correction does
not add a FIPS image or establish FIPS/government acceptance.

The corrected 23-case run passes with actual build inputs in
`.cache/publication-proof-FoKjYh`. The architecture guidance in `core/CLAUDE.md`
now records the missing standalone FIPS image instead of asserting compliance.
