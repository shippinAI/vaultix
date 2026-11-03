// Real Linux native CLI -> Docker -> packaged application acceptance for changed
// migration sets. Derived images carry test-only migrations and every fault lives
// in this disposable driver; product code has no test bypass.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createDisposableImageHarness } from './lib/disposable-image.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(resolve(root, '.ai/package.json'));
const Ajv = require('ajv/dist/2020');
const ajv = new Ajv({ strict: true });
require('ajv-formats')(ajv);
ajv.addSchema(JSON.parse(readFileSync(resolve(root, 'contracts/vaultix.release-checkpoint.v1.json'))));
const validResult = ajv.compile(JSON.parse(readFileSync(resolve(root, 'contracts/vaultix.instance-operation.v1.json'))));
const inputs = JSON.parse(readFileSync(resolve(root, '.cache/lifecycle-inputs.json')));
const candidate = JSON.parse(readFileSync(inputs.candidateReceipt));
assert.ok(candidate.passed, 'An accepted canonical image is required');
assert.match(inputs.clientImage, /^sha256:[a-f0-9]{64}$/);
let phase = 'initialization';
const h = createDisposableImageHarness(candidate.imageId, () => phase);
const { docker, output } = h;
const run = `vaultix-migration-${randomBytes(8).toString('hex')}`;
const project = run;
mkdirSync(resolve(root, '.cache'), { recursive: true });
const evidence = mkdtempSync(resolve(root, '.cache/server-migration-acceptance-'));
const report = { passed: false, cliSha256: createHash('sha256').update(readFileSync(inputs.cli)).digest('hex'),
  candidate: candidate.imageId, revision: candidate.revision, development: inputs.development === true, checks: [], measurements: {},
  exclusions: ['semantic equivalence of arbitrary migrations', 'full disk', 'external audit database (refused; unit tested)', 'external cache', 'candidate application boot on the rehearsal copy', 'operator production deployment'] };
const check = name => { report.checks.push(name); console.log(`Vaultix migration: ${name}`); };
const PATH = 'PATH=/test-bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
const images = [], operations = new Set(), sensitive = [];
let runner, stateVolume;
const client = args => output(['exec', runner, ...args]);
const seen = result => { if (result?.operation?.operation) operations.add(result.operation.operation); return result; };
const cli = (args, { success = true, directory = '/state/instance' } = {}) => {
  const r = docker(['exec', '-e', PATH, runner, 'vaultix', 'server', ...args, '--directory', directory, '--json'], { allowFailure: true, timeout: 420_000 });
  const text = r.stdout.toString(), diagnostics = r.stderr.toString();
  assert.ok(sensitive.every(value => !text.includes(value) && !diagnostics.includes(value)), 'Native CLI disclosed a sensitive canary');
  assert.ok(!text.includes('lifecycle test refusal') && !diagnostics.includes('lifecycle test refusal'), 'Migration output reached CLI diagnostics');
  if (r.error || (r.status === 0) !== success) writeFileSync(resolve(evidence, 'native-failure.json'), JSON.stringify({ phase, exit: r.status, state: text, diagnostics }), { mode: 0o600 });
  assert.ok(!r.error && (r.status === 0) === success, `Native CLI result mismatch during ${phase}`);
  const result = text.trim() ? JSON.parse(text) : null;
  if (result) assert.ok(validResult(result), 'Native lifecycle response violates its public contract');
  return seen(result);
};
const service = name => output(['ps', '-aq', '--filter', `label=com.docker.compose.project=${project}`, '--filter', `label=com.docker.compose.service=${name}`]);
const inspect = id => JSON.parse(output(['inspect', id]))[0];
const app = () => service('backend');
const api = (path, options) => h.request(app(), path, options);
const privateWrite = (path, data) => docker(['exec', '-i', runner, 'sh', '-c', 'umask 077; cat > "$1"', 'write', path], { input: data });
const sql = query => h.sql(service('db'), query);
const sqlIn = (database, query) => output(['exec', '-i', service('db'), 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'vaultix', '-d', database, '-At'], { input: query });
const tableExists = (table, database = 'vaultix') => sqlIn(database, `SELECT to_regclass('public.${table}') IS NOT NULL;`) === 't';
const appliedCount = () => Number(sql('SELECT count(*) FROM vaultix_migrations;'));
const lockHeld = () => sql('SELECT count(*) FROM vaultix_migrations_lock WHERE is_locked <> 0;') !== '0';
const databases = () => sqlIn('template1', "SELECT datname FROM pg_database WHERE NOT datistemplate ORDER BY 1;").split('\n');

