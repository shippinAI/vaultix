# Catalog learning and upload integration

This integrates the outstanding bounded-upload branch and the unfinished native
learning panels into main. First-owner atomic setup remains intact. The existing
authenticated application stays at `/`; learning panels belong to the optional
`/help` reference and connection workflows.

## Learning boundary

The catalog authors short tips for reference and client-connection workflows.
HTTP and MCP return the same document. The UI filters only by the fixed workflow
identifier and uses the shared accordion for optional reading. It neither infers
user expertise nor records project names, folder paths, searches, or activity in
browser storage. No model generation, database-derived teaching, remote viewport
execution, or persistent learning profile is claimed. Existing Guide Me dialogs
remain the interactive lesson path.

New catalog arrays are additive. An older server without them still renders the
existing guide. Present-but-invalid arrays fail validation: bounded text and list
sizes, unique identifiers, supported contexts/kinds, catalog provenance, and
separate inclusion/review fields are required. Plain text is rendered by React;
there are no authored URLs, HTML, selectors, or executable commands in tips.

Capability families organize the roadmap. Software inclusion is independent of
verification, configuration, and permissions. All listed families explicitly
remain under migration/review; the panel does not establish enterprise parity.
The public content contains no tenant data and grants no permissions.

## Upload merge

`fix/bounded-oversized-upload` is merged with its ancestry preserved. Its parser
handler discards at most an additional 2 MiB plus one stream chunk or waits
250 ms before replying to rejected oversized requests. Existing body limits and
Connection: close behavior remain. See 0034 for client/proxy limitations. No
storage, schema, authorization, provider, or first-owner contract changes here.

## Acceptance

Source contract checks cover absent optional fields, context filtering, bounded
content, duplicate IDs, provenance, and unverified capability labels. Browser
checks add keyboard expansion, optional roadmap reading, narrow layouts,
accessibility scans, and old-server compatibility to the existing guided-help
suite. The full standalone image and runtime acceptance are required before
publication. Results are recorded after execution; these descriptions alone are
not passing evidence.

Full authenticated UI conversion, Nomen session migration, live AI teaching,
manual screen-reader review, external provider parity, and remote bare-metal
rollout remain separate work.
