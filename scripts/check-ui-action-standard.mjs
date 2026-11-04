#!/usr/bin/env node
import {readFileSync} from 'node:fs';
import {readManifest, discoverySummary} from './lib/ui-action-standard.mjs';

try {
  const args = process.argv.slice(2);
  const options = {};
  while (args.length) {
    const key = args.shift();
    if (!['--domain','--manifest'].includes(key) || !args.length || options[key]) throw new Error('Use --domain NAME and/or --manifest PATH');
    options[key] = args.shift();
  }
  const manifest = options['--manifest'] ? JSON.parse(readFileSync(options['--manifest'],'utf8')) : readManifest();
  console.log(JSON.stringify(discoverySummary(manifest,options['--domain']),null,2));
} catch (error) {
  // Offline authored metadata only. Do not use this CLI to inspect real credential payloads.
  console.error(JSON.stringify({error:error.message}));
  process.exitCode = 1;
}
