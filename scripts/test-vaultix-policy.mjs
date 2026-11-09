import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,existsSync} from 'node:fs';

const cwd='core/backend-go';
const run=args=>execFileSync('go',args,{cwd,encoding:'utf8',maxBuffer:8*1024*1024});
const rejectOldGraph=graph=>assert.doesNotMatch(graph,/vaultix|(?:github\.com\/vaultix\/gocasl)|third_party[\\/]gocasl/i);
for(const graph of ['github.com/vaultix/gocasl v0.0.7 => ./third_party/gocasl','github.com/vaultix/gocasl v0.0.7']) {
  assert.throws(()=>rejectOldGraph(graph));
}
rejectOldGraph(readFileSync(`${cwd}/go.mod`,'utf8'));
rejectOldGraph(run(['list','-m','all']));
const dependencies=run(['list','-deps','./cmd/vaultix']);
rejectOldGraph(dependencies);
assert.match(dependencies,/github\.com\/vaultix\/api\/internal\/vaultixpolicy/);
assert.equal(existsSync(`${cwd}/third_party/gocasl`),false);
assert.equal(existsSync(`${cwd}/internal/vaultixpolicy/go.mod`),false);
const packages=['./internal/vaultixpolicy/...','./internal/services/permission/...','./internal/services/assumeprivilege','./internal/services/secretmanager/reference'];
const tests=run(['test','-mod=readonly','-race','-count=1','-timeout','120s',...packages]);
run(['vet',...packages]);
console.log(JSON.stringify({passed:true,internalPolicy:true,noModuleAlias:true,raceChecked:true,packages,tests:tests.trim()}));
