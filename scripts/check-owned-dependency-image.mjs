import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {readdirSync,readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';

const revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
assert.equal(execFileSync('git',['status','--porcelain=v1'],{encoding:'utf8'}).trim(),'','Receipt requires committed clean source');
const candidates=readdirSync('.cache').filter(name=>name.startsWith('self-hosted-build-'))
  .map(name=>resolve('.cache',name,'result.json')).filter(existsSync)
  .map(path=>({path,receipt:JSON.parse(readFileSync(path,'utf8'))}))
  .filter(({receipt})=>receipt.revision===revision && receipt.passed===true);
assert.ok(candidates.length,'No successful canonical build for this exact revision');
const {path,receipt}=candidates.at(-1);
for(const name of ['canonical-image','image-identity','identity-lifetime','dragonfly-application','redis-application',
  'encrypted-recovery','tenant-isolation','proxy-boundary','admission-dragonfly','admission-redis']) {
  assert.equal(receipt.steps.find(step=>step.name===name)?.passed,true,`Missing image gate ${name}`);
}
const actual=execFileSync('docker',['image','inspect','--format','{{.Id}}',receipt.image],{encoding:'utf8'}).trim();
assert.equal(actual,receipt.imageId);
const graph=execFileSync('docker',['run','--rm','--network','none','--entrypoint','node',actual,'scripts/check-owned-dependencies.mjs'],{encoding:'utf8'});
assert.equal(JSON.parse(graph).passed,true);
execFileSync('docker',['run','--rm','--network','none','--entrypoint','node',actual,'scripts/build-gateway-transport.mjs'],{stdio:'pipe'});
const native=spawnSync('docker',['run','--rm','-i','--network','none','--entrypoint','/backend/vaultix-transport',actual],{input:'{"version":2}\n',encoding:'utf8'});
assert.equal(native.status,1);
assert.match(JSON.parse(native.stdout).error,/unsupported gateway transport request/);
console.log(JSON.stringify({passed:true,revision,imageId:actual,canonicalReceipt:path,runtimeGraph:JSON.parse(graph),nativeExecutable:true}));
