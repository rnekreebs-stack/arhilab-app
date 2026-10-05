import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { parsePayload, visibleSnapshot } from '../../src/sync/registry.js';

test('F5 task validates canonical status, date-only, assignment and bounded fields',()=>{
  const projectId=randomUUID(),estimateId=randomUUID();
  const valid={projectId,estimateId,title:'Монтаж трапа',description:'После стяжки',status:'open',priority:'high',dueDate:'2026-09-28'};
  assert.deepEqual(parsePayload('task','create',valid),valid);
  for(const payload of [{...valid,priority:'critical'},{...valid,dueDate:'2026-02-30'},
    {...valid,description:'x'.repeat(1001)},{...valid,createdBy:randomUUID()},
    {...valid,completedAt:'2026-09-28T10:00:00Z'},{...valid,title:''}])
    assert.equal(parsePayload('task','create',payload),null);
  assert.deepEqual(parsePayload('task','update',{status:'done'}),{status:'done'});
  assert.equal(parsePayload('task','update',{}),null);
  assert.equal(visibleSnapshot('worker',{title:'Inspect',privateData:{cost:1},price:'100'}).price,undefined);
});
