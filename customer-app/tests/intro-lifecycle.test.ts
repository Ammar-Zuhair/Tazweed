import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createIntroLifecycle } from '../integration/intro-lifecycle';

function fixture() {
  let released = false; let paused = 0; let played = 0; let completed = 0;
  const guard = () => { if (released) throw new Error('Cannot use shared object that was already released'); };
  const player = { pause() { guard(); paused++; }, play() { guard(); played++; }, get status() { guard(); return 'readyToPlay'; } };
  const lifecycle = createIntroLifecycle(player, () => completed++);
  return { lifecycle, release() { released = true; }, counts: () => ({ paused, played, completed }) };
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
  const f = fixture(); f.lifecycle.activate(); f.release();
  assert.doesNotThrow(() => f.lifecycle.playIfReady());
  assert.equal(f.counts().completed, 1);
});
test('normal playback pauses before one completion and cannot replay afterwards', () => {
  const f = fixture(); f.lifecycle.activate(); f.lifecycle.playIfReady(); f.lifecycle.finish(); f.lifecycle.playIfReady(); f.lifecycle.finish();
  assert.deepEqual(f.counts(), { paused: 1, played: 1, completed: 1 });
});
test('development effect setup/cleanup/setup stays usable without pausing or releasing from cleanup', () => {
  const f = fixture(); f.lifecycle.activate(); f.lifecycle.deactivate(); f.lifecycle.activate(); f.lifecycle.playIfReady(); f.lifecycle.finish();
  assert.deepEqual(f.counts(), { paused: 1, played: 1, completed: 1 });
});
