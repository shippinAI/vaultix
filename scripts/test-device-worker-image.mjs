import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createDisposableImageHarness} from './lib/disposable-image.mjs';
let phase='artifact';
const h=createDisposableImageHarness(process.argv[2],()=>phase);
mkdirSync('.cache',{recursive:true});const directory=mkdtempSync(resolve('.cache/device-worker-image-'));
const report={passed:false,artifact:h.artifact,harnessSha256:createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex'),checks:[],scope:'Actual assembled worker registration, profile gates, durable owner effects, restart and shutdown on isolated PostgreSQL/Dragonfly. Public device authorization and external federation are not exercised.'};
const name='vaultix-worker-'+randomBytes(8).toString('hex');
try {
 h.createNetwork(name);phase='disposable services';
 const password=randomBytes(24).toString('hex'),dbName=name+'-db',cacheName=name+'-cache';
 const db=h.container(dbName,'postgres:16.6-alpine',[],{POSTGRES_USER:'vaultix',POSTGRES_DB:'vaultix',POSTGRES_PASSWORD:password});
 const cache=h.container(cacheName,'docker.dragonflydb.io/dragonflydb/dragonfly:v1.34.2',['--default_lua_flags=allow-undeclared-keys','--cache_mode=false','--maxmemory=512mb','--proactor_threads=2']);
 await h.waitFor(()=>h.docker(['exec',db,'pg_isready','-U','vaultix','-d','vaultix'],{allowFailure:true}).status===0,'database');
 await h.waitFor(()=>h.docker(['exec',cache,'redis-cli','ping'],{allowFailure:true}).status===0,'cache');
 const env={DB_CONNECTION_URI:`postgres://vaultix:${password}@${dbName}:5432/vaultix`,VAULTIX_CACHE_PROVIDER:'dragonfly',VAULTIX_CACHE_URL:`redis://${cacheName}:6379`,ENCRYPTION_KEY:randomBytes(16).toString('hex'),AUTH_SECRET:randomBytes(32).toString('hex'),SITE_URL:'http://127.0.0.1:8200',TELEMETRY_ENABLED:'false',DISABLE_UPDATE_CHECK:'true'};
 const app=(suffix,profile,enabled=true)=>h.container(name+'-'+suffix,h.artifact.id,[],{...env,QUEUE_WORKERS_ENABLED:String(enabled),QUEUE_WORKER_PROFILE:profile});
 const stop=id=>{const started=performance.now();h.output(['stop','-t','20',id]);assert.notEqual(h.output(['inspect','--format','{{.State.ExitCode}}',id]),'137','Worker shutdown required SIGKILL');assert.ok(performance.now()-started<20000,'Worker shutdown exceeded grace period');};
 const disabled=app('disabled','all',false);await h.ready(disabled);
 const owner=await h.request(disabled,'/api/v1/admin/signup',{method:'POST',body:{email:name+'@vaultix.invalid',password:'Vx9!'+randomBytes(32).toString('hex'),firstName:'Worker',organizationName:'Worker image proof'}});
 const orgId=owner.organization.id,userId=h.sql(db,`SELECT id FROM users WHERE email='${name}@vaultix.invalid'`);
 for(const id of [orgId,userId])assert.match(id,/^[a-f0-9-]{36}$/);
 const seed=()=>{
  const id=randomUUID(),sessionId=randomUUID();
  const provenance={authMethod:'email',mfaVerified:false,mfaMethod:'',ssoBypass:false,rootOrgId:orgId,clientId:'vaultix-cli'};
  h.sql(db,`BEGIN; INSERT INTO auth_token_sessions (id,"userId",ip,"userAgent","sessionType","lastUsed") VALUES ('${sessionId}','${userId}','192.0.2.22','Vaultix worker image proof','device-v1',clock_timestamp()); INSERT INTO vaultix_device_sessions ("sessionId","clientId",resource,scope,approval,"refreshDigest","createdAt","expiresAt") VALUES ('${sessionId}','vaultix-cli','https://vaultix.invalid','vaultix:user','${JSON.stringify({sessionId,userId,orgId,...provenance})}'::jsonb,decode('${randomBytes(32).toString('hex')}','hex'),clock_timestamp(),clock_timestamp()+interval '1 hour'); INSERT INTO vaultix_device_session_events (id,"sessionId","userId","orgId",action,provenance) VALUES ('${id}','${sessionId}','${userId}','${orgId}','issued','${JSON.stringify(provenance)}'::jsonb); COMMIT;`);
  return id;
 };
 const idle=id=>assert.equal(h.sql(db,`SELECT "preparationAttempts" FROM vaultix_device_session_events WHERE id='${id}'`),'0');
 const accepted=async id=>{
  await h.waitFor(()=>h.sql(db,`SELECT count(*) FROM vaultix_device_event_deliveries WHERE "eventId"='${id}' AND status IN ('delivered','disabled')`)==='3','durable worker acceptance',45000);
  assert.equal(h.sql(db,`SELECT count(*) FROM audit_logs WHERE id='${id}' AND actor='user' AND "actorMetadata"::jsonb->>'userId'='${userId}'`),'1');
  assert.equal(h.sql(db,`SELECT count(*) FROM user_notifications n JOIN vaultix_device_event_deliveries d ON d.id=n.id WHERE d."eventId"='${id}' AND n."userId"='${userId}'`),'1');
  assert.equal(h.sql(db,`SELECT count(*) FROM vaultix_device_event_deliveries WHERE "eventId"='${id}' AND attempts<>1`),'0');
 };
 phase='disabled profile';const first=seed();await new Promise(done=>setTimeout(done,1800));idle(first);stop(disabled);report.checks.push('Disabled workers leave durable source events unclaimed');
 phase='scanning-only profile';const scanning=app('scanning','secret-scanning');await h.ready(scanning);await new Promise(done=>setTimeout(done,1800));idle(first);stop(scanning);report.checks.push('Scanning-only profile leaves standard security-event work unclaimed');
 phase='standard profile';const standard=app('standard','standard');await h.ready(standard);await accepted(first);report.checks.push('Standard profile prepares and delivers actual audit and notification with explicit disabled SMTP');
 phase='all profile and independent replicas';const all=app('all','all');await h.ready(all);const ids=[seed(),seed(),seed()];for(const id of ids)await accepted(id);report.checks.push('Standard and all replicas consume distinct database claims without duplicate accepted effects');stop(standard);
 phase='busy-pool shutdown';
 const lock=h.container(name+'-lock','postgres:16.6-alpine',['psql','-X','-v','ON_ERROR_STOP=1','-c',"BEGIN; LOCK TABLE vaultix_device_session_events IN ACCESS EXCLUSIVE MODE; SELECT pg_sleep(60); ROLLBACK;"],{PGHOST:dbName,PGUSER:'vaultix',PGDATABASE:'vaultix',PGPASSWORD:password,PGAPPNAME:'vaultix-worker-lock'});
 await h.waitFor(()=>h.sql(db,"SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE a.application_name='vaultix-worker-lock' AND l.relation='vaultix_device_session_events'::regclass AND l.granted")!=='0','fixture lock');
 await h.waitFor(()=>h.sql(db,"SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%vaultix_device_session_events%' AND application_name<>'vaultix-worker-lock'")!=='0','worker blocked query');
 stop(all);report.checks.push('Actual application shuts down without SIGKILL while worker database claims are blocked');h.output(['stop','-t','5',lock]);
 phase='restart recovery';const final=seed();h.output(['start',all]);await h.ready(all);await accepted(final);assert.equal((await h.request(all,'/api/v1/admin/config')).config.initialized,true);stop(all);report.checks.push('Restart resumes pending source work and preserves the initialized owner');
 report.passed=true;
} catch(error) {report.failure={phase,message:error.code==='ERR_ASSERTION'?error.message:'Device worker image verification failed; raw diagnostics withheld.',cause:error.message?.startsWith('Timed out:')?'timeout':undefined};process.exitCode=1;}
finally {report.cleanupPassed=h.cleanup();if(!report.cleanupPassed){report.passed=false;process.exitCode=1}writeFileSync(resolve(directory,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,checks:report.checks,failure:report.failure,cleanupPassed:report.cleanupPassed,directory}));}
