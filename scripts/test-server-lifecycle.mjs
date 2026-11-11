// Real Linux native CLI -> Docker -> packaged application acceptance.
// Only randomly named, test-owned services are mutated. Credentials stay in memory.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createDisposableImageHarness } from './lib/disposable-image.mjs';
import { literalObjectNames } from './lib/table-namespaces.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(resolve(root, '.ai/package.json'));
const Ajv = require('ajv/dist/2020');
const ajv = new Ajv({ strict: true });
require('ajv-formats')(ajv);
ajv.addSchema(JSON.parse(readFileSync(resolve(root, 'contracts/vaultix.release-checkpoint.v1.json'))));
ajv.addSchema(JSON.parse(readFileSync(resolve(root, 'contracts/vaultix.instance.v2.json'))));
const validResult = ajv.compile(JSON.parse(readFileSync(resolve(root, 'contracts/vaultix.instance-operation.v1.json'))));
const inputs = JSON.parse(readFileSync(resolve(root, '.cache/lifecycle-inputs.json')));
const baseline = JSON.parse(readFileSync(inputs.baselineReceipt));
const candidate = JSON.parse(readFileSync(inputs.candidateReceipt));
assert.ok(baseline.passed && candidate.passed && baseline.imageId !== candidate.imageId, 'Two distinct accepted canonical images are required');
assert.match(inputs.clientImage, /^sha256:[a-f0-9]{64}$/);
let phase = 'initialization';
const h = createDisposableImageHarness(candidate.imageId, () => phase);
const { docker, output } = h;
const run = `vaultix-lifecycle-${randomBytes(8).toString('hex')}`;
const project = run;
mkdirSync(resolve(root, '.cache'), { recursive: true });
const evidence = mkdtempSync(resolve(root, '.cache/lifecycle-acceptance-'));
const report = { passed: false, cliSha256: createHash('sha256').update(readFileSync(inputs.cli)).digest('hex'),
  baseline: baseline.imageId, candidate: candidate.imageId, revision: candidate.revision,
  development: inputs.development === true, checks: [], exclusions: ['failure paths of changed migration sets (scripts/test-server-migration.mjs)', 'fleet orchestration', 'external identity provider acceptance', 'operator production deployment'] };
