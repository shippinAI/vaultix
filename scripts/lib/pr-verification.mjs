import assert from 'node:assert/strict';

export const repository = 'vaultix-cloud/vaultix';
export const context = 'vaultix/verified-source';
export const canonicalStages = [
  'source-inventory', 'migration-map', 'login-failure-policy', 'owned-source',
  'source-archive', 'extract-source', 'canonical-image', 'image-identity',
  'identity-lifetime', 'dragonfly-application', 'redis-application',
  'encrypted-recovery', 'tenant-isolation', 'proxy-boundary',
  'admission-dragonfly', 'admission-redis'
];
export const cliChecks = [
  'image-identity', 'vaultix-help', 'vaultix-login-help', 'vaultixl-help',
  'vaultixl-login-help', 'linux-race', 'vet', 'packaged-cli'
];

export function validateProtection(settings, protection) {
  assert.equal(settings.allow_auto_merge, true, 'Repository auto-merge is disabled');
  assert.equal(protection.required_status_checks?.strict, true, 'Require an up-to-date base');
  assert.ok(protection.required_status_checks.contexts?.includes(context), 'Missing required local verification');
  assert.equal(protection.enforce_admins?.enabled, true, 'Apply the gate to administrators');
  assert.ok(protection.required_pull_request_reviews, 'Changes must use pull requests');
  assert.equal(protection.allow_force_pushes?.enabled, false);
  assert.equal(protection.allow_deletions?.enabled, false);
}

export function validatePullRequest(pr, head, main) {
  assert.match(head, /^[a-f0-9]{40}$/);
  assert.match(main, /^[a-f0-9]{40}$/);
  assert.equal(pr.state, 'open', 'PR must be open');
  assert.equal(pr.draft, false, 'Review the candidate before enabling verification');
  assert.equal(pr.head?.repo?.full_name, repository, 'Unreviewed fork execution is not supported');
  assert.equal(pr.base?.repo?.full_name, repository);
  assert.equal(pr.base.ref, 'main');
  assert.equal(pr.base.sha, main, 'Main changed; reconcile and verify again');
  assert.equal(pr.head.sha, head, 'PR head changed; verify the new commit');
  assert.equal(pr.mergeable, true, 'PR must be conflict-free and mergeability resolved');
  return { head, main, number: pr.number };
}

export function validateEvidence(build, cli, head) {
  for (const receipt of [build, cli]) {
    assert.equal(receipt.passed, true, 'Failed verification cannot be published');
    assert.equal(receipt.revision, head, 'Evidence belongs to a different commit');
    assert.notEqual(receipt.fixtures, true, 'Fixture evidence is not release acceptance');
  }
  assert.match(build.imageId, /^sha256:[a-f0-9]{64}$/);
  assert.equal(build.image, `vaultix:${head}`);
  assert.equal(cli.image, build.imageId, 'CLI must be exercised against the tested image');
  assert.ok(Array.isArray(build.steps));
  assert.equal(new Set(build.steps.map(s => s.name)).size, build.steps.length, 'Duplicate stage');
  for (const name of canonicalStages) {
    assert.ok(build.steps.some(s => s.name === name && s.passed === true && s.exitCode === 0), `Missing ${name}`);
  }
  assert.ok(build.steps.every(s => s.passed === true && s.exitCode === 0));
  for (const name of cliChecks) assert.ok(cli.checks?.includes(name), `Missing CLI check ${name}`);
  assert.ok(Number.isSafeInteger(cli.linuxTests) && cli.linuxTests > 0, 'Missing Linux test execution');
  assert.deepEqual(cli.cli?.map(a => a.platform).sort(), ['linux/amd64', 'windows/amd64']);
  for (const artifact of cli.cli) {
    assert.match(artifact.sha256, /^[a-f0-9]{64}$/);
    assert.equal(artifact.files.length, 2);
    assert.equal(new Set(artifact.files).size, 2);
  }
  return { imageId: build.imageId, revision: head };
}

// The driver supplies trusted local execution and live GitHub reads. A failed or
// raced verification never publishes success. Local operator receipts are not
// independently signed CI attestations; GitHub credentials remain outside tests.
export async function verifyAndReport(io) {
  const initial = await io.inspect();
  validatePullRequest(initial.pr, initial.head, initial.main);
  await io.status('pending', initial.head);
  try {
    const { build, cli } = await io.verify(initial);
    const accepted = validateEvidence(build, cli, initial.head);
    const final = await io.inspect();
    assert.equal(final.head, initial.head, 'Local source changed');
    assert.equal(final.main, initial.main, 'Main changed during verification');
    validatePullRequest(final.pr, initial.head, initial.main);
    await io.checkArtifacts(accepted, cli);
    await io.status('success', initial.head);
    return accepted;
  } catch (error) {
    try { await io.status('failure', initial.head); } catch { /* Never convert failure to success. */ }
    throw error;
  }
}
