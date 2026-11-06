import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrivateKey, createPublicKey, sign, generateKeyPairSync } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, symlinkSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { canonical, sha256, verifyManifest, verifyArtifacts, parseCanonical } from './lib/release-bundle.mjs';

mkdirSync('.cache', { recursive: true });
const directory = mkdtempSync(resolve('.cache/release-boundary-'));
const cli = resolve(directory, process.platform === 'win32' ? 'consumer.exe' : 'consumer');
execFileSync('go', ['build', '-o', cli, './cmd/vaultix'], { stdio: 'pipe', windowsHide: true });
const require = createRequire(resolve('.ai/package.json'));
const Ajv = require('ajv/dist/2020').default, addFormats = require('ajv-formats');
const ajv = new Ajv({ strict: true }); addFormats(ajv);
const schema = ajv.compile(JSON.parse(readFileSync('contracts/vaultix.release-manifest.v1.json')));
const packageSchema = ajv.compile(JSON.parse(readFileSync('contracts/vaultix.release-manifest.v2.json')));
// RFC 8032 section 7.1 TEST 1, public test key only. Never production trust.
const key = createPrivateKey({ key: Buffer.from('302e020100300506032b6570042204209d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60', 'hex'), type: 'pkcs8', format: 'der' });
const publicDER = createPublicKey(key).export({ type: 'spki', format: 'der' });
const keyId = sha256(publicDER);
const trust = canonical({ schemaVersion: 'vaultix.release-trust.v1', keys: [{ keyId, publicKey: publicDER.toString('base64') }] });
const now = Date.now(), date = offset => new Date(now + offset).toISOString().replace(/\.\d{3}Z$/, 'Z');
const bytes = Buffer.from('PUBLIC FIXTURE BYTES; not a real release\n');
function manifest() {
  return { schemaVersion: 'vaultix.release-manifest.v1', version: '0.1.0', channel: 'stable', revision: 'a'.repeat(40),
    sequence: 10, issuedAt: date(-60000), expiresAt: date(86400000), minimumUpdaterVersion: '1.0.0',
    migration: { from: ['schema-a'], to: 'schema-b', rollback: 'restore-required' },
    artifacts: [
      ...['linux', 'windows'].flatMap(os => ['vaultix', 'vaultixl'].map(name => ({ name: `${name}-${os}-amd64${os === 'windows' ? '.exe' : ''}`, kind: 'cli', platform: `${os}/amd64`, bytes: bytes.length, sha256: sha256(bytes), imageId: null }))),
      { name: 'engine.tar', kind: 'engine', platform: 'linux/amd64', bytes: bytes.length, sha256: sha256(bytes), imageId: `sha256:${'b'.repeat(64)}` },
      { name: 'source.tar', kind: 'source', platform: 'any', bytes: bytes.length, sha256: sha256(bytes), imageId: null },
      { name: 'sbom.json', kind: 'sbom', platform: 'any', bytes: bytes.length, sha256: sha256(bytes), imageId: null }
    ] };
}
function packageManifest() {
  return { ...manifest(), schemaVersion: 'vaultix.release-manifest.v2', minimumUpdaterVersion: '1.1.0',
    artifacts: [...manifest().artifacts, { name: 'vaultix-cli-windows-amd64.msix', kind: 'cli-package',
      platform: 'windows/amd64', bytes: bytes.length, sha256: sha256(bytes), imageId: null }] };
}
const signature = raw => canonical({ schemaVersion: 'vaultix.release-signature.v1', keyId, signature: sign(null, raw, key).toString('base64') });
function bundle(m, raw = canonical(m), signed = signature(raw), trusted = trust, previous = null) {
  const dir = mkdtempSync(resolve(directory, 'fixture-'));
  for (const a of manifest().artifacts) writeFileSync(resolve(dir, a.name), bytes);
  writeFileSync(resolve(dir, 'vaultix-cli-windows-amd64.msix'), bytes);
  for (const [name, value] of [['release-manifest.json', raw], ['release-signature.json', signed], ['trust.json', trusted]]) writeFileSync(resolve(dir, name), value);
  const args = ['update', 'verify', '--bundle', dir, '--trust', resolve(dir, 'trust.json')];
  if (previous) { writeFileSync(resolve(dir, 'checkpoint.json'), canonical(previous)); args.push('--checkpoint', resolve(dir, 'checkpoint.json')); }
  return { dir, args, raw, signed, trusted };
}
function go(f, success) {
  const result = spawnSync(cli, f.args, { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, success ? 0 : 1, result.stderr);
  if (success) { const out = JSON.parse(result.stdout); assert.equal(out.verified, true); assert.equal(out.installed, false); return out; }
  assert.equal(result.stdout, '');
}
test('independent RFC 8032 signing vector', () => {
  assert.equal(sign(null, Buffer.alloc(0), key).toString('hex'), 'e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b');
});
test('schema and two independent consumers accept the same signed bytes and checkpoint', async () => {
  const m = manifest(); assert.equal(schema(m), true, JSON.stringify(schema.errors)); const f = bundle(m);
  const checked = verifyManifest(f.raw, f.signed, trust, { now });
  assert.equal((await verifyArtifacts(m, f.dir)).length, 7);
  assert.deepEqual(go(f, true).checkpoint, checked.checkpoint);
  for (const [name, value] of [['signature', parseCanonical(f.signed)], ['trust', parseCanonical(trust)], ['checkpoint', checked.checkpoint]]) {
    const validate = ajv.compile(JSON.parse(readFileSync(`contracts/vaultix.release-${name}.v1.json`)));
    assert.equal(validate(value), true, JSON.stringify(validate.errors));
    assert.equal(validate({ ...value, unknown: true }), false);
  }
  verifyManifest(f.raw, f.signed, trust, { now, previous: checked.checkpoint });
  go(bundle(m, f.raw, f.signed, trust, checked.checkpoint), true);
});
for (const [name, change] of [
  ['unknown version', m => m.schemaVersion = 'unknown'], ['missing field', m => delete m.sequence],
  ['unknown field', m => m.execute = 'arbitrary command'], ['fractional sequence', m => m.sequence = 1.5],
  ['unsafe sequence', m => m.sequence = Number.MAX_SAFE_INTEGER + 1],
  ['expired', m => { m.issuedAt = date(-86400000); m.expiresAt = date(-10000); }],
  ['future', m => m.issuedAt = date(3600000)], ['invalid timestamp', m => m.issuedAt = '2026-02-31T12:00:00Z'],
  ['unsupported updater', m => m.minimumUpdaterVersion = '2.0.0'], ['channel mismatch', m => m.channel = 'preview'],
  ['invalid SemVer', m => m.version = '1.0.0-01'], ['missing platform', m => m.artifacts.splice(0, 2)],
  ['CLI name mismatch', m => m.artifacts[0].sha256 = 'f'.repeat(64)],
  ['duplicate artifact', m => m.artifacts.push(m.artifacts[0])], ['traversal', m => m.artifacts[4].name = '../engine'],
  ['Windows reserved name', m => m.artifacts[4].name = 'CON.tar'], ['trailing dot', m => m.artifacts[4].name = 'engine.'],
  ['unsupported platform', m => m.artifacts[4].platform = 'linux/arm64'], ['unknown artifact field', m => m.artifacts[4].url = 'https://example.invalid'],
  ['missing image identity field', m => delete m.artifacts[0].imageId], ['missing source', m => m.artifacts.splice(5, 1)],
  ['negative length', m => m.artifacts[4].bytes = -1], ['oversized artifact', m => m.artifacts[4].bytes = 2 ** 40]
]) test(`Node and native CLI reject ${name}`, () => {
  const m = manifest(); change(m); const f = bundle(m);
  assert.throws(() => verifyManifest(f.raw, f.signed, trust, { now })); go(f, false);
});
for (const [name, transform] of [
  ['one-byte signature mutation', (f) => { const s = parseCanonical(f.signed); const b = Buffer.from(s.signature, 'base64'); b[0] ^= 1; s.signature = b.toString('base64'); f.signed = canonical(s); }],
  ['unsigned field mutation', f => { const m = parseCanonical(f.raw); m.sequence++; f.raw = canonical(m); }],
  ['duplicate JSON key', f => f.raw = Buffer.from(f.raw.toString().replace('"sequence": 10', '"sequence": 10, "sequence": 10'))],
  ['oversized metadata', f => f.raw = Buffer.alloc(65537, 32)],
  ['untrusted replacement key', f => { const p = generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }); f.trusted = canonical({ schemaVersion: 'vaultix.release-trust.v1', keys: [{ keyId: sha256(p), publicKey: p.toString('base64') }] }); }],
  ['duplicate trust key', f => { const t = parseCanonical(trust); t.keys.push(t.keys[0]); f.trusted = canonical(t); }]
]) test(`Node and native CLI reject ${name}`, () => {
  const m = manifest(), f = bundle(m); transform(f);
  assert.throws(() => verifyManifest(f.raw, f.signed, f.trusted, { now }));
  go(bundle(m, f.raw, f.signed, f.trusted), false);
});
for (const previous of [{ schemaVersion: 'vaultix.release-checkpoint.v1', sequence: 11, sha256: 'f'.repeat(64) }, { schemaVersion: 'vaultix.release-checkpoint.v1', sequence: 10, sha256: 'f'.repeat(64) }]) {
  test(`reject replay/checkpoint conflict at sequence ${previous.sequence}`, () => {
    const f = bundle(manifest()); assert.throws(() => verifyManifest(f.raw, f.signed, trust, { now, previous }));
    go(bundle(manifest(), f.raw, f.signed, trust, previous), false);
  });
}
test('changed artifact rejected without installation or checkpoint mutation', async () => {
  const m = manifest(), f = bundle(m); writeFileSync(resolve(f.dir, 'engine.tar'), Buffer.alloc(bytes.length, 1));
  await assert.rejects(verifyArtifacts(m, f.dir)); go(f, false);
  assert.ok(readFileSync(resolve(f.dir, 'vaultix-linux-amd64')).equals(bytes));
});
test('artifact links rejected, including a junction on Windows', async () => {
  const m = manifest(), f = bundle(m); const path = resolve(f.dir, 'engine.tar'); unlinkSync(path);
  if (process.platform === 'win32') symlinkSync(directory, path, 'junction'); else symlinkSync(resolve(f.dir, 'source.tar'), path);
  await assert.rejects(verifyArtifacts(m, f.dir)); go(f, false);
});
test('preview and SemVer build metadata remain compatible in both consumers', () => {
  for (const [version, channel] of [['0.1.0-rc.1', 'preview'], ['0.1.0+build-one', 'stable']]) {
    const m = manifest(); Object.assign(m, { version, channel }); const f = bundle(m);
    assert.equal(schema(m), true); verifyManifest(f.raw, f.signed, trust, { now }); go(f, true);
  }
});

