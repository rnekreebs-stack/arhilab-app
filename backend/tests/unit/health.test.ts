import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkDatabase } from '../../src/services/health.js';
test('health checks PostgreSQL and fails closed', async () => {
  assert.equal(await checkDatabase({ query: async () => ({}) } as never), true);
  assert.equal(await checkDatabase({ query: async () => { throw Error('secret'); } } as never), false);
});
