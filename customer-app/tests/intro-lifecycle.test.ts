import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createIntroLifecycle } from '../integration/intro-lifecycle';

function fixture() {
  let released = false; let paused = 0; let played = 0; let completed = 0;
  const guard = () => { if (released) throw new Error('Cannot use shared object that was already released'); };
  const player = { pause() { guard(); paused++; }, play() { guard(); played++; }, get status() { guard(); return 'readyToPlay'; } };
  let presentations = 0;
  const lifecycle = createIntroLifecycle(player, () => completed++, () => presentations++);
  const show = () => { lifecycle.activate(); lifecycle.appStateChanged('active'); lifecycle.reduceMotionChanged(false); };
  return { lifecycle, show, presentations: () => presentations, release() { released = true; }, counts: () => ({ paused, played, completed }) };
}
test('hook releases before application cleanup: cleanup and late callbacks never access the released object', () => {
  const f = fixture(); f.lifecycle.activate(); f.release();
  assert.doesNotThrow(() => f.lifecycle.deactivate());
  assert.doesNotThrow(() => { f.lifecycle.finish(); f.lifecycle.playIfReady(); });
  assert.deepEqual(f.counts(), { paused: 0, played: 0, completed: 0 });
});
test('a native pause rejection still completes once across skip/end/timeout races', () => {
  const f = fixture(); f.lifecycle.activate(); f.release();
  assert.doesNotThrow(() => { f.lifecycle.finish(); f.lifecycle.finish(); f.lifecycle.finish(); });
  assert.deepEqual(f.counts(), { paused: 0, played: 0, completed: 1 });
});
test('released status getter/play fails open instead of raising a render error', () => {
  const f = fixture(); f.lifecycle.activate(); f.release(); f.lifecycle.appStateChanged('active');
  assert.doesNotThrow(() => f.lifecycle.reduceMotionChanged(false));
  assert.equal(f.counts().completed, 1);
});
test('normal playback pauses before one completion and cannot replay afterwards', () => {
  const f = fixture(); f.show(); f.lifecycle.finish(); f.lifecycle.playIfReady(); f.lifecycle.finish();
  assert.deepEqual(f.counts(), { paused: 1, played: 1, completed: 1 });
});
test('development effect setup/cleanup/setup stays usable without pausing or releasing from cleanup', () => {
  const f = fixture(); f.lifecycle.activate(); f.lifecycle.deactivate(); f.show(); f.lifecycle.finish();
  assert.deepEqual(f.counts(), { paused: 1, played: 1, completed: 1 });
});

test('first Expo Go launch waits through null/inactive/background and arms timeout on first active only', () => {
  const f = fixture(); f.lifecycle.activate(); f.lifecycle.reduceMotionChanged(false);
  for (const state of [null, 'inactive', 'background']) f.lifecycle.appStateChanged(state);
  assert.deepEqual(f.counts(), { paused: 0, played: 0, completed: 0 }); assert.equal(f.presentations(), 0);
  f.lifecycle.appStateChanged('active'); assert.equal(f.presentations(), 1); assert.equal(f.counts().played, 1);
  f.lifecycle.appStateChanged('active'); assert.equal(f.presentations(), 1);
  f.lifecycle.appStateChanged('background'); assert.equal(f.counts().completed, 1);
  f.lifecycle.appStateChanged('active'); assert.equal(f.counts().completed, 1);
});
test('ready event after motion check starts video, while reduced motion completes without playing', () => {
  let status = 'loading'; let plays = 0; let done = 0;
  const lifecycle = createIntroLifecycle({ pause() {}, play() { plays++; }, get status() { return status; } }, () => done++);
  lifecycle.activate(); lifecycle.appStateChanged('active'); lifecycle.reduceMotionChanged(false); assert.equal(plays, 0);
  status = 'readyToPlay'; lifecycle.statusChanged(status); assert.equal(plays, 1);
  const f = fixture(); f.lifecycle.activate(); f.lifecycle.appStateChanged('active'); f.lifecycle.reduceMotionChanged(true);
  assert.deepEqual(f.counts(), { paused: 1, played: 0, completed: 1 }); assert.equal(done, 0);
});
test('initial video error is retained until presentation and finishes without trapping startup', () => {
  const f = fixture(); f.lifecycle.activate(); f.lifecycle.statusChanged('error');
  assert.equal(f.counts().completed, 0); f.lifecycle.reduceMotionChanged(false); f.lifecycle.appStateChanged('active');
  assert.deepEqual(f.counts(), { paused: 1, played: 0, completed: 1 });
});
test('cleanup/setup re-arms the safety timeout only once per actual presentation', () => {
  const f = fixture(); f.show(); f.lifecycle.deactivate(); f.lifecycle.activate(); f.lifecycle.appStateChanged('inactive');
  assert.equal(f.presentations(), 1); f.lifecycle.appStateChanged('active'); assert.equal(f.presentations(), 2);
  f.lifecycle.finish(); f.lifecycle.finish(); assert.equal(f.counts().completed, 1);
});
