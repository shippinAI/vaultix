// Explicit trusted-operator invocation; no Actions runner, fetch or remote code checkout.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { repository, context, verifyAndReport, validateProtection } from './lib/pr-verification.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [number, goImage] = process.argv.slice(2);
assert.equal(process.argv.length, 4, 'Usage: node scripts/verify-pull-request.mjs PR_NUMBER LINUX_GO_TEST_IMAGE_ID');
assert.match(number, /^[1-9][0-9]*$/);
assert.match(goImage, /^sha256:[a-f0-9]{64}$/);
const run = (name, args, input) => execFileSync(name, args, {
  cwd: root, encoding: 'utf8', input, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024
}).trim();
const api = path => JSON.parse(run('gh', ['api', `repos/${repository}${path ? `/${path}` : ''}`]));
const git = args => run('git', args);
const digest = file => createHash('sha256').update(readFileSync(file)).digest('hex');
mkdirSync(resolve(root, '.cache'), { recursive: true });
const evidence = mkdtempSync(resolve(root, '.cache/pr-verification-'));
const report = { passed: false, number: Number(number), context, checks: [], sourceOnly: true };
const save = () => writeFileSync(resolve(evidence, 'result.json'), JSON.stringify(report, null, 2) + '\n');
const check = (name, executable, args) => {
  const fd = openSync(resolve(evidence, `${name}.log`), 'wx', 0o600);
  console.log(`Vaultix verification: ${name}`);
  let result;
  try { result = spawnSync(executable, args, { cwd: root, stdio: ['ignore', fd, fd], windowsHide: true }); }
  finally { closeSync(fd); }
  report.checks.push({ name, passed: result.status === 0 && !result.error }); save();
  assert.ok(result.status === 0 && !result.error, `${name} failed; inspect local evidence`);
};
try {
  const accepted = await verifyAndReport({
    inspect: async () => {
      validateProtection(api(''), api('branches/main/protection'));
      assert.equal(git(['status', '--porcelain=v1']), '', 'Use a clean reviewed checkout');
      const head = git(['rev-parse', 'HEAD']);
      const main = api('git/ref/heads/main').object.sha;
      git(['merge-base', '--is-ancestor', main, head]);
      return { head, main, pr: api(`pulls/${number}`) };
    },
    status: async (state, sha) => {
      const body = { state, context, description: state === 'success'
        ? 'Local canonical image and packaged CLI verified for this commit'
        : `Local Vaultix verification ${state}; no hosted Actions`,
      target_url: `https://github.com/${repository}/pull/${number}` };
      run('gh', ['api', '--method', 'POST', `repos/${repository}/statuses/${sha}`, '--input', '-'], JSON.stringify(body));
      if (state === 'pending') {
        run('gh', ['pr', 'merge', number, '--repo', repository, '--auto', '--merge', '--match-head-commit', sha]);
      }
    },
    verify: async ({ head }) => {
      report.revision = head; save();
      check('delivery-boundaries', process.execPath, ['--test', 'scripts/pr-verification.test.mjs', 'scripts/release-bundle.test.mjs']);
      const findBuilds = () => readdirSync(resolve(root, '.cache')).filter(name => name.startsWith('self-hosted-build-'))
        .map(name => resolve(root, '.cache', name, 'result.json'))
        .map(path => ({ path, data: JSON.parse(readFileSync(path)) }))
        .filter(({ data }) => data.revision === head && data.passed === true);
      if (findBuilds().length === 0) check('canonical', process.execPath, ['scripts/build-self-hosted.mjs']);
      const candidates = findBuilds();
      assert.ok(candidates.length > 0, 'Missing exact-candidate canonical receipt');
      const build = candidates.at(-1);
      check('canonical-artifacts', process.execPath, ['scripts/check-owned-dependency-image.mjs']);
      check('cli-build', process.execPath, ['scripts/build-cli.mjs']);
      check('cli-acceptance', process.execPath, ['scripts/test-cli-delivery.mjs', build.path, goImage]);
      // The baseline and Docker client image are explicitly provisioned on the
      // owned verifier. Candidate artifacts always come from this exact commit.
      const lifecycleInputs = resolve(root, '.cache/lifecycle-inputs.json');
      const provisioned = JSON.parse(readFileSync(lifecycleInputs));
      const builtCLI = JSON.parse(readFileSync(resolve(root, '.cache/committed-cli.json')));
      const linux = builtCLI.artifacts.find(a => a.platform === 'linux/amd64');
      assert.ok(linux && builtCLI.revision === head && builtCLI.passed);
      writeFileSync(lifecycleInputs, JSON.stringify({ baselineReceipt: provisioned.baselineReceipt,
        clientImage: provisioned.clientImage, candidateReceipt: build.path, cli: linux.files[0], development: false }, null, 2) + '\n', { mode: 0o600 });
      check('server-lifecycle', process.execPath, ['scripts/test-server-lifecycle.mjs']);
      const lifecyclePath = resolve(root, '.cache/lifecycle-acceptance.json');
      const lifecycle = JSON.parse(readFileSync(lifecyclePath));
      assert.ok(lifecycle.passed && lifecycle.cleanupPassed && !lifecycle.development);
      assert.equal(lifecycle.revision, head);
      assert.equal(lifecycle.candidate, build.data.imageId);
      assert.equal(lifecycle.cliSha256, linux.sha256);
      writeFileSync(resolve(root, '.cache/download-inputs.json'), JSON.stringify({ clientImage: goImage, development: false }, null, 2) + '\n', { mode: 0o600 });
      check('release-download', process.execPath, ['scripts/test-release-download.mjs']);
      const downloadPath = resolve(root, '.cache/download-acceptance.json');
      const downloaded = JSON.parse(readFileSync(downloadPath));
      assert.ok(downloaded.passed && downloaded.cleanupPassed && !downloaded.development);
      assert.equal(downloaded.revision, head);
      assert.equal(downloaded.cliSha256, linux.sha256);
      report.canonicalReceipt = build.path;
      const cliPath = resolve(root, '.cache/cli-domain-acceptance.json');
      report.receipts = [build.path, cliPath, lifecyclePath, downloadPath].map(path => ({ path, sha256: digest(path) }));
      return { build: build.data, cli: JSON.parse(readFileSync(cliPath)) };
    },
    checkArtifacts: async ({ imageId, revision }, cli) => {
      assert.equal(run('docker', ['image', 'inspect', '--format', '{{.Id}}', `vaultix:${revision}`]), imageId);
      for (const artifact of cli.cli) for (const path of artifact.files) assert.equal(digest(path), artifact.sha256);
    }
  });
  Object.assign(report, accepted, { passed: true });
  console.log(JSON.stringify({ ...accepted, passed: true, evidence, sourceOnly: true }));
} catch (error) {
  console.error(`Verification failed. Inspect ${evidence}; no success should be inferred.`);
  report.error = error instanceof assert.AssertionError ? error.message.slice(0, 250) : 'Verification operation failed';
  process.exitCode = 1;
} finally { save(); }
