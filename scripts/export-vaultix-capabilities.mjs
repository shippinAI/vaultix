import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {capabilities,groups} from '../docs/capabilities/catalog.mjs';

const file=new URL('../docs/capabilities/vaultix-capabilities.md',import.meta.url);
const cell=value=>String(value).replaceAll('|','\\|').replaceAll('\n',' ');
const lines=[
 '# Vaultix capability register','',
 `This register lists all **${capabilities.length} product requirements in ${groups.length} groups** from the canonical Vaultix capability catalog. It is generated from [catalog.mjs](catalog.mjs), not a separate feature definition.`, '',
 'Software capabilities are included with Vaultix. Permissions, tenant policies, provider configuration and operational limits still apply. A feature being present in source or enabled by the included-feature policy does not establish production acceptance.', '',
 'For identity methods, existing implementation owners and the remaining public CLI flow, see [Vaultix identity execution](../0113-vaultix-identity-execution.md).', '',
 'The [API surface register](generated/surface-map.tsv) lists the preserved route/operation baseline. The [source register](generated/source-map.tsv) maps the source inventory. Neither inventory is a substitute for reviewing or testing each implementation.', '',
 'The scope below includes existing capabilities and planned additions. Each row retains its current implementation and acceptance state; this is not a claim that every listed requirement is delivered. Provider-specific operations and edge cases require their own verification.', '',
 '## Groups','',
 '| Group | Requirements | Purpose |','| --- | ---: | --- |',
 ...groups.map(group=>`| ${cell(group.title)} | ${capabilities.filter(c=>c.group===group.id).length} | ${cell(group.purpose)} |`),''
];
for(const group of groups){
 lines.push(`## ${group.title}`,'','| ID | Vaultix capability | Implementation | Acceptance |','| --- | --- | --- | --- |');
 for(const c of capabilities.filter(c=>c.group===group.id)){
  lines.push(`| ${c.id} | ${cell(c.title)} | ${cell(c.implementation)} | ${cell(c.evidence)} |`);
 }
 lines.push('');
}
lines.push('Regenerate with `node scripts/export-vaultix-capabilities.mjs --write`; verify with `--check`. The detailed outcomes and acceptance criteria remain in the canonical catalog.','');
const output=lines.join('\n');
if(process.argv.includes('--write'))writeFileSync(file,output);
else {assert.ok(process.argv.includes('--check'),'Use --write or --check');assert.equal(readFileSync(file,'utf8').replaceAll('\r\n','\n'),output,'Vaultix capability register is stale');}
console.log(JSON.stringify({requirements:capabilities.length,groups:groups.length,mode:process.argv.includes('--write')?'write':'check'}));
