# Capability planning workspace

Start with [the product plan](../0049-capability-product-plan.md). This workspace
connects product requirements to structural discovery without certifying that a
feature works. It is a planning artifact, not the application or its action catalog.

Run `node scripts/serve-capability-plan.mjs`, then open
<http://127.0.0.1:4310>. The read-only explorer filters requirements by group,
phase and implementation state, shows acceptance criteria and lists discovered
provider adapters. It never connects to the secrets store or executes an action.
The real application remains at <http://127.0.0.1:8200>.

## Authored requirements and discovered surfaces

- `catalog.mjs`: authored outcomes, acceptance criteria, phases and source credits.
- `generated/catalog.json`: explorer data, group counts and provider discovery.
- `generated/surface-map.tsv`: every route/operation from the preserved surface
  baseline, assigned a primary product group.
- `generated/source-map.tsv`: every file in the migration inventory, assigned a
  primary group through its workstream, retaining exact blob and review state.

Groups are navigation/ownership proposals. A group assignment does not trace
callers, authorization or data flow. API families may cross several capabilities;
source workstreams may contain several domains. Provider entries are adapter
paths, not unique vendors or accepted integrations. Dynamic credentials, sync
and connection adapters for one vendor are separate entries. These six adapter
roots do not enumerate every external protocol, SDK, identity method or PAM/PKI
provider; those require child matrices under the relevant requirements.

The requirements cover the product families and known convergence gaps. They are
**not an exhaustive specification of every provider operation or edge case**.
Before implementation, split a requirement into lifecycle operations and bind
each to exact source paths, callers, authorization and evidence. An unknown is
an investigation task, never an implied completed capability.

## Update order

```sh
node scripts/audit-codebase.mjs --write
node scripts/map-migration.mjs --write
node scripts/map-capabilities.mjs --write
node scripts/audit-codebase.mjs --write
node scripts/audit-codebase.mjs --check
node scripts/map-migration.mjs --check
node scripts/map-capabilities.mjs --check
node scripts/test-capability-map.mjs
node scripts/test-capability-explorer.mjs
```

Generated capability artifacts are excluded from migration inputs to prevent
self-referential hashes. No script advances review or acceptance state. Do not
reduce or recapture the route/API baseline to accommodate this map.

Browser verification uses the installed `core/e2e` Playwright and axe dependencies.
Set `VAULTIX_BROWSER_CHANNEL=chrome` when using installed Chrome. Receipts and
screenshots are written under `.cache/capability-plan-*`. The test covers this
planning view only; manual assistive-technology review remains separate.

## Evidence states

`Existing / review required` means there is an existing family to investigate;
it does not certify each word in a combined requirement. `Scoped evidence` points
to limited verified behavior with broader acceptance still open. `Known semantic
gap`, `Planned` and `Decision pending` are unresolved work. Every requirement
currently remains `Not accepted end to end` against its complete stated criteria.
Existing useful tests retain their value; they do not prove a whole family.

To accept a future workflow, add a versioned evidence record with exact source and
image IDs, scenario, preconditions, allowed and denied results, recovery behavior,
accessibility results, test command, receipt and remaining limits. Evolve the
validator deliberately when that evidence exists. Never change a label alone.
