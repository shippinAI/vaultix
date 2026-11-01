import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { getVideoMetadata, openBrowser, renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import { getVaultixGuidance } from '../backend/src/services/vaultix/guidance.ts';
import { assertMediaBudget, mediaSpec, referenceStory, transcript } from './story.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const fingerprint = name => createHash('sha256').update(readFileSync(resolve(root, name))).digest('hex');
const sourcePaths = ['core/media/package.json', 'core/media/package-lock.json', 'core/media/src/index.tsx', 'core/media/render.mjs', 'core/media/story.mjs', 'core/backend/src/services/vaultix/guidance.ts', 'core/frontend/src/theme.css', 'core/frontend/public/images/vaultix-mark.svg'];
const sources = sourcePaths.map(path => ({ path, sha256: fingerprint(path) }));
mkdirSync(resolve(root, '.cache'), { recursive: true });
const output = mkdtempSync(resolve(root, '.cache/vaultix-media-'));
const assets = resolve(output, 'assets');
mkdirSync(assets, { recursive: true });
copyFileSync(resolve(here, '../frontend/public/images/vaultix-mark.svg'), resolve(assets, 'vaultix-mark.svg'));
for (const [weight, file] of [[400, 'inter.woff2'], [600, 'inter-semibold.woff2']]) {
  copyFileSync(resolve(here, `../frontend/node_modules/@fontsource/inter/files/inter-latin-${weight}-normal.woff2`), resolve(assets, file));
}
const theme = readFileSync(resolve(here, '../frontend/src/theme.css'), 'utf8');
const palette = Object.fromEntries(['background', 'foreground', 'card', 'project', 'muted', 'border'].map(name => {
  const value = theme.match(new RegExp(`--color-${name}:\\s*(#[0-9a-f]{6});`, 'i'))?.[1];
  assert.ok(value, `Missing semantic color ${name}; review media theme`);
  return [name, value];
}));
const serveUrl = await bundle({ entryPoint: resolve(here, 'src/index.tsx'), publicDir: assets, outDir: resolve(output, 'bundle') });
const inputProps = { palette };
const puppeteerInstance = await openBrowser('chrome', { browserExecutable: process.env.VAULTIX_MEDIA_BROWSER || undefined });
const video = resolve(output, 'vaultix-references.mp4');
const poster = resolve(output, 'vaultix-references.png');
try {
  const composition = await selectComposition({ serveUrl, id: mediaSpec.id, inputProps, puppeteerInstance });
  await renderMedia({ serveUrl, composition, inputProps, puppeteerInstance, codec: 'h264', pixelFormat: 'yuv420p', crf: 24, concurrency: 2, outputLocation: video });
  await renderStill({ serveUrl, composition, inputProps, puppeteerInstance, frame: 35, imageFormat: 'png', output: poster });
  for (let step = 0; step < mediaSpec.steps; step++) {
    await renderStill({ serveUrl, composition, inputProps, puppeteerInstance, frame: step * mediaSpec.stepFrames + 35, imageFormat: 'png', output: resolve(output, `step-${step + 1}.png`) });
  }
} finally {
  await puppeteerInstance.close({ silent: true });
}
assertMediaBudget('video', statSync(video).size);
assertMediaBudget('poster', statSync(poster).size);
const metadata = await getVideoMetadata(video);
assert.equal(metadata.width, mediaSpec.width);
assert.equal(metadata.height, mediaSpec.height);
assert.equal(metadata.fps, mediaSpec.fps);
assert.equal(metadata.durationInSeconds, mediaSpec.stepFrames * mediaSpec.steps / mediaSpec.fps);
const story = referenceStory(getVaultixGuidance());
writeFileSync(resolve(output, 'transcript.md'), transcript(story));
const stamp = seconds => `00:00:${String(seconds).padStart(2, '0')}.000`;
writeFileSync(resolve(output, 'captions.vtt'), 'WEBVTT\n\n' + story.map((step, i) => `${i + 1}\n${stamp(i * 6)} --> ${stamp((i + 1) * 6)}\n${step.title}\n${step.hint}\n`).join('\n'));
const files = ['vaultix-references.mp4', 'vaultix-references.png', 'transcript.md', 'captions.vtt'].map(name => ({ name, bytes: statSync(resolve(output, name)).size, sha256: createHash('sha256').update(readFileSync(resolve(output, name))).digest('hex') }));
for (const source of sources) assert.equal(fingerprint(source.path), source.sha256, `Source changed while rendering: ${source.path}`);
const receipt = { schemaVersion: 'vaultix.media.receipt.v1', remotion: '4.0.538', composition: mediaSpec.id, sources, metadata, files, scope: 'Authored illustration only; no live assist or server acceptance', renderedAt: new Date().toISOString() };
writeFileSync(resolve(output, 'result.json'), JSON.stringify(receipt, null, 2) + '\n');
writeFileSync(resolve(root, '.cache/vaultix-media-latest.json'), JSON.stringify({ output, receipt: resolve(output, 'result.json') }, null, 2) + '\n');
console.log(JSON.stringify({ output, files, durationSeconds: metadata.durationInSeconds }, null, 2));
