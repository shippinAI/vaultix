export const mediaSpec = Object.freeze({ id: 'VaultixReferences', width: 1600, height: 900, fps: 30, stepFrames: 180, steps: 4 });
export const mediaBudgets = Object.freeze({ video: 5 * 1024 * 1024, poster: 512 * 1024 });
const targets = ['reference-app', 'reference-environment', 'reference-path', 'reference-submit'];

export function referenceStory(document) {
  if (document?.schemaVersion !== 'vaultix.guidance.v1' || document.source !== 'catalog') throw new Error('Unsupported guidance document');
  const guide = document.guides?.find(entry => entry.id === 'references');
  if (!guide || guide.steps.length !== mediaSpec.steps) throw new Error('Reference lesson changed; review the media');
  return guide.steps.map((step, index) => {
    if (step.target !== targets[index] || step.component !== 'configure-step' ||
        ![step.title, step.hint, step.body, step.teaches].every(value => typeof value === 'string' && value.length > 0 && value.length <= 1500)) {
      throw new Error('Unsupported reference lesson step');
    }
    return { id: step.id, target: step.target, title: step.title, hint: step.hint, body: step.body, teaches: step.teaches };
  });
}

export function assertMediaBudget(kind, bytes) {
  if (!Object.hasOwn(mediaBudgets, kind) || !Number.isSafeInteger(bytes) || bytes < 1 || bytes > mediaBudgets[kind]) throw new Error('Media output exceeds its budget or is empty');
}

export function transcript(story) {
  return '# Vaultix: find a secret reference\n\nWorkflow illustration using example project data. No live vault actions are performed.\n\n' +
    story.map((step, index) => `## ${index + 1}. ${step.title}\n\n${step.body}\n\n${step.teaches}\n`).join('\n');
}
