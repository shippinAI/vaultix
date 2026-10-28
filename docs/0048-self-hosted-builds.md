# Self-hosted builds and visible review

Accepted direction, 2026-10-28. The owner has three bare-metal servers and wants
to build and operate Vaultix there. This supersedes the hosted-first delivery
order in 0018. It does not reduce capability, authorization, accessibility or
store-preservation requirements. The public-service target is clarified in
[0054](0054-public-cloud-service.md): owned bare-metal infrastructure runs
Vaultix.cloud; local build ownership does not replace public-cloud acceptance.

## Delivery boundary

GitHub hosts reviewed source. Automatic push/PR Actions are disabled; the existing
cloud workflows remain manual-only alternatives with their checks intact. Local
builds do not require a GitHub runner registration, GHCR account or registry push.
Never copy the cloud workflow's ephemeral-runner disk cleanup onto a persistent
server. No system pruning or unrelated container deletion belongs in local builds.

The canonical Dockerfile remains `core/Dockerfile.standalone-vaultix`. Build a
committed source archive rather than an ambient working directory that may hold
ignored operator files. Verify the actual image's source revision, real disposable
application workflows and Dragonfly/Redis behavior before using it. Record scoped
results and the image ID; an image label alone is not proof of successful tests.

## Build on your own machine

Prerequisites: Git, Bash, tar, ripgrep, curl, OpenSSL, Node 22 or newer, a Linux Docker engine with Compose
v2, and enough disk/RAM for the existing frontend/backend build (the frontend
uses an 8 GiB Node heap). On Windows, use Git for Windows Bash and Docker's Linux
engine. The current validation host is Windows/amd64; other hosts and
architectures still need their own successful receipt. Initial dependency and
base-image downloads require network access; this is not an offline-build claim.

Prepare the pinned browser test dependencies once per checkout:

```sh
cd core/e2e
npm ci
npx playwright install chromium
cd ../..
node scripts/build-self-hosted.mjs --check
node scripts/build-self-hosted.mjs
```

On Linux, install the browser's OS dependencies using your server's managed
package process. An existing Chrome installation can be selected with
`VAULTIX_BROWSER_CHANNEL=chrome`. The command requires clean, committed source;
it never stashes or discards changes. `--check` is read-only. The default mode
builds `vaultix:<full-commit>`, verifies image identity and identity-policy startup,
then runs real application/browser acceptance on Dragonfly and the Redis smoke
suite. `--capabilities` additionally builds the Go/backend test stages and runs
their existing integration suites against both caches plus backend unit tests.
Run only one capability build per Docker daemon: the existing test-stage tags
are shared. A checkout lock prevents overlapping invocations in that checkout;
after a killed process, inspect the recorded PID before removing a stale lock.

Each step writes a local log and updates `.cache/self-hosted-build-*/result.json`.
`passed: true` is issued only after every selected step passes, the source remains
clean at the same commit and the final tag still resolves to the tested image ID.
Failures stop the build sequence. These logs are local diagnostic data, not public
artifacts. No registry push, production deployment, external-provider acceptance,
full WCAG certification or whole-product parity is implied. This command does not
replace every check in the optional cloud workflow.

Use the successful receipt's immutable image ID on the **same Docker engine**:

```sh
export VAULTIX_ENGINE_IMAGE='sha256:<imageId from the successful receipt>'
bash scripts/up.sh
```

The configured PostgreSQL/Dragonfly services and existing volumes are retained.
For a different machine with the same architecture, `docker image save` and
`docker image load` can transfer the tagged image without a registry. Compare its
image ID and source-revision label to the receipt after transfer. Choose the
actual target and its backup/restore procedure before changing a running server.
Do not set `VAULTIX_PULL=1` for a local image; that option is for explicit registry
deployments. Compose defaults are `vaultix:local` and optional
`vaultix-panel:local`, not a downloaded application image.

Server assignment, OS/architecture, existing SSH access and the preview hostname
are pending owner input. Do not infer a cluster, change production firewall/DNS,
or provision three independent secrets stores. Choose the first single-instance
deployment after those facts are known; shared storage, backups, replication and
failover need separate acceptance. Existing keys and database volumes survive
upgrades. Credentials stay in the operator's existing access/configuration tools.

## Review experience

The current application is available at `http://127.0.0.1:8200/`; Vite development
UI is at `http://127.0.0.1:3000/`. The retained instance currently opens first-admin
setup. Real login and authenticated-workflow proofs use disposable instances,
not invented operator accounts. The latest create-sheet evidence is
`.cache/app-image-proof-1653IB/dashboard-create-mobile.png`.

