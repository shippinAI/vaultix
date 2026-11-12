// Go user sessions against a real application store and real TypeScript-issued tokens.
// Pass an image that still answers these routes in TypeScript, for the comparison.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {collectGoTestEvidence} from './go-test-evidence.mjs';

const image=process.argv[2];
assert.match(image??'',/^sha256:[a-f0-9]{64}$/,'Usage: node scripts/test-user-sessions.mjs sha256:IMAGE');
const runner='sha256:812899ac172fd5cb46363316d1d0ea65892b17368799a4ff9dfaaa1fecc2d0cd';
const root=resolve('platform/engine/backend-go');
const result=spawnSync('docker',['run','--rm','--init','--pull=never','--add-host','host.docker.internal:host-gateway',
 '--mount','type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock',
 '--mount',`type=bind,source=${root.replaceAll('\\','/')},target=/app,readonly`,'--workdir','/app',
 '-e','GOTOOLCHAIN=local','-e','GOTELEMETRY=off','-e','TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal',
 '-e',`VAULTIX_TEST_IMAGE=${image}`,'-e','VAULTIX_TEST_CACHE_PROVIDER=dragonfly',runner,
 'go','test','-mod=readonly','-count=1','-tags','integration','-race','-timeout','240s','-json',
 './tests/platform/auth','-run','TestUserSessions'],
 {encoding:'utf8',windowsHide:true,maxBuffer:32*1024*1024,timeout:300000});
const {events,diagnostics}=collectGoTestEvidence(result.stdout??'');
const failed=events.filter(e=>e.action==='fail');
const tests=events.filter(e=>e.test&&e.action==='pass').length;
const passed=result.status===0&&failed.length===0&&tests>0;
// Assertion text only comes from the tests' own output, and these tests use no secrets in it.
const lines=(result.stdout??'').split('\n').flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}});
const reasons=passed?[]:lines.filter(e=>e.Action==='output'&&failed.some(f=>f.test===e.Test)).map(e=>e.Output.trimEnd()).slice(-40);
console.log(JSON.stringify({passed,tests,failed:failed.map(e=>e.test??e.package),reasons,diagnostics:diagnostics?.slice?.(0,40),processError:result.error?.code}));
if(!passed)process.exitCode=1;
