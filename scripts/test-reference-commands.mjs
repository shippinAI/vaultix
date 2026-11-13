import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import Ajv2020 from '../.ai/node_modules/ajv/dist/2020.js';
import {readReferenceCommand,referenceCommandCatalog} from '../platform/engine/frontend/src/components/vaultix/reference-commands.ts';
const scope='test-workspace';
const base={version:1,scope,action:'reference.project',value:'project-a'};
assert.deepEqual(readReferenceCommand(base,scope),base);
for(const input of [null,[],{}, {...base,version:2},{...base,scope:'other'},
  {...base,action:'eval'},{...base,selector:'body'},{...base,value:''},{...base,value:'x'.repeat(1025)},
  {...base,action:'reference.folder',value:'relative'},
  {...base,action:'reference.load'}, {...base,secretValue:'not-allowed'},
  {...base,action:'reference.environment',value:42}]) assert.equal(readReferenceCommand(input,scope),null);
for(const action of ['reference.load','reference.reset'])assert.ok(readReferenceCommand({version:1,scope,action},scope));
assert.deepEqual(referenceCommandCatalog.map(x=>x.id),['reference.project','reference.environment','reference.folder','reference.load','reference.reset']);
assert.equal(referenceCommandCatalog.filter(x=>x.effect==='read').length,1);
const schema=new Ajv2020({strict:false}).compile(JSON.parse(readFileSync(new URL('../contracts/vaultix.reference-ui-command.v1.schema.json',import.meta.url))));
for(const action of referenceCommandCatalog.map(x=>x.id)){
  for(const value of [undefined,'','/','dev',42,'x'.repeat(1025)]){
    const input={version:1,scope,action,...(value===undefined?{}:{value})};
    assert.equal(schema(input),readReferenceCommand(input,scope)!==null,`Schema/parser disagreement for ${action}`);
  }
}
console.log('Reference commands: scoped allowlist, bounded values, unknown fields and executable payloads rejected.');
