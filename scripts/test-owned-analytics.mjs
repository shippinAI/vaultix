// Real PostgreSQL acceptance for the owned, explicit-column analytics generator.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildAnalyticsViewStatements, buildAnalyticsGrantStatements, readAnalyticsViewConfig } from '../platform/engine/backend/src/db/analytics-views.ts';

const require = createRequire(resolve('platform/engine/backend/package.json'));
const { load, FAILSAFE_SCHEMA } = require('js-yaml');
const config = readAnalyticsViewConfig(load(readFileSync('platform/engine/backend/src/db/sanitized-schema.yaml', 'utf8'), { schema: FAILSAFE_SCHEMA }));
const name = `vaultix-analytics-proof-${randomBytes(6).toString('hex')}`;
const docker = (args, input) => execFileSync('docker', args, { encoding: 'utf8', input, stdio: ['pipe','pipe','pipe'], timeout: 120000 });
const sql = (input) => docker(['exec','-i',name,'psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-At'], input);
const denial = (statement) => {
  try { sql(statement); } catch (error) {
    assert.match(String(error.stderr), /permission denied|cannot (?:insert|update|delete)/i);
    return;
  }
  assert.fail('Expected PostgreSQL to deny the operation.');
};
let started = false;
try {
  for (const bad of [null, {}, {tables:[]}, {tables:[{name:'bad',source:'public.users',columns:['*']}]},
    {tables:[{name:'bad',source:'public.users; DROP TABLE vx_auth_users',columns:['id']}]},
    {tables:[{name:'bad',source:'public.users',columns:['id','id']}]},
    {tables:[{name:'bad',source:'public.users',columns:['id'],where:'true'}]}]) {
    assert.throws(() => buildAnalyticsViewStatements(bad,'analytics'));
  }
  assert.throws(() => buildAnalyticsGrantStatements('analytics','reader"; DROP SCHEMA public CASCADE;--'));
  assert.throws(() => buildAnalyticsViewStatements(config,'analytics; SELECT 1'));
  docker(['run','--detach','--rm','--network','none','--name',name,'--label','vaultix.test=owned-analytics',
    '-e',`POSTGRES_PASSWORD=${randomBytes(24).toString('hex')}`,'postgres:16.6-alpine']);
  started = true;
  let ready = false;
  for(let attempt=0;attempt<60;attempt++) {
    try { docker(['exec',name,'pg_isready','-U','postgres']); ready=true; break; } catch {}
    await new Promise(r=>setTimeout(r,500));
  }
  assert.ok(ready,'Disposable PostgreSQL did not become ready');
  // Build source tables independently from the YAML allowlist. Every source gets a
  // canary column that must never appear in the resulting analytics view.
  const quote = name => '"'+name.replaceAll('"','""')+'"';
  for(const view of config.tables) {
    const [schema,table]=view.source.split('.');
    sql(`CREATE SCHEMA IF NOT EXISTS ${quote(schema)}; CREATE TABLE ${quote(schema)}.${quote(table)} (${view.columns.map(column=>`${quote(column)} text`).join(',')}, "vaultix_private_canary" text);`);
  }
  sql(buildAnalyticsViewStatements(config,'analytics').join('\n'));
  const observed = sql("SELECT table_name || ':' || string_agg(column_name, ',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema='analytics' GROUP BY table_name ORDER BY table_name;").trim().split(/\r?\n/);
  const expected=config.tables.map(view=>`${view.name}:${view.columns.join(',')}`).sort();
  assert.deepEqual(observed,expected,'Every configured view must preserve the exact ordered column allowlist');
  sql('CREATE ROLE "123-vaultix-reader"; REVOKE ALL ON SCHEMA public FROM PUBLIC;');
  sql(buildAnalyticsGrantStatements('analytics','123-vaultix-reader').join('\n'));
  const first=config.tables[0];
  sql(`SET ROLE "123-vaultix-reader"; SELECT * FROM analytics.${quote(first.name)} LIMIT 0;`);
  denial(`SET ROLE "123-vaultix-reader"; SELECT * FROM ${first.source.split('.').map(quote).join('.')};`);
  denial(`SET ROLE "123-vaultix-reader"; DELETE FROM analytics.${quote(first.name)};`);
  assert.equal(sql("SELECT count(*) FROM information_schema.columns WHERE table_schema='analytics' AND column_name='vaultix_private_canary';").trim(),'0');
  console.log(JSON.stringify({passed:true,realPostgres:true,views:config.tables.length,exactColumns:true,canaryExcluded:true,baseTableDenied:true,writesDenied:true,invalidInputRejected:true}));
} finally {
  if(started) docker(['rm','--force',name]);
}
