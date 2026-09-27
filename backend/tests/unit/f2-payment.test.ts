import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePayload } from '../../src/sync/registry.js';
const projectId='f8eb4554-0b91-40da-9ccf-3c8664ff59fa';
test('F2 payment payload preserves planned and paid amounts with explicit currency and dates',()=>{
  const payload={projectId,estimateId:projectId,amount:'50000.00',paidAmount:'30000.01',
    currency:'EUR',kind:'income',businessDate:'2026-09-27',planDate:'2026-10-01',
    actualDate:null,comment:'Первый этап'};
  assert.deepEqual(parsePayload('payment','create',payload),payload);
  assert.equal(parsePayload('payment','create',{...payload,currency:''}),null);
  assert.equal(parsePayload('payment','create',{...payload,currency:'eur'}),null);
  assert.equal(parsePayload('payment','create',{...payload,amount:'1.001'}),null);
  assert.equal(parsePayload('payment','create',{...payload,businessDate:'tomorrow'}),null);
  assert.equal(parsePayload('payment','create',{...payload,comment:'a'.repeat(1001)}),null);
  assert.equal(parsePayload('payment','update',{paidAmount:'55000.00',comment:'Исправлено'})?.paidAmount,'55000.00');
  assert.deepEqual(parsePayload('payment','delete',{}),{});
});