const check = name => { report.checks.push(name); console.log(`Vaultix lifecycle: ${name}`); };
let runner, stateVolume, operation;
const sensitive = [];
const client = args => output(['exec', runner, ...args]);
const cli = (args, { success = true, directory = '/state/instance' } = {}) => {
  const r = docker(['exec', '-e', 'PATH=/test-bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', runner,
    'vaultix', 'server', ...args, '--directory', directory, '--json'], { allowFailure: true, timeout: 300_000 });
  const text = r.stdout.toString(), diagnostics = r.stderr.toString();
  assert.ok(sensitive.every(value => !text.includes(value) && !diagnostics.includes(value)), 'Native CLI disclosed a sensitive canary');
  if (r.error || (r.status === 0) !== success) writeFileSync(resolve(evidence, 'native-failure.json'), JSON.stringify({ phase, exit: r.status, state: text, diagnostics }), { mode: 0o600 });
  assert.ok(!r.error && (r.status === 0) === success, `Native CLI result mismatch during ${phase}`);
  const result = text.trim() ? JSON.parse(text) : null;
  if (result) assert.ok(validResult(result), 'Native lifecycle response violates its public contract');
  return result;
};
const service = name => output(['ps', '-aq', '--filter', `label=com.docker.compose.project=${project}`, '--filter', `label=com.docker.compose.service=${name}`]);
const inspect = id => JSON.parse(output(['inspect', id]))[0];
const app = () => service('backend');
const api = (path, options) => h.request(app(), path, options);
const privateWrite = (path, data) => docker(['exec', '-i', runner, 'sh', '-c', 'umask 077; cat > "$1"', 'write', path], { input: data });
try {
  stateVolume = output(['volume', 'create', '--label', `vaultix.lifecycle.test=${run}`, `${run}-state`]);
  runner = output(['create', '--name', `${run}-client`, '--label', `vaultix.lifecycle.test=${run}`, '--mount', 'type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock',
    '--add-host', 'vaultix-host:host-gateway', '--mount', `type=volume,source=${stateVolume},target=/state`, '--entrypoint', 'sleep', inputs.clientImage, 'infinity']);
  output(['start', runner]);
  output(['cp', resolve(inputs.cli), `${runner}:/usr/local/bin/vaultix`]);
  client(['chmod', '755', '/usr/local/bin/vaultix']);
  client(['mkdir', '-p', '/proof', '/test-bin']);
  for (const [name, file] of [['baseline', inputs.baselineReceipt], ['candidate', inputs.candidateReceipt]]) output(['cp', resolve(file), `${runner}:/proof/${name}.json`]);
  // Faults exist only in this disposable test driver; product code has no test bypass.
  // The official image temporarily serves Unix sockets during initialization.
  // Make that window deterministic and reject any restore started in it.
  privateWrite('/test-bin/slow-init.sh', '#!/bin/sh\ntouch /tmp/vaultix-init-pending\nsleep 5\ntouch /tmp/vaultix-init-complete\n');
  client(['chmod', '644', '/test-bin/slow-init.sh']);
  privateWrite('/test-bin/docker', '#!/bin/sh\ncase "$1:$2:$3" in\ncreate:--name:vaultix-restore-*)\n id=$(/usr/local/bin/docker "$@") || exit $?\n /usr/local/bin/docker cp /test-bin/slow-init.sh "$id:/docker-entrypoint-initdb.d/vaultix-proof.sh" || exit $?\n echo "$id" >> /state/delayed-probes\n echo "$id"\n exit 0\n ;;\nesac\nif [ "$1:$2:$4" = "exec:-i:pg_restore" ] && grep -Fxq "$3" /state/delayed-probes; then\n if ! /usr/local/bin/docker exec "$3" test -f /tmp/vaultix-init-complete; then touch /state/early-restore; exit 82; fi\nfi\ncase " $* " in\n*" pg_dump "*)\n [ ! -f /state/fail-backup ] || exit 71\n if [ -f /state/hold-backup ]; then touch /state/entered; while [ -f /state/hold-backup ]; do sleep 1; done; fi\n ;;\nesac\nexec /usr/local/bin/docker "$@"\n');
  client(['chmod', '755', '/test-bin/docker']);
  const port = 20000 + randomBytes(2).readUInt16BE() % 30000;
  const proxyPort = port + 1;
  const proxyBinding = `0.0.0.0:${proxyPort}`;
  const proxyReachable = () => {
    // This client is outside the application's network. It must use the host
    // listener, not backend DNS, exec into the application, or its container IP.
    assert.equal(JSON.parse(client(['wget', '-T', '10', '-qO-', `http://vaultix-host:${proxyPort}/api/status`])).message, 'Ok');
    const ports = inspect(app()).NetworkSettings.Ports['8080/tcp'];
    assert.deepEqual(ports.map(p => `${p.HostIp}:${p.HostPort}`).sort(), [`0.0.0.0:${proxyPort}`, `127.0.0.1:${port}`].sort());
  };
  phase = 'native installation';
  const installed = cli(['install', '--from-build', '/proof/baseline.json', '--site-url', `http://127.0.0.1:${port}`, '--project', project, '--port', String(port), '--proxy-bind', proxyBinding], { directory: '/state/original' });
  assert.ok(installed.ready && !installed.recoveryRequired);
  assert.equal(inspect(app()).Image, baseline.imageId);
  const database = inspect(service('db')), cache = inspect(service('cache'));
  check('compiled Linux install creates private configuration and a healthy Vaultix instance with Dragonfly');
  proxyReachable();
  phase = 'proxy deployment adoption';
  const initialApp = inspect(app()).Id;
  const originalOwner = inspect(`vaultix-owner-${project}`);
  assert.equal(originalOwner.Config.Labels['vaultix.lifecycle.instance'], installed.instance.id);
  output(['rm', originalOwner.Id]);
  const enrollment = ['adopt', '--env-file', '/state/original/config/vaultix.env', '--project', project, '--site-url', installed.instance.siteUrl, '--port', String(port)];
  cli(enrollment, { directory: '/state/rejected', success: false });
  assert.equal(inspect(app()).Id, initialApp); proxyReachable();
  const enrolled = cli([...enrollment, '--proxy-bind', proxyBinding]);
  assert.ok(enrolled.ready); assert.equal(inspect(app()).Id, initialApp);
  assert.equal(enrolled.instance.schemaVersion, 'vaultix.instance.v2');
  assert.deepEqual(enrolled.instance.proxyBindings, [{ hostIp: '0.0.0.0', port: proxyPort }]);
  assert.equal(inspect(service('db')).Id, database.Id);
  check('adoption refuses an omitted proxy listener without outage; explicit enrollment preserves the running app and remote HTTP path');
  phase = 'existing identity and encrypted project';
  const password = `Vx9!${[...randomBytes(24)].map(v => v.toString(16).padStart(2, '0')).join('-')}`;
  const email = `${run}@vaultix.invalid`, canary = randomBytes(32).toString('hex'); sensitive.push(password, canary);
  const owner = await api('/api/v1/admin/signup', { method: 'POST', body: { email, password, firstName: 'Lifecycle', organizationName: 'Lifecycle proof', ...(installed.setupCode ? { setupCode: installed.setupCode } : {}) } });
  const { token } = await api('/api/v3/auth/select-organization', { method: 'POST', token: owner.token, body: { organizationId: owner.organization.id } });
  sensitive.push(token, owner.token);
  const { project: workspace } = await api('/api/v1/projects', { method: 'POST', token, body: { projectName: 'Preserved project' } });
  const scope = { projectId: workspace.id, environment: 'dev', secretPath: '/' };
  await api('/api/v4/secrets/LIFECYCLE_CANARY', { method: 'POST', token, body: { ...scope, secretValue: canary } });
  // The baseline may predate the vx_ table names (docs/0119); upgrade and rollback cross them.
  const secretsTable = () => h.sql(database.Id, "SELECT CASE WHEN to_regclass('public.vx_secrets_secrets') IS NOT NULL THEN 'vx_secrets_secrets' ELSE 'secrets_v2' END;");
  const canaryCipher = () => h.sql(database.Id, `SELECT encode("encryptedValue",'hex') FROM ${secretsTable()} WHERE key='LIFECYCLE_CANARY';`);
  const legacyTables = () => Number(h.sql(database.Id, "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace AND n.nspname='public' WHERE c.relkind IN ('r','p') AND c.relname NOT LIKE 'vx\\_%' AND c.relname NOT LIKE 'vaultix\\_migrations%';"));
  // Generated constraint, index and sequence names follow their renamed table unless a historical
  // migration spells them out, and so do updatedAt triggers, including ones named after a table's earlier name.
  const inherited = JSON.parse(readFileSync(resolve(root, 'docs/schema/table-namespaces.json'))).tables.map(table => table.legacy);
  const migrations = resolve(root, 'core/backend/src/db/migrations');
  const spelledOut = literalObjectNames(inherited, readdirSync(migrations).filter(file => file.endsWith('.ts')).map(file => readFileSync(resolve(migrations, file), 'utf8')));
  const textArray = names => `ARRAY[${names.map(name => `'${name}'`).join(',')}]::text[]`;
  const strandedNames = () => h.sql(database.Id, `WITH inherited(name) AS (SELECT unnest(${textArray(inherited)})),
    objects(name) AS (
      SELECT c.conname FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace AND n.nspname='public'
      UNION SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace AND n.nspname='public' WHERE c.relkind IN ('i','I','S'))
    SELECT coalesce(string_agg(o.name, ',' ORDER BY o.name), '') FROM objects o
    WHERE o.name ~ '_(pkey|key|fkey|check|idx|seq|excl)[0-9]*$' AND length(o.name) < 63
      AND o.name <> ALL(${textArray(spelledOut)})
      AND EXISTS (SELECT 1 FROM inherited i WHERE left(o.name, length(i.name) + 1) = i.name || '_');`);
  const strandedTriggers = () => h.sql(database.Id, `SELECT coalesce(string_agg(t.tgname, ',' ORDER BY t.tgname), '') FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace AND n.nspname='public' WHERE NOT t.tgisinternal AND t.tgname LIKE '%\\_updatedAt' AND left(t.tgname, length(t.tgname) - 10) = ANY(${textArray(inherited)});`);
  const cipher = canaryCipher();
  assert.ok(cipher && !cipher.includes(canary));
  phase = 'invalid image receipt';
  const counterfeit = { ...candidate, revision: 'f'.repeat(40), image: 'vaultix:' + 'f'.repeat(40) };
  privateWrite('/proof/wrong-image.json', JSON.stringify(counterfeit));
  const originalApp = inspect(app()).Id;
  cli(['upgrade', '--from-build', '/proof/wrong-image.json'], { success: false });
  assert.equal(inspect(app()).Id, originalApp); assert.equal(inspect(app()).State.Running, true);
  check('a receipt with mismatched image provenance is refused before disruption');
  phase = 'omitted active configuration';
  client(['cp', '/state/instance/config/vaultix.env', '/state/original.env']);
  client(['sh', '-c', 'umask 077; sed "/^COMPOSE_PROFILES=/d" /state/original.env > /state/instance/config/vaultix.env']);
  cli(['upgrade', '--from-build', '/proof/candidate.json', '--plan'], { success: false });
  assert.equal(inspect(app()).Id, originalApp); assert.equal(inspect(app()).State.Running, true);
  client(['cp', '/state/original.env', '/state/instance/config/vaultix.env']);
  check('preflight rejects an omitted active setting before creating an upgrade operation');
  phase = 'reviewable upgrade and configuration drift';
  const planned = cli(['upgrade', '--from-build', '/proof/candidate.json', '--plan']); operation = planned.operation.operation;
  assert.equal(planned.operation.phase, 'planned');
  // The images decide the path. State which one ran rather than leaving it implied.
  const changedSet = planned.operation.candidate.migrations !== installed.operation.candidate.migrations;
  assert.equal(Boolean(planned.operation.migration), changedSet);
  const pending = planned.operation.migration?.pending ?? [];
  report.migrationsApplied = pending;
  const appliedOf = () => Number(h.sql(database.Id, `SELECT count(*) FROM vaultix_migrations WHERE name IN (${pending.map(name => `'${name}'`).join(',') || "''"});`));
  assert.equal(appliedOf(), 0);
  const before = inspect(app());
  client(['cp', '/state/instance/config/vaultix.env', '/state/original.env']);
  client(['sh', '-c', 'printf "\\n# drift\\n" >> /state/instance/config/vaultix.env']);
  cli(['upgrade', '--apply', operation], { success: false });
  assert.equal(inspect(app()).Id, before.Id); assert.equal(inspect(app()).State.Running, true);
  client(['cp', '/state/original.env', '/state/instance/config/vaultix.env']);
  check('saved upgrade rejects configuration drift before stopping the original application');
  phase = 'backup failure'; client(['touch', '/state/fail-backup']);
  cli(['upgrade', '--apply', operation], { success: false });
  const failed = cli(['status']);
  assert.equal(failed.operation.phase, 'snapshot'); assert.equal(failed.recoveryRequired, true);
  assert.equal(inspect(app()).Id, before.Id); assert.equal(inspect(app()).State.Running, false);
  assert.equal(inspect(app()).State.ExitCode, 0);
  check('failed backup prevents replacement after a clean bounded application shutdown');
  client(['rm', '/state/fail-backup']); client(['touch', '/state/hold-backup']);
  const startRecovery = () => {
    const child = spawn('docker', ['exec', '-e', 'PATH=/test-bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', runner,
      'sh', '-c', 'echo $$ > /state/active-pid; exec vaultix server recover --directory /state/instance --json'], { windowsHide: true, stdio: 'ignore' });
    return new Promise(resolve => { child.once('error', () => resolve(-1)); child.once('exit', code => resolve(code)); });
  };
  phase = 'configuration changes during backup';
  const drifted = startRecovery();
  await h.waitFor(() => docker(['exec', runner, 'test', '-f', '/state/entered'], { allowFailure: true }).status === 0, 'backup drift gate');
  client(['sh', '-c', 'printf "\\n# drift during checkpoint\\n" >> /state/instance/config/vaultix.env']);
  client(['rm', '/state/hold-backup']);
  assert.notEqual(await drifted, 0);
  assert.equal(cli(['status']).operation.phase, 'snapshot');
  assert.equal(inspect(app()).Id, before.Id); assert.equal(inspect(app()).State.Running, false);
  client(['cp', '/state/original.env', '/state/instance/config/vaultix.env']);
  client(['rm', '/state/entered']); client(['touch', '/state/hold-backup']);
  check('configuration changed during backup blocks phase advancement and replacement; original configuration restores recovery');
  phase = 'concurrent operation and actual process interruption';
  const exited = startRecovery();
  await h.waitFor(() => docker(['exec', runner, 'test', '-f', '/state/entered'], { allowFailure: true }).status === 0, 'backup interruption gate');
  cli(['recover'], { success: false });
  client(['sh', '-c', 'kill -9 "$(cat /state/active-pid)"']);
  assert.notEqual(await exited, 0);
  client(['rm', '/state/hold-backup']);
  phase = 'forward recovery';
  const recovered = cli(['recover']);
  assert.ok(recovered.ready && !recovered.recoveryRequired);
  assert.equal(recovered.operation.operation, operation);
  assert.equal(inspect(app()).Image, candidate.imageId);
  proxyReachable();
  assert.equal(inspect(service('db')).Id, database.Id); assert.equal(inspect(service('cache')).Id, cache.Id);
  assert.deepEqual(inspect(service('db')).Mounts, database.Mounts);
  assert.equal(appliedOf(), pending.length, 'Every planned migration must be recorded in the store');
  assert.ok(recovered.operation.backup.endsWith('.age') && /^[a-f0-9]{64}$/.test(recovered.operation.backupHash));
  assert.equal(output(['ps', '-aq', '--filter', `label=vaultix.lifecycle.operation=${operation}`]), '');
  client(['test', '-s', '/state/delayed-probes']);
  client(['test', '!', '-e', '/state/early-restore']);
  check('restore waits for completed PostgreSQL initialization instead of accepting the temporary Unix-socket server');
  check('OS lock excludes concurrent processes; killed native operation resumes with an isolated full restore rehearsal and unchanged database/cache');
  phase = 'fresh credentials and existing secret';
  const login = await api('/api/v3/auth/login', { method: 'POST', body: { email, password } });
  const selected = await api('/api/v3/auth/select-organization', { method: 'POST', token: login.accessToken, body: { organizationId: owner.organization.id } });
  sensitive.push(login.accessToken, selected.token);
  const path = '/api/v4/secrets/LIFECYCLE_CANARY?' + new URLSearchParams({ ...scope, viewSecretValue: 'true' });
  const secret = await api(path, { token: selected.token });
  assert.ok(secret.secret.secretValue === canary, 'Existing canary no longer decrypts');
  assert.ok(canaryCipher() === cipher, 'Encrypted row changed');
  if (secretsTable() === 'vx_secrets_secrets') {
    assert.equal(legacyTables(), 0, 'Every table, partitions included, moves to its vx_ name');
    assert.equal(strandedNames(), '', 'Generated names follow their renamed table');
    assert.equal(strandedTriggers(), '', 'updatedAt triggers follow the table names they were built from');
    check('the upgraded store has no table, generated name or updatedAt trigger left on an inherited name');
  }
  await api(path, { status: 401 });
  await api('/api/v1/admin/signup', { method: 'POST', body: { email, password, firstName: 'Duplicate' }, status: 400 });
  await api('/api/v4/secrets/AFTER_UPGRADE', { method: 'POST', token: selected.token, body: { ...scope, secretValue: canary } });
  check('fresh built-in login, original project, exact ciphertext, authorized decryption and new writes survive upgrade; anonymous access and repeat bootstrap are denied');
  phase = 'proxy preserving rollback';
  const rolledBack = cli(['rollback', '--discard-writes']);
  assert.ok(rolledBack.ready); assert.equal(inspect(app()).Image, baseline.imageId);
  proxyReachable();
  assert.equal(inspect(service('db')).Id, database.Id); assert.equal(inspect(service('cache')).Id, cache.Id);
  assert.ok(canaryCipher() === cipher);
  assert.ok(cli(['upgrade', '--from-build', '/proof/candidate.json']).ready);
  proxyReachable();
  check('adopted instance retains both listeners and external HTTP reachability after interrupted recovery, rollback and a subsequent upgrade');
  phase = 'same-image idempotence'; const current = inspect(app()).Id;
  assert.ok(cli(['upgrade', '--from-build', '/proof/candidate.json']).ready);
  assert.equal(inspect(app()).Id, current);
  check('same-image upgrade is a no-outage operation');
  phase = 'existing instance adoption';
  // Release only the synthetic ownership marker to model an existing unmanaged deployment.
  const claim = inspect(`vaultix-owner-${project}`);
  assert.equal(claim.Config.Labels['vaultix.lifecycle.instance'], enrolled.instance.id);
  output(['rm', claim.Id]);
  const adopted = cli(['adopt', '--env-file', '/state/instance/config/vaultix.env', '--project', project, '--site-url', installed.instance.siteUrl, '--port', String(port), '--proxy-bind', proxyBinding], { directory: '/state/adopted' });
  assert.ok(adopted.ready); assert.equal(inspect(app()).Id, current);
  assert.equal(inspect(service('db')).Id, database.Id);
  proxyReachable();
  check('explicit adoption enrolls an existing supported instance without replacing its application or database');
  report.passed = true;
} catch (error) {
  report.failure = { phase, message: error.code === 'ERR_ASSERTION' ? error.message.split('\n')[0] : 'Operation failed; raw diagnostics withheld' };
  process.exitCode = 1;
} finally {
  let cleanup = true;
  const remove = args => { if (docker(args, { allowFailure: true }).status !== 0) cleanup = false; };
  if (runner) report.postgresInitializationGuard = {
    delayedProbeCreated: docker(['exec', runner, 'test', '-s', '/state/delayed-probes'], { allowFailure: true }).status === 0,
    earlyRestoreAttempted: docker(['exec', runner, 'test', '-e', '/state/early-restore'], { allowFailure: true }).status === 0
  };
  if (runner) remove(['rm', '-f', '-v', runner]);
  // Random exact project is created only by this run. Never prune or use an operator project.
  for (const id of output(['ps', '-aq', '--filter', `label=com.docker.compose.project=${project}`]).split(/\s+/).filter(Boolean)) remove(['rm', '-f', '-v', id]);
  const claim = docker(['inspect', `vaultix-owner-${project}`], { allowFailure: true });
  if (claim.status === 0) remove(['rm', JSON.parse(claim.stdout.toString())[0].Id]);
  if (operation) for (const id of output(['ps', '-aq', '--filter', `label=vaultix.lifecycle.operation=${operation}`]).split(/\s+/).filter(Boolean)) remove(['rm', '-f', '-v', id]);
  for (const id of output(['network', 'ls', '-q', '--filter', `label=com.docker.compose.project=${project}`]).split(/\s+/).filter(Boolean)) remove(['network', 'rm', id]);
  for (const id of output(['volume', 'ls', '-q', '--filter', `label=com.docker.compose.project=${project}`]).split(/\s+/).filter(Boolean)) remove(['volume', 'rm', id]);
  if (stateVolume) remove(['volume', 'rm', stateVolume]);
  report.cleanupPassed = cleanup;
  if (!cleanup) { report.passed = false; process.exitCode = 1; }
  writeFileSync(resolve(evidence, 'result.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  writeFileSync(resolve(root, '.cache/lifecycle-acceptance.json'), JSON.stringify({ ...report, evidence }, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({ passed: report.passed, failure: report.failure, checks: report.checks.length, cleanup, evidence }));
}
