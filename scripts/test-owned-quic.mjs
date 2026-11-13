import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import net from 'node:net';
import {randomBytes,webcrypto} from 'node:crypto';
import {testCertificates} from './lib/test-certificates.mjs';
import {startGatewayTransport} from '../platform/engine/backend/src/lib/gateway/transport.ts';

const require=createRequire(resolve('scripts/fixtures/quic-peer/package.json'));
const {QUICServer,events}=await import(new URL('./dist/index.js',pathToFileURL(require.resolve('@matrixai/quic/package.json'))));
const binary=resolve('.cache',process.platform==='win32'?'vaultix-transport-test.exe':'vaultix-transport-test');
mkdirSync('.cache',{recursive:true});
execFileSync('go',['build','-o',binary,'./cmd/vaultix-transport'],{cwd:'platform/engine/backend-go',stdio:'pipe',timeout:120000});
const crossCompiled=[];
for(const arch of ['amd64','arm64']) {
  execFileSync('go',['build','-trimpath','-o',resolve('.cache',`vaultix-transport-linux-${arch}`),'./cmd/vaultix-transport'],{
    cwd:'platform/engine/backend-go',env:{...process.env,CGO_ENABLED:'0',GOOS:'linux',GOARCH:arch},stdio:'pipe',timeout:120000
  });
  crossCompiled.push(`linux/${arch}`);
}
const pki=await testCertificates();
const peer=await pki.issue({subject:'CN=gateway-fixture,O=org-fixture,OU=Gateway'});
const client=await pki.issue({subject:'CN=cloud,O=org-fixture,OU=gateway-client',client:true});
const commands=[];
let pingFailure=false;
const server=new QUICServer({
  crypto:{key:Uint8Array.from(randomBytes(32)).buffer,ops:{
    sign:async(key,data)=>webcrypto.subtle.sign('HMAC',await webcrypto.subtle.importKey('raw',key,{name:'HMAC',hash:'SHA-256'},false,['sign']),data),
    verify:async(key,data,sig)=>webcrypto.subtle.verify('HMAC',await webcrypto.subtle.importKey('raw',key,{name:'HMAC',hash:'SHA-256'},false,['verify']),sig,data)
  }},
  config:{...peer,ca:pki.ca,verifyPeer:true,applicationProtos:['vaultix-gateway'],maxIdleTimeout:5000}
});
server.addEventListener(events.EventQUICServerConnection.name,event=>{
  event.detail.addEventListener(events.EventQUICConnectionStream.name,streamEvent=>{
    const stream=streamEvent.detail;
    void (async()=>{
      const reader=stream.readable.getReader(),writer=stream.writable.getWriter();
      let pending=Buffer.alloc(0),command;
      try {
        for(;;) {
          const {value,done}=await reader.read();if(done)break;
          if(command===undefined) {
            pending=Buffer.concat([pending,Buffer.from(value)]);
            const newline=pending.indexOf(10);if(newline<0)continue;
            command=pending.subarray(0,newline).toString();commands.push(command);
            if(command==='PING') {
              if(pingFailure) {pingFailure=false;await writer.write(Buffer.from('FAIL'));}
              else {await writer.write(Buffer.from('PO'));await new Promise(r=>setTimeout(r,10));await writer.write(Buffer.from('NG\n'));}
              await writer.close();return;
            }
            if(pending.length>newline+1)await writer.write(pending.subarray(newline+1));
          } else await writer.write(value);
        }
        await writer.close();
      } catch { /* Negative cases deliberately close authenticated streams. */ }
      finally {reader.releaseLock();writer.releaseLock();}
    })();
  });
});
await server.start({host:'127.0.0.1',port:0});
const request={version:1,host:'127.0.0.1',port:server.port,ca:pki.ca,...client,identityId:'gateway-fixture',orgId:'org-fixture'};
const start=options=>startGatewayTransport({...request,...options},binary);
const echo=(port,payload)=>new Promise((resolve,reject)=>{
  const socket=net.connect({host:'127.0.0.1',port,allowHalfOpen:true});
  const chunks=[];socket.on('data',chunk=>chunks.push(chunk));socket.setTimeout(10000,()=>socket.destroy(new Error('echo timeout')));
  socket.once('error',reject);
  socket.once('connect',()=>socket.end(payload));
  socket.once('end',()=>{socket.destroy();resolve(Buffer.concat(chunks));});
});
try {
  const ping=await start({mode:'ping'});await ping.cleanup();
  for(const wrong of [{orgId:'other-org'},{identityId:'other-gateway'},{serverName:'wrong.example.test'},{ca:(await testCertificates()).ca}]) {
    await assert.rejects(start({...wrong,mode:'ping'}),/certificate|handshake/i);
  }
  const foreign=await (await testCertificates()).issue({client:true});
  await assert.rejects(start({...foreign,mode:'ping'}));
  const expired=await pki.issue({subject:'CN=gateway-fixture,O=org-fixture,OU=Gateway',expired:true});
  server.updateConfig({...expired});
  await assert.rejects(start({mode:'ping'}),/expired|handshake/i);
  server.updateConfig({...peer});
  const wrongPurpose=await pki.issue({subject:'CN=gateway-fixture,O=org-fixture,OU=NotGateway'});
  server.updateConfig({...wrongPurpose});
  await assert.rejects(start({mode:'ping'}),/identity|handshake/i);
  server.updateConfig({...peer});
  pingFailure=true;await assert.rejects(start({mode:'ping'}),/unexpected gateway ping/);
  const recovered=await start({mode:'ping'});await recovered.cleanup();
  await assert.rejects(start({mode:'proxy',command:'FORWARD-TCP target:443\nFORWARD-TCP attacker:443\n'}),/invalid gateway/);
  const proxy=await start({mode:'proxy',command:'FORWARD-TCP target.example.test:443\n'});
  try {
    const payloads=[randomBytes(300_000),randomBytes(71_000),Buffer.from('third independent connection')];
    const results=await Promise.all(payloads.map(payload=>echo(proxy.port,payload)));
    results.forEach((result,index)=>assert.deepEqual(result,payloads[index]));
    assert.deepEqual(await echo(proxy.port,Buffer.from('after other sockets closed')),Buffer.from('after other sockets closed'));
  } finally {await proxy.cleanup();}
  await assert.rejects(echo(proxy.port,Buffer.from('closed')),/ECONNREFUSED/);
  const http=await start({mode:'proxy',command:'FORWARD-HTTP https://example.test:443 ca=Zml4dHVyZQ== verify=true\n'});
  try {assert.deepEqual(await echo(http.port,Buffer.from('GET / HTTP/1.1\r\n\r\n')),Buffer.from('GET / HTTP/1.1\r\n\r\n'));}
  finally {await http.cleanup();}
  assert.ok(commands.includes('FORWARD-TCP target.example.test:443'));
  assert.ok(commands.includes('FORWARD-HTTP https://example.test:443 ca=Zml4dHVyZQ== verify=true'));
  console.log(JSON.stringify({passed:true,realQUIC:true,runtime:`${process.platform}/${process.arch}`,crossCompiled,independentPeer:'@matrixai/quic 2.0.9',nodeToNative:true,mutualTLS:true,wrongTenantDenied:true,expiredDenied:true,fragmentedPing:true,recovery:true,concurrentForwarding:true,halfClose:true,cleanup:true}));
} finally {await server.stop({force:true});}