// A derived image keeps the candidate's identity labels and adds only test files.
// Image work on a busy shared host can pass the harness's usual limit. This container
// has never run, so Docker's own error is safe to keep and is the only way to tell why.
const derive = (name, files, changes = [], base = candidate.imageId) => {
  const slow = { timeout: 600_000 };
  const container = output(['create', base], slow);
  try {
    const directory = mkdtempSync(resolve(evidence, 'image-'));
    for (const [file, content] of Object.entries(files)) {
      const path = resolve(directory, file);
      writeFileSync(path, content);
      output(['cp', path, `${container}:/backend/dist/db/migrations/${file}`], slow);
    }
    const committed = docker(['commit', ...changes.flatMap(change => ['--change', change]), container], { ...slow, allowFailure: true });
    if (committed.error || committed.status !== 0) {
      writeFileSync(resolve(evidence, `derive-${name}-failure.json`), JSON.stringify({ status: committed.status, error: committed.error?.code, stderr: committed.stderr?.toString().slice(0, 2000) }), { mode: 0o600 });
      assert.fail(`Could not derive the ${name} image`);
    }
    const id = committed.stdout.toString().trim();
    assert.match(id, /^sha256:[a-f0-9]{64}$/);
    images.push(id);
    privateWrite(`/proof/${name}.json`, JSON.stringify({ ...candidate, imageId: id }));
    return id;
  } finally { output(['rm', '-f', container], slow); }
};
const migration = (up, down = '') => `export async function up(knex) { ${up} }\nexport async function down(knex) { ${down} }\n`;
const FORWARD = '29990101000000_lifecycle-forward.mjs';
// On the copy, refuses unless the rehearsal has real settings and only loopback, and
// cannot reach the live database. Slow enough that a killed CLI leaves it running, and
// outside a batch transaction, because only then does knex commit its lock separately:
// removing this run while it is in progress would strand that lock.
const forwardFile = "export const config = { transaction: false };\n" + migration(`
  if (!process.env.DB_CONNECTION_URI.includes('@db:')) {
    const { networkInterfaces } = await import('node:os');
    const { connect } = await import('node:net');
    const reached = await new Promise(done => {
      const socket = connect({ host: 'db', port: 5432 });
      socket.once('connect', () => { socket.destroy(); done(true); });
      socket.once('error', () => done(false));
      setTimeout(() => { socket.destroy(); done(false); }, 3000);
    });
    if (reached || Object.keys(networkInterfaces()).some(name => name !== 'lo')) throw new Error('rehearsal has a network path');
    if (!process.env.ENCRYPTION_KEY || !process.env.AUTH_SECRET) throw new Error('rehearsal is missing application settings');
  }
  await knex.raw('SELECT pg_sleep(12)');
  await knex.raw('CREATE TABLE vaultix_lifecycle_forward (id int); INSERT INTO vaultix_lifecycle_forward VALUES (1);');`);
// Passes on the copy and fails only on the live store. Knex wraps a batch in one
// transaction unless a migration opts out, so opting out is what leaves a partial store.
const liveOnly = "export const config = { transaction: false };\n" + migration("if (process.env.DB_CONNECTION_URI.includes('@db:')) throw new Error('lifecycle test refusal');");

