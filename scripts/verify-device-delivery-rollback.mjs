import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createDisposableImageHarness} from './lib/disposable-image.mjs';
let phase='artifact';
const h=createDisposableImageHarness(process.argv[2],()=>phase);
const previous='sha256:39f67677e32a41744821233c7f792589758e7a04eea803977b27744a36c7021e';
mkdirSync('.cache',{recursive:true});const directory=mkdtempSync(resolve('.cache/device-delivery-rollback-'));
const report={passed:false,artifact:h.artifact,previous,checks:[],sources:['scripts/verify-device-delivery-rollback.mjs','scripts/lib/disposable-image.mjs'].map(path=>({path,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')}))};
const name='vaultix-delivery-rollback-'+randomBytes(8).toString('hex');
try{
 h.createNetwork(name);const password=randomBytes(24).toString('hex'),dbName=name+'-db',cacheName=name+'-cache';
 const db=h.container(dbName,'postgres:16.6-alpine',[],{POSTGRES_USER:'vaultix',POSTGRES_DB:'vaultix',POSTGRES_PASSWORD:password});
 const cache=h.container(cacheName,'redis:7.4-alpine');
 await h.waitFor(()=>h.docker(['exec',db,'pg_isready','-U','vaultix','-d','vaultix'],{allowFailure:true}).status===0,'database');
 await h.waitFor(()=>h.docker(['exec',cache,'redis-cli','ping'],{allowFailure:true}).status===0,'cache');
 const env={DB_CONNECTION_URI:`postgres://vaultix:${password}@${dbName}:5432/vaultix`,VAULTIX_CACHE_PROVIDER:'redis',VAULTIX_CACHE_URL:`redis://${cacheName}:6379`,ENCRYPTION_KEY:randomBytes(16).toString('hex'),AUTH_SECRET:randomBytes(32).toString('hex'),SITE_URL:'http://127.0.0.1:8200',TELEMETRY_ENABLED:'false',DISABLE_UPDATE_CHECK:'true'};
 phase='previous image and existing owner';const old=h.container(name+'-old',previous,[],env);await h.ready(old);
 const fixturePassword='Vx9!'+[...randomBytes(24)].map(byte=>byte.toString(16).padStart(2,'0')).join('-');
 const owner=await h.request(old,'/api/v1/admin/signup',{method:'POST',body:{email:name+'@vaultix.invalid',password:fixturePassword,firstName:'Rollback',organizationName:'Rollback proof'}});
 const {token}=await h.request(old,'/api/v3/auth/select-organization',{method:'POST',token:owner.token,body:{organizationId:owner.organization.id}});
 const user=h.sql(db,`SELECT id FROM users WHERE email='${name}@vaultix.invalid'`),org=owner.organization.id;
 assert.match(user,/^[a-f0-9-]{36}$/);assert.match(org,/^[a-f0-9-]{36}$/);
 h.output(['stop',old]);phase='actual forward migration history';const current=h.container(name+'-current',h.artifact.id,[],env);await h.ready(current);
 assert.equal(h.sql(db,"SELECT count(*) FROM vaultix_migrations WHERE name LIKE '20261031200000_vaultix-device-event-delivery.%'"),'1');
 report.checks.push('New image applies and records the real forward migration on an existing database');
 const session=randomUUID(),event=randomUUID();
 h.sql(db,`BEGIN;
 INSERT INTO auth_token_sessions(id,"userId",ip,"userAgent","lastUsed","sessionType") VALUES('${session}','${user}','192.0.2.99','Vaultix rollback proof',clock_timestamp(),'device-v1');
 INSERT INTO vaultix_device_sessions("sessionId","clientId",resource,scope,approval,"refreshDigest","createdAt","expiresAt")
 VALUES('${session}','vaultix-cli','https://vaultix.invalid','vaultix:user',jsonb_build_object('sessionId','${session}','userId','${user}','orgId','${org}','rootOrgId','${org}','authMethod','email'),decode(repeat('01',32),'hex'),clock_timestamp(),clock_timestamp()+interval '1 hour');
 INSERT INTO vaultix_device_session_events(id,"sessionId","userId","orgId",action,provenance) VALUES('${event}','${session}','${user}','${org}','issued','{}');
 UPDATE vaultix_device_session_events SET "preparationStatus"='prepared',"preparedAt"=clock_timestamp(),"preparationSnapshot"='{"version":1}' WHERE id='${event}';
 INSERT INTO vaultix_device_event_deliveries("eventId","orgId",destination,"recipientId",payload,"expiresAt",status,"settledAt")
 VALUES('${event}','${org}','audit','${org}','{"version":1}',clock_timestamp()+interval '1 day','disabled',clock_timestamp());
 INSERT INTO vaultix_device_event_deliveries("eventId","orgId",destination,"recipientId",payload,"expiresAt",status,attempts)
 VALUES('${event}','${org}','email','${user}','{"version":1,"purpose":"rollback-proof"}',clock_timestamp()+interval '1 day','unknown',1);
 COMMIT;`);
 h.output(['stop',current]);phase='previous binary with advanced migration history';h.output(['start',old]);await h.ready(old);
 assert.equal((await h.request(old,'/api/v1/admin/config')).config.initialized,true);
 assert.ok((await h.request(old,'/api/v2/users/me/sessions',{token})).some(row=>row.id===session));
 assert.equal(h.sql(db,`SELECT count(*) FROM vaultix_device_session_events WHERE id='${event}' AND "sourceContext"->'subject'->>'id'='${user}'`),'1');
 report.checks.push('Previous image starts with advanced migration history and preserves owner, sessions and captured context');
 phase='previous binary canonical revocation API';
 const endpoint='/api/v2/users/me/sessions/'+session;
 // The generic request helper always declares JSON. An empty DELETE with that
 // header is correctly rejected; use the real bodyless HTTP shape instead.
 const invalid=await h.http(old,endpoint,{method:'DELETE',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'}});
 assert.equal(invalid.status,400);assert.equal(JSON.parse(invalid.body).error,'EmptyJsonBody');
 const deleted=await h.http(old,endpoint,{method:'DELETE',headers:{Authorization:'Bearer '+token}});assert.equal(deleted.status,200);
 assert.equal(h.sql(db,`SELECT count(*) FROM auth_token_sessions WHERE id='${session}'`),'0');
 assert.equal(h.sql(db,`SELECT count(*) FROM vaultix_device_session_events WHERE "sessionId"='${session}' AND action='revoked' AND provenance->>'initiator'='unattributed' AND "sourceContext"->'subject'->>'id'='${user}'`),'1');
 report.checks.push('Previous image real session-revocation API records the new transactional deletion fact');
 h.output(['stop',old]);phase='reupgrade';h.output(['start',current]);await h.ready(current);
 assert.equal((await h.request(current,'/api/v1/admin/config')).config.initialized,true);
 assert.equal(h.sql(db,`SELECT count(*) FROM vaultix_device_session_events WHERE "sessionId"='${session}'`),'2');
 assert.equal(h.sql(db,`SELECT count(*) FROM vaultix_device_event_deliveries WHERE "eventId"='${event}' AND status='unknown' AND payload->>'purpose'='rollback-proof'`),'1');
 assert.equal(h.sql(db,`SELECT count(*) FROM vaultix_device_session_events WHERE "sessionId"='${session}' AND action='revoked' AND "preparationStatus"='pending'`),'1');
 report.checks.push('Reupgrade preserves existing owner, immutable events, unknown delivery and the previous binary pending revocation without reapplying schema');
 report.passed=true;
}catch(error){report.failure={phase,message:error.code==='ERR_ASSERTION'?error.message:'Binary rollback proof failed; raw diagnostics withheld.'};process.exitCode=1;}
finally{report.cleanupPassed=h.cleanup();if(!report.cleanupPassed){report.passed=false;process.exitCode=1}writeFileSync(resolve(directory,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,checks:report.checks,failure:report.failure,cleanupPassed:report.cleanupPassed,directory}));}
