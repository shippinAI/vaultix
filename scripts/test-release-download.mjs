// Production CLI through real TLS and redirects. All release data/key material
// belongs to a local fixture; this is not public publisher acceptance.
import assert from 'node:assert/strict';
import { createPrivateKey, createPublicKey, sign, randomBytes } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import https from 'node:https';
import http from 'node:http';
import net from 'node:net';
import { canonical, sha256, verifyManifest, verifyArtifacts } from './lib/release-bundle.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(resolve(root, '.ai/package.json'));
const Ajv = require('ajv/dist/2020').default, addFormats = require('ajv-formats');
const ajv = new Ajv({ strict: true }); addFormats(ajv);
for (const name of ['manifest', 'checkpoint']) ajv.addSchema(JSON.parse(readFileSync(resolve(root, `contracts/vaultix.release-${name}.v1.json`))));
const validateResult = ajv.compile(JSON.parse(readFileSync(resolve(root, 'contracts/vaultix.release-download.v1.json'))));
const inputs = JSON.parse(readFileSync(resolve(root, '.cache/download-inputs.json')));
assert.match(inputs.clientImage, /^sha256:[a-f0-9]{64}$/);
const sync = (exe, args, options = {}) => execFileSync(exe, args, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], ...options });
const revision = sync('git', ['rev-parse', 'HEAD']).toString().trim();
mkdirSync(resolve(root, '.cache'), { recursive: true });
const evidence = mkdtempSync(resolve(root, '.cache/release-download-'));
let cli;
if (inputs.development === true) {
  cli = resolve(evidence, 'vaultix');
  sync('go', ['build', '-buildvcs=false', '-trimpath', '-ldflags', '-X main.version=dev-worktree -X main.revision=worktree', '-o', cli, './cmd/vaultix'],
    { env: { ...process.env, GOOS: 'linux', GOARCH: 'amd64', CGO_ENABLED: '0' } });
} else {
  assert.equal(sync('git', ['status', '--porcelain']).toString().trim(), '');
  const built = JSON.parse(readFileSync(resolve(root, '.cache/committed-cli.json')));
  assert.ok(built.passed && built.revision === revision);
  const artifact = built.artifacts.find(a => a.platform === 'linux/amd64');
  cli = artifact.files[0]; assert.equal(sha256(readFileSync(cli)), artifact.sha256);
}
const report = { passed: false, revision, development: inputs.development === true, cliSha256: sha256(readFileSync(cli)), checks: [],
  scope: 'Actual Linux CLI process with controlled TLS/public-release fixtures; Windows filesystem behavior is covered separately by native tests. No live GitHub release, production key custody, installation or deployment claim.' };
