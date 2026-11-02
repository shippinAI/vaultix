import assert from 'node:assert/strict';
import tls from 'node:tls';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { once } from 'node:events';
import { testCertificates } from './lib/test-certificates.mjs';
import { ldapConfigurationConsumer } from './lib/ldap-consumer-fixture.mjs';
import { patchLdapts } from '../core/backend/scripts/patch-ldapts.mjs';

await patchLdapts();
const { directoryCommonName, resolveDirectoryPrincipal } = await import('../core/backend/src/lib/ldap/directory.ts');
const { executeDirectoryChanges, parseDirectoryChanges } = await import('../core/backend/src/lib/ldap/ldif.ts');
const require = createRequire(resolve('core/backend/package.json'));
const {Client, Attribute, Change, InvalidCredentialsError} = require('ldapts');
const {testLDAPConfig,searchGroups,buildReferralUrl,isLdapReferralError}=await ldapConfigurationConsumer();
assert.equal(buildReferralUrl('ldaps://dc1.example.test:1636','dc2.example.test'),'ldaps://dc2.example.test:1636');
for(const target of ['attacker.test','127.0.0.1','dc2.other.example'])assert.throws(()=>buildReferralUrl('ldaps://dc1.example.test',target),/Refusing|refusing/);
const pki = await testCertificates();
const serverCert = await pki.issue();
const clientCert = await pki.issue({client:true});
const oct = value => ber(4, Buffer.isBuffer(value) ? value : Buffer.from(value));
function ber(tag, ...values) {
  const body = Buffer.concat(values);
  const size = body.length < 128 ? [body.length] : body.length < 256 ? [0x81,body.length] : [0x82,body.length >> 8,body.length & 255];
  return Buffer.concat([Buffer.from([tag,...size]),body]);
}
const integer = (value, tag=2) => ber(tag, Buffer.from([value]));
const message = (id, operation, ...controls) => ber(0x30,integer(id),operation,...controls);
function tlv(buffer, offset=0) {
  const tag = buffer[offset++];
  let size = buffer[offset++];
  if (size & 128) { const count = size & 127; size=0; for(let n=0;n<count;n++) size=size*256+buffer[offset++]; }
  const end = offset+size;
  assert.ok(end<=buffer.length, 'complete fixture BER');
  const value = buffer.subarray(offset,end);
  const children=[];
  if (tag & 32) { let cursor=offset; while(cursor<end) {const child=tlv(buffer,cursor);children.push(child);cursor=child.end;} }
  return {tag,value,children,end};
}
const status = (id, tag, code=0, dn='', referrals=[]) => message(id,ber(tag,integer(code,10),oct(dn),oct(''),
  ...(referrals.length ? [ber(0xa3,...referrals.map(oct))] : [])));
