import assert from 'node:assert/strict';
import { createReadStream, createWriteStream, existsSync, lstatSync, mkdirSync, openSync, closeSync, fsyncSync, writeFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, resolve } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { canonical, parseCanonical, sha256, validateManifest, validateTrust, verifyArtifacts, verifyManifest } from './release-bundle.mjs';
import { readPublicationFile, readReleaseAcceptance, rejectPublicTestTrust, verifyReleaseAcceptance } from './release-publication.mjs';

export const assetLimit = 2 * 1024 ** 3;
export function exactFields(value, fields) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(), [...fields].sort(), 'Missing or unknown producer input');
}
export function regularFile(path) {
  const absolute = resolve(path), stat = lstatSync(absolute);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size < assetLimit, 'Expected bounded regular artifact');
  assert.equal(realpathSync(absolute), absolute, 'Artifact path cannot traverse links');
  return stat;
}
export function boundedAsset() {
  let bytes = 0;
  return new Transform({ transform(chunk, _, callback) {
    bytes += chunk.length;
    callback(bytes < assetLimit ? null : new Error('Release asset must be under 2 GiB'), chunk);
  }});
}
async function describe(path, kind, platform = 'any', imageId = null) {
  const before = regularFile(path), hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(path)) { bytes += chunk.length; assert.ok(bytes < assetLimit); hash.update(chunk); }
  const after = regularFile(path);
  assert.ok(before.dev === after.dev && before.ino === after.ino && before.mtimeMs === after.mtimeMs && bytes === before.size && bytes === after.size, 'Artifact changed during hashing');
  return { name: path.split(/[\\/]/).at(-1), kind, platform, imageId, bytes, sha256: hash.digest('hex') };
}
async function copyArtifact(source, target) {
  const before = regularFile(source);
  await pipeline(createReadStream(source), boundedAsset(), createWriteStream(target, { flags: 'wx', mode: 0o600 }));
  const after = regularFile(source);
  assert.ok(before.dev === after.dev && before.ino === after.ino && before.mtimeMs === after.mtimeMs && before.size === after.size, 'Artifact changed during copying');
}
function writeExclusive(path, bytes) {
  const fd = openSync(path, 'wx', 0o600);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
}

// The adapter exports committed source and the immutable engine. Receipts remain
// local operator evidence; a supplied SBOM is still subject to content review.
export async function prepareRelease(inputs, io) {
  exactFields(inputs, ['acceptance', 'output', 'sbom', 'sequence', 'issuedAt', 'expiresAt', 'migration']);
  const accepted = readReleaseAcceptance(inputs.acceptance);
  const { revision, platformVersion: version, imageId } = accepted.build;
  // Validate all metadata before creating output or invoking exporters.
  const placeholders = ['vaultix-linux-amd64', 'vaultixl-linux-amd64', 'vaultix-windows-amd64.exe', 'vaultixl-windows-amd64.exe', 'vaultix-engine.tar.gz', 'vaultix-source.tar.gz', 'vaultix-sbom.tar.gz'];
  const manifest = { schemaVersion: 'vaultix.release-manifest.v1', revision, version, channel: version?.split('+')[0].includes('-') ? 'preview' : 'stable',
    sequence: inputs.sequence, issuedAt: inputs.issuedAt, expiresAt: inputs.expiresAt, minimumUpdaterVersion: '1.0.0', migration: inputs.migration,
    artifacts: placeholders.map((name, i) => ({ name, kind: i < 4 ? 'cli' : i === 4 ? 'engine' : i === 5 ? 'source' : 'sbom',
      platform: i < 2 || i === 4 ? 'linux/amd64' : i < 4 ? 'windows/amd64' : 'any', imageId: i === 4 ? imageId : null, bytes: 1, sha256: '0'.repeat(64) })) };
  validateManifest(manifest);
  assert.ok(Date.parse(manifest.issuedAt) <= Date.now() + 300000 && Date.parse(manifest.expiresAt) > Date.now(), 'Manifest must be currently valid');
  regularFile(inputs.sbom);
  for (const item of accepted.cli.cli) for (const file of item.files) regularFile(file);
  await io.verifySource(accepted.build);
  const directory = resolve(inputs.output);
  assert.equal(realpathSync(dirname(directory)), dirname(directory), 'Output parent cannot traverse links');
  assert.ok(!directory.includes('#'), 'Output cannot contain a gh asset-label separator');
  mkdirSync(directory, { mode: 0o700 }); // exclusive: never reuse or erase a prior release
  const artifacts = [];
  for (const platform of ['linux/amd64', 'windows/amd64']) {
    const item = accepted.cli.cli.find(a => a.platform === platform);
    for (const [index, command] of ['vaultix', 'vaultixl'].entries()) {
      const name = `${command}-${platform.replace('/', '-')}${platform.startsWith('windows') ? '.exe' : ''}`;
      const target = resolve(directory, name);
      await copyArtifact(item.files[index], target);
      const artifact = await describe(target, 'cli', platform);
      assert.equal(artifact.sha256, item.sha256, 'CLI bytes differ from accepted build'); artifacts.push(artifact);
    }
  }
  const engine = resolve(directory, 'vaultix-engine.tar.gz');
  await io.exportEngine(accepted.build, engine);
  artifacts.push(await describe(engine, 'engine', 'linux/amd64', imageId));
  const source = resolve(directory, 'vaultix-source.tar.gz');
  await io.exportSource(accepted.build, source);
  artifacts.push(await describe(source, 'source'));
  const sbom = resolve(directory, 'vaultix-sbom.tar.gz');
  await copyArtifact(inputs.sbom, sbom); artifacts.push(await describe(sbom, 'sbom'));
  manifest.artifacts = artifacts; validateManifest(manifest);
  assert.deepEqual(verifyReleaseAcceptance(manifest, inputs.acceptance), accepted, 'Acceptance changed during preparation');
  await io.verifySource(accepted.build);
  await verifyArtifacts(manifest, directory);
  writeExclusive(resolve(directory, 'release-manifest.json'), canonical(manifest));
  return { prepared: true, signed: false, directory, revision, version, acceptanceSha256: accepted.acceptanceSha256, artifacts };
}

