// Independent target-process oracle: record launch before checking consumption.
// Print neither the supplied secret nor its digest.
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const [marker, expected] = process.argv.slice(2);
writeFileSync(marker, 'started', { flag: 'wx', mode: 0o600 });
const digest = createHash('sha256').update(process.env.CLI_REFERENCE ?? '').digest('hex');
if (digest !== expected) process.exitCode = 41;
