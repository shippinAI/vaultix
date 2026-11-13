import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {assertOwnedManifest,checkOwnedDependencies} from '../platform/engine/backend/scripts/check-owned-dependencies.mjs';

assertOwnedManifest({name:'@vaultix/core',dependencies:{ldapts:'9.2.0'}});
for(const bad of [
 {name:'@vaultix/core',dependencies:{'@vaultix/ldapjs':'npm:ldapts@9.2.0'}},
 {name:'@vaultix/core',dependencies:{'@infisical/quic':'1.0.8'}},
 {name:'@vaultix/core',overrides:{transport:{quic:'npm:@infisical/quic@1.0.8'}}},
 {name:'@infisical/core',dependencies:{}}
])assert.throws(()=>assertOwnedManifest(bad));
const backend=await checkOwnedDependencies('platform/engine/backend');
const frontend=await checkOwnedDependencies('platform/engine/frontend');
const files=execFileSync('git',['ls-files','platform/engine/backend/src'],{encoding:'utf8'}).trim().split(/\r?\n/).filter(file=>/\.tsx?$/.test(file));
for(const path of files)assert.doesNotMatch(readFileSync(path,'utf8'),/(?:from|import)\s*["'](?:@infisical\/|@vaultix\/(?:ldapjs|quic|pg-view-generator))/);
console.log(JSON.stringify({passed:true,backend,frontend,aliasFixtureRejected:true,forbiddenGraphRejected:true}));
