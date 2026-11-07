#!/usr/bin/env node
import {summary, readReceipt} from './lib/ui-benchmark-receipt.mjs';

try {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--receipt') throw new Error('Use --receipt PATH');
  const receipt = readReceipt(args[1]);
  console.log(JSON.stringify(summary(receipt), null, 2));
} catch (error) {
  console.error(JSON.stringify({error: error.message}));
  process.exitCode = 1;
}
