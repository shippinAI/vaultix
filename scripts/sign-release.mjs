import assert from 'node:assert/strict';
import { readPublicationFile } from './lib/release-publication.mjs';
import { signRelease } from './lib/release-preparation.mjs';
import { runSigner } from './lib/release-producer-process.mjs';

const usage = 'Usage: node scripts/sign-release.mjs INPUTS.json\nINPUTS: bundle, acceptance, trust, keyId, signer { executable (absolute), args }. The owner-provisioned signer reads canonical bytes on stdin and returns exactly 64 raw Ed25519 signature bytes on stdout. No shell, key creation, implicit trust or publication.';
if (process.argv[2] === '--help') { console.log(usage); process.exit(0); }
try {
  assert.ok(process.argv.length === 3, usage);
  const inputs = JSON.parse(readPublicationFile(process.argv[2], 16384));
  console.log(JSON.stringify(await signRelease(inputs, runSigner), null, 2));
} catch {
  console.error('Release signing was not accepted. Check independently provisioned trust, accepted bundle and signer access. Raw signer diagnostics are withheld. No existing signature was overwritten.');
  process.exitCode = 1;
}
