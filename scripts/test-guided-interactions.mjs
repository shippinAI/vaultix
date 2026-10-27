import assert from "node:assert/strict";
import { initialGuideState, reduceGuide } from "../core/frontend/src/components/vaultix/guidance-state.ts";
import { getVaultixGuidance } from "../core/backend/src/services/vaultix/guidance.ts";

for (const guide of getVaultixGuidance().guides) {
  let state = { ...initialGuideState, history: [] };
  const send = type => { state = reduceGuide(guide, state, { type, stepId: guide.steps[state.index].id }); };
  const original = state;
  for (const invalid of [null, [], {}, { type: "next", stepId: guide.steps[0].id },
    { type: "open", stepId: "unknown" }, { type: "execute", stepId: guide.steps[0].id },
    { type: "open", stepId: guide.steps[0].id, value: "MUST-NOT-STORE" }]) {
    assert.equal(reduceGuide(guide, state, invalid), original);
  }
  send("open");
  send("previous");
  assert.equal(state.index, 0);
  send("finish");
  assert.equal(state.reviewed, false);
  send("next");
  const stale = reduceGuide(guide, state, { type: "next", stepId: guide.steps[0].id });
  assert.equal(stale, state);
  send("dismiss");
  assert.equal(state.open, false);
  send("open");
  assert.equal(state.index, 1);
  while (state.index < guide.steps.length - 1) send("next");
  const atLastStep = state;
  send("next");
  assert.equal(state, atLastStep);
  send("finish");
  assert.equal(state.reviewed, true);
  assert.equal(state.open, false);
  send("open");
  send("restart");
  assert.equal(state.index, 0);
  assert.equal(state.reviewed, false);
  send("focus");
  assert.equal(state.open, false);
  const focused = state;
  send("next");
  assert.equal(state, focused);
  send("open");
  for (let index = 0; index < 20; index++) { send("next"); send("previous"); }
  assert.equal(state.history.length, 8);
  assert.equal(JSON.stringify(state).includes("MUST-NOT-STORE"), false);
}
console.log("Guided interaction tests passed: event rejection, bounds, stale events, pause/resume, completion and bounded metadata history.");