const fixture = resolve(evidence, 'fixture'); mkdirSync(fixture);
const cert = resolve(fixture, 'cert.pem'), tlsKey = resolve(fixture, 'tls-key.pem');
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
sync(bash, ['-c', 'exec openssl "$@"', 'openssl', 'req', '-x509', '-nodes', '-newkey', 'rsa:2048', '-days', '1',
  '-keyout', tlsKey, '-out', cert, '-subj', '/CN=Vaultix acquisition test fixture',
  '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'subjectAltName=DNS:api.github.com,DNS:github.com,DNS:release-assets.githubusercontent.com,DNS:objects.githubusercontent.com'],
  { env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
// RFC 8032 public test vector. Never a production signing key.
const key = createPrivateKey({ key: Buffer.from('302e020100300506032b6570042204209d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60', 'hex'), format: 'der', type: 'pkcs8' });
const der = createPublicKey(key).export({ format: 'der', type: 'spki' });
const trust = canonical({ schemaVersion: 'vaultix.release-trust.v1', keys: [{ keyId: sha256(der), publicKey: der.toString('base64') }] });
writeFileSync(resolve(fixture, 'trust.json'), trust, { mode: 0o600 });
const credentialCanary = Buffer.from('existing-headless-credential-canary');
writeFileSync(resolve(fixture, 'credentials.json'), credentialCanary, { mode: 0o600 });
writeFileSync(resolve(fixture, 'config.json'), JSON.stringify({ api: 'https://unrelated.invalid', credential_file: '/output/auth/credentials.json' }), { mode: 0o600 });
writeFileSync(resolve(fixture, 'replay.json'), canonical({ schemaVersion: 'vaultix.release-checkpoint.v1', sequence: 99, sha256: 'c'.repeat(64) }), { mode: 0o600 });
writeFileSync(resolve(fixture, 'untrusted.json'), canonical({ schemaVersion: 'vaultix.release-trust.v1', keys: [] }), { mode: 0o600 });
const content = Buffer.from('acquisition fixture bytes\0');
const names = ['vaultix-linux-amd64', 'vaultixl-linux-amd64', 'vaultix-windows-amd64.exe', 'vaultixl-windows-amd64.exe', 'engine.tar', 'source.tar', 'sbom.json'];
const manifest = { schemaVersion: 'vaultix.release-manifest.v1', version: '1.2.3', channel: 'stable', revision: 'a'.repeat(40), sequence: 21,
  issuedAt: new Date(Date.now() - 60000).toISOString().replace(/\.\d{3}Z$/, 'Z'), expiresAt: new Date(Date.now() + 3600000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
  minimumUpdaterVersion: '1.0.0', migration: { from: ['schema-a'], to: 'schema-a', rollback: 'compatible' },
  artifacts: names.map((name, i) => ({ name, kind: i < 4 ? 'cli' : i === 4 ? 'engine' : i === 5 ? 'source' : 'sbom', platform: i < 2 || i === 4 ? 'linux/amd64' : i < 4 ? 'windows/amd64' : 'any', bytes: content.length, sha256: sha256(content), imageId: i === 4 ? 'sha256:' + 'b'.repeat(64) : null })) };
const raw = canonical(manifest);
const signature = canonical({ schemaVersion: 'vaultix.release-signature.v1', keyId: sha256(der), signature: sign(null, raw, key).toString('base64') });
const bodies = new Map([['release-manifest.json', raw], ['release-signature.json', signature], ...names.map(name => [name, content])]);
const listing = { tag_name: 'v1.2.3', draft: false, prerelease: false, published_at: manifest.issuedAt,
  assets: [...bodies].map(([name, data], i) => ({ id: i + 1, name, size: data.length, state: 'uploaded', browser_download_url: `https://github.com/shippinAI/vaultix/releases/download/v1.2.3/${name}` })) };
let mode = 'good', held, notifyHeld;
const requests = [], tunnels = [], sockets = new Set();
const hosts = new Set(['api.github.com', 'github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com']);
const server = https.createServer({ key: readFileSync(tlsKey), cert: readFileSync(cert) }, (req, res) => {
  const u = new URL(req.url, 'https://' + req.headers.host);
  requests.push({ host: u.hostname, path: u.pathname, authorization: Boolean(req.headers.authorization), cookie: Boolean(req.headers.cookie) });
  if (!hosts.has(u.hostname) || req.method !== 'GET' || req.headers.authorization || req.headers.cookie) { res.writeHead(403); res.end(); return; }
  if (u.hostname === 'api.github.com') {
    if (mode === 'apiredirect') { res.writeHead(302, { Location: listing.assets[0].browser_download_url }); res.end(); return; }
    if (u.pathname !== '/repos/shippinAI/vaultix/releases/tags/v1.2.3') { res.writeHead(404); res.end(); return; }
    const item = structuredClone(listing);
    if (mode === 'missing') item.assets = item.assets.filter(a => a.name !== 'source.tar');
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(item)); return;
  }
  if (u.hostname === 'github.com') {
    res.writeHead(302, { Location: mode === 'foreign' ? 'https://attacker.invalid/asset' : mode === 'loop' ? u.href : `https://release-assets.githubusercontent.com/${u.pathname.split('/').at(-1)}?fixture=opaque` });
    res.end(); return;
  }
  const name = u.pathname.split('/').at(-1), bytes = bodies.get(name);
  if (!bytes) { res.writeHead(404); res.end(); return; }
  if (name === 'engine.tar') {
    if (mode === 'tamper') { res.end(Buffer.alloc(bytes.length, 1)); return; }
    if (mode === 'oversize') { res.write(bytes); res.end(Buffer.from([1])); return; }
    if (mode === 'interrupt') { res.writeHead(200, { 'Content-Length': bytes.length }); res.write(bytes.subarray(0, 2)); res.socket.destroy(); return; }
    if (mode === 'hold') { held = res; notifyHeld?.(); return; }
  }
  res.end(bytes);
});
const proxy = http.createServer((req, res) => { res.writeHead(403); res.end(); });
proxy.on('connect', (req, client, head) => {
  tunnels.push(req.url);
  if (!hosts.has(req.url.replace(/:443$/, '')) || !req.url.endsWith(':443')) { client.destroy(); return; }
  const upstream = net.connect(server.address().port, '127.0.0.1');
  sockets.add(client); sockets.add(upstream);
  const close = () => { client.destroy(); upstream.destroy(); sockets.delete(client); sockets.delete(upstream); };
  client.on('error', close); upstream.on('error', close); client.on('close', close); upstream.on('close', close);
  upstream.once('connect', () => { client.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head.length) upstream.write(head); client.pipe(upstream); upstream.pipe(client); });
});
const listen = (s, host) => new Promise((done, reject) => { s.once('error', reject); s.listen(0, host, done); });
const run = (args, success = true) => new Promise((done, reject) => {
  const p = spawn('docker', args, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); let out = '', err = '';
  const timer = setTimeout(() => { p.kill(); reject(new Error('Disposable download process timed out')); }, 90000);
  p.stdout.on('data', b => out += b); p.stderr.on('data', b => err += b); p.on('error', e => { clearTimeout(timer); reject(e); });
  p.on('close', code => { clearTimeout(timer); if ((code === 0) !== success) { writeFileSync(resolve(evidence, 'process-failure.json'), JSON.stringify({ mode, code, out, err }), { mode: 0o600 }); reject(new Error('Unexpected native download exit')); } else done({ code, out, err }); });
});
const id = 'vaultix-download-' + randomBytes(8).toString('hex'); let container = false, volume = false;
const check = description => { report.checks.push(description); console.log('Vaultix download: ' + description); };
try {
  await listen(server, '127.0.0.1'); await listen(proxy, '0.0.0.0');
  await run(['volume', 'create', id]); volume = true;
  await run(['run', '-d', '--pull=never', '--name', id, '--add-host', 'host.docker.internal:host-gateway',
    '--mount', `type=bind,source=${cli},target=/bin/vaultix,readonly`, '--mount', `type=bind,source=${cert},target=/proof/cert.pem,readonly`,
    '--mount', `type=bind,source=${resolve(fixture, 'trust.json')},target=/proof/trust.json,readonly`, '--mount', `type=volume,source=${id},target=/output`,
    '--mount', `type=bind,source=${resolve(fixture, 'replay.json')},target=/proof/replay.json,readonly`,
    '--mount', `type=bind,source=${resolve(fixture, 'untrusted.json')},target=/proof/untrusted.json,readonly`,
    '-e', `HTTPS_PROXY=http://host.docker.internal:${proxy.address().port}`, '-e', 'NO_PROXY=', '-e', 'SSL_CERT_FILE=/proof/cert.pem',
    '-e', 'SSL_CERT_DIR=/proof/no-roots', '-e', 'HOME=/output/home', '-e', 'VAULTIX_HOME=/output/auth', '-e', 'VAULTIX_TOKEN=acquisition-secret-canary',
    '--entrypoint', 'sleep', inputs.clientImage, 'infinity']); container = true;
  await run(['exec', id, 'mkdir', '-p', '/output/auth']);
  for (const file of ['credentials.json', 'config.json']) await run(['cp', resolve(fixture, file), `${id}:/output/auth/${file}`]);
  const invoke = (directory, success = true, extra = []) => run(['exec', id, 'sh', '-c', 'echo $$ > /output/active.pid; exec /bin/vaultix "$@"', 'fixture',
    'update', 'download', '--version', '1.2.3', '--directory', `/output/${directory}`, '--trust', '/proof/trust.json', '--json', ...extra], success);
  const result = JSON.parse((await invoke('accepted')).out);
  assert.ok(result.verified && result.installed === false && result.artifacts === 7 && !result.priorCheckpointSupplied);
  assert.equal(validateResult(result), true, JSON.stringify(validateResult.errors));
  assert.equal(validateResult({ ...result, installed: true }), false);
  await run(['cp', `${id}:/output/accepted`, resolve(evidence, 'accepted')]);
  const downloaded = resolve(evidence, 'accepted');
  assert.equal(sha256(readFileSync(resolve(downloaded, 'release-manifest.json'))), sha256(raw));
  assert.deepEqual(verifyManifest(raw, signature, trust).checkpoint, result.checkpoint);
  assert.equal((await verifyArtifacts(manifest, downloaded)).length, 7);
  const nativeVerified = JSON.parse((await run(['exec', id, '/bin/vaultix', 'update', 'verify', '--bundle', '/output/accepted', '--trust', '/proof/trust.json'])).out);
  assert.ok(nativeVerified.verified && nativeVerified.installed === false);
  assert.deepEqual(nativeVerified.checkpoint, result.checkpoint);
  check('native CLI follows allowed TLS asset redirects and independent Node verification accepts every downloaded byte');
  const count = requests.length;
  await invoke('accepted', false); assert.equal(requests.length, count);
  check('existing destination is refused before network activity and its accepted files remain intact');
  for (const [name, extra] of [['untrusted', ['--trust', '/proof/untrusted.json']], ['replay', ['--checkpoint', '/proof/replay.json']]]) {
    const response = await invoke(name, false, extra); assert.equal(response.out, '');
    await run(['exec', id, 'test', '!', '-e', `/output/${name}`]);
  }
  check('actual command rejects untrusted signing metadata and a release older than the supplied accepted checkpoint');
  await run(['exec', '-e', 'SSL_CERT_FILE=/proof/trust.json', id, '/bin/vaultix', 'update', 'download', '--version', '1.2.3', '--directory', '/output/bad-tls', '--trust', '/proof/trust.json', '--json'], false);
  await run(['exec', id, 'test', '!', '-e', '/output/bad-tls']);
  check('production TLS verification rejects an endpoint without a trusted certificate');
  for (mode of ['missing', 'foreign', 'apiredirect', 'loop', 'tamper', 'oversize', 'interrupt']) {
    const response = await invoke(mode, false); assert.equal(response.out, ''); assert.ok(!response.err.includes('acquisition-secret-canary'));
    await run(['exec', id, 'test', '!', '-e', `/output/${mode}`]);
    check(`${mode} response fails without publishing a bundle or exposing credentials`);
  }
  mode = 'hold';
  let timer;
  const reached = new Promise((done, reject) => { notifyHeld = done; timer = setTimeout(() => reject(new Error('Cancellation transfer was not reached')), 20000); });
  const pending = invoke('cancelled', false);
  try { await reached; } finally { clearTimeout(timer); }
  await run(['exec', id, 'sh', '-c', 'kill -INT "$(cat /output/active.pid)"']);
  await pending; held?.destroy(); held = null;
  await run(['exec', id, 'test', '!', '-e', '/output/cancelled']);
  mode = 'good'; await invoke('after-cancel');
  check('SIGINT cancels a live TLS transfer without publication; a fresh attempt succeeds');
  await run(['exec', id, 'ln', '-s', '/output', '/output/link']);
  await invoke('link/escaped', false); await run(['exec', id, 'test', '!', '-e', '/output/escaped']);
  check('symlink parent cannot redirect bundle publication');
  assert.ok(requests.every(r => !r.authorization && !r.cookie));
  assert.ok(tunnels.every(t => hosts.has(t.replace(/:443$/, ''))));
  const left = (await run(['exec', id, 'find', '/output', '-maxdepth', '1', '-name', '.vaultix-download-*'])).out.trim(); assert.equal(left, '');
  await run(['cp', `${id}:/output/accepted`, resolve(evidence, 'retained')]);
  assert.equal((await verifyArtifacts(manifest, resolve(evidence, 'retained'))).length, 7);
  for (const file of ['credentials.json', 'config.json']) {
    const copied = resolve(evidence, `retained-${file}`); await run(['cp', `${id}:/output/auth/${file}`, copied]);
    assert.equal(sha256(readFileSync(copied)), sha256(readFileSync(resolve(fixture, file))));
  }
  check('all requests omit authority, forbidden redirect never connects, failures clean staging and retain the prior accepted bundle');
  check('existing headless credential and instance configuration files remain byte-identical');
  if (!report.development) {
    assert.equal(sync('git', ['rev-parse', 'HEAD']).toString().trim(), revision);
    assert.equal(sync('git', ['status', '--porcelain']).toString().trim(), '');
  }
  assert.equal(sha256(readFileSync(cli)), report.cliSha256); report.passed = true;
} catch (error) {
  report.failure = { phase: mode, message: error.message.slice(0, 240) }; process.exitCode = 1;
} finally {
  held?.destroy(); for (const socket of sockets) socket.destroy(); proxy.close(); server.close();
  let cleanup = true;
  for (const args of [...(container ? [['rm', '-f', '-v', id]] : []), ...(volume ? [['volume', 'rm', id]] : [])]) {
    try { await run(args); } catch { cleanup = false; }
  }
  report.cleanupPassed = cleanup; if (!cleanup) { report.passed = false; process.exitCode = 1; }
  writeFileSync(resolve(evidence, 'requests.json'), JSON.stringify(requests, null, 2) + '\n', { mode: 0o600 });
  writeFileSync(resolve(evidence, 'result.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  writeFileSync(resolve(root, '.cache/download-acceptance.json'), JSON.stringify({ ...report, evidence }, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({ passed: report.passed, failure: report.failure, checks: report.checks.length, cleanup, evidence }));
}
