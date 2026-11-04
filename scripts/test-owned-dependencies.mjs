import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {assertOwnedManifest,checkOwnedDependencies} from '../core/backend/scripts/check-owned-dependencies.mjs';

assertOwnedManifest({name:'@vaultix/core',dependencies:{ldapts:'9.2.0'}});
for(const bad of [
 {name:'@vaultix/core',dependencies:{'@vaultix/ldapjs':'npm:ldapts@9.2.0'}},
 {name:'@vaultix/core',dependencies:{'@vaultix/quic':'1.0.8'}},
 {name:'@vaultix/core',overrides:{transport:{quic:'npm:@vaultix/quic@1.0.8'}}},
 {name:'@vaultix/core',dependencies:{}}
])assert.throws(()=>assertOwnedManifest(bad));
const backend=await checkOwnedDependencies('core/backend');
const frontend=await checkOwnedDependencies('core/frontend');
const files=execFileSync('git',['ls-files','core/backend/src'],{encoding:'utf8'}).trim().split(/\r?\n/).filter(file=>/\.tsx?$/.test(file));
for(const path of files)assert.doesNotMatch(readFileSync(path,'utf8'),/(?:from|import)\s*["'](?:@vaultix\/|@vaultix\/(?:ldapjs|quic|pg-view-generator))/);
console.log(JSON.stringify({passed:true,backend,frontend,aliasFixtureRejected:true,forbiddenGraphRejected:true}));
