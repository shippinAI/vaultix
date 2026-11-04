import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkLatestStable, loadPublication, publishRelease, readPublicationFile } from './lib/release-publication.mjs';
import { repository } from './lib/pr-verification.mjs';

const usage = 'Usage: node scripts/publish-release.mjs INPUTS.json [--plan|--draft|--stage|--publish]\nINPUTS: bundle, trust, acceptance, notes; optional checkpoint. --stage publishes for explicit download without selecting latest. Stable --publish promotes already staged, verified bytes. No keys are generated or uploaded.';
if (process.argv[2] === '--help') { console.log(usage); process.exit(0); }
const [inputsFile, option = '--plan'] = process.argv.slice(2);
assert.ok(inputsFile && process.argv.length <= 4 && ['--plan', '--draft', '--stage', '--publish'].includes(option), usage);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const command = (exe, args, input) => {
  const result = spawnSync(exe, args, { cwd: root, input, encoding: 'utf8', windowsHide: true, timeout: 15 * 60_000, maxBuffer: 4 * 1024 * 1024 });
  // Never print tool stderr: an authenticated transport can contain private diagnostics.
  assert.ok(!result.error, `${exe} could not complete; no success is inferred`);
  return result;
};
const git = args => { const result = command('git', args); assert.equal(result.status, 0, 'Local source check failed'); return result.stdout.trim(); };
const api = (path, method = 'GET', body, missing = false) => {
  const args = ['api', '--hostname', 'github.com', '--method', method, `repos/${repository}${path ? `/${path}` : ''}`];
  if (body) args.push('--input', '-');
  const result = command('gh', args, body ? JSON.stringify(body) : undefined);
  if (result.status !== 0) {
    let status; try { status = JSON.parse(result.stdout).status; } catch { /* Fail closed. */ }
    if (missing && Number(status) === 404) return null;
    throw new Error('GitHub operation failed; retain any draft and retry after checking access');
  }
  return JSON.parse(result.stdout);
};
try {
  const inputs = JSON.parse(readPublicationFile(inputsFile, 16384));
  assert.deepEqual(Object.keys(inputs).filter(k => k !== 'checkpoint').sort(), ['acceptance', 'bundle', 'notes', 'trust']);
  const notes = new TextDecoder('utf-8', { fatal: true }).decode(readPublicationFile(inputs.notes, 65536));
  assert.ok(notes.trim(), 'Release notes are required');
  const plan = await loadPublication(inputs);
  const io = {
    verifySource: async p => {
      assert.equal(api('').private, false, 'Public acquisition requires a public repository');
      assert.equal(git(['status', '--porcelain=v1']), '', 'Publication requires a clean reviewed checkout');
      assert.equal(git(['rev-parse', 'HEAD']), p.revision);
      assert.equal(git(['rev-parse', `${p.tag}^{commit}`]), p.revision, 'Local release tag differs');
      let object = api(`git/ref/tags/${encodeURIComponent(p.tag)}`).object;
      for (let count = 0; object?.type === 'tag' && count < 4; count++) object = api(`git/tags/${object.sha}`).object;
      assert.equal(object?.type, 'commit');
      assert.equal(object.sha, p.revision, 'Remote tag differs; publication does not create or move tags');
      const comparison = api(`compare/${p.revision}...main`);
      assert.equal(comparison.merge_base_commit?.sha, p.revision, 'Release source must already be merged into main');
      checkLatestStable(p, api('releases/latest', 'GET', undefined, true));
    },
    getRelease: async tag => api(`releases/tags/${encodeURIComponent(tag)}`, 'GET', undefined, true),
    createDraft: async p => api('releases', 'POST', { tag_name: p.tag, target_commitish: p.revision,
      name: `Vaultix ${p.tag.slice(1)}`, body: notes, draft: true, prerelease: p.preview }),
    upload: async (p, asset) => {
      const result = command('gh', ['release', 'upload', p.tag, resolve(p.directory, asset.name), '--repo', `https://github.com/${repository}`]);
      assert.equal(result.status, 0, 'Asset upload failed; matching draft assets can be resumed without overwrite');
    },
    revalidate: async p => assert.deepEqual(await loadPublication(inputs), p, 'Signed bundle or acceptance changed during upload'),
    publish: async (id, p, latest) => {
      assert.ok(!latest || !p.preview, 'A signed preview cannot become the stable latest release');
      return api(`releases/${id}`, 'PATCH', { draft: false, make_latest: latest ? 'true' : 'false' });
    },
    verifyVisibility: async (p, selected) => {
      const latest = api('releases/latest', 'GET', undefined, true);
      assert.equal(latest?.tag_name === p.tag, selected, 'GitHub latest discovery does not match the selected publication stage');
    }
  };
  console.log(JSON.stringify(await publishRelease(plan, io, option.slice(2)), null, 2));
} catch (error) {
  console.error(error instanceof assert.AssertionError ? error.message.split('\n')[0] : 'Publication input or GitHub operation failed. Raw diagnostics withheld.');
  console.error('Publication was not accepted. No delete or overwrite was attempted. Inspect the remote release before retrying; a lost response can follow successful publication.');
  process.exitCode = 1;
}
