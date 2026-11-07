import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { canonical, sha256 } from './lib/release-bundle.mjs';
import { canonicalStages, cliChecks, context } from './lib/pr-verification.mjs';
import { loadPublication } from './lib/release-publication.mjs';
import { prepareRelease, signRelease } from './lib/release-preparation.mjs';
import { exportArchive, runSigner } from './lib/release-producer-process.mjs';

mkdirSync('.cache', { recursive: true });
const root = mkdtempSync(resolve('.cache/producer-fixtures-'));
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const der = publicKey.export({ type: 'spki', format: 'der' }), keyId = sha256(der);
// Ephemeral test key never becomes product trust or release material.
const keyPath = resolve(root, 'ephemeral-test-only.pem');
writeFileSync(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
const signerPath = resolve(root, 'signer.mjs');
writeFileSync(signerPath, `import {readFileSync} from 'node:fs'; import {sign} from 'node:crypto';
const chunks=[]; for await(const chunk of process.stdin) chunks.push(chunk);
process.stdout.write(sign(null,Buffer.concat(chunks),readFileSync(process.argv[2])));`);
const signer = { executable: process.execPath, args: [signerPath, keyPath] };

function fixture(version = '0.1.0') {
  const directory = mkdtempSync(resolve(root, 'case-'));
  const output = resolve(directory, 'prepared');
  const save = (name, value) => { const path = resolve(directory, name); writeFileSync(path, canonical(value)); return path; };
  const revision = 'a'.repeat(40), imageId = `sha256:${'b'.repeat(64)}`;
  const cli = ['linux/amd64', 'windows/amd64'].map(platform => {
    const bytes = Buffer.from(`Executable fixture for ${platform}; never deployed.`);
    const files = ['vaultix', 'vaultixl'].map(command => {
      const path = resolve(directory, `${command}-${platform.replace('/', '-')}`); writeFileSync(path, bytes); return path;
    });
    return { platform, sha256: sha256(bytes), files };
  });
  const build = { passed: true, revision, imageId, image: `vaultix:${revision}`, platformVersion: version,
    steps: canonicalStages.map(name => ({ name, passed: true, exitCode: 0 })) };
  const cliReceipt = { passed: true, revision, image: imageId, checks: cliChecks, linuxTests: 1, cli };
  const runtime = { passed: true, cleanupPassed: true, development: false, revision, candidate: imageId, cliSha256: cli[0].sha256 };
  const receipts = [build, cliReceipt, ...Array.from({ length: 4 }, () => ({ ...runtime }))];
  const saveAcceptance = () => save('acceptance.json', { passed: true, context, revision, imageId,
    receipts: receipts.map((receipt, i) => { const path = save(`receipt-${i}.json`, receipt); return { path, sha256: sha256(readFileSync(path)) }; }) });
  const acceptance = saveAcceptance();
  const sbom = resolve(directory, 'reviewed-sbom.tar.gz'); writeFileSync(sbom, 'Reviewed SBOM fixture.');
  const inputs = { acceptance, output, sbom, sequence: 1,
    issuedAt: new Date(Date.now() - 60000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    expiresAt: new Date(Date.now() + 3600000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    migration: { from: ['fixture-schema'], to: 'fixture-schema', rollback: 'restore-required' } };
  const trust = save('trust.json', { schemaVersion: 'vaultix.release-trust.v1', keys: [{ keyId, publicKey: der.toString('base64') }] });
  const notes = resolve(directory, 'notes.md'); writeFileSync(notes, 'Test fixture, not a production release.');
  const io = { verifySource: async () => {}, exportEngine: async (_, target) => writeFileSync(target, 'Immutable engine fixture.', { flag: 'wx' }),
    exportSource: async (_, target) => writeFileSync(target, 'Committed source fixture.', { flag: 'wx' }) };
  return { inputs, directory, output, receipts, saveAcceptance, io,
    signing: { bundle: output, acceptance, trust, keyId, signer }, publication: { bundle: output, acceptance, trust, notes } };
}
const signatureExists = f => existsSync(resolve(f.output, 'release-signature.json'));
const manifestExists = f => existsSync(resolve(f.output, 'release-manifest.json'));

test('accepted bytes prepare and sign through a real subprocess, then the existing publisher accepts them', async () => {
  const f = fixture(), result = await prepareRelease(f.inputs, f.io);
  assert.equal(result.signed, false); assert.equal(result.artifacts.length, 7);
  assert.equal(readFileSync(resolve(f.output, 'vaultix-engine.tar.gz'), 'utf8'), 'Immutable engine fixture.');
  for (const item of f.receipts[1].cli) {
    for (const [index, command] of ['vaultix', 'vaultixl'].entries()) {
      const target = resolve(f.output, `${command}-${item.platform.replace('/', '-')}${item.platform.startsWith('windows') ? '.exe' : ''}`);
      assert.deepEqual(readFileSync(target), readFileSync(item.files[index]));
    }
  }
  assert.equal((await signRelease(f.signing, runSigner)).unchanged, false);
  const plan = await loadPublication(f.publication);
  assert.equal(plan.assets.length, 9); assert.equal(plan.tag, 'v0.1.0');
  assert.equal((await signRelease(f.signing, () => assert.fail('Retry must not invoke signer'))).unchanged, true);
});

test('build metadata containing a hyphen does not change the stable channel', async () => {
  const f = fixture('0.1.0+owned-build'); await prepareRelease(f.inputs, f.io);
  assert.equal(JSON.parse(readFileSync(resolve(f.output, 'release-manifest.json'))).channel, 'stable');
});

for (const [name, change] of [
  ['failed acceptance', f => { f.receipts[0].passed = false; f.saveAcceptance(); }],
  ['stale receipt hash', f => writeFileSync(resolve(f.directory, 'receipt-0.json'), '{}')],
  ['development runtime', f => { f.receipts[2].development = true; f.saveAcceptance(); }],
  ['unversioned build', f => { f.receipts[0].platformVersion = 'dev-unversioned'; f.saveAcceptance(); }],
  ['mismatched second CLI', f => writeFileSync(f.receipts[1].cli[0].files[1], 'Not the accepted command')],
  ['unknown input', f => f.inputs.skipVerification = true],
  ['invalid dates', f => f.inputs.expiresAt = '2020-01-01T00:00:00Z'],
  ['source refusal', f => f.io.verifySource = async () => { throw Error('Wrong tag'); }],
  ['export failure', f => f.io.exportEngine = async (_, path) => { writeFileSync(path, 'partial'); throw Error('Disconnected'); }],
  ['changed acceptance during export', f => f.io.exportSource = async (_, path) => { writeFileSync(path, 'source'); f.receipts[2].passed = false; f.saveAcceptance(); }]
]) test(`preparation refuses ${name} without a manifest`, async () => {
  const f = fixture(); change(f); await assert.rejects(prepareRelease(f.inputs, f.io)); assert.equal(manifestExists(f), false);
});

test('preparation cannot reuse an output or overwrite its operator files', async () => {
  const f = fixture(); mkdirSync(f.output); writeFileSync(resolve(f.output, 'keep'), 'Existing material');
  await assert.rejects(prepareRelease(f.inputs, f.io));
  assert.equal(readFileSync(resolve(f.output, 'keep'), 'utf8'), 'Existing material');
  assert.equal(manifestExists(f), false);
});

for (const [name, mutate] of [
  ['manifest', f => writeFileSync(resolve(f.output, 'release-manifest.json'), '{}')],
  ['trust', f => writeFileSync(f.signing.trust, '{}')],
  ['artifact', f => writeFileSync(resolve(f.output, 'vaultix-source.tar.gz'), 'altered')],
  ['acceptance', f => { f.receipts[2].passed = false; f.saveAcceptance(); }]
]) test(`signing refuses ${name} changed while the signer runs`, async () => {
  const f = fixture(); await prepareRelease(f.inputs, f.io);
  await assert.rejects(signRelease(f.signing, async bytes => { const signature = await runSigner(bytes, signer); mutate(f); return signature; }));
  assert.equal(signatureExists(f), false);
});

for (const [name, configure] of [
  ['untrusted signer', f => f.signing.keyId = 'f'.repeat(64)],
  ['relative executable', f => f.signing.signer = { executable: 'node', args: [] }],
  ['tampered artifact', f => writeFileSync(resolve(f.output, 'vaultix-engine.tar.gz'), 'tampered')],
  ['unknown signer option', f => f.signing.signer = { ...signer, shell: true }]
]) test(`signing preflight denies ${name} before execution`, async () => {
  const f = fixture(); await prepareRelease(f.inputs, f.io); configure(f);
  await assert.rejects(signRelease(f.signing, () => assert.fail('Signer must not execute'))); assert.equal(signatureExists(f), false);
});

test('incorrect signature and failed signer never produce a signature file', async () => {
  for (const execute of [async () => Buffer.alloc(64), async () => { throw Error('Unavailable'); }, async () => Buffer.alloc(65)]) {
    const f = fixture(); await prepareRelease(f.inputs, f.io);
    await assert.rejects(signRelease(f.signing, execute)); assert.equal(signatureExists(f), false);
  }
});

test('a valid signature from a different trusted key is not mislabeled on retry', async () => {
  const f = fixture(); await prepareRelease(f.inputs, f.io); await signRelease(f.signing, runSigner);
  const other = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'der' });
  const trust = JSON.parse(readFileSync(f.signing.trust)); trust.keys.push({ keyId: sha256(other), publicKey: other.toString('base64') });
  writeFileSync(f.signing.trust, canonical(trust)); f.signing.keyId = sha256(other);
  await assert.rejects(signRelease(f.signing, () => assert.fail('Retry must not execute')), /different signer/);
});

test('signer process rejects nonzero exit, oversized/short output, missing executable and timeout', async () => {
  for (const script of ['process.stdout.write(Buffer.alloc(64));process.exitCode=2', 'process.stdout.write(Buffer.alloc(65))', 'process.stdout.write(Buffer.alloc(63))', 'setInterval(()=>{},1000)']) {
    await assert.rejects(runSigner(Buffer.from('input'), { executable: process.execPath, args: ['-e', script] }, 1000));
  }
  await assert.rejects(runSigner(Buffer.from('input'), { executable: resolve(root, 'does-not-exist.exe'), args: [] }, 1000));
});

test('signer argv is literal, not a shell program', async () => {
  const literal = '; $(echo unsafe) & | >';
  const bytes = await runSigner(Buffer.from('input'), { executable: process.execPath,
    args: ['-e', 'process.stdin.resume();process.stdin.on("end",()=>{if(process.argv[1]!=="; $(echo unsafe) & | >")process.exit(1);process.stdout.write(Buffer.alloc(64,7));})', literal] });
  assert.deepEqual(bytes, Buffer.alloc(64, 7));
});

test('archive exporter preserves stream bytes, refuses overwrite and fails closed on child errors', async () => {
  const directory = mkdtempSync(resolve(root, 'export-')), target = resolve(directory, 'archive.gz');
  await exportArchive(process.execPath, ['-e', 'process.stdout.write("exact committed bytes")'], target, directory, 1000);
  assert.equal(gunzipSync(readFileSync(target)).toString(), 'exact committed bytes');
  const original = readFileSync(target);
  await assert.rejects(exportArchive(process.execPath, ['-e', 'process.stdout.write("replacement")'], target, directory, 1000));
  assert.deepEqual(readFileSync(target), original);
  await assert.rejects(exportArchive(process.execPath, ['-e', 'process.stdout.write("partial");process.exitCode=1'], resolve(directory, 'failed.gz'), directory, 1000));
  await assert.rejects(exportArchive(process.execPath, ['-e', 'setInterval(()=>{},1000)'], resolve(directory, 'timeout.gz'), directory, 1000));
  await assert.rejects(exportArchive(resolve(directory, 'missing.exe'), [], resolve(directory, 'missing.gz'), directory, 1000));
});
