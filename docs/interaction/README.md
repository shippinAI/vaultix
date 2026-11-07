# Interaction ownership

Start at [the domain UI standard](../0114-domain-scripted-ui-standard.md).
The [separate mesh and UI workbench plan](../0116-domain-mesh-and-ui-workbench.md)
defines development/product isolation, domain ownership, researched limits and
the complete UI conversion sequence. Storybook is the local development surface;
its MCP does not grant product execution authority.
`workflows.json` is the canonical partial action/porting ledger specified by 0076.
The schema is `contracts/vaultix.ui-actions.v1.schema.json`.
Mesh knowledge/persona and dynamic trigger scaffolding is defined in
[0115](../0115-mesh-knowledge-personas-and-scripted-event-benchmark.md) with
contracts `contracts/vaultix.mesh-knowledge-personas.v1.schema.json` and
`contracts/vaultix.mesh-knowledge-trigger.v1.schema.json`.
Benchmark receipt scaffolding is defined by
`contracts/vaultix.ui-benchmark-receipt.v1.schema.json` with fixture
`docs/interaction/ui-benchmark-receipt.example.v1.json`. Validate with
`node scripts/check-ui-benchmark-receipt.mjs --receipt docs/interaction/ui-benchmark-receipt.example.v1.json`
and run negative guards with `node --test scripts/ui-benchmark-receipt.test.mjs`.

Current coverage: 15 domain boundaries; 16 mapped/planned actions; five existing
local commands; two planned finite scripts; zero remote-enabled actions. Domain
presence does not mean its workflows have been reviewed. Keep missing interactions
in `pending` until the whole workflow has evidence, rather than dropping them.

`status: local` means an existing local command mapping, not acceptance of the new
binding protocol. Planned human-only boundaries have empty inputs by construction.
Script `valueFrom` names refer to fixed workflow parameters, never expressions.
The public script binds the sample client; the tenant script requires real source
authorization. Neither script template is currently a remote MCP tool.

To add or convert a workflow, use the [portable skill](../../.agents/skills/domain-ui-actions/SKILL.md),
read the actual handlers, preserve current behavior and record independent service,
UI and manual evidence. Run the checker/tests listed in the standard. Do not change
`remote` to true: a reviewed contract/runtime revision and paired-client acceptance
must introduce that capability together.
