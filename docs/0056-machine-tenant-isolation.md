# Packaged machine-identity tenant isolation

This packet adds reproducible real-image checks for selected CLOUD-01/02 authority
boundaries in [0054](0054-public-cloud-service.md). It does not open public signup
or complete public tenant enrollment. Nomen remains the target identity/session
owner; real issuer registration, human enrollment, invitations and recovery still
need their own acceptance.

## Run and scope

```sh
node scripts/test-tenant-isolation.mjs vaultix:<full-source-commit>
```

The local build orchestrator now requires this check after encrypted recovery,
using the same verified immutable image ID. A failure prevents a successful build
receipt. The runner creates one disposable PostgreSQL database, Dragonfly and
canonical application on an internal Docker network with no published ports or
outbound route. It does not accept an operator URL or configuration file. Required
dependency images are the same pinned local images as the recovery runner.

The instance owner creates two separate organizations through the existing API.
Each gets its own project and machine identity, organization member role, explicit
project admin membership and short-lived token. The owner provisions both fixtures
but is never used as the actor for the isolation assertions. This is independent
machine authority in two organizations, not two independently enrolled humans.
There are no direct SQL inserts or mocked authentication/permission responses.

The executable checks require:

- Each identity lists exactly its own project. HTTP and MCP results agree.
- Reference results expose only the five allowed reference fields, excluding
  planted values, comments and custom metadata.
- Foreign projects and nonexistent project IDs return the same 404 body through
  the native HTTP and MCP actions. Client-supplied actor organization fields fail
  validation rather than changing authority.
- A machine identity that successfully writes its own secret cannot write into
  the other project. The other identity's reference list remains unchanged. The
  retained compatibility write API may return 403 or 404; no identical-error or
  complete enumeration-resistance claim is made for that inherited endpoint.
- Organization/project privileges do not grant instance configuration access.
  Signup remains disabled and repeated first-owner bootstrap remains closed.
- Revoked and anonymous credentials fail HTTP/MCP actions. The other tenant keeps
  working, including after an application restart. This is not a cache-loss or
  multi-replica revocation test.

The shared `scripts/lib/disposable-image.mjs` owns the two runners' container
lifecycle, image resolution, bounded internal HTTP requests and cleanup. Containers
are tracked by returned IDs before startup, and only owned resources are removed.
The helper never dumps Docker environment configuration or raw command errors.
Fixture credentials travel in process memory/stdin and container runtime settings;
Docker daemon access remains privileged. Result receipts contain safe check labels
and statuses. Cleanup failure prevents success.

## Existing code traced and retained

The native router derives the actor from verified request permission, parses an
allowlist of reference arguments and calls the same reference service for HTTP
and MCP. The service obtains project permission before folder/reference queries
and filters each reference using the existing secret-description policy. The
native error handler deliberately normalizes forbidden/not-found resources to
404. This packet adds packaged characterization; it does not claim a completed
Go domain migration or whole-module authorship for the surrounding inherited
identity, membership and permission services.

Fixtures use existing organization creation, organization selection, project and
identity creation, project membership, token-auth issuance/revocation and secret
creation endpoints. The prior in-process reference tests remain intact. Their
SQL projection/pagination assertions complement this image test and are not
replaced by it. The pending native API/MCP edits in the main worktree were not
included or modified by this packet.

## Public-cloud requirements still open

CLOUD-01/02 remain open. These checks do not prove human enrollment or Nomen
issuer/session/logout, all legacy API authorization, custom/group/temporary roles,
imports, exports, jobs, provider adapters, scheduler isolation, noisy-neighbor
fairness, distributed rate limits, or multi-replica/cache-failure consistency.
Public signup must never call instance-owner bootstrap. No federation setup is
added to first-owner creation and no authentication defaults are loosened.

Results are local `.cache/tenant-isolation-*/result.json` receipts. The shared
harness extraction also requires repeating the nine encrypted-recovery checks;
fixture-only orchestration success is not a substitute for either real-image run.
