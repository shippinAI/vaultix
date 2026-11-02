import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';

const require=createRequire(resolve('core/backend/package.json'));
const {load}=require('js-yaml');
for(const file of ['core/docker-compose.dev.yml','core/docker-compose.dev-read-replica.yml','core/docker-compose.bdd.yml']) {
  const compose=load(readFileSync(file,'utf8'));
  for(const service of Object.values(compose.services)) {
    if(service.build?.context==='./backend')assert.equal(service.build.additional_contexts?.['vaultix-native'],'./backend-go',file);
  }
}
const recipes=['core/backend/Dockerfile','core/backend/Dockerfile.dev','core/backend/Dockerfile.dev.fips','core/Dockerfile.ghcr'];
for(const [index,recipe] of recipes.entries()) {
  const root=recipe==='core/Dockerfile.ghcr'?'core':'core/backend';
  const source=readFileSync(recipe,'utf8');
  const patchCopy=source.indexOf('scripts/patch-ldapts.mjs');
  const dependencyInstall=source.search(/RUN npm (?:ci|install)(?:\r?\n| --omit)/);
  assert.ok(patchCopy>0 && patchCopy<dependencyInstall,`${recipe} must supply its postinstall implementation`);
  assert.doesNotMatch(source,/artifacts-cli\.vaultix\.com/);
  const tag=`vaultix:transport-build-proof-${index}`;
  execFileSync('docker',['build','--target','gateway-transport',
    ...(root==='core/backend'?['--build-context',`vaultix-native=${resolve('core/backend-go')}`]:[]),
    '-f',recipe,'-t',tag,root],{stdio:'pipe',timeout:180000});
  const image=execFileSync('docker',['image','inspect','--format','{{.Id}}',tag],{encoding:'utf8'}).trim();
  const result=spawnSync('docker',['run','--rm','-i','--network','none','--entrypoint','/vaultix-transport',image],{input:'{"version":2}\n',encoding:'utf8'});
  assert.equal(result.status,1);assert.match(JSON.parse(result.stdout).error,/unsupported gateway transport request/);
}
console.log(JSON.stringify({passed:true,nativeLinuxBuildRecipes:recipes,composeContexts:true,scope:'Native stage and postinstall wiring; full historical profiles and FIPS not certified'}));
