// Disposable old/new binary and actual migration acceptance; no operator targets.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createDisposableImageHarness } from "./lib/disposable-image.mjs";
const [image, previous] = process.argv.slice(2);
assert.equal(process.argv.length, 4, "Supply locally built candidate and previous canonical images");
let phase = "inspection";
const h = createDisposableImageHarness(image, () => phase);
const old = createDisposableImageHarness(previous, () => phase).artifact;
const { container, output, docker, request, ready, sql, waitFor } = h;
const run = "vaultix-binding-" + randomBytes(8).toString("hex");
mkdirSync(resolve(".cache"), { recursive: true });
const evidence = mkdtempSync(resolve(".cache/nomen-binding-migration-"));
const report = { passed: false, artifact: h.artifact, previous: old, checks: [], exclusions: ["public account linking", "real fresh-authentication proof", "live Nomen", "notification delivery", "tenant actor cutover"] };
const check = message => { report.checks.push(message); console.log("Vaultix binding: " + message); };
const dbPassword = randomBytes(24).toString("hex"), user = randomUUID(), binding = randomUUID();
const password = "Vx9!" + [...randomBytes(24)].map(v => v.toString(16).padStart(2, "0")).join("-");
const canary = randomBytes(32).toString("hex");
const migrations = ["20261030220000_vaultix-identity-bindings.mjs", "20261031001000_vaultix-identity-reauthentication.mjs"];
function migrate(app, migration, direction, expectedSuccess) {
  const code = `import knex from 'knex'; const db=knex({client:'pg',connection:process.env.DB_CONNECTION_URI});
    try { await db.migrate[${JSON.stringify(direction)}]({directory:'./dist/db/migrations',tableName:'vaultix_migrations',loadExtensions:['.mjs'],name:${JSON.stringify(migration)}}); }
    catch { process.exitCode=2; } finally { await db.destroy(); }`;
  const result = docker(["exec", app, "node", "--input-type=module", "-e", code], { allowFailure: true });
  assert.equal(result.error, undefined); assert.equal(result.status, expectedSuccess ? 0 : 2, "Migration outcome differs from expected retention policy");
}
try {
  h.createNetwork(run);
  const dbName=run+"-db", cacheName=run+"-cache";
  const db=container(dbName,"postgres:16.6-alpine",[],{POSTGRES_USER:"vaultix",POSTGRES_DB:"vaultix",POSTGRES_PASSWORD:dbPassword});
  const cache=container(cacheName,"docker.dragonflydb.io/dragonflydb/dragonfly:v1.34.2",["--default_lua_flags=allow-undeclared-keys","--cache_mode=false","--maxmemory=512mb","--proactor_threads=2"]);
  await waitFor(()=>docker(["exec",db,"pg_isready","-U","vaultix","-d","vaultix"],{allowFailure:true}).status===0,"database readiness");
  await waitFor(()=>docker(["exec",cache,"redis-cli","ping"],{allowFailure:true}).status===0,"cache readiness");
  const env={DB_CONNECTION_URI:'postgres://vaultix:'+dbPassword+'@'+dbName+':5432/vaultix',VAULTIX_CACHE_PROVIDER:'dragonfly',VAULTIX_CACHE_URL:'redis://'+cacheName+':6379',ENCRYPTION_KEY:randomBytes(16).toString('hex'),AUTH_SECRET:randomBytes(32).toString('hex'),SITE_URL:'http://127.0.0.1:8200',TELEMETRY_ENABLED:'false',DISABLE_UPDATE_CHECK:'true'};
  phase="old binary fixture";
  const before=container(run+"-before",old.id,[],env);await ready(before);
  const owner=await request(before,"/api/v1/admin/signup",{method:"POST",body:{email:run+"@vaultix.invalid",password,firstName:"Binding",organizationName:"Binding compatibility"}});
  const {token}=await request(before,"/api/v3/auth/select-organization",{method:"POST",token:owner.token,body:{organizationId:owner.organization.id}});
  const {project}=await request(before,"/api/v1/projects",{method:"POST",token,body:{projectName:"Binding compatibility"}});
  await request(before,"/api/v4/secrets/BINDING_CANARY",{method:"POST",token,body:{projectId:project.id,environment:"dev",secretPath:"/",secretValue:canary}});
  sql(db,`INSERT INTO users(id,username,email,"isAccepted","createdAt","updatedAt") VALUES('${user}','${user}@example.test','${user}@example.test',true,NOW(),NOW());`);
  const cipher=sql(db,`SELECT encode("encryptedValue",'hex') FROM secrets_v2 WHERE key='BINDING_CANARY';`);assert.ok(cipher&&!cipher.includes(canary));
  output(["stop","-t","10",before]);
  phase="forward migration";
  const after=container(run+"-after",h.artifact.id,[],env);await ready(after);
  for (const migration of migrations) assert.equal(sql(db,`SELECT count(*) FROM vaultix_migrations WHERE name='${migration}';`),"1");
  check("existing store upgraded through actual canonical startup migration");
  for (const migration of [...migrations].reverse()) migrate(after,migration,"down",true);
  assert.equal(sql(db,"SELECT to_regclass('public.vaultix_identity_bindings') IS NULL AND to_regclass('public.vaultix_identity_reauth_proofs') IS NULL;"),"t");
  for (const migration of migrations) migrate(after,migration,"up",true);
  assert.equal(sql(db,"SELECT count(*) FROM vaultix_identity_bindings;"),"0");
  assert.equal(sql(db,`SELECT encode("encryptedValue",'hex') FROM secrets_v2 WHERE key='BINDING_CANARY';`),cipher);
  check("empty migration down/up preserves existing ciphertext and ledger");
  sql(db,`INSERT INTO vaultix_identity_bindings(id,issuer,subject,"userId","proofId","sessionId") VALUES('${binding}','https://fixture.nomen.invalid','fixture-subject','${user}','${randomUUID()}','${randomUUID()}');`);
  const session = randomUUID();
  sql(db,`INSERT INTO auth_token_sessions(id,"userId","accessVersion","refreshVersion",ip,"userAgent","lastUsed","createdAt","updatedAt") VALUES('${session}','${user}',1,1,'127.0.0.1','migration-fixture',NOW(),NOW(),NOW());
    INSERT INTO vaultix_identity_reauth_attempts("userId",attempts) VALUES('${user}',1);
    INSERT INTO vaultix_identity_reauth_proofs("userId",id,digest,issuer,action,"sessionId","accessVersion","orgId","policyDigest","authenticatedAt","expiresAt") VALUES('${user}','${randomUUID()}',decode(repeat('01',32),'hex'),'https://fixture.nomen.invalid','link','${session}',1,'${owner.organization.id}',decode(repeat('02',32),'hex'),NOW(),NOW()+interval '5 minutes');`);
  for (const migration of [...migrations].reverse()) migrate(after,migration,"down",false);
  assert.equal(sql(db,`SELECT count(*) FROM vaultix_identity_bindings WHERE id='${binding}';`),"1");
  for (const migration of migrations) assert.equal(sql(db,`SELECT count(*) FROM vaultix_migrations WHERE name='${migration}';`),"1");
  assert.equal(sql(db,`SELECT attempts FROM vaultix_identity_reauth_attempts WHERE "userId"='${user}';`),"1");
  check("nonempty rollback preserves identity provenance, proof and attempt state, and migration history");
  output(["stop","-t","10",after]);
  phase="previous binary on migrated store";
  const rollback=container(run+"-rollback",old.id,[],env);await ready(rollback);
  phase="old binary secret decryption";
  const query=new URLSearchParams({projectId:project.id,environment:"dev",secretPath:"/",viewSecretValue:"true"});
  const result=await request(rollback,"/api/v4/secrets/BINDING_CANARY?"+query,{token});assert.ok(result.secret.secretValue===canary,"Ciphertext no longer decrypts after binary rollback");
  phase="old binary account deletion";
  // A bodyless DELETE must not advertise an empty JSON document.
  const deletion=h.http(rollback,"/api/v1/admin/user-management/users/"+user,{method:"DELETE",headers:{Authorization:"Bearer "+token}});
  assert.equal(deletion?.status,200,"Previous binary account deletion failed");
  phase="deletion tombstone history";
  assert.equal(sql(db,`SELECT "userId" IS NULL AND "revokedAt" IS NOT NULL FROM vaultix_identity_bindings WHERE id='${binding}';`),"t");
  assert.equal(sql(db,`SELECT string_agg(action,',' ORDER BY id) FROM vaultix_identity_binding_events WHERE "bindingId"='${binding}';`),"linked,user-deleted");
  assert.equal(sql(db,`SELECT (SELECT count(*) FROM vaultix_identity_reauth_proofs WHERE "userId"='${user}')+(SELECT count(*) FROM vaultix_identity_reauth_attempts WHERE "userId"='${user}');`),"0");
  check("previous binary starts, decrypts existing secrets and deletes account with atomic tombstone history");
  output(["stop","-t","10",rollback]);output(["start",after]);await ready(after);
  phase="candidate restart";
  assert.equal(sql(db,`SELECT "userId" IS NULL FROM vaultix_identity_bindings WHERE id='${binding}';`),"t");
  check("candidate restarts with preserved deletion tombstone");report.passed=true;
} catch { report.failedPhase=phase;process.exitCode=1; }
finally { report.cleanedUp=h.cleanup();if(!report.cleanedUp){report.passed=false;process.exitCode=1;}writeFileSync(resolve(evidence,"result.json"),JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,failedPhase:report.failedPhase,evidence})); }
