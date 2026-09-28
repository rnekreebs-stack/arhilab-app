import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePayload, specification } from '../../src/sync/registry.js';

const id='11111111-1111-4111-8111-111111111111';
const base={projectId:id,category:'materials',amount:'0.01',currency:'RUB',
  businessDate:'2026-09-28',description:'Кабель и автоматика'};

test('F3 expense requires explicit positive decimal, currency, date and bounded description',()=>{
  assert.equal(specification('expense')?.table,'expenses');
  assert.deepEqual(parsePayload('expense','create',base),base);
  for(const amount of ['0','0.00','-1','0.001','NaN','Infinity','10000000000000000']) {
    assert.equal(parsePayload('expense','create',{...base,amount}),null,amount);
  }
  for(const field of [
    {currency:'rub'},{businessDate:'not-a-date'},{category:'cash'},{description:'  '},
    {description:'x'.repeat(251)},{note:'x'.repeat(1001)},{estimateId:'not-uuid'}
  ]) assert.equal(parsePayload('expense','create',{...base,...field}),null,JSON.stringify(field).slice(0,30));
  assert.equal(parsePayload('expense','update',{description:'Исправлено'})?.description,'Исправлено');
  assert.deepEqual(parsePayload('expense','delete',{}),{});
});