Continue the existing steel-dark/mint vector direction unless the owner chooses
to explore alternatives. Bring concrete screen/art options for meaningful design
decisions. Keep artwork lightweight and decorative; do not replace the real app
with a mockup or review gallery. Screenshots describe their actual tested state.

## Verification record

The delivery change passed nine isolated orchestration fixtures in
`.cache/self-hosted-fixtures-WxeKDm/result.json`: read-only preflight, application
and capability sequencing, dirty-source refusal, lock ownership, build failure,
application failure, concurrent source change and image-tag change. Git and tar
are real in these fixtures; Docker and capability gates are simulated. They do
not prove the application itself. The 23 publication/history fixtures also pass
in `.cache/publication-proof-cvitRq/result.json`.

Real Compose rendering against disposable configuration verifies local defaults,
explicit immutable-image selection, source-revision build arguments, Dragonfly,
loopback binding and preserved volume definitions. Both workflow files parse with
only `workflow_dispatch` triggers. Evidence:
`.cache/self-hosted-compose-Bod5ym/result.json`. No operator configuration was read
or changed by these fixtures.

The first real committed-source run built `b414b12` successfully and passed all
18 identity-lifetime startup cases, then correctly stopped on a generator Escape
failure during the Dragonfly browser workflow. Receipt:
`.cache/self-hosted-build-17PHFT/result.json`. A diagnostic repeat reproduced a
visible, still-open generator with focus inside after Escape:
`.cache/app-image-proof-FByuLf/dashboard-create-generator-dismissal.json`.
An intervening pass did not supersede this failure.

The generator now handles Escape from its own focused controls as well as the
shared document layer, and leaves an expanded nested selector to handle Escape
first. The dashboard regression check repeats open/dismiss six times, requires
focus restoration, and records only layer/focus metadata. No generated value is
recorded. Random generation, policy matching and clipboard behavior remain
unchanged; this change does not certify those separate concerns.

The corrected commit `ff1c7eaf857c39cc5e022ffb93640ef3142b7e5b` passed the full
`--capabilities` run on the local Linux/amd64 Docker engine:

- Canonical image: `sha256:0b7a93099844a6c22e387cbb76455fc264e6ea8799793ccadb68eb7ed80eb48e`.
- Receipt: `.cache/self-hosted-build-iW5cuv/result.json`, all 17 steps passed.
- Identity-lifetime startup: 18/18. Dragonfly real sign-in/application, queue and
  restart checks, and Redis smoke: passed. The 273 UI routes and 2,290 API
  operations remain in the baseline.
- Actual browser evidence: `.cache/app-image-proof-E63t5Q/workflow-result.json`.
  Six generator dismissals restore focus and retain the sheet. Selected desktop
  and 320px create states have no automated axe violations; manual-review items
  remain in `dashboard-create-accessibility.json`.
- Native Go integrations with race detection: 473 passed, 0 failed, 8 skipped per
  cache. `.cache/go-proof-A52N4g/result.json` (Dragonfly) and
  `.cache/go-proof-JASmvL/result.json` (Redis).
- Backend unit: 1,892 passed, 22 skipped across 121 files;
  `.cache/unit-proof-JMFqZN/test-results.json`.
- Backend database workflows: 170/170 across 12 files per cache;
  `.cache/core-proof-QqDeX6/test-results.json` (Dragonfly) and
  `.cache/core-proof-jhog2V/test-results.json` (Redis).

Final delivery review tightened image selection: resolve the image ID first,
then verify its exact source revision and use that same ID throughout runtime
checks. This avoids relying on a movable tag between identity and execution.
The nine orchestration fixtures enforce that invariant in addition to the final
tag-stability check (`.cache/self-hosted-fixtures-Q6m3K9/result.json`).

Final delivery commit `e977611456a88dc88914de5b3397961c8951a878` passed the repeated
application acceptance in `.cache/self-hosted-build-OXAKQP/result.json`, producing
`sha256:4e2e44a2d87c1914d001fbfd07aea55036c7cb1ab5290bd3d9d77d0730df24c7`.
Its core source, packaged filesystem layers and runtime configuration match the
fully capability-tested image above; the source revision label is updated.
Evidence: `.cache/self-hosted-runtime-comparison.json`. The final browser run is
`.cache/app-image-proof-5cZoie/workflow-result.json`.

The local `vaultix-dev` application was updated by immutable image ID with
`--no-deps --no-build --pull never`. It is healthy, and application/API responses
at port 8200 and the development UI at port 3000 are HTTP 200. PostgreSQL and
Dragonfly container IDs are unchanged. No operator configuration or database
volumes were replaced. Evidence: `.cache/self-hosted-preview-result.json`.
The visible browser opens the retained instance's first-admin setup; real
authenticated workflow evidence remains from disposable instances. Remote
bare-metal deployment awaits the owner's server/access details.