test('v2 binds Windows package bytes while v1 remains a separate immutable contract', async () => {
  const m = packageManifest(), f = bundle(m);
  assert.equal(schema(m), false, 'Older schema must reject new package-bearing manifests');
  assert.equal(packageSchema(m), true, JSON.stringify(packageSchema.errors));
  const verified = verifyManifest(f.raw, f.signed, trust, { now });
  assert.deepEqual(go(f, true).checkpoint, verified.checkpoint);
  assert.equal((await verifyArtifacts(m, f.dir)).length, 8);
  writeFileSync(resolve(f.dir, 'vaultix-cli-windows-amd64.msix'), Buffer.alloc(bytes.length, 7));
  await assert.rejects(verifyArtifacts(m, f.dir));
  go(f, false);
});

for (const [name, change] of [
  ['missing Windows package', m => m.artifacts.pop()],
  ['v2 paired with old updater', m => m.minimumUpdaterVersion = '1.0.0'],
  ['v1 hiding Windows package', m => { m.schemaVersion = 'vaultix.release-manifest.v1'; m.minimumUpdaterVersion = '1.0.0'; }],
  ['wrong package platform', m => m.artifacts[7].platform = 'linux/amd64'],
  ['foreign package name', m => m.artifacts[7].name = 'other.msix'],
  ['oversized package', m => m.artifacts[7].bytes = 536870913],
  ['duplicate package', m => m.artifacts.push({ ...m.artifacts[7], name: 'second.msix' })],
  ['package with image ID', m => m.artifacts[7].imageId = `sha256:${'b'.repeat(64)}`]
]) test(`v2 independent consumers reject ${name}`, () => {
  const m = packageManifest(); change(m); const f = bundle(m);
  assert.throws(() => verifyManifest(f.raw, f.signed, trust, { now }));
  go(f, false);
});

test('v2 preserves preview/stable sequence and semantic version meanings', () => {
  for (const [version, channel] of [['1.2.3-rc.4', 'preview'], ['1.2.3+build.9', 'stable']]) {
    const m = packageManifest(); Object.assign(m, { version, channel }); const f = bundle(m);
    assert.equal(packageSchema(m), true);
    verifyManifest(f.raw, f.signed, trust, { now }); go(f, true);
  }
});
