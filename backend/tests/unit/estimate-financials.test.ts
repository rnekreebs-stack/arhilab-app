import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePayload } from '../../src/sync/registry.js';

const project='f8eb4554-0b91-40da-9ccf-3c8664ff59fa';
test('F1 amount and item inputs are decimal strings; internal costs never enter ordinary sync',()=>{
  assert.ok(parsePayload('estimate','create',{projectId:project,name:'Original',delivery:'75.20',discount:'1.05',workMarkupPercent:'10.00'}));
  assert.ok(parsePayload('estimateItem','create',{estimateId:project,title:'Work',kind:'work',quantity:'1.25',unit:'m2',
    price:'100.05',coefficient:'1.5000',autoMaterial:true,materialPrice:'30.00',catalogKey:'work-key'}));
  assert.equal(parsePayload('estimateItem','create',{estimateId:project,title:'Work',quantity:'1',price:'0.001'}),null);
  assert.equal(parsePayload('estimateItem','update',{price:'1e2'}),null);
  assert.equal(parsePayload('estimateItem','update',{cost:'20.00'}),null);
  assert.equal(parsePayload('estimate','update',{profit:'999.00'}),null);
});
