import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,openSync,closeSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';

const git=args=>execFileSync('git',args,{encoding:'utf8'}).trim();
assert.equal(git(['status','--porcelain=v1']),'','Linux wire acceptance requires committed source');
const revision=git(['rev-parse','HEAD']);
const backend=execFileSync('docker',['image','inspect','--format','{{.Id}}','vaultix:verify-backend'],{encoding:'utf8'}).trim();
assert.match(backend,/^sha256:[a-f0-9]{64}$/);
mkdirSync('.cache',{recursive:true});
const evidence=mkdtempSync(resolve('.cache/owned-quic-linux-'));
const source=resolve(evidence,'source');mkdirSync(source);
execFileSync('git',['-c','core.autocrlf=false','archive','--format=tar',`--output=${resolve(evidence,'source.tar')}`,revision,
  'platform/engine/backend-go','platform/engine/backend/package-lock.json','platform/engine/backend/src/lib/gateway/transport.ts',
  'scripts/test-owned-quic.mjs','scripts/lib/test-certificates.mjs','scripts/fixtures/quic-peer']);
execFileSync('tar',['-xf',resolve(evidence,'source.tar'),'-C',source]);
const image=`vaultix:quic-linux-${revision}`;
const fd=openSync(resolve(evidence,'build.log'),'wx');
try {
  const build=spawnSync('docker',['build','-f',resolve(source,'scripts/fixtures/quic-peer/Dockerfile'),
    '--build-arg','VAULTIX_BACKEND_TEST_IMAGE=vaultix:verify-backend','-t',image,source],{stdio:['ignore',fd,fd],timeout:180000});
  assert.equal(build.status,0,`Linux fixture build failed; inspect ${evidence}/build.log`);
} finally {closeSync(fd);}
assert.equal(execFileSync('docker',['image','inspect','--format','{{.Id}}','vaultix:verify-backend'],{encoding:'utf8'}).trim(),backend,'Backend test image changed during the build');
const imageId=execFileSync('docker',['image','inspect','--format','{{.Id}}',image],{encoding:'utf8'}).trim();
const runtime=spawnSync('docker',['run','--rm','--network','none',imageId],{encoding:'utf8',timeout:90000,maxBuffer:512*1024});
writeFileSync(resolve(evidence,'runtime.log'),(runtime.stdout??'')+(runtime.stderr??''));
assert.equal(runtime.status,0,`Linux wire test failed; inspect ${evidence}/runtime.log`);
const result=runtime.stdout.split(/\r?\n/).filter(line=>line.startsWith('{')).map(line=>JSON.parse(line)).find(value=>value.realQUIC);
assert.equal(result?.passed,true);assert.equal(result?.runtime,'linux/x64');
const report={passed:true,revision,imageId,backendTestImage:backend,result,scope:'Actual Linux x64 QUIC runtime; ARM64 remains compile-only'};
writeFileSync(resolve(evidence,'result.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({...report,evidence}));
