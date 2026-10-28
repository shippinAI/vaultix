# Vaultix image identity and source revision

Status: local metadata/build verification accepted; committed-revision build next,
2026-10-28.

## Preceding accepted checkpoint

The create-secret work is committed and pushed as
`8ff85c21d7cbf18ada57df267d2b4a39b5920336`. Canonical image
`sha256:1bdd77c12dc80fad2141eaba7081e5dfac2cd6f0f2c8d48ca4b02b1ce6d15898`
is healthy in the local backend. The database/cache container identities are
unchanged, and the integrated application/API at port 8200 and Vite development
UI at port 3000 return 200 (`.cache/create-secret-dev-rollout.json`). Source push
is recorded in `.cache/create-secret-source-push.log`. This is local rollout,
not a hosted deployment or registry-publication claim.

## Read and findings

The canonical standalone Dockerfile, reduced legacy engine Dockerfile, optional
panel Dockerfile, release workflow and existing image smoke path were read.
Both engine definitions and the panel still label the product URL as
`https://vaultix.shippin.cloud`. The canonical image derives its revision label
from an optional Datadog argument that the release workflow does not set. The
panel and reduced definition have no source-revision label.

Vaultix.cloud is the primary product destination. Instance URLs, Nomen issuer
configuration and DevSCIF control profiles remain separately configured. OCI
metadata must not change an operator's runtime URL, authentication or storage.
The reduced Dockerfile is not the canonical release path and does not include
the complete standalone runtime; metadata alignment is not capability acceptance.

## Acceptance plan

1. Record current image metadata without inspecting runtime environment values.
2. Set the product URL and a first-class source revision in existing Dockerfiles.
   Uncommitted local builds must identify themselves honestly; release jobs must
   supply and check the checked-out commit.
3. Check actual engine/panel image labels before promoting release tags. Keep all
   existing capability gates. A matching unsigned OCI label is not a signed
   provenance attestation or proof of enterprise compliance.
4. Build the canonical standalone image and optional panel, verify identity,
   retained runtime content and appropriate smoke behavior, record exact evidence,
   then commit/push. Do not claim GitHub execution while billing blocks jobs.

Registry access, GitHub billing, Nomen registration and WI/TX deployment remain
external prerequisites. The existing successful local application stays available
while this checkpoint is verified.

## Implemented and verified

The baseline image reports the old product URL and an empty revision
(`.cache/image-identity-baseline.json`); the new check rejects it. Existing image
definitions now use `https://vaultix.cloud` and `VAULTIX_SOURCE_REVISION`, defaulting
to the explicit `uncommitted` marker for local builds. Datadog runtime arguments
remain separate and unchanged. The legacy reduced definition is labelled as such;
it was read but was not built or accepted as a release image.

`scripts/check-image-identity.mjs` inspects only image labels. It checks product,
source repository, vendor, license, URL and revision format; a supplied expected
commit must match exactly. An empty supplied commit is rejected. Smoke checks
run the identity gate before creating resources. Both release jobs pass the
checkout SHA as a build argument. The engine is checked locally before pushing.
The optional panel publishes its revision tag with minimum build provenance,
pulls and checks that exact registry digest, then promotes `latest` from that
digest using `docker buildx imagetools create`. The revision tag is published
before verification; only the moving release tag waits for this check.

The panel retains registry build attestations: loading through a classic Docker
image store can discard them. Promotion copies the existing image index rather
than rebuilding or pushing a potentially reduced local manifest. See Docker's
[attestation storage guidance](https://docs.docker.com/build/metadata/attestations/)
and [image-index promotion command](https://docs.docker.com/reference/cli/docker/buildx/imagetools/create/).
The engine's pre-existing disabled provenance setting is unchanged and remains
a separate release-hardening gap.

Local canonical image
`sha256:60bb6c80d5ae3bca03362130aa78d0f7129efe5726cc67df3a6bdedc78df32a6`
passes the identity gate and Dragonfly image/API/MCP/queue/restart smoke checks.
Its complete ordered filesystem layers and runtime configuration are identical
to the accepted 0044 image, excluding only the two deliberately changed labels
(`.cache/image-identity-runtime-comparison.json`). This preserves the previous
real-browser and Redis runtime evidence without claiming a new browser run.
The optional panel also builds and passes its metadata check. Its runtime and
production deployment were not changed or newly certified by this metadata work.

Both local images honestly report `uncommitted` at this stage. The checker rejects
an expected commit that does not match (`.cache/image-identity-wrong-revision.log`).
Local YAML inspection verifies engine build/check/push ordering and panel
revision publication/digest check/index promotion ordering. A disposable loopback
registry probe could read its HTTP endpoint, but Docker push failed with
`connection refused` before any index promotion. This does not establish a
successful registry promotion (`.cache/image-identity-promotion-failure.json`);
no global Docker configuration was changed and the temporary registry was removed.
The existing 23 publication fixtures passed again after the workflow revision at
`.cache/publication-proof-rDfJRI`. These are local checks, not GitHub execution.
Run `40640517445` has zero steps and the same billing/spending rejection
(`.cache/create-secret-github-blocker.json`). Registry authentication, hosted
deployment and signed provenance remain unresolved independently.

After committing this source, build the canonical and panel images with
`--build-arg VAULTIX_SOURCE_REVISION=<full-commit>`, check both against that commit,
and compare the canonical runtime again before local promotion. Never label an
uncommitted checkout with the previous commit merely to pass the release check.
