import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyFailure, retryDelayMs } from '../../src/sync/client/retry.js';
test('retry increases, caps, jitters and honors bounded Retry-After', () => {
  assert.equal(retryDelayMs(1,0),500);
  assert.equal(retryDelayMs(1,0.999) < 1000,true);
  assert.equal(retryDelayMs(2,0),1000);
  assert.equal(retryDelayMs(20,0),30000);
  assert.equal(retryDelayMs(20,0.999) < 60000,true);
  assert.equal(retryDelayMs(1,0,120),120000);
  assert.equal(retryDelayMs(1,0,600),300000);
  assert.throws(()=>retryDelayMs(0,0));
  assert.throws(()=>retryDelayMs(1,Number.NaN));
  assert.throws(()=>retryDelayMs(1,0,-1));
});
test('classifies temporary, authorization, conflict and permanent failures', () => {
  assert.equal(classifyFailure({}),'retry');
  assert.equal(classifyFailure({httpStatus:500}),'retry');
  assert.equal(classifyFailure({httpStatus:503}),'retry');
  assert.equal(classifyFailure({httpStatus:429,retryAfterSeconds:4}),'retry');
  assert.equal(classifyFailure({httpStatus:401}),'auth_required');
  assert.equal(classifyFailure({httpStatus:409,errorClass:'conflict'}),'conflict');
  assert.equal(classifyFailure({httpStatus:400,errorClass:'validation'}),'permanent');
  assert.equal(classifyFailure({httpStatus:403,errorClass:'authorization'}),'permanent');
  assert.equal(classifyFailure({httpStatus:403,errorClass:'retryable'}),'permanent');
  assert.equal(classifyFailure({httpStatus:413}),'permanent');
});
