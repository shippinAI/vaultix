import assert from 'node:assert/strict';

export const recordedTitles = ['Your project workspace','Give your project a home','Your application, organized','Learn by watching the controls'];
export const recordedCaptions = [
  'Start in your organization. Open Secrets Management to choose a project.',
  'Give the project a clear name. The real application creates it when you confirm.',
  'Your new project opens with its environments and an empty, ready-to-use workspace.',
  'Open Clyffy. The scripted guide selects scope and requests reference names through authorized actions. Take over whenever you like.'
];
export function validateRecording(value) {
  assert.equal(value?.schemaVersion,'vaultix.recording.v1');
  assert.equal(value.passed,true);assert.equal(value.cleanupPassed,true);assert.equal(value.credentialsRecorded,false);
  assert.equal(value.width,1600);assert.equal(value.height,900);
  assert.match(value.backend?.id??'',/^sha256:[a-f0-9]{64}$/);assert.match(value.backend?.revision??'',/^[a-f0-9]{40}$/);
  assert.equal(value.raw?.name,'workflow.webm');assert.match(value.raw.sha256,/^[a-f0-9]{64}$/);
  assert.ok(Array.isArray(value.frontend)&&value.frontend.length>0&&value.frontend.length<10000);
  for(const file of value.frontend){assert.match(file.path,/^core\/frontend\/src\/[A-Za-z0-9_.$/()@ -]+$/);assert.ok(!file.path.split('/').includes('..'));assert.match(file.sha256,/^[a-f0-9]{64}$/);}
  assert.ok(Array.isArray(value.chapters));assert.equal(value.chapters.length,4);
  let previous=-1;
  for(const [index,chapter]of value.chapters.entries()) {assert.equal(chapter.title,recordedTitles[index]);assert.ok(Number.isFinite(chapter.startSeconds)&&chapter.startSeconds>previous);previous=chapter.startSeconds;}
  assert.ok(Number.isFinite(value.endSeconds)&&value.endSeconds>previous&&value.endSeconds<180);
  assert.ok(value.endSeconds-value.chapters[0].startSeconds<90);
  return value;
}
