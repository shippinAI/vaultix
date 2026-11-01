import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getVaultixGuidance } from '../core/backend/src/services/vaultix/guidance.ts';
import { assertMediaBudget, mediaBudgets, mediaSpec, referenceStory, transcript } from '../core/media/story.mjs';

const document = getVaultixGuidance();
const story = referenceStory(document);
assert.deepEqual(story.map(step => step.target), ['reference-app', 'reference-environment', 'reference-path', 'reference-submit']);
assert.equal(mediaSpec.stepFrames * mediaSpec.steps / mediaSpec.fps, 24);
assert.match(transcript(story), /No live vault actions are performed/);
for (const step of story) assert.ok(transcript(story).includes(step.body));
for (const mutate of [
  data => { data.schemaVersion = 'unknown'; },
  data => { data.source = 'model'; },
  data => { data.guides[0].steps.pop(); },
  data => { data.guides[0].steps[0].target = 'execute-arbitrary-code'; },
  data => { data.guides[0].steps[0].component = 'iframe'; },
  data => { data.guides[0].steps[0].title = ''; },
  data => { data.guides[0].steps[0].hint = 'x'.repeat(1501); }
]) { const invalid = structuredClone(document); mutate(invalid); assert.throws(() => referenceStory(invalid)); }
for (const kind of ['video', 'poster']) {
  assertMediaBudget(kind, mediaBudgets[kind]);
  for (const bytes of [0, -1, NaN, 1.5, mediaBudgets[kind] + 1]) assert.throws(() => assertMediaBudget(kind, bytes));
}
assert.throws(() => assertMediaBudget('unknown', 1));
assert.throws(() => assertMediaBudget('toString', 1));
const pkg = JSON.parse(readFileSync(new URL('../core/media/package.json', import.meta.url)));
for (const dependency of ['remotion', '@remotion/renderer', '@remotion/bundler']) assert.equal(pkg.dependencies[dependency], '4.0.538');
const uiPackage = JSON.parse(readFileSync(new URL('../core/frontend/package.json', import.meta.url)));
assert.equal(Object.keys(uiPackage.dependencies).some(name => name.includes('remotion')), false);
const spec = readFileSync(new URL('../docs/0024-interaction-and-teaching-system.md', import.meta.url), 'utf8').replace(/\s+/g, ' ');
for (const obligation of ['Take over', 'replayed IDs', 'assistant provenance', 'real AI client']) assert.ok(spec.includes(obligation), obligation);
console.log('Media source/negative checks passed. Actual render and live assist remain separate evidence.');
