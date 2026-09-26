import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePayload } from '../../src/sync/registry.js';

test('F1 estimate markup is optional for legacy create and bounded decimal on update',()=>{
  const projectId='f8eb4554-0b91-40da-9ccf-3c8664ff59fa';
  assert.ok(parsePayload('estimate','create',{projectId,name:'Legacy'}));
  for(const value of ['0','0.01','5','10.50','100','100.00'])
    assert.equal(parsePayload('estimate','update',{workMarkupPercent:value})?.workMarkupPercent,value);
  for(const value of ['-1','100.01','01','0.001','1e2',1,101,''])
    assert.equal(parsePayload('estimate','update',{workMarkupPercent:value}),null);
});
