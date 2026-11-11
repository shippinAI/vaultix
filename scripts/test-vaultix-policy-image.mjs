import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {readFileSync,readdirSync,existsSync,mkdirSync,mkdtempSync,openSync,closeSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {collectGoTestEvidence} from './go-test-evidence.mjs';

const git=args=>execFileSync('git',args,{encoding:'utf8'}).trim();
assert.equal(git(['status','--porcelain=v1']),'','Policy image acceptance requires clean committed source');
const revision=git(['rev-parse','HEAD']);
const receipts=readdirSync('.cache').filter(name=>name.startsWith('self-hosted-build-'))
 .map(name=>resolve('.cache',name,'result.json')).filter(existsSync).map(path=>({path,receipt:JSON.parse(readFileSync(path,'utf8'))}))
 .filter(({receipt})=>receipt.revision===revision && receipt.passed);
assert.ok(receipts.length,'Run the canonical build for the current revision first');
const {path:canonicalPath,receipt}=receipts.at(-1);
const inspect=ref=>JSON.parse(execFileSync('docker',['image','inspect',ref],{encoding:'utf8'}))[0];
assert.equal(inspect(receipt.image).Id,receipt.imageId);
// Long native runs execute outside the journal's five-minute command limit.
// A repeat invocation validates their exact-revision evidence and immutable images.
const previous=readdirSync('.cache').filter(name=>name.startsWith('vaultix-policy-image-'))
 .map(name=>resolve('.cache',name,'result.json')).filter(existsSync)
 .map(path=>({path,report:JSON.parse(readFileSync(path,'utf8'))}))
 .filter(({report})=>report.passed && report.revision===revision && report.imageId===receipt.imageId);
if(previous.length) {
 const {path,report}=previous.at(-1);
 assert.equal(inspect(report.runnerId).Id,report.runnerId);
 assert.deepEqual(report.results.map(result=>result.provider),['dragonfly','redis']);
 for(const result of report.results) {
  assert.equal(result.passed,true);
  assert.equal(result.exitCode,0);
  assert.ok(result.tests>0);
  assert.equal(result.events.filter(event=>event.action==='fail' || (event.test && event.action==='skip')).length,0);
  for(const pkg of ['internal/vaultixpolicy','internal/services/permission','tests/platform/permission','tests/secretmanager/secrets']) {
   assert.ok(result.events.some(event=>event.package===`github.com/vaultix-cloud/api/${pkg}` && event.test && event.action==='pass'),`Missing native package evidence: ${pkg}`);
  }
 }
 console.log(JSON.stringify({passed:true,revision,imageId:report.imageId,evidence:path,reusedExactRevisionEvidence:true}));
 process.exit(0);
}
mkdirSync('.cache',{recursive:true});
const evidence=mkdtempSync(resolve('.cache/vaultix-policy-image-'));
const source=resolve(evidence,'source');mkdirSync(source);
execFileSync('git',['-c','core.autocrlf=false','archive','--format=tar',`--output=${resolve(evidence,'source.tar')}`,revision,'core']);
execFileSync('tar',['-xf',resolve(evidence,'source.tar'),'-C',source]);
const runner=`vaultix:policy-tests-${revision}`;
const fd=openSync(resolve(evidence,'build.log'),'wx');
try {
 const result=spawnSync('docker',['build','-f',resolve(source,'core/Dockerfile.standalone-vaultix'),'--target','go-builder','-t',runner,resolve(source,'core')],{stdio:['ignore',fd,fd]});
 assert.equal(result.status,0,`Policy test image failed: ${evidence}/build.log`);
}finally{closeSync(fd);}
const runnerId=inspect(runner).Id;
const results=[];
for(const provider of ['dragonfly','redis']) {
 console.log(`Vaultix policy: native permission and secrets on ${provider}`);
 const result=spawnSync('docker',['run','--rm','--init','--pull=never','--add-host','host.docker.internal:host-gateway',
  '-v','/var/run/docker.sock:/var/run/docker.sock','-e','GOTOOLCHAIN=local','-e','GOTELEMETRY=off',
  '-e','TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal','-e',`VAULTIX_TEST_IMAGE=${receipt.imageId}`,'-e',`VAULTIX_TEST_CACHE_PROVIDER=${provider}`,
  runnerId,'go','test','-mod=readonly','-count=1','-p','1','-tags','integration','-race','-timeout','180s','-json',
  './internal/vaultixpolicy/...','./internal/services/permission/...','./internal/services/assumeprivilege','./internal/services/secretmanager/reference',
  './tests/platform/permission/...','./tests/secretmanager/...'],{encoding:'utf8',maxBuffer:32*1024*1024});
 const {events,diagnostics}=collectGoTestEvidence(result.stdout??'');
 const failed=events.filter(event=>event.action==='fail');
 const tests=events.filter(event=>event.test && event.action==='pass').length;
 const skipped=events.filter(event=>event.test && event.action==='skip');
 const outcome={provider,exitCode:result.status,passed:result.status===0 && failed.length===0 && tests>0 && skipped.length===0,tests,failed,skipped,events,diagnostics};
 results.push(outcome);writeFileSync(resolve(evidence,'result.json'),JSON.stringify({passed:false,revision,imageId:receipt.imageId,runnerId,canonicalPath,results},null,2));
 assert.equal(outcome.passed,true,`Policy integration failed; inspect ${evidence}/result.json`);
}
assert.equal(git(['rev-parse','HEAD']),revision);assert.equal(git(['status','--porcelain=v1']),'');
writeFileSync(resolve(evidence,'result.json'),JSON.stringify({passed:true,revision,imageId:receipt.imageId,runnerId,canonicalPath,results},null,2));
console.log(JSON.stringify({passed:true,revision,imageId:receipt.imageId,runnerId,evidence,results:results.map(({provider,tests,passed})=>({provider,tests,passed}))}));
