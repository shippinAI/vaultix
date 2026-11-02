// Native Linux activation against a real Docker volume. Fixture signing keys and
// release versions are never publication or operator deployment evidence.
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {createPrivateKey,createPublicKey,sign,randomBytes} from 'node:crypto';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {canonical,sha256,verifyManifest} from './lib/release-bundle.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const run=(exe,args,options={})=>execFileSync(exe,args,{cwd:root,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe'],...options});
const inputs=JSON.parse(readFileSync(resolve(root,'.cache/cli-install-inputs.json')));
assert.match(inputs.clientImage,/^sha256:[a-f0-9]{64}$/);
const revision=run('git',['rev-parse','HEAD']).trim();
if(!inputs.development)assert.equal(run('git',['status','--porcelain']).trim(),'');
mkdirSync(resolve(root,'.cache'),{recursive:true});
const evidence=mkdtempSync(resolve(root,'.cache/cli-install-proof-'));
const fixture=resolve(evidence,'fixture');mkdirSync(fixture);
const report={passed:false,revision,development:inputs.development===true,checks:[],scope:'Actual Linux/amd64 native CLI and atomic directory activation on a Docker volume. Test signing material only; Windows and production publisher acceptance remain open.'};
const key=createPrivateKey({key:Buffer.from('302e020100300506032b6570042204209d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60','hex'),type:'pkcs8',format:'der'});
const der=createPublicKey(key).export({type:'spki',format:'der'});
const trust=canonical({schemaVersion:'vaultix.release-trust.v1',keys:[{keyId:sha256(der),publicKey:der.toString('base64')}]});
writeFileSync(resolve(fixture,'trust.json'),trust);
const require=createRequire(resolve(root,'.ai/package.json'));const ajv=new(require('ajv/dist/2020.js'))({strict:true});
ajv.addSchema(JSON.parse(readFileSync(resolve(root,'contracts/vaultix.release-checkpoint.v1.json'))));
const validators=Object.fromEntries(['cli-install','cli-acceptance','cli-install-result'].map(name=>[name,ajv.compile(JSON.parse(readFileSync(resolve(root,`contracts/vaultix.${name}.v1.json`))))]));
const validate=(kind,value)=>assert.ok(validators[kind](value),JSON.stringify(validators[kind].errors));
const binary=(version)=>{const path=resolve(fixture,'vaultix-'+version);run('go',['build','-buildvcs=false','-trimpath','-ldflags',`-X main.version=${version} -X main.revision=${revision}`,'-o',path,'./cmd/vaultix'],{env:{...process.env,GOOS:'linux',GOARCH:'amd64',CGO_ENABLED:'0'}});return readFileSync(path)};
const oldBytes=binary('1.2.3'),newBytes=binary('1.2.4');
let cli;
if(inputs.development){cli=resolve(fixture,'vaultix-1.2.3')}else{const built=JSON.parse(readFileSync(resolve(root,'.cache/committed-cli.json')));assert.ok(built.passed&&built.revision===revision);const item=built.artifacts.find(a=>a.platform==='linux/amd64');cli=item.files[0];assert.equal(sha256(readFileSync(cli)),item.sha256)}
writeFileSync(resolve(fixture,'bootstrap'),readFileSync(cli));report.cliSha256=sha256(readFileSync(cli));
const names=['vaultix-linux-amd64','vaultixl-linux-amd64','vaultix-windows-amd64.exe','vaultixl-windows-amd64.exe','engine.tar','source.tar','sbom.json'];
function bundle(label,version,sequence,code,change=()=>{}){
 const directory=resolve(fixture,label);mkdirSync(directory);
 const body=names.map((name,i)=>i<2?code:Buffer.from('signed non-selected fixture artifact'));
 const m={schemaVersion:'vaultix.release-manifest.v1',version,channel:'stable',revision,sequence,issuedAt:new Date(Date.now()-60000).toISOString().replace(/\.\d{3}Z$/,'Z'),expiresAt:new Date(Date.now()+3600000).toISOString().replace(/\.\d{3}Z$/,'Z'),minimumUpdaterVersion:'1.0.0',migration:{from:['schema-a'],to:'schema-a',rollback:'compatible'},artifacts:names.map((name,i)=>({name,kind:i<4?'cli':i===4?'engine':i===5?'source':'sbom',platform:i<2||i===4?'linux/amd64':i<4?'windows/amd64':'any',bytes:body[i].length,sha256:sha256(body[i]),imageId:i===4?'sha256:'+'b'.repeat(64):null}))};change(m,body);
 const raw=canonical(m),signed=canonical({schemaVersion:'vaultix.release-signature.v1',keyId:sha256(der),signature:sign(null,raw,key).toString('base64')});
 writeFileSync(resolve(directory,'release-manifest.json'),raw);writeFileSync(resolve(directory,'release-signature.json'),signed);
 names.forEach((name,i)=>writeFileSync(resolve(directory,name),body[i]));return {m,raw,signed};
}
const old=bundle('old','1.2.3',1,oldBytes),next=bundle('next','1.2.4',2,newBytes);
bundle('downgrade','1.2.2',3,oldBytes);
bundle('mismatch','1.2.5',3,oldBytes);
bundle('expired','1.2.5',3,newBytes,m=>{m.expiresAt=new Date(Date.now()-1000).toISOString().replace(/\.\d{3}Z$/,'Z')});
bundle('not-native','1.2.5',3,Buffer.from('#!/bin/sh\necho not-a-native-program\n'));
const foreignArchitecture=Buffer.from(newBytes);foreignArchitecture.writeUInt16LE(183,18);
bundle('wrong-arch','1.2.5',3,foreignArchitecture);
bundle('archive','1.2.5',3,Buffer.from('PK\x03\x04archive-not-an-executable'));
bundle('traversal','1.2.5',3,newBytes,m=>{m.artifacts[0].name='../vaultix-linux-amd64'});
bundle('tampered','1.2.5',3,newBytes);writeFileSync(resolve(fixture,'tampered/vaultix-linux-amd64'),Buffer.from('tampered'));
const name='vaultix-install-'+randomBytes(8).toString('hex'),volume=name+'-data';
let created=false,started=false;
const d=(...args)=>run('docker',args);
const exec=(...args)=>d('exec',name,...args).trim();
const command=(binary,...args)=>JSON.parse(exec('env','VAULTIX_DISABLE_UPDATE_CHECK=1','VAULTIX_HOME=/work/auth',binary,...args));
const install=(label,dir='/work/install',binary='/fixture/bootstrap')=>command(binary,'update','install','--directory',dir,'--bundle','/fixture/'+label,'--trust','/fixture/trust.json','--json');
const check=message=>{report.checks.push(message);console.log('Vaultix CLI install: '+message)};
try{
 d('volume','create',volume);created=true;
 d('run','-d','--name',name,'--network=none','--tmpfs',`/limited:rw,exec,nosuid,nodev,size=${oldBytes.length*3},mode=0700`,'--tmpfs',`/nonexec:rw,noexec,nosuid,nodev,size=${oldBytes.length*3},mode=0700`,'--mount',`type=bind,source=${fixture},target=/fixture,readonly`,'--mount',`type=volume,source=${volume},target=/work`,inputs.clientImage,'sleep','infinity');started=true;
 report.testMounts=exec('cat','/proc/mounts').split('\n').filter(line=>line.includes(' /limited ')||line.includes(' /nonexec '));
 assert.equal(report.testMounts.length,2);assert.ok(!report.testMounts.find(line=>line.includes(' /limited ')).includes('noexec'));
 exec('chmod','700','/work');
 // Copy executables off the Windows host mount to a native executable filesystem.
 exec('cp','/fixture/bootstrap','/work/bootstrap');exec('chmod','700','/work/bootstrap');
 // /fixture binaries have host-dependent permission bits; all actual invocations
 // use this native copy or the installed programs.
 const nativeInstall=(label,dir='/work/install',binary='/work/bootstrap')=>install(label,dir,binary);
 exec('mkdir','-m','700','/work/auth');exec('sh','-c','printf existing-credential > /work/auth/credentials.json; printf existing-config > /work/auth/config.json; chmod 600 /work/auth/*');
 const authBefore=exec('sha256sum','/work/auth/credentials.json','/work/auth/config.json');
 let result=nativeInstall('old');validate('cli-install-result',result);assert.ok(result.changed);assert.equal(result.version,'1.2.3');
 for(const binary of ['vaultix','vaultixl']){const identity=command('/work/install/current/'+binary,'version','--json');assert.equal(identity.version,'1.2.3');assert.equal(identity.revision,revision)}
 validate('cli-install',JSON.parse(exec('cat','/work/install/owner.json')));validate('cli-acceptance',JSON.parse(exec('cat','/work/install/current/accepted.json')));
 check('first install creates both real signed native binaries and their canonical acceptance record');
 // Keep the original executable mapped while token login waits for input.
 // No token is supplied, no login request is made, and the test proves the
 // process really has the executable mapped before and after replacement.
 exec('mkfifo','/work/hold');d('exec','-d',name,'sh','-c','exec 3<>/work/hold; echo $$ >/work/held.pid; exec /work/install/current/vaultix login --token <&3 > /work/held.out 2>/work/held.err');
 let held='';
 for(let i=0;i<20;i++){try{held=exec('cat','/work/held.pid');if(exec('readlink',`/proc/${held}/exe`)==='/work/install/current/vaultix')break}catch{};await new Promise(r=>setTimeout(r,50))}
 assert.equal(exec('readlink',`/proc/${held}/exe`),'/work/install/current/vaultix');
 result=nativeInstall('next','/work/install','/work/install/current/vaultix');validate('cli-install-result',result);assert.ok(result.changed);assert.equal(result.version,'1.2.4');
 assert.equal(command(result.previousDirectory+'/vaultix','version','--json').version,'1.2.3');
 assert.equal(exec('readlink',`/proc/${held}/exe`),result.previousDirectory+'/vaultix');exec('kill','-0',held);
 for(const binary of ['vaultix','vaultixl'])assert.equal(command('/work/install/current/'+binary,'version','--json').version,'1.2.4');
 assert.equal(exec('sha256sum','/work/install/current/vaultix').split(' ')[0],sha256(newBytes));assert.equal(exec('sha256sum','/work/install/current/vaultixl').split(' ')[0],sha256(newBytes));
 check('installed CLI self-updates while an old native process is mapped; both new names and retained old generation have expected independent hashes/versions');
 const acceptedBefore=exec('sha256sum','/work/install/current/accepted.json','/work/install/current/vaultix','/work/install/current/vaultixl');
 for(const label of ['old','downgrade','mismatch','expired','not-native','wrong-arch','archive','traversal','tampered']){
  const r=spawnSync('docker',['exec',name,'/work/bootstrap','update','install','--directory','/work/install','--bundle','/fixture/'+label,'--trust','/fixture/trust.json','--json'],{encoding:'utf8',windowsHide:true});assert.notEqual(r.status,0,label);assert.equal(r.stdout,'');
  assert.equal(exec('sha256sum','/work/install/current/accepted.json','/work/install/current/vaultix','/work/install/current/vaultixl'),acceptedBefore,label);
 }
 check('replay, downgrade, executable identity/architecture mismatch, expiry, scripts, archives, traversal and tampered bytes preserve the complete accepted installation');
 const nonexec=spawnSync('docker',['exec',name,'/work/bootstrap','update','install','--directory','/nonexec/install','--bundle','/fixture/old','--trust','/fixture/trust.json','--json'],{encoding:'utf8',windowsHide:true});
 assert.notEqual(nonexec.status,0);assert.equal(nonexec.stdout,'');exec('test','!','-e','/nonexec/install');
 check('non-executable filesystem cannot publish a purportedly usable CLI installation');
 nativeInstall('old','/limited/install');
 const exhausted=spawnSync('docker',['exec',name,'/work/bootstrap','update','install','--directory','/limited/install','--bundle','/fixture/next','--trust','/fixture/trust.json','--json'],{encoding:'utf8',windowsHide:true});
 assert.notEqual(exhausted.status,0);assert.equal(exhausted.stdout,'');
 assert.equal(command('/work/bootstrap','update','status','--directory','/limited/install','--json').version,'1.2.3');
 for(const binary of ['vaultix','vaultixl'])assert.equal(command('/limited/install/current/'+binary,'version','--json').version,'1.2.3');
 check('real filesystem exhaustion during staging preserves the previously accepted executable pair and checkpoint');
 result=nativeInstall('next');assert.equal(result.changed,false);
 exec('mkdir','-m','700','/work/package-owned');exec('cp','/work/bootstrap','/work/package-owned/vaultix');
 const before=exec('find','/work/package-owned','-type','f','-printf','%f\n');
 const refused=spawnSync('docker',['exec',name,'/work/bootstrap','update','install','--directory','/work/package-owned','--bundle','/fixture/next','--trust','/fixture/trust.json'],{encoding:'utf8',windowsHide:true});assert.notEqual(refused.status,0);assert.equal(exec('find','/work/package-owned','-type','f','-printf','%f\n'),before);
 check('same-release install is unchanged; unmanaged/package-owned directories are refused without creating installer files');
 // Kill an actual installer during repeated fresh activation attempts. Each
 // visible root must be absent or a fully verified generation. No user data is
 // under these uniquely allocated test directories.
 for(let i=0;i<8;i++){
  const target='/work/interrupted-'+i;
  exec('sh','-c',`/work/bootstrap update install --directory ${target} --bundle /fixture/next --trust /fixture/trust.json --json >/work/attempt-${i}.out 2>/work/attempt-${i}.err & p=$!; sleep 0.0${i+1}; kill -KILL "$p" 2>/dev/null || true; wait "$p" 2>/dev/null || true`);
  const present=spawnSync('docker',['exec',name,'test','-e',target],{windowsHide:true}).status===0;
  if(present){const s=command('/work/bootstrap','update','status','--directory',target,'--json');assert.equal(s.version,'1.2.4')}
  else nativeInstall('next',target);
  assert.equal(command(target+'/current/vaultixl','version','--json').version,'1.2.4');
 }
 check('killed native first-install processes leave either no published root or a verified whole pair; fresh retry succeeds');
 const observed=new Set();let killed=0;
 for(const [i,delay] of ['0.001','0.02','0.08','0.2','0.5','accepted'].entries()){
  const target='/work/update-interrupted-'+i;nativeInstall('old',target);
  const boundary=delay==='accepted'?`n=0; until cmp -s ${target}/current/release-manifest.json /fixture/next/release-manifest.json; do n=$((n+1)); if [ "$n" -gt 1000 ]; then kill -KILL "$p" 2>/dev/null; exit 72; fi; sleep 0.01; done`:`sleep ${delay}`;
  const outcome=exec('sh','-c',`${target}/current/vaultix update install --directory ${target} --bundle /fixture/next --trust /fixture/trust.json --json >/work/update-${i}.out 2>/work/update-${i}.err & p=$!; ${boundary}; if kill -KILL "$p" 2>/dev/null; then echo killed; else echo finished; fi; wait "$p" 2>/dev/null || true`);
  if(outcome==='killed')killed++;
  const s=command('/work/bootstrap','update','status','--directory',target,'--json');assert.ok(['1.2.3','1.2.4'].includes(s.version));observed.add(s.version);
  for(const binary of ['vaultix','vaultixl'])assert.equal(command(target+'/current/'+binary,'version','--json').version,s.version);
  nativeInstall('next',target);assert.equal(command(target+'/current/vaultix','version','--json').version,'1.2.4');
 }
 assert.ok(killed>0);assert.deepEqual([...observed].sort(),['1.2.3','1.2.4']);
 check('actual native updater interruption observes both old and new complete generations, never a mixed pair; retry converges');
 const status=command('/work/install/current/vaultixl','update','status','--directory','/work/install','--json');validate('cli-install-result',status);assert.equal(status.version,'1.2.4');
 const trusted=verifyManifest(next.raw,next.signed,trust);assert.deepEqual(status.checkpoint,trusted.checkpoint);assert.equal(trusted.manifest.version,'1.2.4');
 assert.equal(exec('sha256sum','/work/auth/credentials.json','/work/auth/config.json'),authBefore);
 check('installed alternate command verifies accepted release state; credential/config files remain byte-identical');
 report.passed=true;
}finally{
 let cleanup=true;
 if(started){try{d('rm','-f',name)}catch{cleanup=false}}
 if(created){try{d('volume','rm',volume)}catch{cleanup=false}}
 report.cleanupPassed=cleanup;report.passed&&=cleanup;report.evidence=evidence;
 writeFileSync(resolve(evidence,'result.json'),JSON.stringify(report,null,2)+'\n');writeFileSync(resolve(root,'.cache/cli-install-acceptance.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,cleanup,evidence}));
}
assert.ok(report.passed&&report.cleanupPassed,'CLI installation acceptance or cleanup failed');
