import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {resolve,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {collectGoTestEvidence} from './go-test-evidence.mjs';

const image=process.argv[2]??'sha256:184687667e4f1bcf0c45a0f5bd9e4593fed1ccbc12c3f3fdfaf8a87d361f42e8';
const runner='sha256:812899ac172fd5cb46363316d1d0ea65892b17368799a4ff9dfaaa1fecc2d0cd';
const root=resolve('platform/engine/backend-go');
const snapshot=()=>{
 const files=[];
 function walk(dir){for(const f of readdirSync(dir,{withFileTypes:true})){const path=resolve(dir,f.name);if(f.isDirectory())walk(path);else files.push({path:relative(root,path).replaceAll('\\','/'),sha256:createHash('sha256').update(readFileSync(path)).digest('hex')});}}
 walk(root);return files.sort((a,b)=>a.path.localeCompare(b.path));
};
const sources=snapshot();
mkdirSync('.cache',{recursive:true});const evidence=mkdtempSync(resolve('.cache/device-http-'));
const result=spawnSync('docker',['run','--rm','--init','--pull=never','--add-host','host.docker.internal:host-gateway',
 '--mount','type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock',
 '--mount',`type=bind,source=${root.replaceAll('\\','/')},target=/app,readonly`,'--workdir','/app',
 '-e','GOTOOLCHAIN=local','-e','GOTELEMETRY=off','-e','TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal',
 '-e',`VAULTIX_TEST_IMAGE=${image}`,'-e','VAULTIX_TEST_CACHE_PROVIDER=dragonfly',runner,
 'go','test','-mod=readonly','-count=1','-tags','integration','-race','-timeout','240s','-json',
 './tests/platform/auth','-run','TestDeviceHTTP|TestDeviceConsumer|TestDeviceSessions'],
 {encoding:'utf8',windowsHide:true,maxBuffer:32*1024*1024,timeout:300000});
const {events,diagnostics}=collectGoTestEvidence(result.stdout??'');
const failed=events.filter(e=>e.action==='fail');
const tests=events.filter(e=>e.test&&e.action==='pass').length;
const passed=result.status===0&&failed.length===0&&tests>0;
assert.deepEqual(snapshot(),sources,'Source changed during verification');
writeFileSync(resolve(evidence,'result.json'),JSON.stringify({passed,image,runner,sources,tests,events,diagnostics,exitCode:result.status,processError:result.error?.code,
 scope:'Native HTTP source against disposable canonical application store and browser credentials; this is not packaged routing, UI or CLI acceptance.'},null,2));
console.log(JSON.stringify({passed,tests,failed,diagnostics,evidence}));
if(!passed)process.exitCode=1;