export async function signRelease(inputs, signer) {
  exactFields(inputs, ['bundle', 'acceptance', 'trust', 'keyId', 'signer']);
  exactFields(inputs.signer, ['executable', 'args']);
  assert.ok(isAbsolute(inputs.signer.executable) && Array.isArray(inputs.signer.args) && inputs.signer.args.every(x => typeof x === 'string' && !x.includes('\0')), 'Signer requires an absolute executable and explicit argv');
  const directory = realpathSync(resolve(inputs.bundle));
  const manifestPath = resolve(directory, 'release-manifest.json'), signaturePath = resolve(directory, 'release-signature.json');
  const raw = readPublicationFile(manifestPath, 65536), manifest = validateManifest(parseCanonical(raw));
  const trust = readPublicationFile(inputs.trust, 16384);
  const keys = validateTrust(trust); rejectPublicTestTrust(trust);
  assert.ok(keys.has(inputs.keyId), 'Signer key must already be independently trusted');
  assert.ok(Date.parse(manifest.issuedAt) <= Date.now() + 300000 && Date.parse(manifest.expiresAt) > Date.now(), 'Manifest must be currently valid');
  assert.ok(manifest.artifacts.every(a => a.bytes < assetLimit && !['release-manifest.json', 'release-signature.json'].includes(a.name)), 'Invalid publication artifact');
  const acceptance = verifyReleaseAcceptance(manifest, inputs.acceptance);
  await verifyArtifacts(manifest, directory);
  if (existsSync(signaturePath)) {
    const existing = readPublicationFile(signaturePath, 4096);
    verifyManifest(raw, existing, trust);
    assert.equal(parseCanonical(existing, 4096).keyId, inputs.keyId, 'Existing signature uses a different signer');
    return { signed: true, unchanged: true, revision: manifest.revision, keyId: inputs.keyId };
  }
  const signature = await signer(Buffer.from(raw), inputs.signer);
  assert.ok(Buffer.isBuffer(signature) && signature.length === 64, 'Signer must return exactly 64 raw Ed25519 signature bytes');
  const detached = canonical({ schemaVersion: 'vaultix.release-signature.v1', keyId: inputs.keyId, signature: signature.toString('base64') });
  verifyManifest(raw, detached, trust);
  assert.ok(readPublicationFile(manifestPath, 65536).equals(raw), 'Manifest changed while signing');
  assert.ok(readPublicationFile(inputs.trust, 16384).equals(trust), 'Trust changed while signing');
  assert.deepEqual(verifyReleaseAcceptance(manifest, inputs.acceptance), acceptance, 'Acceptance changed while signing');
  await verifyArtifacts(manifest, directory);
  writeExclusive(signaturePath, detached);
  return { signed: true, unchanged: false, revision: manifest.revision, keyId: inputs.keyId, manifestSha256: sha256(raw) };
}