// The migration-set hash the earlier CLI saved must not change for this one.
const earlierProbe = `const fs=require('fs'),p=require('path'),crypto=require('crypto');const dir='/backend/dist/db/migrations',names=fs.readdirSync(dir).filter(n=>/\\.(mjs|ts)$/.test(n)).sort();const h=crypto.createHash('sha256');for(const n of names){const f=p.join(dir,n);h.update(n+'\\0');h.update(fs.readFileSync(f));}process.stdout.write(h.digest('hex'));`;
// A held command never resumes: the CLI that issued it has been killed.
const shim = `#!/bin/sh
real=/usr/local/bin/docker
hold() { touch /state/entered; while [ -f "$1" ]; do sleep 1; done; exit 99; }
case "$1" in
wait)
 if [ -f /state/hold-rehearsal ] || [ -f /state/hold-migrate ]; then
  case "$($real inspect --format '{{.Name}}' "$2")" in
  */vaultix-rehearsal-*) [ ! -f /state/hold-rehearsal ] || hold /state/hold-rehearsal ;;
  */vaultix-migrate-*) [ ! -f /state/hold-migrate ] || hold /state/hold-migrate ;;
  esac
 fi ;;
exec)
 case " $* " in
 *" pg_restore "*"-d vaultix-restore-"*) [ ! -f /state/hold-restore ] || hold /state/hold-restore ;;
 *"ALTER DATABASE"*) if [ -f /state/hold-swap ]; then "$real" "$@" || exit $?; hold /state/hold-swap; fi ;;
 esac ;;
esac
exec "$real" "$@"
`;
// Run one native command in the background, killable with SIGKILL at a gate.
const background = (args) => {
  const child = spawn('docker', ['exec', '-e', PATH, runner, 'sh', '-c', `echo $$ > /state/active-pid; exec vaultix server ${args} --directory /state/instance --json`], { windowsHide: true, stdio: 'ignore' });
  return new Promise(done => { child.once('error', () => done(-1)); child.once('exit', code => done(code)); });
};
const killAtGate = async (gate, args, label) => {
  client(['touch', gate]);
  const exited = background(args);
  await h.waitFor(() => docker(['exec', runner, 'test', '-f', '/state/entered'], { allowFailure: true }).status === 0, label, 240_000);
  client(['sh', '-c', 'kill -9 "$(cat /state/active-pid)"']);
  assert.notEqual(await exited, 0);
  client(['rm', '-f', gate, '/state/entered']);
  // Let the held shim observe the removed gate and exit before state is read.
  await new Promise(done => setTimeout(done, 2000));
};

