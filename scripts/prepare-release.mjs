import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPublicationFile } from './lib/release-publication.mjs';
import { prepareRelease } from './lib/release-preparation.mjs';
import { sourceAdapter } from './lib/release-producer-process.mjs';

const usage = 'Usage: node scripts/prepare-release.mjs INPUTS.json\nINPUTS: acceptance, output (new directory), sbom (reviewed archive), sequence, issuedAt, expiresAt, migration. Uses accepted CLI files, immutable Docker image and exact local source tag. Never signs or publishes.';
if (process.argv[2] === '--help') { console.log(usage); process.exit(0); }
try {
  assert.ok(process.argv.length === 3, usage);
  const inputs = JSON.parse(readPublicationFile(process.argv[2], 16384));
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  console.log(JSON.stringify(await prepareRelease(inputs, sourceAdapter(root)), null, 2));
} catch {
  console.error('Release preparation failed. Inspect inputs, acceptance, local tag and engine. Existing outputs were not overwritten; partial new output is retained without an accepted manifest.');
  process.exitCode = 1;
}
