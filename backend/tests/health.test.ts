import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/app.js';

test('health reports process only, and business routes remain unavailable', async () => {
  const server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    const response = await fetch(`${origin}/health`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.has('x-powered-by'), false);
    assert.deepEqual(await response.json(), { service: 'tazweed-backend', status: 'ok', phase: '01', database: 'not-configured', businessServices: 'not-implemented' });
    for (const path of ['/api/orders', '/api/catalog', '/api/auth/login']) {
      const missing = await fetch(origin + path);
      assert.equal(missing.status, 404);
      assert.equal((await missing.json()).error.code, 'NOT_FOUND');
    }
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