const guid = Buffer.from('00112233445566778899aabbccddeeff','hex');
const urls = ['ldaps://dc2.example.test/DC=example,DC=test','ldaps://dc3.example.test/DC=example,DC=test'];
const changes=[];
let sockets = new Set(), bindCount=0, unbindCount=0, pages=0, mode='normal', fixtureError;
const server = tls.createServer({...serverCert,ca:pki.ca,requestCert:true,rejectUnauthorized:true}, socket=>{
  sockets.add(socket); socket.on('close',()=>sockets.delete(socket)); socket.on('error',()=>{});
  let pending=Buffer.alloc(0);
  socket.on('data',chunk=>{
    pending=Buffer.concat([pending,chunk]);
    try {
      while(pending.length>=2) {
        const first=pending[1], count=first & 128 ? first & 127 : 0;
        if(pending.length<2+count)break;
        let length=count ? 0 : first;for(let n=0;n<count;n++) length=length*256+pending[2+n];
        if(pending.length<2+count+length)break;
        const envelope=tlv(pending.subarray(0,2+count+length)); pending=pending.subarray(envelope.end);
        const id=envelope.children[0].value.readUIntBE(0,envelope.children[0].value.length);
        const request=envelope.children[1];
        if(request.tag===0x60) {
          bindCount++;
          socket.write(status(id,0x61,request.children[2].value.toString()==='wrong' ? 49 : 0));
        } else if(request.tag===0x42) { unbindCount++;socket.end(); }
        else if(request.tag===0x63) {
          if(mode==='referral') {socket.write(status(id,0x65,10,'DC=example,DC=test',urls));continue;}
          if(mode==='drop') {socket.destroy();continue;}
          if(mode==='timeout') continue;
          const filter=request.children[6];
          if(mode==='principal') {
            assert.equal(filter.tag,0xa3);
            assert.equal(filter.children[1].value.toString(),'user*)(uid=*)@example.test');
          }
          const entryDn=mode==='principal' ? 'CN=Vaultix User,DC=example,DC=test' : `CN=Page${pages+1},DC=example,DC=test`;
          socket.write(message(id,ber(0x64,oct(entryDn),ber(0x30,
            ber(0x30,oct('cn'),ber(0x31,oct('Vaultix User'))),ber(0x30,oct('objectGUID'),ber(0x31,oct(guid)))))));
          if(mode==='paged') {
            const controls=envelope.children[2]; assert.equal(controls.tag,0xa0);
            const control=controls.children[0];assert.equal(control.children[0].value.toString(),'1.2.840.113556.1.4.319');
            const paging=tlv(control.children.at(-1).value);
            assert.equal(paging.children[1].value.toString(), pages===0 ? '' : 'next');
            pages++;
            const responseControl=ber(0xa0,ber(0x30,oct('1.2.840.113556.1.4.319'),oct(ber(0x30,integer(0),oct(pages===1?'next':'')))));
            socket.write(message(id,ber(0x65,integer(0,10),oct(''),oct('')),responseControl));
          } else socket.write(status(id,0x65));
        } else if([0x66,0x68,0x4a].includes(request.tag)) {
          changes.push(request);
          socket.write(status(id,request.tag===0x4a ? 0x6b : request.tag+1,mode==='modify-referral'?10:0,'DC=example,DC=test',mode==='modify-referral'?urls:[]));
        } else throw new Error(`Unexpected wire operation ${request.tag}`);
      }
    } catch(error) {fixtureError=error;socket.destroy();}
  });
});
server.on('tlsClientError',()=>{});
server.listen(0,'127.0.0.1');await once(server,'listening');
const url=`ldaps://127.0.0.1:${server.address().port}`;
const options={url,timeout:400,connectTimeout:1000,tlsOptions:{...clientCert,ca:pki.ca,servername:'localhost'}};
const client=new Client(options);
try {
  await client.bind('CN=fixture','test-only');
  mode='principal';
  assert.equal(await resolveDirectoryPrincipal(client,'user*)(uid=*)@example.test','DC=example,DC=test'),'CN=Vaultix User,DC=example,DC=test');
  mode='referral';
  await assert.rejects(resolveDirectoryPrincipal(client,'user@example.test','DC=example,DC=test'),error=>{
    assert.equal(error.code,10);assert.equal(isLdapReferralError(error),true);assert.equal(error.referralSource,'search');assert.equal(error.dn,'DC=example,DC=test');assert.deepEqual(error.referrals,urls);return true;
  });
  mode='modify-referral';
  await assert.rejects(client.modify('CN=user',new Change({operation:'replace',modification:new Attribute({type:'unicodePwd',values:[Buffer.from('"test"','utf16le')]})})),error=>{
    assert.equal(error.code,10);assert.equal(error.name,'ReferralError');assert.deepEqual(error.referrals,urls);return true;
  });
  mode='paged';
  const result=await client.search('DC=example,DC=test',{scope:'sub',filter:'(objectClass=*)',paged:{pageSize:1},explicitBufferAttributes:['objectGUID']});
  assert.equal(pages,2);assert.equal(result.searchEntries.length,2);assert.deepEqual(result.searchEntries[1].objectGUID,guid);
  mode='normal';changes.length=0;
  const passwordBytes=Buffer.from('"Tést😀"','utf16le');
  const document=`version: 1\n\ndn: CN=fixture,DC=example,DC=test\nchangetype: add\nobjectClass: person\ncn: one\ncn: two\n\ndn: CN=fixture,DC=example,DC=test\nchangetype: modify\nreplace: unicodePwd\nunicodePwd:: ${passwordBytes.toString('base64')}\n-\n\ndn: CN=fixture,DC=example,DC=test\nchangetype: delete\n`;
  assert.equal((await executeDirectoryChanges(client,document)).length,3);
  assert.deepEqual(changes.map(entry=>entry.tag),[0x68,0x66,0x4a]);
  const modify=changes[1].children[1].children[0];
  assert.equal(modify.children[0].value[0],2);
  assert.deepEqual(modify.children[1].children[1].children[0].value,passwordBytes);
  assert.equal(changes[0].children[1].children[1].children[1].children.length,2,'repeated add attributes retain every value');
  for(const bad of ['dn: a\nchangetype: modify\nreplace: cn\nuid: mismatch\n-', 'dn: a\nchangetype: add\nphoto:< file:///private', 'dn: a\nchangetype: add\nphoto:: !bad']) assert.throws(()=>parseDirectoryChanges(bad));
  assert.equal(directoryCommonName('CN=Smith\\, John,OU=Groups'),'Smith\\2c John');
  assert.equal(directoryCommonName('CN=Smith\\2c John,OU=Groups'),'Smith\\2c John');
  const oid=parseDirectoryChanges('dn: CN=fixture\nchangetype: add\n2.5.4.3: preserved');
  assert.equal(oid[0].attributes[0].type,'2.5.4.3');
  await client.unbind();
  const rejected=new Client(options);
  try {await assert.rejects(rejected.bind('CN=fixture','wrong'),InvalidCredentialsError);} finally {await rejected.unbind();}
  for(const tlsOptions of [{...clientCert,servername:'localhost'}, {...clientCert,ca:pki.ca,servername:'wrong.example'}, {ca:pki.ca,servername:'localhost'}]) {
    const denied=new Client({...options,tlsOptions});
    try {await assert.rejects(denied.bind('CN=fixture','test-only'));} finally {await denied.unbind();}
  }
  for(const failure of ['drop','timeout']) {
    const failing=new Client(options);await failing.bind('CN=fixture','test-only');mode=failure;
    try {await assert.rejects(failing.search('DC=example,DC=test',{filter:'(cn=*)'}));} finally {await failing.unbind();}
  }
  mode='normal';const recovered=new Client(options);await recovered.bind('CN=fixture','test-only');await recovered.unbind();
  const config={url,caCert:pki.ca,clientCertificate:clientCert.cert,clientKeyCertificate:clientCert.key,bindDN:'CN=fixture',bindPass:'test-only'};
  assert.equal(await testLDAPConfig(config),true);
  assert.equal(await testLDAPConfig({...config,bindPass:'wrong'}),false);
  mode='paged';pages=0;
  assert.deepEqual(await searchGroups(config,'(objectClass=*)','DC=example,DC=test'),[
    {dn:'CN=Page1,DC=example,DC=test',cn:'Page1'},
    {dn:'CN=Page2,DC=example,DC=test',cn:'Page2'}
  ]);
  await new Promise(resolve=>setTimeout(resolve,30));
  if(fixtureError)throw fixtureError;
  assert.equal(sockets.size,0,'all owned LDAP connections close');
  assert.equal(bindCount,8,'TLS denials must never reach bind');
  assert.equal(unbindCount,6,'successful/rejected binds unbind; dropped/timed-out sockets are already destroyed');
  console.log(JSON.stringify({passed:true,realTLS:true,mutualTLS:true,configurationConsumer:true,groupSearchConsumer:true,referralUrls:true,paging:true,binaryAttributes:true,orderedChanges:true,transportFailures:true,recovery:true,cleanup:true}));
} finally {
  await client.unbind();for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));
}
