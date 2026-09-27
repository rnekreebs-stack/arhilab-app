import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePayload,visibleSnapshot } from '../../src/sync/registry.js';

const project='f8eb4554-0b91-40da-9ccf-3c8664ff59fa';
test('F1 amounts use decimal strings and private costs remain strictly scoped to admin snapshots',()=>{
  assert.ok(parsePayload('estimate','create',{projectId:project,name:'Original',delivery:'75.20',discount:'1.05',workMarkupPercent:'10.00'}));
  assert.ok(parsePayload('estimateItem','create',{estimateId:project,title:'Work',kind:'work',quantity:'1.25',unit:'m2',
    price:'100.05',coefficient:'1.5000',autoMaterial:true,materialPrice:'30.00',catalogKey:'work-key'}));
  assert.equal(parsePayload('estimateItem','create',{estimateId:project,title:'Work',quantity:'1',price:'0.001'}),null);
  assert.equal(parsePayload('estimateItem','update',{price:'1e2'}),null);
  assert.equal(parsePayload('estimateItem','update',{cost:'20.00'}),null);
  assert.equal(parsePayload('estimate','update',{profit:'999.00'}),null);
  assert.ok(parsePayload('estimateItem','update',{privateData:{cost:'45.00',materialTier:'standard',materials:['Песок']}}));
  assert.equal(parsePayload('estimateItem','update',{privateData:{cost:'45.00',refreshToken:'secret'}}),null);
  assert.equal(parsePayload('estimate','update',{privateData:{passwordHash:'secret'}}),null);
  assert.deepEqual(visibleSnapshot('manager',{id:project,privateData:{cost:'45.00'}}),{id:project});
  assert.deepEqual(visibleSnapshot('worker',{id:project,privateData:{cost:'45.00'}}),{id:project});
  assert.deepEqual(visibleSnapshot('admin',{id:project,privateData:{cost:'45.00'}}),{id:project,privateData:{cost:'45.00'}});
});
