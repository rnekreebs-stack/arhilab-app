import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConfig } from '../../src/config/env.js';
test('configuration rejects missing database URL and invalid rate limit', () => {
  assert.throws(() => parseConfig({}), /DATABASE_URL/);
  assert.throws(() => parseConfig({ DATABASE_URL: 'postgresql://example/test', RATE_LIMIT_MAX: '0' }), /RATE_LIMIT_MAX/);
  assert.equal(parseConfig({ DATABASE_URL: 'postgresql://example/test' }).PORT, 3000);
});
