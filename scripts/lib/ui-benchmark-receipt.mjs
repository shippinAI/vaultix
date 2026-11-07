import {readFileSync} from 'node:fs';
import Ajv2020 from '../../.ai/node_modules/ajv/dist/2020.js';
import addFormats from '../../.ai/node_modules/ajv-formats/dist/index.js';

export const schema = JSON.parse(readFileSync(new URL('../../contracts/vaultix.ui-benchmark-receipt.v1.schema.json', import.meta.url)));
const ajv = new Ajv2020({strict: true, allErrors: true});
addFormats(ajv);
const validate = ajv.compile(schema);
const check = (condition, message) => {
  if (!condition) throw new Error(message);
};

const forbiddenKey = /(^|_)(secret|password|credential)(_|$)|(^|_)(access|refresh|id)_token$|private[-_]?key|mfa(_|$)|otp(_|$)/i;
const forbiddenContent = /(-----BEGIN [A-Z ]+-----|password=|token=|secret=|api[-_]?key=)/i;
const walk = (value, path = '$') => {
  if (typeof value === 'string') {
    if (forbiddenContent.test(value)) throw new Error(`Forbidden content in receipt payload: ${path}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (forbiddenKey.test(key) && key !== 'secret_scan_clean') {
      throw new Error(`Forbidden key in receipt payload: ${path}.${key}`);
    }
    walk(item, `${path}.${key}`);
  }
};

export const readReceipt = (path) => JSON.parse(readFileSync(path, 'utf8'));

export function validateReceipt(receipt) {
  check(validate(receipt), `Invalid benchmark receipt: ${ajv.errorsText(validate.errors)}`);
  check(receipt.parity_gate.valid, 'Parity gate must be true for a valid benchmark receipt');
  check(receipt.evidence.secret_scan_clean, 'Evidence must confirm secret scan clean');
  const methods = receipt.runs.map((run) => run.method).sort().join(',');
  check(methods === 'playwright,scripted-events', 'Runs must include scripted-events and playwright exactly once');
  walk(receipt);
  return receipt;
}

export function summary(receipt) {
  validateReceipt(receipt);
  const scripted = receipt.runs.find((run) => run.method === 'scripted-events');
  const playwright = receipt.runs.find((run) => run.method === 'playwright');
  return {
    workflow: receipt.workflow.workflow_id,
    surface: receipt.workflow.surface,
    winner: receipt.summary.winner,
    scriptedLatencyMs: scripted.latency_ms,
    playwrightLatencyMs: playwright.latency_ms,
    tokenReductionPercent: receipt.summary.token_reduction_percent
  };
}
