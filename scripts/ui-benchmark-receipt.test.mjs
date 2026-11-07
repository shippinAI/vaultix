import assert from 'node:assert/strict';
import test from 'node:test';
import {readReceipt, summary, validateReceipt} from './lib/ui-benchmark-receipt.mjs';

const fixturePath = 'docs/interaction/ui-benchmark-receipt.example.v1.json';

test('benchmark receipt fixture validates and summarizes', () => {
  const receipt = readReceipt(fixturePath);
  const validated = validateReceipt(receipt);
  assert.equal(validated.schema_version, 'vaultix.ui-benchmark-receipt.v1');
  assert.equal(summary(validated).winner, 'scripted-events');
});

test('receipt fails when parity gate is invalid', () => {
  const receipt = readReceipt(fixturePath);
  receipt.parity_gate.valid = false;
  assert.throws(() => validateReceipt(receipt), /Parity gate must be true/);
});

test('receipt fails when methods are incomplete', () => {
  const receipt = readReceipt(fixturePath);
  receipt.runs = [receipt.runs[0]];
  assert.throws(() => validateReceipt(receipt), /Invalid benchmark receipt|include scripted-events and playwright/);
});

test('receipt fails on forbidden key leakage', () => {
  const receipt = readReceipt(fixturePath);
  receipt.anti_gaming.notes = 'token=synthetic-canary';
  assert.throws(() => validateReceipt(receipt), /Forbidden content/);
});
