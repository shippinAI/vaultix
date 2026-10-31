// Actual Go producer -> actual TypeScript ingest consumer. Storage/fanout
// dependencies are mocked; this is a protocol check, not live provider acceptance.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {cpSync, readFileSync, writeFileSync, mkdtempSync, mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {collectGoTestEvidence} from './go-test-evidence.mjs';

const args = process.argv.slice(2);
const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const goImage = option('--go-image'), backendImage = option('--backend-image'), cacheImage = option('--cache-image');
for (const image of [goImage, backendImage, cacheImage]) assert.match(image ?? '', /^sha256:[a-f0-9]{64}$/, 'Pinned local runner/cache image required');
mkdirSync('.cache', {recursive: true});
const directory = mkdtempSync(resolve('.cache/native-audit-boundary-'));
const run = args => spawnSync('docker', args, {encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024});
const required = args => { const r = run(args); assert.equal(r.status, 0, 'Audit boundary runner preparation failed'); return r; };
const source = resolve(directory, 'go');
cpSync('core/backend-go', source, {recursive: true});
const cacheName = 'vaultix-audit-cache-' + directory.slice(-6).toLowerCase();
let go;
try {
  required(['network', 'create', cacheName]);
  required(['run', '-d', '--name', cacheName, '--network', cacheName, '--pull=never', cacheImage]);
  go = run(['run', '--rm', '--init', '--pull=never', '--network', cacheName, '--mount', `type=bind,source=${source.replaceAll('\\', '/')},target=/app,readonly`, '--workdir', '/app', '-e', 'GOTOOLCHAIN=local', '-e', 'GOTELEMETRY=off', '-e', `VAULTIX_AUDIT_TEST_CACHE=${cacheName}:6379`, goImage, 'go', 'test', '-mod=readonly', '-race', '-tags', 'integration', '-count=1', '-json', './internal/services/auditlog']);
} finally {
  run(['rm', '-f', cacheName]);
  run(['network', 'rm', cacheName]);
}
const evidence = collectGoTestEvidence(go.stdout ?? '');
const report = {passed: false, goImage, backendImage, cacheImage, producer: evidence, cases: [], sources: [], compileDiagnostics: (go.stderr ?? '').split('\n').filter(s => /\.go:\d+:\d+:/.test(s))};
const paths = ['core/backend-go/internal/services/auditlog/queue_handler.go', 'core/backend-go/internal/services/auditlog/queue_handler_test.go', 'core/backend-go/internal/services/auditlog/auditlog.go', 'core/backend-go/internal/services/auditlog/event.go', 'core/backend/src/ee/services/audit-log/audit-log-queue.ts', 'core/backend/src/ee/services/audit-log/audit-log-queue.test.ts', 'core/backend/src/ee/services/audit-log/fixtures/native-ingest-v1.json', 'scripts/verify-native-audit-boundary.mjs'];
paths.push('core/backend-go/internal/services/auditlog/producer_integration_test.go');
report.sources = paths.map(path => ({path, sha256: createHash('sha256').update(readFileSync(path)).digest('hex')}));
const save = () => writeFileSync(resolve(directory, 'result.json'), JSON.stringify(report, null, 2));
save();
console.log(JSON.stringify({directory, producerPassed: go.status === 0, compileDiagnostics: report.compileDiagnostics}));
assert.equal(go.status, 0, 'Native audit tests failed; inspect bounded producer outcomes');
let envelope;
for (const line of go.stdout.split('\n')) {
  try { const event = JSON.parse(line); if (event.Output?.startsWith('VAULTIX_AUDIT_FIXTURE:')) envelope = JSON.parse(event.Output.slice('VAULTIX_AUDIT_FIXTURE:'.length)); } catch {}
}
assert.ok(envelope, 'Actual producer fixture missing');
assert.deepEqual(envelope, JSON.parse(readFileSync('core/backend/src/ee/services/audit-log/fixtures/native-ingest-v1.json')), 'Producer changed independently declared contract fixture');
const backend = resolve(directory, 'backend');
mkdirSync(backend);
cpSync('core/backend/src', resolve(backend, 'src'), {recursive: true});
// Feed actual bytes, not only the separately declared fixture, to the consumer.
writeFileSync(resolve(backend, 'src/ee/services/audit-log/fixtures/native-ingest-v1.json'), JSON.stringify(envelope));
const name = 'vaultix-audit-boundary-' + directory.slice(-6).toLowerCase();
try {
  required(['create', '--init', '--name', name, '--entrypoint', 'node', backendImage, '--max-old-space-size=4096', 'node_modules/vitest/vitest.mjs', 'run', '-c', 'vitest.unit.config.mts', 'src/ee/services/audit-log/audit-log-queue.test.ts', '--reporter=json', '--outputFile=/app/audit-boundary.json']);
  required(['cp', resolve(backend, 'src'), name + ':/app/']);
  required(['cp', resolve('core/backend/vitest.unit.config.mts'), name + ':/app/']);
  const consumer = run(['start', '--attach', name]);
  required(['cp', name + ':/app/audit-boundary.json', resolve(directory, 'consumer.json')]);
  const result = JSON.parse(readFileSync(resolve(directory, 'consumer.json')));
  report.cases = result.testResults.flatMap(r => r.assertionResults).map(r => ({name: r.fullName, status: r.status}));
  report.passed = consumer.status === 0 && report.cases.length >= 30 && report.cases.every(r => r.status === 'passed');
  report.scope = 'Actual native producer and TS consumer; storage/fanout dependencies mocked. No live ClickHouse or remote sink claim.';
  save();
  console.log(JSON.stringify({passed: report.passed, directory, producerOutcomes: evidence.events.filter(e => e.test && e.action === 'pass').length, consumerOutcomes: report.cases.length, failures: report.cases.filter(c => c.status !== 'passed')}));
  assert.equal(report.passed, true, 'Audit boundary acceptance failed');
} finally { run(['rm', '-f', name]); }
