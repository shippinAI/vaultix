import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePullRequest, validateEvidence, verifyAndReport, validateProtection } from './lib/pr-verification.mjs';

const head = 'a'.repeat(40), main = 'b'.repeat(40), image = `sha256:${'c'.repeat(64)}`;
const fixture = () => ({
  head, main, pr: { number: 3, state: 'open', draft: false, mergeable: true,
    head: { sha: head, repo: { full_name: 'shippinAI/vaultix' } },
    base: { sha: main, ref: 'main', repo: { full_name: 'shippinAI/vaultix' } } },
  build: { passed: true, revision: head, image: `vaultix:${head}`, imageId: image,
    steps: ['source-inventory', 'migration-map', 'login-failure-policy', 'owned-source', 'source-archive', 'extract-source',
      'canonical-image', 'image-identity', 'identity-lifetime', 'dragonfly-application', 'redis-application',
      'encrypted-recovery', 'tenant-isolation', 'proxy-boundary', 'admission-dragonfly', 'admission-redis']
      .map(name => ({ name, passed: true, exitCode: 0 })) },
  cli: { passed: true, revision: head, image, linuxTests: 101,
    checks: ['image-identity', 'vaultix-help', 'vaultix-login-help', 'vaultixl-help', 'vaultixl-login-help', 'linux-race', 'vet', 'packaged-cli'],
    cli: ['linux/amd64', 'windows/amd64'].map(platform => ({ platform, sha256: 'd'.repeat(64), files: [`${platform}/vaultix`, `${platform}/vaultixl`] })) }
});
test('required protected auto-merge policy cannot be silently absent', () => {
  const settings = { allow_auto_merge: true };
  const protection = { required_status_checks: { strict: true, contexts: ['vaultix/verified-source'] },
    enforce_admins: { enabled: true }, required_pull_request_reviews: { required_approving_review_count: 0 },
    allow_force_pushes: { enabled: false }, allow_deletions: { enabled: false } };
  validateProtection(settings, protection);
  assert.throws(() => validateProtection({ allow_auto_merge: false }, protection));
  for (const key of Object.keys(protection)) {
    const changed = structuredClone(protection); delete changed[key];
    assert.throws(() => validateProtection(settings, changed));
  }
  const changed = structuredClone(protection); changed.required_status_checks.strict = false;
  assert.throws(() => validateProtection(settings, changed));
});
test('complete independent fixture is accepted', () => {
  const f = fixture(); validatePullRequest(f.pr, head, main); validateEvidence(f.build, f.cli, head);
});
for (const [name, change] of [
  ['draft', f => f.pr.draft = true], ['fork', f => f.pr.head.repo.full_name = 'other/vaultix'],
  ['conflict', f => f.pr.mergeable = false], ['unresolved mergeability', f => f.pr.mergeable = null],
  ['wrong base', f => f.pr.base.ref = 'other'], ['changed head', f => f.pr.head.sha = 'f'.repeat(40)],
  ['changed main', f => f.pr.base.sha = 'f'.repeat(40)], ['closed', f => f.pr.state = 'closed']
]) test(`reject PR ${name}`, () => { const f = fixture(); change(f); assert.throws(() => validatePullRequest(f.pr, head, main)); });
for (const [name, change] of [
  ['failed build', f => f.build.passed = false], ['stale receipt', f => f.build.revision = main],
  ['fixture receipt', f => f.cli.fixtures = true], ['missing tenant boundary', f => f.build.steps.splice(12, 1)],
  ['failed stage', f => f.build.steps[0].exitCode = 1], ['duplicate stage', f => f.build.steps.push(f.build.steps[0])],
  ['wrong image', f => f.cli.image = `sha256:${'e'.repeat(64)}`], ['missing CLI consumer', f => f.cli.checks.pop()],
  ['zero executed tests', f => f.cli.linuxTests = 0], ['missing platform', f => f.cli.cli.pop()]
]) test(`reject evidence ${name}`, () => { const f = fixture(); change(f); assert.throws(() => validateEvidence(f.build, f.cli, head)); });
for (const scenario of ['success', 'verification failure', 'head race', 'base race', 'artifact change', 'status failure']) {
  test(`status publication: ${scenario}`, async () => {
    const f = fixture(), statuses = []; let inspection = 0;
    const run = verifyAndReport({
      inspect: async () => {
        inspection++;
        if (inspection === 2 && scenario === 'head race') f.pr.head.sha = main;
        if (inspection === 2 && scenario === 'base race') f.main = head;
        return f;
      },
      verify: async () => { if (scenario === 'verification failure') throw Error('fixture failure'); return f; },
      checkArtifacts: async () => { if (scenario === 'artifact change') throw Error('changed binary'); },
      status: async (state, sha) => {
        assert.equal(sha, head);
        if (state === 'success' && scenario === 'status failure') throw Error('publication refused');
        statuses.push(state);
      }
    });
    if (scenario === 'success') { assert.equal((await run).imageId, image); assert.deepEqual(statuses, ['pending', 'success']); }
    else { await assert.rejects(run); assert.deepEqual(statuses, ['pending', 'failure']); }
  });
}
