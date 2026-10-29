import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePreference, resolveTheme } from '../src/ui/theme-model';
import { assertPreviewEnvironment, createFakeFoundationRepository } from '../src/data/foundation-repository';

test('a missing or corrupt preference follows the system; explicit choices survive a system change', () => {
  for (const value of [null, undefined, '', 'broken', 'system']) assert.equal(parsePreference(value), 'system');
  assert.equal(resolveTheme(parsePreference(null), 'dark'), 'dark');
  assert.equal(resolveTheme('system', null), 'light');
  assert.equal(resolveTheme('light', 'dark'), 'light');
  assert.equal(resolveTheme('dark', 'light'), 'dark');
});
test('fake data is labelled, empty is separate, and errors can recover through a fresh request', async () => {
  const ready = await createFakeFoundationRepository('ready', 0).getOverview();
  assert.equal(ready.source, 'fake'); assert.match(ready.message, /تجريبية/); assert(ready.highlights.length > 0);
  assert.equal((await createFakeFoundationRepository('empty', 0).getOverview()).highlights.length, 0);
  await assert.rejects(createFakeFoundationRepository('error', 0).getOverview(), /تعذر/);
  assert.equal((await createFakeFoundationRepository('ready', 0).getOverview()).source, 'fake');
});
test('cancelled work cannot publish stale data after navigation', async () => {
  const controller = new AbortController();
  const pending = createFakeFoundationRepository('loading', 10_000).getOverview(controller.signal);
  controller.abort();
  await assert.rejects(pending, /aborted/);
  await assert.rejects(createFakeFoundationRepository().getOverview(controller.signal), /aborted/);
});
test('a production environment cannot use preview repositories', () => {
  assert.doesNotThrow(() => assertPreviewEnvironment('preview'));
  assert.throws(() => assertPreviewEnvironment('production'), /production/);
});
