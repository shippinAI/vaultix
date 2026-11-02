import assert from 'node:assert/strict';
import { openSync, readSync, closeSync, fstatSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseCanonical, verifyManifest, verifyArtifacts } from './lib/release-bundle.mjs';

const [directory, trustFile, checkpointFile] = process.argv.slice(2);
assert.ok(directory && trustFile && process.argv.length <= 5,
  'Usage: node scripts/verify-release-bundle.mjs BUNDLE_DIRECTORY TRUST_FILE [PREVIOUS_CHECKPOINT]');
function readBounded(path, max) {
  const fd = openSync(path, 'r');
  try {
    assert.ok(fstatSync(fd).isFile(), 'Metadata must be a regular file');
    const bytes = Buffer.alloc(max + 1); let size = 0, count;
    while (size < bytes.length && (count = readSync(fd, bytes, size, bytes.length - size, null)) > 0) size += count;
    assert.ok(size <= max, 'Metadata too large'); return bytes.subarray(0, size);
  } finally { closeSync(fd); }
}
try {
  const { manifest, checkpoint } = verifyManifest(
    readBounded(resolve(directory, 'release-manifest.json'), 65536),
    readBounded(resolve(directory, 'release-signature.json'), 4096),
    readBounded(trustFile, 16384),
    { previous: checkpointFile ? parseCanonical(readBounded(checkpointFile, 4096), 4096) : null }
  );
  const artifacts = await verifyArtifacts(manifest, directory);
  console.log(JSON.stringify({ verified: true, version: manifest.version, revision: manifest.revision,
    channel: manifest.channel, checkpoint, artifacts, installed: false,
    limitations: ['No installation, schema compatibility execution or automatic trust rotation',
      checkpointFile ? 'Caller must durably retain the accepted checkpoint' : 'First-use verification; no prior replay checkpoint supplied'] }));
} catch {
  console.error('Vaultix release verification failed. No software was installed or trust state changed.');
  process.exitCode = 1;
}