try {
  stateVolume = output(['volume', 'create', '--label', `vaultix.lifecycle.test=${run}`, `${run}-state`]);
  runner = output(['create', '--name', `${run}-client`, '--label', `vaultix.lifecycle.test=${run}`, '--mount', 'type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock',
    '--mount', `type=volume,source=${stateVolume},target=/state`, '--entrypoint', 'sleep', inputs.clientImage, 'infinity']);
  output(['start', runner]);
  output(['cp', resolve(inputs.cli), `${runner}:/usr/local/bin/vaultix`]);
  client(['chmod', '755', '/usr/local/bin/vaultix']);
  client(['mkdir', '-p', '/proof', '/test-bin']);
  output(['cp', resolve(inputs.candidateReceipt), `${runner}:/proof/candidate.json`]);
  privateWrite('/test-bin/docker', shim);
  client(['chmod', '755', '/test-bin/docker']);

  phase = 'derived images';
  const lastMigration = output(['run', '--rm', '--network', 'none', '--entrypoint', 'sh', candidate.imageId, '-c', 'ls dist/db/migrations/*.mjs | tail -n 1 | xargs basename']);
  const lastBytes = docker(['run', '--rm', '--network', 'none', '--entrypoint', 'cat', candidate.imageId, `dist/db/migrations/${lastMigration}`]).stdout;
  const forward = derive('forward', { [FORWARD]: forwardFile });
  const sameSet = derive('same-set', {}, ['LABEL vaultix.lifecycle.test=same-set'], forward);
  derive('later', { '29990102000000_lifecycle-later.mjs': migration("await knex.raw('CREATE TABLE vaultix_lifecycle_later (id int)');") }, [], forward);
  derive('failing', { '29990101000000_lifecycle-failing.mjs': migration("throw new Error('lifecycle test refusal');") });
  derive('rewrites', { '29990101000000_lifecycle-rewrites.mjs': migration(`await knex.raw(\`UPDATE secrets_v2 SET "encryptedValue" = "encryptedValue" || '\\\\x00'::bytea\`);`) });
  derive('altered', { [lastMigration]: Buffer.concat([lastBytes, Buffer.from('\n// altered by the lifecycle test\n')]), [FORWARD]: forwardFile });
  derive('partial', { '29990101000000_lifecycle-partial.mjs': migration("await knex.raw('CREATE TABLE vaultix_lifecycle_partial (id int); INSERT INTO vaultix_lifecycle_partial VALUES (1);');"), '29990101000001_lifecycle-live-only.mjs': liveOnly });
  const unbootable = derive('unbootable', { '29990101000000_lifecycle-unbootable.mjs': migration("await knex.raw('CREATE TABLE vaultix_lifecycle_unbootable (id int)');") }, ['CMD ["/bin/false"]']);

  const port = 20000 + randomBytes(2).readUInt16BE() % 30000;
  phase = 'installation with existing data';
  const installed = cli(['install', '--from-build', '/proof/candidate.json', '--site-url', `http://127.0.0.1:${port}`, '--project', project, '--port', String(port)]);
  assert.ok(installed.ready && !installed.recoveryRequired);
  assert.equal(inspect(app()).Image, candidate.imageId);
  assert.equal(output(['run', '--rm', '--network', 'none', '--read-only', '--entrypoint', 'node', candidate.imageId, '-e', earlierProbe]), installed.operation.candidate.migrations);
  const password = `Vx9!${[...randomBytes(24)].map(v => v.toString(16).padStart(2, '0')).join('-')}`;
  const email = `${run}@vaultix.invalid`, canary = randomBytes(32).toString('hex'); sensitive.push(password, canary);
  const owner = await api('/api/v1/admin/signup', { method: 'POST', body: { email, password, firstName: 'Migration', organizationName: 'Migration proof' } });
  const { token } = await api('/api/v3/auth/select-organization', { method: 'POST', token: owner.token, body: { organizationId: owner.organization.id } });
  sensitive.push(token, owner.token);
  const { project: workspace } = await api('/api/v1/projects', { method: 'POST', token, body: { projectName: 'Preserved project' } });
  const scope = { projectId: workspace.id, environment: 'dev', secretPath: '/' };
  await api('/api/v4/secrets/MIGRATION_CANARY', { method: 'POST', token, body: { ...scope, secretValue: canary } });
  const cipherQuery = 'SELECT encode("encryptedValue",\'hex\') FROM secrets_v2 WHERE key=\'MIGRATION_CANARY\';';
  const cipher = sql(cipherQuery);
  assert.ok(cipher && !cipher.includes(canary));
  const baseApplied = appliedCount();
  const secretPath = name => `/api/v4/secrets/${name}?` + new URLSearchParams({ ...scope, viewSecretValue: 'true' });
  // Fresh credentials every time: nothing here may survive only through a session.
  const signIn = async () => {
    const login = await api('/api/v3/auth/login', { method: 'POST', body: { email, password } });
    const selected = await api('/api/v3/auth/select-organization', { method: 'POST', token: login.accessToken, body: { organizationId: owner.organization.id } });
    sensitive.push(login.accessToken, selected.token);
    return selected.token;
  };
  const assertPreserved = async () => {
    assert.equal(sql(cipherQuery), cipher, 'Encrypted row changed');
    const fresh = await signIn();
    assert.ok((await api(secretPath('MIGRATION_CANARY'), { token: fresh })).secret.secretValue === canary, 'Existing canary no longer decrypts');
    await api(secretPath('MIGRATION_CANARY'), { status: 401 });
    return fresh;
  };
  const assertOnCandidate = () => {
    assert.equal(inspect(app()).Image, candidate.imageId);
    assert.equal(inspect(app()).State.Running, true);
    assert.equal(appliedCount(), baseApplied);
    assert.equal(lockHeld(), false);
  };
  check('a changed migration set runs on an instance that holds accounts, projects and secrets; the set identity matches the earlier CLI');

  phase = 'plan and cancel';
  const originalApp = inspect(app()).Id;
  const planned = cli(['upgrade', '--from-build', '/proof/forward.json', '--plan']);
  assert.equal(planned.operation.phase, 'planned');
  assert.deepEqual(planned.operation.migration.pending, [FORWARD]);
  assert.equal(inspect(app()).Id, originalApp); assert.equal(tableExists('vaultix_lifecycle_forward'), false);
  const cancelled = cli(['rollback']);
  assert.ok(cancelled.ready && cancelled.operation.action === 'rollback' && cancelled.operation.revertedFrom === 'planned');
  assert.equal(inspect(app()).Id, originalApp); assertOnCandidate();
  check('a plan names the pending migrations and changes nothing; rollback cancels it with no outage');

  phase = 'refusals before disruption';
  const refusedUnchanged = args => {
    cli(args, { success: false });
    assert.equal(inspect(app()).Id, originalApp); assert.equal(inspect(app()).State.Running, true);
    assert.equal(cli(['status']).recoveryRequired, false);
  };
  refusedUnchanged(['upgrade', '--from-build', '/proof/altered.json', '--plan']);
  check('a candidate that changes an already shipped migration is refused before the application stops');
  sql('UPDATE vaultix_migrations_lock SET is_locked=1;');
  refusedUnchanged(['upgrade', '--from-build', '/proof/forward.json', '--plan']);
  sql('UPDATE vaultix_migrations_lock SET is_locked=0;');
  check('a held migration lock is refused before the application stops');

  phase = 'failed rehearsal';
  const refused = cli(['upgrade', '--from-build', '/proof/failing.json'], { success: false });
  assert.ok(refused.ready && !refused.recoveryRequired, 'The previous application must be running again');
  assert.equal(refused.operation.action, 'rollback'); assert.equal(refused.operation.revertedFrom, 'rehearsing');
  assert.equal(refused.operation.retainedDatabase, undefined);
  assert.ok(refused.message.includes('live database was not changed'));
  assertOnCandidate(); await assertPreserved();
  assert.match(client(['sh', '-c', 'cat /state/instance/op-*-rehearsal-*.log']), /lifecycle test refusal/);
  assert.equal(client(['sh', '-c', 'stat -c %a /state/instance/op-*-rehearsal-*.log | sort -u']), '600');
  check('a migration that fails on the restored copy leaves the live database unchanged, restarts the previous application and keeps its output in a private log');

  phase = 'ciphertext rewrite';
  const rewritten = cli(['upgrade', '--from-build', '/proof/rewrites.json'], { success: false });
  assert.ok(rewritten.ready && rewritten.operation.action === 'rollback');
  assertOnCandidate(); await assertPreserved();
  check('a migration that changes secret ciphertext is caught on the copy before it reaches the live database');

  phase = 'live migration failure';
  const failedLive = cli(['upgrade', '--from-build', '/proof/partial.json'], { success: false });
  assert.equal(failedLive.operation.phase, 'migrating'); assert.ok(failedLive.recoveryRequired && !failedLive.ready);
  assert.equal(tableExists('vaultix_lifecycle_partial'), true, 'The first migration should have committed');
  assert.equal(appliedCount(), baseApplied + 1);
  assert.equal(inspect(app()).State.Running, false);
  assert.equal(cli(['recover'], { success: false }).operation.phase, 'migrating');
  check('a failure on the live store stops before the application starts, reports the phase, and retrying does not hide it');

  phase = 'application started by hand';
  output(['start', failedLive.operation.priorContainer]);
  cli(['rollback'], { success: false });
  assert.equal(cli(['status']).operation.action, 'upgrade');
  assert.equal(inspect(failedLive.operation.priorContainer).State.Running, true);
  check('an application started by hand against the half-migrated store blocks a rollback until the operator accepts losing its writes');

  phase = 'interrupted restore';
  await killAtGate('/state/hold-restore', 'rollback --discard-writes', 'restore gate');
  assert.equal(cli(['status']).operation.phase, 'restoring');
  assert.equal(inspect(failedLive.operation.priorContainer).State.Running, false, 'Nothing may write while the store is replaced');
  assert.equal(tableExists('vaultix_lifecycle_partial'), true, 'Nothing is swapped until the copy is proven');
  const recoveredLive = cli(['recover']);
  assert.ok(recoveredLive.ready && recoveredLive.operation.action === 'rollback' && recoveredLive.operation.revertedFrom === 'migrating');
  const retainedLive = recoveredLive.operation.retainedDatabase;
  assert.match(retainedLive, /^vaultix-replaced-/);
  assertOnCandidate(); assert.equal(tableExists('vaultix_lifecycle_partial'), false);
  assert.equal(tableExists('vaultix_lifecycle_partial', retainedLive), true, 'The replaced database must be kept');
  await assertPreserved();
  assert.ok(databases().every(name => !name.startsWith('vaultix-restore-')), 'No half-restored database may remain');
  check('rollback after a failed live migration restores the checkpoint, survives being killed mid-restore, and keeps the replaced database');

  phase = 'candidate never becomes healthy';
  const sick = cli(['upgrade', '--from-build', '/proof/unbootable.json'], { success: false });
  assert.ok(['replacing', 'validating'].includes(sick.operation.phase));
  assert.equal(inspect(app()).Image, unbootable);
  assert.equal(tableExists('vaultix_lifecycle_unbootable'), true);
  cli(['rollback'], { success: false });
  assert.equal(cli(['status']).operation.action, 'upgrade');
  check('once the new application may have served, rollback refuses until the operator accepts losing writes');
  const cacheContainer = service('cache');
  output(['exec', cacheContainer, 'redis-cli', 'SET', 'vaultix-lifecycle-marker', '1']);
  const recoveredSick = cli(['rollback', '--discard-writes']);
  assert.ok(recoveredSick.ready && recoveredSick.operation.revertedFrom === sick.operation.phase);
  assertOnCandidate(); assert.equal(tableExists('vaultix_lifecycle_unbootable'), false);
  assert.equal(output(['exec', cacheContainer, 'redis-cli', 'EXISTS', 'vaultix-lifecycle-marker']), '0', 'The local cache must not outlive the restored store');
  await assertPreserved();
  assert.ok(recoveredSick.message.includes('local cache was cleared'));
  check('an application that never becomes healthy is rolled back with the store restored and the local cache cleared');

  phase = 'rollback from an interrupted rehearsal';
  const abandoned = cli(['upgrade', '--from-build', '/proof/forward.json', '--plan']);
  const abandonedId = abandoned.operation.operation;
  const leftovers = () => output(['ps', '-aq', '--filter', `label=vaultix.lifecycle.operation=${abandonedId}`]);
  await killAtGate('/state/hold-rehearsal', `upgrade --apply ${abandonedId}`, 'rehearsal gate');
  assert.ok(leftovers().split(/\s+/).length >= 2, 'The killed attempt should leave its restored copy and rehearsal');
  const abandonedBack = cli(['rollback']);
  assert.ok(abandonedBack.ready && abandonedBack.operation.revertedFrom === 'rehearsing');
  assert.equal(leftovers(), '', 'No copy of the store or its keys may remain');
  assert.ok(client(['sh', '-c', `ls /state/instance/${abandonedId}-rehearsal-*.log`]));
  assertOnCandidate(); await assertPreserved();
  check('rollback from an interrupted rehearsal removes the restored copy and the container holding real settings, and keeps its log');

  phase = 'interrupted upgrade';
  const database = inspect(service('db')), cache = inspect(service('cache'));
  const plan = cli(['upgrade', '--from-build', '/proof/forward.json', '--plan']);
  await killAtGate('/state/hold-rehearsal', `upgrade --apply ${plan.operation.operation}`, 'rehearsal gate');
  assert.equal(cli(['status']).operation.phase, 'rehearsing');
  assert.equal(appliedCount(), baseApplied);
  await killAtGate('/state/hold-migrate', 'recover', 'live migration gate');
  assert.equal(cli(['status']).operation.phase, 'migrating');
  const stillRunning = output(['ps', '-q', '--filter', `name=vaultix-migrate-${plan.operation.operation}`]);
  assert.ok(stillRunning, 'The detached migration should outlive the killed CLI');
  const upgraded = cli(['recover']);
  assert.ok(upgraded.ready && upgraded.operation.action === 'upgrade');
  assert.equal(inspect(app()).Image, forward);
  assert.equal(appliedCount(), baseApplied + 1); assert.equal(lockHeld(), false);
  assert.equal(tableExists('vaultix_lifecycle_forward'), true);
  assert.equal(inspect(service('db')).Id, database.Id); assert.equal(inspect(service('cache')).Id, cache.Id);
  assert.deepEqual(inspect(service('db')).Mounts, database.Mounts);
  assert.equal(output(['ps', '-aq', '--filter', `label=vaultix.lifecycle.operation=${plan.operation.operation}`]), '');
  assert.equal(client(['sh', '-c', `ls /state/instance/${plan.operation.operation}-migrate-*.log | wc -l`]), '2', 'The interrupted run keeps its log too');
  const fresh = await assertPreserved();
  await api('/api/v4/secrets/AFTER_UPGRADE', { method: 'POST', token: fresh, body: { ...scope, secretValue: canary } });
  await api('/api/v1/admin/signup', { method: 'POST', body: { email, password, firstName: 'Duplicate' }, status: 400 });
  check('the rehearsal runs with the real application settings, only a loopback interface and no path to the live database');
  check('killed during rehearsal and live migration, the upgrade resumes without stranding the migration lock or disturbing PostgreSQL and the cache');
  check('after migrating, existing login, project, exact ciphertext, decryption and new writes work; anonymous access and repeat bootstrap are denied');

  phase = 'downgrade';
  const migratedApp = inspect(app()).Id;
  cli(['upgrade', '--from-build', '/proof/candidate.json', '--plan'], { success: false });
  assert.equal(inspect(app()).Id, migratedApp); assert.equal(inspect(app()).State.Running, true);
  check('an image older than the store is refused before the application stops');

  phase = 'configuration drift blocks restore';
  client(['cp', '/state/instance/config/vaultix.env', '/state/original.env']);
  client(['sh', '-c', 'printf "\\n# drift\\n" >> /state/instance/config/vaultix.env']);
  cli(['rollback', '--discard-writes'], { success: false });
  const undisturbed = cli(['status']);
  assert.ok(undisturbed.operation.action === 'upgrade' && undisturbed.operation.phase === 'ready');
  assert.equal(inspect(app()).Id, migratedApp); assert.equal(inspect(app()).State.Running, true);
  assert.equal(tableExists('vaultix_lifecycle_forward'), true);
  client(['cp', '/state/original.env', '/state/instance/config/vaultix.env']);
  check('changed configuration refuses a rollback before committing to it, so the running application is left as it is');

  phase = 'missing checkpoint blocks restore';
  const checkpointFile = undisturbed.operation.backup;
  client(['mv', `/state/instance/${checkpointFile}`, '/state/held-checkpoint']);
  cli(['rollback', '--discard-writes'], { success: false });
  const stillUpgraded = cli(['status']);
  assert.ok(stillUpgraded.operation.action === 'upgrade' && stillUpgraded.operation.phase === 'ready');
  assert.equal(inspect(app()).Id, migratedApp); assert.equal(inspect(app()).State.Running, true);
  client(['mv', '/state/held-checkpoint', `/state/instance/${checkpointFile}`]);
  check('a missing checkpoint refuses a rollback before anything stops, so the operator is never stranded with the application down');

  phase = 'interrupted swap and measured recovery';
  const started = Date.now();
  await killAtGate('/state/hold-swap', 'rollback --discard-writes', 'swap gate');
  assert.equal(cli(['status']).operation.phase, 'restoring');
  assert.equal(tableExists('vaultix_lifecycle_forward'), false, 'The swap had already committed');
  const swapped = databases().filter(name => name.startsWith('vaultix-replaced-') && name !== retainedLive && tableExists('vaultix_lifecycle_forward', name));
  assert.equal(swapped.length, 1);
  const restored = cli(['recover']);
  report.measurements.rollbackSeconds = Math.round((Date.now() - started) / 1000);
  assert.ok(restored.ready && restored.operation.revertedFrom === 'ready');
  assert.equal(restored.operation.retainedDatabase, swapped[0]);
  assert.equal(tableExists('vaultix_lifecycle_forward', swapped[0]), true, 'A repeated swap would have lost this');
  assert.ok(sqlIn(swapped[0], "SELECT count(*) FROM secrets_v2 WHERE key='AFTER_UPGRADE';") === '1', 'Writes after the checkpoint stay in the retained database');
  assertOnCandidate();
  const afterRestore = await assertPreserved();
  await api(secretPath('AFTER_UPGRADE'), { token: afterRestore, status: 404 });
  check('rollback after a completed upgrade returns to the checkpoint, is not repeated when killed right after the swap, and keeps later writes in the retained database');

  phase = 'upgrade again after rollback';
  const again = cli(['upgrade', '--from-build', '/proof/forward.json']);
  assert.ok(again.ready); assert.equal(inspect(app()).Image, forward);
  assert.equal(tableExists('vaultix_lifecycle_forward'), true);
  await assertPreserved();
  check('a store restored by rollback takes the same upgrade again');

  phase = 'same migration set';
  const listed = databases();
  const unchanged = cli(['upgrade', '--from-build', '/proof/same-set.json']);
  assert.ok(unchanged.ready); assert.equal(unchanged.operation.migration, undefined);
  assert.equal(inspect(app()).Image, sameSet);
  cli(['upgrade', '--from-build', '/proof/same-set.json']);
  assert.equal(inspect(app()).Image, sameSet);
  check('a same-set upgrade takes the earlier path with no rehearsal');
  const imageOnly = cli(['upgrade', '--from-build', '/proof/forward.json']);
  assert.ok(imageOnly.ready && imageOnly.operation.migration === undefined);
  const backOnce = cli(['rollback']);
  assert.ok(backOnce.ready && backOnce.operation.retainedDatabase === undefined);
  assert.equal(inspect(app()).Image, sameSet);
  assert.deepEqual(databases(), listed, 'A same-set rollback must not touch the database');
  assert.equal(tableExists('vaultix_lifecycle_forward'), true);
  await assertPreserved();
  check('rolling back a same-set upgrade changes only the image, needs no consent and keeps every write');

  phase = 'adopted instance';
  const claim = inspect(`vaultix-owner-${project}`);
  assert.equal(claim.Config.Labels['vaultix.lifecycle.instance'], installed.instance.id);
  output(['rm', claim.Id]);
  const adopted = cli(['adopt', '--env-file', '/state/instance/config/vaultix.env', '--project', project, '--site-url', installed.instance.siteUrl, '--port', String(port)], { directory: '/state/adopted' });
  assert.ok(adopted.ready);
  const adoptedPlan = cli(['upgrade', '--from-build', '/proof/later.json', '--plan'], { directory: '/state/adopted' });
  assert.deepEqual(adoptedPlan.operation.migration.pending, ['29990102000000_lifecycle-later.mjs']);
  assert.equal(adoptedPlan.operation.prior.trust, 'existing-instance');
  const adoptedBack = cli(['rollback'], { directory: '/state/adopted' });
  assert.ok(adoptedBack.ready); assert.equal(adoptedBack.operation.candidate.trust, 'existing-instance');
  check('an adopted instance can plan and cancel a changed migration set');
  report.passed = true;
} catch (error) {
  report.failure = { phase, message: error.code === 'ERR_ASSERTION' ? error.message.split('\n')[0] : 'Operation failed; raw diagnostics withheld' };
  process.exitCode = 1;
} finally {
  let cleanup = true;
  const remove = args => { if (docker(args, { allowFailure: true }).status !== 0) cleanup = false; };
  if (runner) remove(['rm', '-f', '-v', runner]);
  for (const operation of operations) for (const id of output(['ps', '-aq', '--filter', `label=vaultix.lifecycle.operation=${operation}`]).split(/\s+/).filter(Boolean)) remove(['rm', '-f', '-v', id]);
  // Random exact project is created only by this run. Never prune or use an operator project.
  for (const id of output(['ps', '-aq', '--filter', `label=com.docker.compose.project=${project}`]).split(/\s+/).filter(Boolean)) remove(['rm', '-f', '-v', id]);
  const claim = docker(['inspect', `vaultix-owner-${project}`], { allowFailure: true });
  if (claim.status === 0) remove(['rm', JSON.parse(claim.stdout.toString())[0].Id]);
  for (const id of output(['network', 'ls', '-q', '--filter', `label=com.docker.compose.project=${project}`]).split(/\s+/).filter(Boolean)) remove(['network', 'rm', id]);
  for (const id of output(['volume', 'ls', '-q', '--filter', `label=com.docker.compose.project=${project}`]).split(/\s+/).filter(Boolean)) remove(['volume', 'rm', id]);
  if (stateVolume) remove(['volume', 'rm', stateVolume]);
  for (const id of images.reverse()) remove(['rmi', '--force', id]);
  report.cleanupPassed = cleanup;
  if (!cleanup) { report.passed = false; process.exitCode = 1; }
  writeFileSync(resolve(evidence, 'result.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  writeFileSync(resolve(root, '.cache/server-migration-acceptance.json'), JSON.stringify({ ...report, evidence }, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({ passed: report.passed, failure: report.failure, checks: report.checks.length, cleanup, measurements: report.measurements, evidence }));
}
