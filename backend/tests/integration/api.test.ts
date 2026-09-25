import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { pool } from '../../src/database/pool.js';
import { createApp } from '../../src/app.js';
let server: Server;
let base: string;
before(async () => {
  await pool.query('SELECT 1');
  server = createApp().listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('Missing port');
  base = `http://127.0.0.1:${address.port}`;
});
after(async () => { if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await pool.end(); });
test('health reaches PostgreSQL', async () => {
  const response = await fetch(`${base}/api/v1/health`);
  assert.equal(response.status, 200);
  const body = await response.json() as Record<string, string>;
  assert.equal(body.database, 'connected');
  assert.equal(body.status, 'ok');
});
test('unknown routes return a safe 404', async () => {
  const response = await fetch(`${base}/api/v1/missing`);
  assert.equal(response.status, 404);
  const body = await response.json() as Record<string, string>;
  assert.equal(body.error, 'Not found');
  assert.equal(typeof body.requestId, 'string');
});
test('invalid JSON and oversized payload receive safe errors', async () => {
  for (const [body, expectedStatus] of [['{broken', 400], [JSON.stringify({ contents: 'x'.repeat(1_100_000) }), 413]] as const) {
    const response = await fetch(`${base}/api/v1/health`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    assert.equal(response.status, expectedStatus);
    const text = await response.text();
    assert.doesNotMatch(text, /SyntaxError|stack|node_modules|\/app\/|postgresql:\/\//);
  }
});
test('database failure is reported as unavailable without disclosing details', async () => {
  const unavailable = createApp({ query: async () => { throw Error('secret database failure'); } }).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => unavailable.once('listening', resolve));
  const address = unavailable.address();
  if (!address || typeof address === 'string') throw Error('Missing port');
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/health`);
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /secret database failure/);
  } finally { await new Promise<void>(resolve => unavailable.close(() => resolve())); }
});
