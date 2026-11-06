// Release byte verification only. No download, installation, key creation or trust-on-first-use.
import assert from 'node:assert/strict';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const hex = /^[a-f0-9]{64}$/;
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const sorted = value => Array.isArray(value) ? value.map(sorted) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])])) : value;
export const canonical = value => Buffer.from(JSON.stringify(sorted(value), null, 2) + '\n');
const fields = (value, names) => {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), 'Expected object');
  assert.deepEqual(Object.keys(value).sort(), [...names].sort(), 'Missing or unknown fields');
};
const text = (value, pattern) => assert.ok(typeof value === 'string' && pattern.test(value), 'Invalid text field');
const integer = (value, max = Number.MAX_SAFE_INTEGER) => assert.ok(Number.isSafeInteger(value) && value > 0 && value <= max, 'Invalid positive integer');
function version(value) {
  text(value, semver);
  assert.ok(value.length <= 128);
  const match = value.match(semver);
  assert.ok(match.slice(1, 4).every(n => Number.isSafeInteger(Number(n))));
  assert.ok(!match[4]?.split('.').some(n => /^0\d+$/.test(n)));
}
function timestamp(value) {
  text(value, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  const time = Date.parse(value);
  assert.ok(Number.isFinite(time) && new Date(time).toISOString().replace('.000Z', 'Z') === value, 'Invalid timestamp');
  return time;
}
export function parseCanonical(bytes, limit = 65536) {
  assert.ok(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= limit, 'Metadata size limit');
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  // Exact canonical bytes reject duplicate keys, unsafe numeric round trips and
  // alternate encodings; signatures cover these same bytes in every consumer.
  assert.ok(canonical(value).equals(bytes), 'Metadata must use canonical JSON encoding');
  return value;
}
export function validateManifest(manifest) {
  fields(manifest, ['schemaVersion', 'version', 'channel', 'revision', 'sequence', 'issuedAt', 'expiresAt', 'minimumUpdaterVersion', 'migration', 'artifacts']);
  assert.equal(manifest.schemaVersion, 'vaultix.release-manifest.v1');
  version(manifest.version); version(manifest.minimumUpdaterVersion);
  assert.ok(['stable', 'preview'].includes(manifest.channel));
  assert.equal(manifest.channel === 'preview', Boolean(manifest.version.match(semver)[4]), 'Channel and version disagree');
  text(manifest.revision, /^[a-f0-9]{40}$/); integer(manifest.sequence);
  const issued = timestamp(manifest.issuedAt), expires = timestamp(manifest.expiresAt);
  assert.ok(expires > issued && expires - issued <= 90 * 86400000, 'Invalid validity window');
  fields(manifest.migration, ['from', 'to', 'rollback']);
  assert.ok(Array.isArray(manifest.migration.from) && manifest.migration.from.length > 0 && manifest.migration.from.length <= 100);
  assert.equal(new Set(manifest.migration.from).size, manifest.migration.from.length);
  for (const id of [...manifest.migration.from, manifest.migration.to]) text(id, /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/);
  assert.ok(['compatible', 'restore-required'].includes(manifest.migration.rollback));
  assert.ok(Array.isArray(manifest.artifacts) && manifest.artifacts.length >= 7 && manifest.artifacts.length <= 64);
  const names = new Set(), identities = new Set();
  let engines = 0, sources = 0, sboms = 0;
  const cli = new Map();
  for (const artifact of manifest.artifacts) {
    fields(artifact, ['name', 'kind', 'platform', 'bytes', 'sha256', 'imageId']);
    text(artifact.name, /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/);
    assert.ok(!artifact.name.includes('..') && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(artifact.name), 'Unsafe artifact name');
    assert.ok(!artifact.name.endsWith('.'), 'Unsafe artifact suffix');
    assert.ok(!names.has(artifact.name), 'Duplicate artifact'); names.add(artifact.name);
    assert.ok(['cli', 'engine', 'source', 'sbom'].includes(artifact.kind));
    assert.ok(['linux/amd64', 'windows/amd64', 'any'].includes(artifact.platform));
    integer(artifact.bytes, 32 * 1024 ** 3); text(artifact.sha256, hex);
    if (artifact.kind === 'engine') {
      assert.equal(artifact.platform, 'linux/amd64'); text(artifact.imageId, /^sha256:[a-f0-9]{64}$/); engines++;
    } else assert.equal(artifact.imageId, null);
    if (artifact.kind === 'cli') {
      assert.notEqual(artifact.platform, 'any');
      const stem = artifact.platform === 'windows/amd64' ? /^(vaultix|vaultixl)-windows-amd64\.exe$/ : /^(vaultix|vaultixl)-linux-amd64$/;
      text(artifact.name, stem);
      const identity = `${artifact.platform}/${artifact.name.match(stem)[1]}`;
      assert.ok(!identities.has(identity)); identities.add(identity);
      const peer = cli.get(artifact.platform);
      if (peer) assert.ok(peer.sha256 === artifact.sha256 && peer.bytes === artifact.bytes, 'CLI executable names disagree');
      cli.set(artifact.platform, artifact);
    } else if (artifact.kind !== 'engine') {
      assert.equal(artifact.platform, 'any');
      if (artifact.kind === 'source') sources++;
      if (artifact.kind === 'sbom') sboms++;
    }
  }
  assert.equal(engines, 1, 'Exactly one supported engine artifact is required');
  assert.equal(sources, 1, 'Exactly one source archive is required');
  assert.equal(sboms, 1, 'Exactly one SBOM is required');
  assert.equal(identities.size, 4, 'Both executable names for both supported platforms are required');
  return manifest;
}

export function validateTrust(trustBytes) {
  const trust = parseCanonical(trustBytes, 16384);
  fields(trust, ['schemaVersion', 'keys']); assert.equal(trust.schemaVersion, 'vaultix.release-trust.v1');
  assert.ok(Array.isArray(trust.keys) && trust.keys.length > 0 && trust.keys.length <= 16);
  const keys = new Map();
  for (const entry of trust.keys) {
    fields(entry, ['keyId', 'publicKey']); text(entry.keyId, hex);
    assert.ok(!keys.has(entry.keyId), 'Duplicate trusted key');
    assert.equal(typeof entry.publicKey, 'string');
    const der = Buffer.from(entry.publicKey, 'base64');
    assert.equal(der.toString('base64'), entry.publicKey);
    assert.equal(sha256(der), entry.keyId, 'Trust key identity mismatch');
    const key = createPublicKey({ key: der, format: 'der', type: 'spki' });
    assert.equal(key.asymmetricKeyType, 'ed25519');
    assert.ok(key.export({ format: 'der', type: 'spki' }).equals(der), 'Noncanonical public key');
    keys.set(entry.keyId, key);
  }
  return keys;
}

export function verifyManifest(bytes, signatureBytes, trustBytes, { now = Date.now(), previous = null } = {}) {
  const manifest = validateManifest(parseCanonical(bytes));
  const signature = parseCanonical(signatureBytes, 4096);
  fields(signature, ['schemaVersion', 'keyId', 'signature']);
  assert.equal(signature.schemaVersion, 'vaultix.release-signature.v1'); text(signature.keyId, hex);
  const selected = validateTrust(trustBytes).get(signature.keyId);
  assert.ok(selected, 'Release signing key is not trusted');
  assert.equal(typeof signature.signature, 'string');
  const signed = Buffer.from(signature.signature, 'base64');
  assert.equal(signed.length, 64); assert.equal(signed.toString('base64'), signature.signature);
  assert.ok(verify(null, bytes, selected, signed), 'Invalid release signature');
  assert.ok(Number.isFinite(now) && timestamp(manifest.issuedAt) <= now + 300000, 'Release issued in the future');
  assert.ok(timestamp(manifest.expiresAt) > now, 'Release metadata expired');
  // This verifier implements v1; higher updater requirements cannot silently pass.
  assert.equal(manifest.minimumUpdaterVersion, '1.0.0', 'Unsupported updater version');
  const digest = sha256(bytes);
  if (previous !== null) {
    fields(previous, ['schemaVersion', 'sequence', 'sha256']);
    assert.equal(previous.schemaVersion, 'vaultix.release-checkpoint.v1'); integer(previous.sequence); text(previous.sha256, hex);
    assert.ok(manifest.sequence > previous.sequence || (manifest.sequence === previous.sequence && digest === previous.sha256), 'Replayed or conflicting release metadata');
  }
  return { manifest, checkpoint: { schemaVersion: 'vaultix.release-checkpoint.v1', sequence: manifest.sequence, sha256: digest } };
}

export async function verifyArtifacts(manifest, directory) {
  validateManifest(manifest);
  const root = await realpath(directory);
  const results = [];
  for (const artifact of manifest.artifacts) {
    const path = resolve(root, artifact.name);
    assert.equal(dirname(path), root);
    const before = await lstat(path);
    assert.ok(before.isFile() && !before.isSymbolicLink(), 'Artifact must be a regular file');
    assert.equal(await realpath(path), path, 'Artifact link/reparse point refused');
    const handle = await open(path, 'r');
    try {
      const stat = await handle.stat();
      assert.ok(stat.isFile() && stat.dev === before.dev && stat.ino === before.ino, 'Artifact changed before open');
      assert.equal(stat.size, artifact.bytes);
      const hash = createHash('sha256'); let count = 0;
      for await (const chunk of createReadStream(path, { fd: handle.fd, autoClose: false })) {
        count += chunk.length; assert.ok(count <= artifact.bytes, 'Artifact exceeds declared size'); hash.update(chunk);
      }
      assert.equal(count, artifact.bytes); assert.equal(hash.digest('hex'), artifact.sha256, 'Artifact digest mismatch');
      const after = await handle.stat(); assert.equal(after.size, stat.size); assert.equal(after.mtimeMs, stat.mtimeMs);
      const current = await lstat(path); assert.ok(!current.isSymbolicLink() && current.dev === stat.dev && current.ino === stat.ino, 'Artifact path replaced');
      results.push({ name: artifact.name, bytes: count, sha256: artifact.sha256 });
    } finally { await handle.close(); }
  }
  return results;
}
