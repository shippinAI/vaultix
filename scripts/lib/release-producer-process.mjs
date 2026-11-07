// Operator-configured tools only. Downloaded manifests never select executables.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { boundedAsset } from './release-preparation.mjs';

export function runSigner(bytes, config, timeout = 60000) {
  return new Promise((resolve, reject) => {
    const child = spawn(config.executable, config.args, { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    let failure, count = 0;
    const chunks = [];
    const fail = () => {
      failure = new Error('External signer failed, exceeded its limit or timed out');
      child.kill('SIGKILL'); child.stdin.destroy(); child.stdout.destroy();
    };
    const timer = setTimeout(fail, timeout);
    child.on('error', fail);
    child.stdin.on('error', fail);
    child.stdout.on('error', fail);
    child.stdout.on('data', chunk => {
      count += chunk.length;
      if (count > 64) fail();
      else chunks.push(chunk);
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (failure || code !== 0 || count !== 64) reject(failure ?? new Error('External signer did not return a complete signature'));
      else resolve(Buffer.concat(chunks));
    });
    child.stdin.end(bytes);
  });
}

// Exports stream into an exclusive file; failure retains a partial archive but
// preparation never writes its manifest. Stderr is not exposed in receipts.
export async function exportArchive(executable, args, target, cwd, timeout = 30 * 60000) {
  const child = spawn(executable, args, { cwd, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  let failed = false;
  const timer = setTimeout(() => { failed = true; child.kill('SIGKILL'); child.stdout.destroy(); }, timeout);
  const exited = new Promise(resolve => {
    child.on('error', () => { failed = true; });
    child.on('close', code => resolve(code));
  });
  try {
    await pipeline(child.stdout, createGzip({ level: 1 }), boundedAsset(), createWriteStream(target, { flags: 'wx', mode: 0o600 }));
  } catch {
    failed = true; child.kill('SIGKILL'); child.stdout.destroy();
  }
  const code = await exited;
  clearTimeout(timer);
  assert.ok(!failed && code === 0, 'Artifact export failed; partial output was retained without a manifest');
}

export function sourceAdapter(root) {
  const command = (exe, args) => {
    const result = spawnSync(exe, args, { cwd: root, shell: false, windowsHide: true, encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024 });
    assert.ok(!result.error && result.status === 0, 'Local release source inspection failed');
    return result.stdout.trim();
  };
  return {
    verifySource: async build => {
      assert.equal(command('git', ['rev-parse', `v${build.platformVersion}^{commit}`]), build.revision, 'Exact local source tag is required');
      const [image] = JSON.parse(command('docker', ['image', 'inspect', build.imageId]));
      assert.equal(image.Id, build.imageId);
      assert.equal(image.Os, 'linux'); assert.equal(image.Architecture, 'amd64');
      assert.equal(image.Config?.Labels?.['org.opencontainers.image.revision'], build.revision, 'Engine source label differs');
      assert.equal(image.Config?.Labels?.['org.opencontainers.image.version'], build.platformVersion, 'Engine version label differs');
    },
    exportEngine: (build, target) => exportArchive('docker', ['image', 'save', build.imageId], target, root),
    exportSource: (build, target) => exportArchive('git', ['-c', 'core.autocrlf=false', '-c', 'core.eol=lf', 'archive', '--format=tar', `--prefix=vaultix-${build.platformVersion}/`, build.revision], target, root)
  };
}
