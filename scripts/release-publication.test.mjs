import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { canonical, sha256 } from './lib/release-bundle.mjs';
import { canonicalStages, cliChecks, context } from './lib/pr-verification.mjs';
import { checkLatestStable, loadPublication, publishRelease } from './lib/release-publication.mjs';

// Ephemeral keys exist only in this test process; never production trust.
// Public RFC signing vectors are covered by release-bundle.test.mjs.
const { privateKey: key } = generateKeyPairSync('ed25519');
const der = createPublicKey(key).export({ type: 'spki', format: 'der' });
mkdirSync('.cache', { recursive: true });
const root = mkdtempSync(resolve('.cache/publication-fixtures-'));
function fixture(preview = true) {
  const directory = mkdtempSync(resolve(root, 'bundle-'));
  const content = Buffer.from('Publication boundary fixture, not executable software.');
  const revision = 'a'.repeat(40), image = `sha256:${'b'.repeat(64)}`, hash = sha256(content);
  const version = preview ? '0.1.0-alpha.1' : '0.1.0';
  const names = ['vaultix-linux-amd64', 'vaultixl-linux-amd64', 'vaultix-windows-amd64.exe', 'vaultixl-windows-amd64.exe', 'engine.tar.gz', 'source.tar', 'sbom.json'];
  const manifest = { schemaVersion: 'vaultix.release-manifest.v1', version, channel: preview ? 'preview' : 'stable', revision, sequence: 1,
    issuedAt: new Date(Date.now() - 60000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    expiresAt: new Date(Date.now() + 3600000).toISOString().replace(/\.\d{3}Z$/, 'Z'), minimumUpdaterVersion: '1.0.0',
    migration: { from: ['schema-a'], to: 'schema-a', rollback: 'compatible' },
    artifacts: names.map((name, i) => ({ name, kind: i < 4 ? 'cli' : i === 4 ? 'engine' : i === 5 ? 'source' : 'sbom',
      platform: i < 2 || i === 4 ? 'linux/amd64' : i < 4 ? 'windows/amd64' : 'any', bytes: content.length, sha256: hash, imageId: i === 4 ? image : null })) };
  const save = (name, value) => { const path = resolve(directory, name); writeFileSync(path, canonical(value)); return path; };
  for (const name of names) writeFileSync(resolve(directory, name), content);
  const signManifest = () => {
    save('release-manifest.json', manifest);
    save('release-signature.json', { schemaVersion: 'vaultix.release-signature.v1', keyId: sha256(der), signature: sign(null, canonical(manifest), key).toString('base64') });
  };
  signManifest();
  const notes = resolve(directory, 'notes.md'); writeFileSync(notes, 'Fixture release notes.\n');
  const trust = save('owner-trust.json', { schemaVersion: 'vaultix.release-trust.v1', keys: [{ keyId: sha256(der), publicKey: der.toString('base64') }] });
  const build = { passed: true, revision, imageId: image, image: `vaultix:${revision}`, platformVersion: version,
    steps: canonicalStages.map(name => ({ name, passed: true, exitCode: 0 })) };
  const cli = { passed: true, revision, image, checks: cliChecks, linuxTests: 1,
    cli: ['linux/amd64', 'windows/amd64'].map(platform => ({ platform, sha256: hash, files: ['vaultix', 'vaultixl'] })) };
  const runtime = { passed: true, cleanupPassed: true, development: false, revision, candidate: image, cliSha256: hash };
  const receipts = [build, cli, runtime, runtime, runtime, runtime];
  const acceptance = resolve(directory, 'acceptance.json');
  const saveAcceptance = () => save('acceptance.json', { passed: true, context, revision, imageId: image,
    receipts: receipts.map((receipt, i) => { const path = save(`receipt-${i}.json`, receipt); return { path, sha256: sha256(readFileSync(path)) }; }) });
  saveAcceptance();
  return { inputs: { bundle: directory, trust, acceptance, notes }, directory, manifest, receipts, saveAcceptance, signManifest };
}
function github(plan) {
  let listing = null;
  let selected = false;
  const effects = [];
  return {
    effects, get current() { return listing; },
    verifySource: async () => effects.push('source'),
    getRelease: async () => listing && structuredClone(listing),
    createDraft: async () => { effects.push('draft'); listing = { id: 42, tag_name: plan.tag, prerelease: plan.preview, draft: true, body: 'Fixture release notes.\n', assets: [] }; return structuredClone(listing); },
    upload: async (_, asset) => { effects.push(`upload:${asset.name}`); listing.assets.push({ name: asset.name, state: 'uploaded', size: asset.bytes, digest: `sha256:${asset.sha256}` }); },
    revalidate: async () => effects.push('local-verification'),
    publish: async (_, p, latest) => { effects.push('publish'); listing.draft = false; selected = latest; },
    verifyVisibility: async (_, expected) => assert.equal(selected, expected)
  };
}
test('signed files and accepted receipts produce a complete resumable draft; publication is explicit', async () => {
  const f = fixture(), plan = await loadPublication(f.inputs), io = github(plan);
  assert.equal(plan.assets.length, 9);
  assert.ok(!plan.assets.some(a => /trust|acceptance|receipt/.test(a.name)), 'Private local inputs must not be uploaded');
  assert.equal((await publishRelease(plan, io)).planned, true);
  assert.deepEqual(io.effects, ['source']);
  assert.equal((await publishRelease(plan, io, 'draft')).draft, true);
  assert.ok(!io.effects.includes('publish'));
  const uploaded = io.effects.filter(x => x.startsWith('upload:')).length;
  assert.equal((await publishRelease(plan, io, 'publish')).published, true);
  assert.equal(io.effects.filter(x => x.startsWith('upload:')).length, uploaded, 'Matching assets should not be replaced');
  assert.equal(io.effects.at(-2), 'publish');
  assert.equal((await publishRelease(plan, io, 'publish')).unchanged, true);
});
for (const [name, change] of [
  ['changed artifact bytes', f => writeFileSync(resolve(f.directory, 'vaultix-linux-amd64'), 'tampered')],
  ['unsigned metadata', f => { f.manifest.sequence++; writeFileSync(resolve(f.directory, 'release-manifest.json'), canonical(f.manifest)); }],
  ['changed acceptance receipt', f => writeFileSync(resolve(f.directory, 'receipt-0.json'), '{}')],
  ['failed acceptance', f => { f.receipts[2].passed = false; f.saveAcceptance(); }],
  ['development acceptance', f => { f.receipts[2].development = true; f.saveAcceptance(); }],
  ['wrong build version', f => { f.receipts[0].platformVersion = 'dev-unversioned'; f.saveAcceptance(); }],
  ['wrong CLI bytes', f => { f.receipts[1].cli[0].sha256 = 'c'.repeat(64); f.saveAcceptance(); }],
  ['wrong engine identity', f => { f.manifest.artifacts[4].imageId = `sha256:${'c'.repeat(64)}`; f.signManifest(); }],
  ['asset at GitHub size limit', f => { f.manifest.artifacts[4].bytes = 2 * 1024 ** 3; f.signManifest(); }],
  ['metadata artifact collision', f => { f.manifest.artifacts[4].name = 'release-manifest.json'; f.signManifest(); }],
  ['public RFC key in owner trust', f => {
    const known = createPrivateKey({ key: Buffer.from('302e020100300506032b6570042204209d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60', 'hex'), type: 'pkcs8', format: 'der' });
    const publicKey = createPublicKey(known).export({ type: 'spki', format: 'der' });
    const trust = JSON.parse(readFileSync(f.inputs.trust));
    trust.keys.push({ keyId: sha256(publicKey), publicKey: publicKey.toString('base64') });
    writeFileSync(f.inputs.trust, canonical(trust));
  }],
  ['expired manifest', f => { f.manifest.issuedAt = '2020-01-01T00:00:00Z'; f.manifest.expiresAt = '2020-01-02T00:00:00Z'; f.signManifest(); }]
]) test(`publication preflight rejects ${name}`, async () => { const f = fixture(); change(f); await assert.rejects(loadPublication(f.inputs)); });
for (const [name, change] of [
  ['wrong remote digest', io => io.current.assets[0].digest = `sha256:${'f'.repeat(64)}`],
  ['missing digest', io => delete io.current.assets[0].digest],
  ['incomplete upload', io => io.current.assets[0].state = 'starter'],
  ['unknown asset', io => io.current.assets.push({ name: 'unreviewed.exe' })],
  ['changed channel', io => io.current.prerelease = false],
  ['changed notes', io => io.current.body = 'Unreviewed claim'],
  ['replaced release', io => io.current.id++],
  ['concurrent publication', io => io.current.draft = false]
]) test(`publication refuses ${name} after upload`, async () => {
  const plan = await loadPublication(fixture().inputs), io = github(plan);
  io.revalidate = async () => change(io);
  await assert.rejects(publishRelease(plan, io, 'publish'));
  assert.ok(!io.effects.includes('publish'));
});
test('an interrupted upload resumes matching files without a delete or overwrite action', async () => {
  const plan = await loadPublication(fixture().inputs), io = github(plan), upload = io.upload;
  io.upload = async (p, asset) => { if (io.current.assets.length === 2) throw new Error('network interruption'); await upload(p, asset); };
  await assert.rejects(publishRelease(plan, io, 'publish'));
  assert.equal(io.current.draft, true); assert.equal(io.current.assets.length, 2);
  io.upload = upload;
  assert.equal((await publishRelease(plan, io, 'publish')).published, true);
  assert.equal(io.effects.filter(x => x.startsWith('upload:')).length, 9);
});
test('changed source or local bundle refuses publication', async () => {
  for (const boundary of ['verifySource', 'revalidate']) {
    const plan = await loadPublication(fixture().inputs), io = github(plan);
    io[boundary] = async () => { throw new Error('changed input'); };
    await assert.rejects(publishRelease(plan, io, 'publish'));
    assert.ok(!io.effects.includes('publish'));
  }
});
test('stable publication cannot rewind latest or change only build metadata', () => {
  const latest = { tag_name: 'v1.2.3', draft: false, prerelease: false };
  for (const tag of ['v0.9.9', 'v1.2.2', 'v1.2.3+repacked']) assert.throws(() => checkLatestStable({ tag, preview: false }, latest));
  for (const tag of ['v1.2.3', 'v1.2.4', 'v1.3.0', 'v2.0.0']) checkLatestStable({ tag, preview: false }, latest);
  checkLatestStable({ tag: 'v0.1.0-alpha.1', preview: true }, latest);
  checkLatestStable({ tag: 'v0.1.0', preview: false }, null);
  assert.throws(() => checkLatestStable({ tag: 'v1.2.4', preview: false }, { ...latest, tag_name: 'v01.2.3' }));
});
test('stable artifacts must be staged before identical-byte promotion to latest', async () => {
  const plan = await loadPublication(fixture(false).inputs), io = github(plan);
  await assert.rejects(publishRelease(plan, io, 'publish'), /Stage the stable candidate first/);
  assert.deepEqual(io.effects, ['source']);
  const staged = await publishRelease(plan, io, 'stage');
  assert.equal(staged.published, true); assert.equal(staged.latest, false);
  const originalAssets = structuredClone(io.current.assets);
  const promoted = await publishRelease(plan, io, 'publish');
  assert.equal(promoted.latest, true);
  assert.deepEqual(io.current.assets, originalAssets);
  assert.equal(io.effects.filter(x => x.startsWith('upload:')).length, 9);
});
test('changed assets in a staged stable release prevent promotion', async () => {
  const plan = await loadPublication(fixture(false).inputs), io = github(plan);
  await publishRelease(plan, io, 'stage');
  io.current.assets[0].digest = `sha256:${'f'.repeat(64)}`;
  const mutations = io.effects.filter(x => x === 'publish').length;
  await assert.rejects(publishRelease(plan, io, 'publish'));
  assert.equal(io.effects.filter(x => x === 'publish').length, mutations);
});
